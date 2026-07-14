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
export const COMPACT_AT = Number(env('COMPACT_AT') ?? 12000);

/** How many recent messages to keep verbatim when compacting. */
export const COMPACT_KEEP_RECENT = Number(env('COMPACT_KEEP') ?? 6);

/** Whether orchestrator subtasks run in parallel git worktrees. Off by default (best for independent subtasks). */
export const ORCH_PARALLEL = env('ORCH_PARALLEL') === '1';

/** Max concurrent orchestrator subtasks when parallel mode is on. */
export const ORCH_CONCURRENCY = Number(env('ORCH_CONCURRENCY') ?? 2);

/** Use provider-native tool-calling (frontier providers) instead of the XML protocol. Off by default. */
export const NATIVE_TOOLS = env('NATIVE_TOOLS') === '1';

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
