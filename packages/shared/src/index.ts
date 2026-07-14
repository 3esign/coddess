// Shared types between server and web. The normalized event stream is the
// contract everything above the executor layer consumes (see docs/02-architecture.md).

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  /** Default model to use for this project's runs, e.g. "qwen2.5-coder". */
  model?: string;
  /** Extra read-only folders linked as temporary context (absolute paths). */
  contextDirs?: string[];
}

export type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled' | 'paused';

/** Task classification, chosen automatically by the intent compiler. */
export type TaskLabel = 'Feature' | 'Bug Fix' | 'Refactor' | 'Optimization' | 'Research' | 'Chore';

/** One ordered implementation step (pipeline Stage 1 — plan development). */
export interface PlanStep {
  /** Short imperative step, e.g. "Scaffold the Express server and health route". */
  title: string;
  /** What to do and the key decisions/edge cases for this step. */
  detail?: string;
  /** How this step is confirmed working (a command, or an observable check). */
  verify?: string;
}

/**
 * Structured specification produced by the intent compiler (pipeline Stage 0)
 * plus an ordered build plan (Stage 1). The build loop is anchored to this;
 * acceptance criteria define "done" and the plan is the route to get there.
 */
export interface Spec {
  goal: string;
  label: TaskLabel;
  assumptions: string[];
  stack: string;
  files: string[];
  acceptanceCriteria: string[];
  openQuestions: string[];
  /** Ordered steps that build the solution; each ideally names a verification. */
  plan?: PlanStep[];
}

/**
 * NormalizedEntry — the single event schema. The native agent loop and any
 * future wrapped CLI executor both emit these; the UI, persistence and the
 * diff/merge flow only ever read this shape, never raw agent bytes.
 */
export type NormalizedEntry = (
  | { kind: 'status'; runId: string; projectId: string; ts: number; status: RunStatus; detail?: string }
  | { kind: 'user_prompt'; runId: string; projectId: string; ts: number; text: string }
  | { kind: 'assistant_token'; runId: string; projectId: string; ts: number; text: string }
  | { kind: 'assistant_message'; runId: string; projectId: string; ts: number; text: string }
  | { kind: 'thinking'; runId: string; projectId: string; ts: number; text: string }
  | { kind: 'spec'; runId: string; projectId: string; ts: number; spec: Spec }
  | { kind: 'orchestration'; runId: string; projectId: string; ts: number; phase: 'plan' | 'task' | 'done'; text: string; overview?: string; tasks?: { title: string }[] }
  | { kind: 'tool_use'; runId: string; projectId: string; ts: number; tool: string; args: Record<string, string> }
  | { kind: 'tool_result'; runId: string; projectId: string; ts: number; tool: string; ok: boolean; output: string }
  | { kind: 'verify'; runId: string; projectId: string; ts: number; command: string; ok: boolean; output: string; round: number }
  | { kind: 'review'; runId: string; projectId: string; ts: number; ok: boolean; met: number; total: number; output: string; round: number }
  | { kind: 'final'; runId: string; projectId: string; ts: number; summary: string }
  | { kind: 'error'; runId: string; projectId: string; ts: number; message: string }
  | { kind: 'coddess_opinion'; runId: string; projectId: string; ts: number; text: string }
) & { chatId?: string };

export type ClientMessage =
  | { type: 'subscribe'; projectId: string }
  | { type: 'run'; projectId: string; prompt: string; model?: string; chatId?: string; maxTokens?: number; projectMaxTokens?: number }
  | { type: 'orchestrate'; projectId: string; goal: string; model?: string; chatId?: string; maxTokens?: number; projectMaxTokens?: number }
  | { type: 'inject'; projectId: string; chatId?: string; text: string }
  | { type: 'cancel'; projectId: string; runId: string }
  | { type: 'pause'; projectId: string; runId: string };

export interface FileNode {
  name: string;
  path: string; // relative to project root
  type: 'file' | 'dir';
  children?: FileNode[];
}

/* ------------------------------ git / review ------------------------------ */

export interface GitFileChange {
  path: string;
  status: string;
  added: number;
  removed: number;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  clean: boolean;
}

/* --------------------------------- tasks ---------------------------------- */

export type TaskStatus = 'queued' | 'running' | 'review' | 'done';

export interface TaskCard {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  label: string;
  model?: string;
  chatId?: string;
  branch?: string;
  worktreePath?: string;
  createdAt: number;
  updatedAt: number;
}

/* ----------------------------- model catalog ------------------------------ */

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
}

/** User overrides to the model menu: models to add, and model ids to hide. */
export interface ModelOverrides {
  added: ModelEntry[];
  hidden: string[];
}
