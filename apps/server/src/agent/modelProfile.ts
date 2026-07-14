/**
 * Model-capability tiers. One system prompt cannot be optimal for a 7B local
 * model and a frontier API model, so we classify the connected model and scale
 * the scaffolding depth accordingly (see docs/05-reasoning-pipeline.md §6).
 */

export type ModelTier = 'local-small' | 'local-large' | 'frontier';

/**
 * Prefixes routed to a hosted, native-tool-capable provider. This MUST stay in
 * sync with the routing branches in provider/providerRouter.ts — a model is only
 * "frontier" if the router actually sends it to a hosted API. Matching a bare
 * local family here (e.g. "mistral", "devstral") would misroute local models, so
 * we deliberately match only the hosted prefixes, not model families.
 */
const HOSTED_PREFIXES = [
  'openrouter/',
  'anthropic/', 'claude-',
  'gemini/', 'gemini-',
  'deepseek/', 'deepseek-',
  'kimi/', 'moonshot-',
  'custom/',
];

/** True when the model is routed to a hosted provider with native tool-calling. */
export function isFrontierModel(model: string): boolean {
  const id = (model || '').toLowerCase();
  return HOSTED_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * Local coder/agentic model families that punch above their parameter count and
 * do NOT need the maximum small-model scaffold even when the id lacks a size tag.
 */
const STRONG_LOCAL_PATTERNS = [
  /qwen[.-]?2\.5[-]?coder/, /qwen3/, /qwen[.-]coder/,
  /deepseek[-.]?coder/, /deepseek[-.]?v[23]/,
  /devstral/, /codestral/, /starcoder2/, /\bcoder\b/,
  /llama[-.]?3\.[13]/,
];

/** Extract a rough parameter size (in billions) from an Ollama-style model id, if present. */
function paramBillions(model: string): number | null {
  const m = model.toLowerCase().match(/[:\-](\d{1,3})(\.\d+)?b\b/);
  if (m) return parseFloat(m[1]! + (m[2] || ''));
  return null;
}

export function modelTier(model: string): ModelTier {
  const id = (model || '').toLowerCase();
  if (isFrontierModel(id)) return 'frontier';
  // Local (Ollama) models: size-gate when we can read it, else use family heuristics.
  const b = paramBillions(id);
  if (b !== null) return b >= 14 ? 'local-large' : 'local-small';
  if (STRONG_LOCAL_PATTERNS.some((re) => re.test(id))) return 'local-large';
  return 'local-small';
}

export interface ScaffoldProfile {
  tier: ModelTier;
  /** Require the structured Decompose/Approach/Risks/Verification thinking block. */
  requireStructuredThinking: boolean;
  /** Encourage very small incremental steps + edit_file over full rewrites. */
  smallSteps: boolean;
  /** Run the Intent/Spec pre-flight stage (most valuable for weaker models). */
  runIntent: boolean;
  /** Allow parallel batching of safe read-only operations. */
  allowBatchReads: boolean;
}

export function scaffoldFor(model: string): ScaffoldProfile {
  const tier = modelTier(model);
  switch (tier) {
    case 'frontier':
      return { tier, requireStructuredThinking: false, smallSteps: false, runIntent: true, allowBatchReads: true };
    case 'local-large':
      return { tier, requireStructuredThinking: true, smallSteps: false, runIntent: true, allowBatchReads: true };
    case 'local-small':
    default:
      return { tier, requireStructuredThinking: true, smallSteps: true, runIntent: true, allowBatchReads: false };
  }
}
