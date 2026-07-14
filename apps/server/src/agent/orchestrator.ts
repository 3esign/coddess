import { nanoid } from 'nanoid';
import type { NormalizedEntry, Project } from '@coddess/shared';
import { DEFAULT_MODEL, ORCH_PARALLEL, ORCH_CONCURRENCY } from '../config.js';
import { buildTree } from '../fsutil.js';
import { runAgent, type RunHandle } from './loop.js';
import { chatStream } from './provider/providerRouter.js';
import { listTasks, createTask, updateTask, deleteTask, type TaskCard } from '../tasksStore.js';
import { ensureRepo, addWorktree, removeWorktree, commitAll, mergeBranch, abortMerge } from '../git.js';
import { chatPaths, ensureChatDir, appendHistory } from './chatStore.js';

/**
 * Orchestration / architectural intelligence (autonomous multi-task builder).
 * Given a high-level goal, it plans an architecture — an ordered set of concrete
 * build subtasks — then executes them through the agent loop. Two modes:
 *   - sequential (default): tasks run one after another in the same chat, so
 *     later steps build on earlier ones.
 *   - parallel (CODDESS_ORCH_PARALLEL=1): each subtask runs in its own git
 *     worktree/branch concurrently (bounded), then merges back. Best for
 *     independent subtasks; merges are serialized and conflicts are surfaced.
 */

type Emit = (e: NormalizedEntry) => void;

interface PlannedTask { title: string; prompt: string; }
interface Plan { overview: string; tasks: PlannedTask[]; }

const PLANNER_SYSTEM = `You are the orchestration architect for Coddess, an autonomous software builder.
Given a high-level goal and the project's current files, decompose it into an ORDERED list of concrete, independently-executable build subtasks that together deliver the goal.
Respond with ONLY a JSON object (no prose, no fences):
{
  "overview": "one or two sentences describing the architecture / approach",
  "tasks": [
    { "title": "short imperative title", "prompt": "a complete, self-contained instruction to a coding agent working in THIS project folder" }
  ]
}
Rules: 2 to 8 tasks. Order matters — later tasks may rely on earlier ones being done. Each task.prompt must be fully self-contained and actionable on its own. Prefer the simplest architecture that satisfies the goal. No emojis or fluff. Output valid JSON only.`;

function extractJson(text: string): any | null {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function toPlan(raw: any): Plan | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) return null;
  const tasks: PlannedTask[] = raw.tasks
    .map((t: any) => ({
      title: String(t?.title || '').trim() || 'Untitled step',
      prompt: String(t?.prompt || t?.title || '').trim(),
    }))
    .filter((t: PlannedTask) => t.prompt.length > 0)
    .slice(0, 8);
  if (tasks.length === 0) return null;
  return { overview: String(raw.overview || '').trim(), tasks };
}

export async function planArchitecture(project: Project, goal: string, model: string, tree: string, signal?: AbortSignal): Promise<Plan | null> {
  const user = `Project: ${project.name}
Current files:
${tree || '(empty folder — building from scratch)'}

High-level goal:
"""
${goal}
"""

Produce the orchestration plan JSON now.`;
  let full = '';
  try {
    for await (const chunk of chatStream(model, [
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user', content: user },
    ], signal)) {
      full += chunk;
    }
  } catch {
    return null;
  }
  return toPlan(extractJson(full));
}

function flatten(nodes: ReturnType<typeof buildTree>, prefix = ''): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(`${prefix}${n.type === 'dir' ? n.name + '/' : n.name}`);
    if (n.children) out.push(...flatten(n.children, prefix + '  '));
  }
  return out;
}

export function startOrchestration(
  project: Project,
  goal: string,
  modelOverride: string | undefined,
  chatId: string,
  maxTokens: number | undefined,
  projectMaxTokens: number | undefined,
  emit: Emit
): RunHandle {
  const runId = nanoid(8);
  const controller = new AbortController();
  const model = modelOverride || project.model || DEFAULT_MODEL;
  void driveOrchestration(project, goal, model, runId, chatId, maxTokens, projectMaxTokens, controller.signal, emit).catch((err) => {
    emit({ kind: 'error', runId, projectId: project.id, ts: Date.now(), message: (err as Error).message, chatId });
    emit({ kind: 'status', runId, projectId: project.id, ts: Date.now(), status: 'error', chatId });
  });
  const cancel = () => controller.abort();
  return { runId, cancel, pause: cancel };
}

async function driveOrchestration(
  project: Project,
  goal: string,
  model: string,
  runId: string,
  chatId: string,
  maxTokens: number | undefined,
  projectMaxTokens: number | undefined,
  signal: AbortSignal,
  emit: Emit
): Promise<void> {
  const base = { runId, projectId: project.id, chatId };
  const paths = chatPaths(project, chatId);
  ensureChatDir(paths);

  const emitAndSave = (entry: NormalizedEntry) => {
    emit(entry);
    appendHistory(paths, entry);
  };

  emit({ kind: 'status', ...base, ts: Date.now(), status: 'running', detail: 'orchestrator: planning' });
  emitAndSave({ kind: 'user_prompt', ...base, ts: Date.now(), text: goal });

  const tree = flatten(buildTree(project.path)).slice(0, 200).join('\n');
  const plan = await planArchitecture(project, goal, model, tree, signal);

  if (signal.aborted) {
    emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'cancelled' });
    return;
  }
  if (!plan) {
    emitAndSave({ kind: 'error', ...base, ts: Date.now(), message: 'The orchestrator could not produce a valid plan. Try rephrasing the goal.' });
    emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'error' });
    return;
  }

  for (const t of listTasks(project)) deleteTask(project, t.id);
  const cards = plan.tasks.map((t) => createTask(project, { title: t.title, prompt: t.prompt, label: 'Auto', model }));

  const parallel = ORCH_PARALLEL && plan.tasks.length > 1;
  emitAndSave({
    kind: 'orchestration', ...base, ts: Date.now(), phase: 'plan',
    text: `${plan.overview || `Planned ${plan.tasks.length} tasks.`}${parallel ? ` (parallel, up to ${ORCH_CONCURRENCY} at once)` : ''}`,
    overview: plan.overview,
    tasks: plan.tasks.map((t) => ({ title: t.title })),
  });

  const completed = parallel
    ? await runParallel(project, plan, cards, model, chatId, maxTokens, projectMaxTokens, signal, emitAndSave, base)
    : await runSequential(project, plan, cards, model, chatId, maxTokens, projectMaxTokens, signal, emitAndSave, base);

  const summary = signal.aborted
    ? `Orchestration cancelled after ${completed}/${plan.tasks.length} tasks.`
    : `Orchestration finished: ${completed}/${plan.tasks.length} tasks completed.`;
  emitAndSave({ kind: 'orchestration', ...base, ts: Date.now(), phase: 'done', text: summary });
  emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: signal.aborted ? 'cancelled' : 'done' });
}

async function runSequential(
  project: Project,
  plan: Plan,
  cards: TaskCard[],
  model: string,
  chatId: string,
  maxTokens: number | undefined,
  projectMaxTokens: number | undefined,
  signal: AbortSignal,
  emitAndSave: Emit,
  base: { runId: string; projectId: string; chatId: string }
): Promise<number> {
  let completed = 0;
  for (let i = 0; i < plan.tasks.length; i++) {
    if (signal.aborted) break;
    const card = cards[i]!;
    updateTask(project, card.id, { status: 'running' });
    emitAndSave({ kind: 'orchestration', ...base, ts: Date.now(), phase: 'task', text: `Task ${i + 1}/${plan.tasks.length}: ${plan.tasks[i]!.title}` });
    const status = await runAgent(project, plan.tasks[i]!.prompt, model, nanoid(8), chatId, { skipIntent: true, maxTokens, projectMaxTokens }, signal, () => false, emitAndSave);
    updateTask(project, card.id, { status: status === 'done' ? 'done' : 'review' });
    if (status === 'done') completed++;
    emitAndSave({ kind: 'orchestration', ...base, ts: Date.now(), phase: 'task', text: `Task ${i + 1}/${plan.tasks.length} ${status}` });
    if (status === 'error' || status === 'cancelled') break;
  }
  return completed;
}

async function runParallel(
  project: Project,
  plan: Plan,
  cards: TaskCard[],
  model: string,
  chatId: string,
  maxTokens: number | undefined,
  projectMaxTokens: number | undefined,
  signal: AbortSignal,
  emitAndSave: Emit,
  base: { runId: string; projectId: string; chatId: string }
): Promise<number> {
  await ensureRepo(project.path);
  let completed = 0;
  let mergeChain: Promise<void> = Promise.resolve();

  const runOne = async (i: number) => {
    if (signal.aborted) return;
    const card = cards[i]!;
    const branch = `coddess/task-${i + 1}-${card.id}`;
    updateTask(project, card.id, { status: 'running', branch });
    emitAndSave({ kind: 'orchestration', ...base, ts: Date.now(), phase: 'task', text: `Task ${i + 1}/${plan.tasks.length} started (worktree): ${plan.tasks[i]!.title}` });

    const wt = await addWorktree(project.path, card.id, branch);
    if (!wt.ok) {
      updateTask(project, card.id, { status: 'review' });
      emitAndSave({ kind: 'orchestration', ...base, ts: Date.now(), phase: 'task', text: `Task ${i + 1} could not create a worktree: ${wt.output}` });
      return;
    }

    const subProject: Project = { ...project, path: wt.path };
    const status = await runAgent(subProject, plan.tasks[i]!.prompt, model, nanoid(8), `${chatId}::t${i + 1}`, { skipIntent: true, maxTokens, projectMaxTokens }, signal, () => false, emitAndSave);
    await commitAll(wt.path, `Task ${i + 1}: ${plan.tasks[i]!.title}`);

    // Serialize merges into the main working tree.
    mergeChain = mergeChain.then(async () => {
      if (signal.aborted) return;
      const m = await mergeBranch(project.path, branch);
      if (m.ok) {
        updateTask(project, card.id, { status: status === 'done' ? 'done' : 'review' });
        if (status === 'done') completed++;
        emitAndSave({ kind: 'orchestration', ...base, ts: Date.now(), phase: 'task', text: `Task ${i + 1}/${plan.tasks.length} merged (${status})` });
      } else {
        await abortMerge(project.path);
        updateTask(project, card.id, { status: 'review' });
        emitAndSave({ kind: 'orchestration', ...base, ts: Date.now(), phase: 'task', text: `Task ${i + 1} merge conflict — left on branch ${branch} for review` });
      }
      await removeWorktree(project.path, card.id);
    });
    await mergeChain;
  };

  let idx = 0;
  const workers = Array.from({ length: Math.min(ORCH_CONCURRENCY, plan.tasks.length) }, async () => {
    while (idx < plan.tasks.length && !signal.aborted) {
      const i = idx++;
      await runOne(i);
    }
  });
  await Promise.all(workers);
  await mergeChain;
  return completed;
}
