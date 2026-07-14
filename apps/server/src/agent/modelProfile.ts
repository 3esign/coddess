/**
 * Model-capability tiers. One system prompt cannot be optimal for a 7B local
 * model and a frontier API model, so we classify the connected model and scale
 * the scaffolding depth accordingly (see docs/05-reasoning-pipeline.md §6).
 */

export type ModelTier = 'local-small' | 'local-large' | 'frontier';

const FRONTIER_PREFIXES = ['openrouter/', 'anthropic/', 'claude-', 'gemini/', 'gemini-', 'deepseek/', 'deepseek-', 'kimi/', 'moonshot-', 'custom/'];

/** Extract a rough parameter size (in billions) from an Ollama-style model id, if present. */
function paramBillions(model: string): number | null {
  const m = model.toLowerCase().match(/[:\-](\d{1,3})(\.\d+)?b\b/);
  if (m) return parseFloat(m[1]! + (m[2] || ''));
  return null;
}

export function modelTier(model: string): ModelTier {
  const id = (model || '').toLowerCase();
  // Anything routed to a hosted provider is treated as frontier-capable.
  if (FRONTIER_PREFIXES.some((p) => id.startsWith(p))) return 'frontier';
  // Local (Ollama) models: size-gate when we can read it, else assume small.
  const b = paramBillions(id);
  if (b !== null && b >= 27) return 'local-large';
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
}

export function scaffoldFor(model: string): ScaffoldProfile {
  const tier = modelTier(model);
  switch (tier) {
    case 'frontier':
      return { tier, requireStructuredThinking: false, smallSteps: false, runIntent: true };
    case 'local-large':
      return { tier, requireStructuredThinking: true, smallSteps: false, runIntent: true };
    case 'local-small':
    default:
      return { tier, requireStructuredThinking: true, smallSteps: true, runIntent: true };
  }
}
