import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { NormalizedEntry, Project, Spec, RunStatus } from '@coddess/shared';
import { ALLOW_SHELL, DEFAULT_MODEL, ENABLE_INTENT, ENABLE_VERIFY, MAX_REPAIRS, ENABLE_KNOWLEDGE, ENABLE_COMPACTION, COMPACT_AT, COMPACT_KEEP_RECENT, NATIVE_TOOLS } from '../config.js';
import { buildTree } from '../fsutil.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { parseAction, extractReasoning, type ParsedAction } from './protocol.js';
import { runTool } from './tools.js';
import { runVerification } from './verify.js';
import { chatStream, ProviderError, type ChatMessage } from './provider/providerRouter.js';
import { Budget, countTokens } from './budget.js';
import { runCritique } from './observer.js';
import { scaffoldFor, type ScaffoldProfile } from './modelProfile.js';
import { compileIntent, specToPromptBlock } from './intent.js';
import { knowledgePromptBlock, updateKnowledgeFromRun } from './knowledge.js';
import { drainInjections } from './injections.js';
import { compactIfNeeded } from './compaction.js';
import { chatWithTools, providerSupportsNativeTools } from './nativeTools.js';
import {
  chatPaths,
  ensureChatDir,
  readMessages,
  writeMessages,
  appendHistory,
  updateChatMeta,
  isPausedContinuation,
  otherChatsTokens,
  type ChatPaths,
} from './chatStore.js';

type Emit = (e: NormalizedEntry) => void;

export interface RunHandle {
  runId: string;
  cancel: () => void;
  pause: () => void;
}

export interface ActiveRunInfo {
  projectId: string;
  chatId: string;
  model: string;
  runId: string;
}

export interface AgentRunOptions {
  maxTokens?: number;
  projectMaxTokens?: number;
  /** Skip the intent/spec pre-flight (used by the orchestrator, which already planned). */
  skipIntent?: boolean;
}

export const activeRuns = new Map<string, ActiveRunInfo>();

export function startRun(
  project: Project,
  prompt: string,
  modelOverride: string | undefined,
  chatId: string,
  maxTokens: number | undefined,
  projectMaxTokens: number | undefined,
  emit: Emit,
): RunHandle {
  const runId = nanoid(8);
  const controller = new AbortController();
  const model = modelOverride || project.model || DEFAULT_MODEL;
  let pauseRequested = false;

  void runAgent(project, prompt, model, runId, chatId, { maxTokens, projectMaxTokens }, controller.signal, () => pauseRequested, emit).catch(
    (err) => {
      emit({ kind: 'error', runId, projectId: project.id, ts: Date.now(), message: (err as Error).message, chatId });
      emit({ kind: 'status', runId, projectId: project.id, ts: Date.now(), status: 'error', chatId });
    },
  );

  return {
    runId,
    cancel: () => controller.abort(),
    pause: () => {
      pauseRequested = true;
      controller.abort();
    },
  };
}

/**
 * Run one agent task to completion and resolve with its terminal status. This is
 * the awaitable core the orchestrator drives sequentially, and the WS "run" path
 * fires and forgets.
 */
export async function runAgent(
  project: Project,
  prompt: string,
  model: string,
  runId: string,
  chatId: string,
  opts: AgentRunOptions,
  signal: AbortSignal,
  isPauseRequested: () => boolean,
  emit: Emit,
): Promise<RunStatus> {
  activeRuns.set(runId, { projectId: project.id, chatId, model, runId });
  const base = { runId, projectId: project.id, chatId };
  const paths = chatPaths(project, chatId);
  const profile = scaffoldFor(model);

  try {
    emit({ kind: 'status', ...base, ts: Date.now(), status: 'running', detail: `model: ${model} · tier: ${profile.tier}` });
    ensureChatDir(paths);

    const isContinuation = isPausedContinuation(paths, chatId);
    const formattedPrompt = isContinuation
      ? `[USER INTERRUPT / CONTINUATION]\nThe user paused your execution and has entered additional commands:\n"""\n${prompt}\n"""\n\nPlease evaluate these new commands against what you were working on. Determine your future steps, update your PLAN.md if necessary, and output your next action. You may also output a brief explanation or suggestions to the user inside <thinking>...</thinking>.`
      : prompt;

    let messages: ChatMessage[] = readMessages(paths).filter((m) => m.role !== 'system');

    const budget = new Budget(opts.maxTokens, opts.projectMaxTokens, otherChatsTokens(paths, chatId));
    for (const m of messages) budget.add(m.content);
    budget.add(formattedPrompt);

    const persistMeta = (status: string) =>
      updateChatMeta(paths, chatId, {
        totalTokens: budget.sessionTokens,
        lastOutputTokens: budget.lastOutputTokens,
        status,
        model,
        fallbackTitle: prompt.substring(0, 40) + (prompt.length > 40 ? '...' : ''),
      });

    const emitAndSave = (entry: NormalizedEntry) => {
      emit(entry);
      appendHistory(paths, entry);
    };
    const saveMessages = () => writeMessages(paths, messages);

    // Show the user's input immediately (before the intent stage runs).
    emitAndSave({ kind: 'user_prompt', ...base, ts: Date.now(), text: prompt });

    const tree = flatten(buildTree(project.path)).slice(0, 200).join('\n');

    // --- Pipeline Stage 0: Intent/Spec (skipped on continuations + orchestrated subtasks) ---
    let spec: Spec | null = null;
    if (!isContinuation && !opts.skipIntent && ENABLE_INTENT && profile.runIntent) {
      spec = await compileIntent(project, prompt, model, profile.tier, tree, signal);
      if (signal.aborted) {
        const status: RunStatus = isPauseRequested() ? 'paused' : 'cancelled';
        emitAndSave({ kind: 'status', ...base, ts: Date.now(), status });
        persistMeta(status);
        return status;
      }
    }
    const specBlock = spec ? specToPromptBlock(spec) : undefined;
    const knowledgeBlock = ENABLE_KNOWLEDGE ? knowledgePromptBlock(project) : undefined;
    const contextDirs = project.contextDirs || [];
    const contextBlock = buildContextBlock(contextDirs);

    const system = buildRunSystemPrompt(project, chatId, tree, specBlock, knowledgeBlock, contextBlock, profile, budget.remaining());
    budget.add(system);
    messages.unshift({ role: 'system', content: system });
    messages.push({ role: 'user', content: formattedPrompt });

    saveMessages();
    if (spec) emitAndSave({ kind: 'spec', ...base, ts: Date.now(), spec });

    let repairRounds = 0;

    for (let step = 0; ; step++) {
      if (signal.aborted) {
        const status: RunStatus = isPauseRequested() ? 'paused' : 'cancelled';
        emitAndSave({ kind: 'status', ...base, ts: Date.now(), status });
        persistMeta(status);
        return status;
      }

      // Drain any messages the user queued mid-run; inject them as context.
      const injected = drainInjections(project.id, chatId);
      for (const text of injected) {
        emitAndSave({ kind: 'user_prompt', ...base, ts: Date.now(), text });
        const m = '[USER MESSAGE - sent while you were working. Read it, reason about how it changes what you are doing, adjust your plan if needed, then continue.]' + '\n<user_message>\n' + text + '\n</user_message>';
        messages.push({ role: 'user', content: m });
        budget.add(m);
      }
      if (injected.length) saveMessages();

      // Compact the history if it is about to exceed the context window.
      if (ENABLE_COMPACTION) {
        const c = await compactIfNeeded(messages, model, COMPACT_AT, COMPACT_KEEP_RECENT, signal);
        if (c.compacted) {
          messages = c.messages;
          saveMessages();
          emitAndSave({ kind: 'assistant_message', ...base, ts: Date.now(), text: 'Context compacted: older turns were summarized to fit the model window.' });
        }
      }

      let full = '';
      let nativeAction: ParsedAction | null = null;
      const useNative = NATIVE_TOOLS && providerSupportsNativeTools(model);
      try {
        if (useNative) {
          const turn = await chatWithTools(model, messages, signal);
          full = turn.text || '';
          if (full) emitAndSave({ kind: 'assistant_token', ...base, ts: Date.now(), text: full });
          budget.add(full, true);
          budget.enforce();
          if (turn.call) {
            nativeAction = turn.call.name === 'finish'
              ? { type: 'final', summary: String((turn.call.args as Record<string, unknown>).summary ?? 'Done.') }
              : { type: 'tool', tool: turn.call.name, args: stringifyArgs(turn.call.args) };
          }
        } else {
          for await (const chunk of chatStream(model, messages, signal)) {
            full += chunk;
            emitAndSave({ kind: 'assistant_token', ...base, ts: Date.now(), text: chunk });
            budget.add(chunk, true);
            budget.enforce();
          }
        }
      } catch (err) {
        if (signal.aborted) {
          if (isPauseRequested()) {
            if (full.trim()) {
              messages.push({ role: 'assistant', content: full });
              saveMessages();
              const reasoning = extractReasoning(full);
              if (reasoning) emitAndSave({ kind: 'thinking', ...base, ts: Date.now(), text: reasoning });
            }
            emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'paused' });
            persistMeta('paused');
            void runCritique(project, chatId, model, emitAndSave);
            return 'paused';
          }
          emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'cancelled' });
          persistMeta('cancelled');
          return 'cancelled';
        }
        const msg = err instanceof ProviderError ? err.message : (err as Error).message;
        emitAndSave({ kind: 'error', ...base, ts: Date.now(), message: msg });
        emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'error' });
        persistMeta('error');
        return 'error';
      }

      messages.push({ role: 'assistant', content: full });
      saveMessages();

      const reasoning = extractReasoning(full);
      if (reasoning) emitAndSave({ kind: 'thinking', ...base, ts: Date.now(), text: reasoning });

      const action = nativeAction ?? parseAction(full);

      if (action.type === 'final') {
        // --- Pipeline Stage 3: verify -> repair (bounded) ---
        if (ENABLE_VERIFY && repairRounds < MAX_REPAIRS && !signal.aborted) {
          const v = await runVerification(project.path);
          if (v.ran) {
            emitAndSave({ kind: 'verify', ...base, ts: Date.now(), command: v.command, ok: v.ok, output: v.output, round: repairRounds + 1 });
          }
          if (v.ran && !v.ok) {
            repairRounds++;
            const repairMsg = `Verification FAILED (attempt ${repairRounds}/${MAX_REPAIRS}) — command: ${v.command}\n\n<verification>\n${v.output}\n</verification>\n\nDiagnose and fix the ROOT CAUSE of these failures, then continue. Do NOT call <final> again until this passes.`;
            messages.push({ role: 'user', content: repairMsg });
            budget.add(repairMsg);
            saveMessages();
            continue;
          }
        }
        emitAndSave({ kind: 'final', ...base, ts: Date.now(), summary: action.summary });
        emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'done' });
        persistMeta('done');
        if (ENABLE_KNOWLEDGE) void updateKnowledgeFromRun(project, chatId, model, emitAndSave);
        void runCritique(project, chatId, model, emitAndSave);
        return 'done';
      }

      if (action.type === 'none') {
        const surfaced = stripTags(full).trim();
        if (surfaced) emitAndSave({ kind: 'assistant_message', ...base, ts: Date.now(), text: surfaced });
        messages.push({
          role: 'user',
          content:
            'Reminder: respond with exactly one <tool>...</tool> action, or <final>...</final> if the task is complete. Do not reply in plain prose.',
        });
        saveMessages();
        continue;
      }

      emitAndSave({ kind: 'tool_use', ...base, ts: Date.now(), tool: action.tool, args: action.args });
      const result = await runTool(project.path, action.tool, action.args, contextDirs);
      emitAndSave({ kind: 'tool_result', ...base, ts: Date.now(), tool: action.tool, ok: result.ok, output: result.output });

      const remaining = budget.remaining();
      const budgetInfo =
        remaining !== undefined
          ? `\n\n[Budget Check: Remaining session budget is ${remaining} tokens. If you are close to running out, make sure to write CODDESS_STATUS.md and call <final>.]`
          : '';
      const observation = `<observation tool="${action.tool}" ok="${result.ok}">\n${result.output}\n</observation>\n\nContinue with your next single action.${budgetInfo}`;
      messages.push({ role: 'user', content: observation });
      budget.add(observation);
      saveMessages();

      if (isPauseRequested()) {
        emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'paused' });
        persistMeta('paused');
        void runCritique(project, chatId, model, emitAndSave);
        return 'paused';
      }
    }


  } finally {
    activeRuns.delete(runId);
  }
}

/** Assemble the full system prompt: harness + spec + file tree + concurrency warning + project rules. */
function buildRunSystemPrompt(
  project: Project,
  chatId: string,
  tree: string,
  specBlock: string | undefined,
  knowledgeBlock: string | undefined,
  contextBlock: string | undefined,
  profile: ScaffoldProfile,
  remainingTokens: number | undefined,
): string {
  let system = buildSystemPrompt({
    projectName: project.name,
    projectPath: project.path,
    os: `${os.type()} ${os.release()}`,
    tree,
    allowShell: ALLOW_SHELL,
    remainingTokens,
    specBlock,
    knowledgeBlock,
    contextBlock,
    tier: profile.tier,
    requireStructuredThinking: profile.requireStructuredThinking,
    smallSteps: profile.smallSteps,
  });

  const concurrent = Array.from(activeRuns.values()).filter((r) => r.projectId === project.id && r.chatId !== chatId);
  if (concurrent.length > 0) {
    const list = concurrent.map((r) => `- Chat: "${r.chatId}" (Model: ${r.model})`).join('\n');
    system += `\n\n# WARNING: CONCURRENT AGENTS ACTIVE
You are running in PARALLEL with other agents in this project:
${list}

To prevent conflicts and save tokens:
1. Avoid editing the same files simultaneously unless coordinated.
2. Read files before editing to confirm other agents haven't changed them.
3. Coordinate your tasks by inspecting and writing to PLAN.md.`;
  }

  const rulesPath = path.join(project.path, 'CODDESS_RULES.md');
  if (fs.existsSync(rulesPath)) {
    try {
      system += `\n\n# Project-Specific Rules / Instructions\n${fs.readFileSync(rulesPath, 'utf8')}`;
    } catch (err) {
      console.error('Failed to read project-specific rules:', err);
    }
  }
  return system;
}

function buildContextBlock(contextDirs: string[]): string | undefined {
  if (!contextDirs.length) return undefined;
  const parts = ['# Linked context folders (READ-ONLY reference). You may read_file / list_dir / search_code these using their ABSOLUTE paths below, but you can only WRITE inside the project root.'];
  for (const dir of contextDirs) {
    const t = flatten(buildTree(dir)).slice(0, 60).join('\n');
    parts.push(`\n${dir}\n${t || '(empty)'}`);
  }
  return parts.join('\n');
}

function flatten(nodes: ReturnType<typeof buildTree>, prefix = ''): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(`${prefix}${n.type === 'dir' ? n.name + '/' : n.name}`);
    if (n.children) out.push(...flatten(n.children, prefix + '  '));
  }
  return out;
}

function stringifyArgs(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
}

export { countTokens };
export type { ChatPaths };
