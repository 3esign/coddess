import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { NormalizedEntry, Project, Spec, RunStatus } from '@coddess/shared';
import { ALLOW_SHELL, DEFAULT_MODEL, ENABLE_INTENT, ENABLE_VERIFY, MAX_REPAIRS, ENABLE_KNOWLEDGE, ENABLE_COMPACTION, COMPACT_AT, COMPACT_KEEP_RECENT, NATIVE_TOOLS, MAX_STEPS, ENABLE_REPOMAP, REPOMAP_TOKENS, REPOMAP_MIN_FILES, ENABLE_REVIEW, MAX_REVIEW, ENABLE_BATCH_READS, STREAM_IDLE_MS, MAX_EMPTY_RESPONSES } from '../config.js';
import { buildTree } from '../fsutil.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { parseAction, parseActions, extractReasoning, type ParsedAction, type ToolAction } from './protocol.js';
import { runTool } from './tools.js';
import { runVerification } from './verify.js';
import { chatStream, ProviderError, type ChatMessage } from './provider/providerRouter.js';
import { Budget, countTokens } from './budget.js';
import { runCritique } from './observer.js';
import { scaffoldFor, type ScaffoldProfile } from './modelProfile.js';
import { compileIntent, specToPromptBlock, specToPlanFile } from './intent.js';
import { repoMapPromptBlock } from './repoMap.js';
import { reviewAgainstCriteria } from './review.js';
import { knowledgePromptBlock, updateKnowledgeFromRun } from './knowledge.js';
import { drainInjections, enqueueInjection } from './injections.js';
import { compactIfNeeded } from './compaction.js';
import { chatWithTools, providerSupportsNativeTools } from './nativeTools.js';
import {
  chatPaths,
  ensureChatDir,
  readMessages,
  writeMessages,
  appendHistory,
  readHistory,
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
  inject?: (text: string) => void;
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

  let currentStepAbort: AbortController | null = null;
  let onInjectInterrupt: (() => void) | null = null;

  void runAgent(
    project,
    prompt,
    model,
    runId,
    chatId,
    { maxTokens, projectMaxTokens },
    controller.signal,
    () => pauseRequested,
    emit,
    (stepAbort, onInterrupt) => {
      currentStepAbort = stepAbort;
      onInjectInterrupt = onInterrupt;
    }
  ).catch(
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
    inject: (text: string) => {
      emit({ kind: 'user_prompt', runId, projectId: project.id, chatId, ts: Date.now(), text });
      
      const paths = chatPaths(project, chatId);
      ensureChatDir(paths);
      appendHistory(paths, { kind: 'user_prompt', runId, projectId: project.id, chatId, ts: Date.now(), text });

      enqueueInjection(project.id, chatId, text);

      if (currentStepAbort) {
        onInjectInterrupt?.();
        currentStepAbort.abort();
      }
    }
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
  onStepUpdate?: (stepAbort: AbortController | null, onInterrupt: () => void) => void,
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
    } else {
      try {
        const history = readHistory(paths);
        const lastSpecEntry = [...history].reverse().find((item) => item.kind === 'spec') as any;
        if (lastSpecEntry && lastSpecEntry.spec) {
          spec = lastSpecEntry.spec;
        }
      } catch {
        /* ignore */
      }
    }
    const specBlock = spec ? specToPromptBlock(spec) : undefined;
    // Seed PLAN.md from the approved plan so the run starts against a real checklist
    // (skipped for orchestrated subtasks and paused continuations, which reuse it).
    if (spec && !isContinuation && !opts.skipIntent) seedPlanFile(project.path, spec);
    const knowledgeBlock = ENABLE_KNOWLEDGE ? knowledgePromptBlock(project) : undefined;
    const contextDirs = project.contextDirs || [];
    const contextBlock = buildContextBlock(contextDirs);
    const repoMapBlock = ENABLE_REPOMAP ? repoMapPromptBlock(project.path, REPOMAP_TOKENS, REPOMAP_MIN_FILES, repoHints(prompt, spec)) : undefined;

    const system = buildRunSystemPrompt(project, chatId, tree, specBlock, knowledgeBlock, contextBlock, repoMapBlock, profile, budget.remaining());
    budget.add(system);
    messages.unshift({ role: 'system', content: system });
    messages.push({ role: 'user', content: formattedPrompt });

    saveMessages();
    if (spec) emitAndSave({ kind: 'spec', ...base, ts: Date.now(), spec });

    let repairRounds = 0;
    let reviewRounds = 0;
    let lastTool: string | null = null;
    let lastArgsKey: string | null = null;
    let consecutiveSameCount = 0;
    let consecutiveNone = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) {
        const status: RunStatus = isPauseRequested() ? 'paused' : 'cancelled';
        emitAndSave({ kind: 'status', ...base, ts: Date.now(), status });
        persistMeta(status);
        return status;
      }

      // Drain any messages the user queued mid-run; inject them as context.
      const injected = drainInjections(project.id, chatId);
      for (const text of injected) {
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
          emitAndSave({ kind: 'assistant_message', ...base, ts: Date.now(), text: c.noteText || 'Context compacted: older turns were summarized to fit the model window.' });
        }
      }

      let full = '';
      let nativeAction: ParsedAction | null = null;
      const useNative = NATIVE_TOOLS && providerSupportsNativeTools(model);

      // Stall watchdog: forward the external abort to an internal controller and
      // additionally abort it if the model goes silent for STREAM_IDLE_MS. This is
      // the signal actually handed to the provider, so a hung stream can no longer
      // leave the run wedged with the UI stuck in a "running" state.
      let stalled = false;
      const streamAbort = new AbortController();
      let interruptedByInjection = false;
      const onInterrupt = () => { interruptedByInjection = true; };
      onStepUpdate?.(streamAbort, onInterrupt);
      const forwardAbort = () => streamAbort.abort();
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };
      const armIdle = () => {
        if (!STREAM_IDLE_MS) return;
        clearIdle();
        idleTimer = setTimeout(() => { stalled = true; streamAbort.abort(); }, STREAM_IDLE_MS);
      };
      if (signal.aborted) streamAbort.abort();
      else signal.addEventListener('abort', forwardAbort, { once: true });

      try {
        armIdle();
        if (useNative) {
          const turn = await chatWithTools(model, messages, streamAbort.signal);
          clearIdle();
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
          for await (const chunk of chatStream(model, messages, streamAbort.signal)) {
            armIdle(); // progress: reset the stall timer on every chunk
            full += chunk;
            emitAndSave({ kind: 'assistant_token', ...base, ts: Date.now(), text: chunk });
            budget.add(chunk, true);
            budget.enforce();
          }
          clearIdle();
        }
      } catch (err) {
        clearIdle();
        signal.removeEventListener('abort', forwardAbort);
        onStepUpdate?.(null, () => {});

        if (interruptedByInjection) {
          if (full.trim()) {
            messages.push({ role: 'assistant', content: full });
            saveMessages();
            const reasoning = extractReasoning(full);
            if (reasoning) emitAndSave({ kind: 'thinking', ...base, ts: Date.now(), text: reasoning });
          }
          continue;
        }
        // Model went silent (not a user abort): end the run with a clear error
        // rather than hanging. streamAbort fired but the external signal did not.
        if (stalled && !signal.aborted) {
          const secs = Math.round(STREAM_IDLE_MS / 1000);
          const stallMsg = `The model produced no output for ${secs}s and appears to have stalled. This is usually an Ollama context overflow or an overloaded local model. Run stopped. Try a smaller task, a larger num_ctx, or a lighter model.`;
          emitAndSave({ kind: 'error', ...base, ts: Date.now(), message: stallMsg });
          emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'error' });
          writeStatusFileSafe(project.path, stallMsg);
          persistMeta('error');
          return 'error';
        }
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
      onStepUpdate?.(null, () => {});
      signal.removeEventListener('abort', forwardAbort);

      messages.push({ role: 'assistant', content: full });
      saveMessages();

      const reasoning = extractReasoning(full);
      if (reasoning) emitAndSave({ kind: 'thinking', ...base, ts: Date.now(), text: reasoning });

      const actions = nativeAction ? [nativeAction] : parseActions(full);
      const firstAction = actions[0] || { type: 'none' };
      const action = firstAction;

      if (action.type === 'tool') {
        const argsKey = `${action.tool}:${JSON.stringify(action.args)}`;
        if (action.tool === lastTool && argsKey === lastArgsKey) {
          consecutiveSameCount++;
        } else {
          consecutiveSameCount = 1;
          lastTool = action.tool;
          lastArgsKey = argsKey;
        }
      } else {
        consecutiveSameCount = 0;
        lastTool = null;
        lastArgsKey = null;
      }

      // Hard loop-breaker: if the model repeats the exact same action with no new
      // result, stop instead of burning the whole budget on a stuck loop.
      if (action.type === 'tool' && consecutiveSameCount >= 6) {
        emitAndSave({ kind: 'assistant_message', ...base, ts: Date.now(), text: `Aborting: the same action (${action.tool}) was repeated ${consecutiveSameCount} times with no new result.` });
        writeStatusFileSafe(project.path, `Stuck repeating ${action.tool}; aborted to avoid an infinite loop.`);
        emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'error' });
        persistMeta('error');
        return 'error';
      }

      if (action.type === 'final') {
        consecutiveNone = 0;
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

        // --- Pipeline Stage 3b: acceptance-criteria review gate (fresh-context judge) ---
        if (ENABLE_REVIEW && spec && spec.acceptanceCriteria.length && reviewRounds < MAX_REVIEW && !signal.aborted) {
          const rev = await reviewAgainstCriteria(project, spec, model, signal);
          if (rev.ran) {
            emitAndSave({ kind: 'review', ...base, ts: Date.now(), ok: rev.pass, met: rev.met, total: rev.total, output: rev.output, round: reviewRounds + 1 });
          }
          if (rev.ran && !rev.pass) {
            reviewRounds++;
            const reviewMsg = `Acceptance review FAILED (attempt ${reviewRounds}/${MAX_REVIEW}) — ${rev.met}/${rev.total} criteria met.\nUnmet criteria:\n${rev.unmet.map((u) => `- ${u.criterion} — ${u.reason}`).join('\n')}\n\nImplement the missing behavior, then continue. Do NOT call <final> until every acceptance criterion is satisfied.`;
            messages.push({ role: 'user', content: reviewMsg });
            budget.add(reviewMsg);
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
        consecutiveNone++;
        const surfaced = stripTags(full).trim();
        if (surfaced) emitAndSave({ kind: 'assistant_message', ...base, ts: Date.now(), text: surfaced });
        // Repeated empty/actionless turns usually mean the context window is blown
        // or the model is confused. Stop rather than burn the whole step budget.
        if (consecutiveNone >= MAX_EMPTY_RESPONSES) {
          const emptyMsg = `The model returned no runnable action ${consecutiveNone} times in a row and made no progress. Stopping. This often means the context window overflowed — try a smaller task, a larger num_ctx, or a more capable model.`;
          emitAndSave({ kind: 'assistant_message', ...base, ts: Date.now(), text: emptyMsg });
          writeStatusFileSafe(project.path, emptyMsg);
          emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'error' });
          persistMeta('error');
          return 'error';
        }
        messages.push({
          role: 'user',
          content:
            'Reminder: respond with exactly one <tool>...</tool> action, or <final>...</final> if the task is complete. Do not reply in plain prose.',
        });
        saveMessages();
        continue;
      }
      consecutiveNone = 0;

      // Check for batch execution of read-only tools
      const isReadOnlyTool = (act: ParsedAction) =>
        act.type === 'tool' && ['list_dir', 'read_file', 'search_code'].includes(act.tool);
      const allReadOnly = actions.every(isReadOnlyTool);
      const batchEnabled = ENABLE_BATCH_READS && profile.allowBatchReads;

      if (actions.length > 1 && allReadOnly && batchEnabled) {
        const toolActions = actions as ToolAction[];
        
        for (const act of toolActions) {
          emitAndSave({ kind: 'tool_use', ...base, ts: Date.now(), tool: act.tool, args: act.args });
        }

        const results = await Promise.all(
          toolActions.map((act) => runTool(project.path, act.tool, act.args, contextDirs))
        );

        for (let i = 0; i < toolActions.length; i++) {
          const act = toolActions[i]!;
          const res = results[i]!;
          emitAndSave({ kind: 'tool_result', ...base, ts: Date.now(), tool: act.tool, ok: res.ok, output: res.output });
        }

        let observation = '';
        for (let i = 0; i < toolActions.length; i++) {
          const act = toolActions[i]!;
          const res = results[i]!;
          observation += `<observation tool="${act.tool}" ok="${res.ok}">\n${res.output}\n</observation>\n\n`;
        }

        const planProgress = getPlanProgress(project.path);
        const remaining = budget.remaining();
        const budgetInfo =
          remaining !== undefined
            ? `\n\n[Budget Check: Remaining session budget is ${remaining} tokens. If you are close to running out, make sure to write CODDESS_STATUS.md and call <final>.]`
            : '';

        observation += `Continue with your next action(s).${planProgress}${budgetInfo}`;
        messages.push({ role: 'user', content: observation });
        budget.add(observation);
        saveMessages();
      } else {
        // Run single action
        emitAndSave({ kind: 'tool_use', ...base, ts: Date.now(), tool: action.tool, args: action.args });
        const result = await runTool(project.path, action.tool, action.args, contextDirs);
        emitAndSave({ kind: 'tool_result', ...base, ts: Date.now(), tool: action.tool, ok: result.ok, output: result.output });

        const loopWarning = consecutiveSameCount >= 3
          ? `\n\n[WARNING]: You have executed the same action (${action.tool}) ${consecutiveSameCount} times consecutively with the same arguments. If it is failing or not producing new results, please check your assumptions, examine other files, or change your implementation approach. Do not repeat the same action endlessly.`
          : '';
        const planProgress = getPlanProgress(project.path);
        const remaining = budget.remaining();
        const budgetInfo =
          remaining !== undefined
            ? `\n\n[Budget Check: Remaining session budget is ${remaining} tokens. If you are close to running out, make sure to write CODDESS_STATUS.md and call <final>.]`
            : '';
        const observation = `<observation tool="${action.tool}" ok="${result.ok}">\n${result.output}\n</observation>\n\nContinue with your next single action.${loopWarning}${planProgress}${budgetInfo}`;
        messages.push({ role: 'user', content: observation });
        budget.add(observation);
        saveMessages();
      }

      if (isPauseRequested()) {
        emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'paused' });
        persistMeta('paused');
        void runCritique(project, chatId, model, emitAndSave);
        return 'paused';
      }
    }

    // Step budget exhausted without a <final> — stop cleanly rather than loop forever.
    emitAndSave({ kind: 'assistant_message', ...base, ts: Date.now(), text: `Step limit reached (${MAX_STEPS} steps) before the task reported done. Stopping to avoid an unbounded loop; see PLAN.md / CODDESS_STATUS.md for what remains.` });
    writeStatusFileSafe(project.path, `Step limit (${MAX_STEPS}) reached before completion. See PLAN.md for remaining steps.`);
    emitAndSave({ kind: 'status', ...base, ts: Date.now(), status: 'error' });
    persistMeta('error');
    return 'error';
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
  repoMapBlock: string | undefined,
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
    repoMapBlock,
    tier: profile.tier,
    requireStructuredThinking: profile.requireStructuredThinking,
    smallSteps: profile.smallSteps,
    allowBatchReads: profile.allowBatchReads,
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

/** Words from the prompt + spec used to boost relevant files in the repo map. */
function repoHints(prompt: string, spec: Spec | null): string[] {
  const words = new Set<string>();
  const add = (s?: string) => {
    if (s) for (const w of s.match(/[A-Za-z_][\w-]{2,}/g) || []) words.add(w);
  };
  add(prompt);
  if (spec) {
    add(spec.goal);
    for (const f of spec.files) add(f);
    for (const c of spec.acceptanceCriteria) add(c);
  }
  return [...words].slice(0, 60);
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

export function getPlanProgress(projectPath: string): string {
  const planPath = path.join(projectPath, 'PLAN.md');
  if (!fs.existsSync(planPath)) {
    return `\n\n[PLAN MONITOR] PLAN.md was not found. Please create PLAN.md with your task checklist (using - [ ] for tasks) to trace your progress.`;
  }
  try {
    const content = fs.readFileSync(planPath, 'utf8');
    const lines = content.split('\n');
    const tasks: { status: string; text: string }[] = [];
    for (const line of lines) {
      const m = /^\s*-\s*\[([\s/xX])\]\s*(.*)$/.exec(line);
      if (m) {
        tasks.push({ status: m[1]!, text: m[2]!.trim() });
      }
    }
    if (tasks.length === 0) {
      return `\n\n[PLAN MONITOR] No checklist tasks found in PLAN.md. Please populate it with task list items (e.g. - [ ] task title) to trace execution.`;
    }
    const completed = tasks.filter(t => t.status.toLowerCase() === 'x').length;
    const inProgress = tasks.filter(t => t.status === '/').length;
    const remaining = tasks.filter(t => t.status === ' ' || t.status === '/');
    
    let progressStr = `\n\n[PLAN MONITOR] Progress: ${completed}/${tasks.length} tasks completed.`;
    if (inProgress > 0) {
      progressStr += ` (${inProgress} in progress)`;
    }
    progressStr += `\nRemaining tasks:\n`;
    remaining.slice(0, 5).forEach(t => {
      const prefix = t.status === '/' ? '  - [/] ' : '  - [ ] ';
      progressStr += prefix + t.text + '\n';
    });
    if (remaining.length > 5) {
      progressStr += `  - ... and ${remaining.length - 5} more\n`;
    }
    return progressStr.trimEnd();
  } catch {
    return '';
  }
}

/** Seed PLAN.md from the approved plan when the project has none yet (or it is empty). */
function seedPlanFile(projectPath: string, spec: Spec): void {
  try {
    const planPath = path.join(projectPath, 'PLAN.md');
    const exists = fs.existsSync(planPath);
    const empty = exists ? fs.readFileSync(planPath, 'utf8').trim().length === 0 : true;
    if ((!exists || empty) && ((spec.plan && spec.plan.length) || spec.acceptanceCriteria.length)) {
      fs.writeFileSync(planPath, specToPlanFile(spec), 'utf8');
    }
  } catch {
    /* non-fatal: the agent will create PLAN.md itself */
  }
}

/** Write a short CODDESS_STATUS.md when a run stops without finishing. Best-effort. */
function writeStatusFileSafe(projectPath: string, note: string): void {
  try {
    fs.writeFileSync(path.join(projectPath, 'CODDESS_STATUS.md'), `# Coddess status\n\n${note}\n`, 'utf8');
  } catch {
    /* non-fatal */
  }
}

export { countTokens };
export type { ChatPaths };

