import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Read an env var, preferring the CODDESS_ name but falling back to the legacy OSCODE_ one. */
function env(name: string): string | undefined {
  return process.env[`CODDESS_${name}`] ?? process.env[`OSCODE_${name}`];
}

/** apps/server root (one level up from src). */
export const SERVER_ROOT = path.resolve(__dirname, '..');

/** Local data dir — projects list, encrypted settings, master key. Gitignored. */
export const DATA_DIR = path.join(SERVER_ROOT, '.data');

export const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

export const PORT = Number(env('PORT') ?? 3001);

/** Ollama endpoint (native /api/chat used). */
export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

/** Default model if a project doesn't specify one. Must support instruction-following. */
export const DEFAULT_MODEL = env('MODEL') ?? 'qwen2.5-coder';

/**
 * Context window (tokens) requested from Ollama via options.num_ctx. Without this
 * Ollama silently caps context at a small default (~4K), truncating the system
 * prompt + history regardless of the model's real window. Set to the model's real
 * context (or a sensible floor). Hosted providers ignore this.
 */
export const NUM_CTX = Number(env('NUM_CTX') ?? 16384);

/** Hard ceiling on ReAct steps in one run so a stuck model cannot loop forever. */
export const MAX_STEPS = Number(env('MAX_STEPS') ?? 60);

/**
 * Stall watchdog: if the model produces no output for this many milliseconds
 * during a single turn, the request is aborted and the run ends with an error
 * instead of hanging forever with the UI stuck in a "running" state. Covers the
 * common Ollama case where a context overflow / overloaded local model stops
 * streaming without closing the connection. Set CODDESS_STREAM_IDLE_MS=0 to disable.
 */
export const STREAM_IDLE_MS = Number(env('STREAM_IDLE_MS') ?? 120000);

/**
 * If the model returns no actionable output (no tool / no <final>) this many
 * times in a row, stop the run instead of silently spinning through the step
 * budget. Usually means the context window is blown or the model is confused.
 */
export const MAX_EMPTY_RESPONSES = Number(env('MAX_EMPTY_RESPONSES') ?? 4);



/** Whether the run() shell tool is allowed. On by default; set CODDESS_ALLOW_SHELL=0 to disable. */
export const ALLOW_SHELL = (env('ALLOW_SHELL') ?? '1') !== '0';

/** Whether the post-run Coddess Observer critique runs. Off by default (extra model call). */
export const ENABLE_CRITIQUE = env('ENABLE_CRITIQUE') === '1';

/** Whether the Intent/Spec pre-flight stage runs. On by default; CODDESS_INTENT=0 to disable. */
export const ENABLE_INTENT = (env('INTENT') ?? '1') !== '0';

/** Whether the verify→repair stage runs after the agent declares done. On by default. */
export const ENABLE_VERIFY = (env('VERIFY') ?? '1') !== '0';

/** Max automatic repair rounds when verification fails before accepting the result. */
export const MAX_REPAIRS = Number(env('MAX_REPAIRS') ?? 3);

/** Whether the per-project knowledge base is read + updated. On by default; CODDESS_KNOWLEDGE=0 to disable. */
export const ENABLE_KNOWLEDGE = (env('KNOWLEDGE') ?? '1') !== '0';

/** Whether long conversations are compacted to fit the context window. On by default. */
export const ENABLE_COMPACTION = (env('COMPACTION') ?? '1') !== '0';

/** Token size of the message history above which compaction kicks in. */
export const COMPACT_AT = Number(env('COMPACT_AT') ?? Math.floor(NUM_CTX * 0.75));

/** How many recent messages to keep verbatim when compacting. */
export const COMPACT_KEEP_RECENT = Number(env('COMPACT_KEEP') ?? 6);

/** Whether orchestrator subtasks run in parallel git worktrees. Off by default (best for independent subtasks). */
export const ORCH_PARALLEL = env('ORCH_PARALLEL') === '1';

/** Max concurrent orchestrator subtasks when parallel mode is on. */
export const ORCH_CONCURRENCY = Number(env('ORCH_CONCURRENCY') ?? 2);

/** Use provider-native tool-calling (frontier providers) instead of the XML protocol. Off by default. */
export const NATIVE_TOOLS = env('NATIVE_TOOLS') === '1';

/** Acceptance-criteria review gate: an LLM judge checks the built code against the spec before "done". On by default. */
export const ENABLE_REVIEW = (env('REVIEW') ?? '1') !== '0';

/** Max review→repair rounds triggered by the acceptance-criteria gate (separate from build-verify repairs). */
export const MAX_REVIEW = Number(env('MAX_REVIEW') ?? 2);

/** Inject a ranked repository symbol map into the build prompt so the model locates code. On by default. */
export const ENABLE_REPOMAP = (env('REPOMAP') ?? '1') !== '0';

/** Token budget for the repository map block. */
export const REPOMAP_TOKENS = Number(env('REPOMAP_TOKENS') ?? 1000);

/** Below this many source files the flat tree is enough — skip the repo map. */
export const REPOMAP_MIN_FILES = Number(env('REPOMAP_MIN_FILES') ?? 8);

/** Allow parallel batching of safe read-only operations for capable tiers. On by default. */
export const ENABLE_BATCH_READS = (env('BATCH_READS') ?? '1') !== '0';

/** Enable observation masking of older tool outputs before compaction. On by default. */
export const ENABLE_MASKING = (env('MASKING') ?? '1') !== '0';

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
