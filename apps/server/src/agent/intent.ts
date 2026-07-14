import type { Project, Spec, TaskLabel } from '@coddess/shared';
import type { ModelTier } from './modelProfile.js';
import { chatStream } from './provider/providerRouter.js';

/**
 * Intent compiler (pipeline Stage 0). Turns a raw — possibly vague — prompt into
 * a structured spec BEFORE any code is written, so the build loop has a concrete
 * target and the user can see the assumptions being made. It also CLASSIFIES the
 * task automatically (feature / bug fix / refactor / …) so the user never picks a
 * label by hand. See docs/05-reasoning-pipeline.md §3.
 */

const LABELS: TaskLabel[] = ['Feature', 'Bug Fix', 'Refactor', 'Optimization', 'Research', 'Chore'];

const INTENT_SYSTEM = `You are the intent compiler for Coddess, an autonomous software builder.
Your job: read a user's build request and the project's current file list, then produce a compact, concrete SPECIFICATION of what will be built. The user's request may be vague — infer the most reasonable interpretation, fill gaps with sensible defaults, and make your assumptions EXPLICIT. Also CLASSIFY the task.

Respond with ONLY a single JSON object (no prose, no markdown fences) of exactly this shape:
{
  "goal": "one or two sentences restating what to build, concretely",
  "label": "one of: Feature, Bug Fix, Refactor, Optimization, Research, Chore",
  "assumptions": ["each assumption you made to resolve ambiguity"],
  "stack": "the chosen technologies, kept as simple as the task allows",
  "files": ["the main files you expect to create or change"],
  "acceptanceCriteria": ["specific, checkable statements that define DONE"],
  "openQuestions": ["at most 3 genuinely blocking unknowns, or empty if none"]
}
Rules: choose the single best-fitting label. Prefer the simplest stack that satisfies the request. Acceptance criteria must be concrete and verifiable (e.g. "index.html renders a hero, menu, and contact section", not "looks good"). Keep every array tight. Output valid JSON only.`;

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

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function normalizeLabel(v: unknown): TaskLabel {
  if (typeof v === 'string') {
    const found = LABELS.find((l) => l.toLowerCase() === v.trim().toLowerCase());
    if (found) return found;
    const s = v.toLowerCase();
    if (s.includes('bug') || s.includes('fix')) return 'Bug Fix';
    if (s.includes('refactor')) return 'Refactor';
    if (s.includes('optim') || s.includes('perf')) return 'Optimization';
    if (s.includes('research') || s.includes('investigat')) return 'Research';
    if (s.includes('chore') || s.includes('config') || s.includes('setup')) return 'Chore';
  }
  return 'Feature';
}

/** Normalize an arbitrary parsed object into a Spec, or return null if unusable. */
export function toSpec(raw: any): Spec | null {
  if (!raw || typeof raw !== 'object') return null;
  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
  const spec: Spec = {
    goal,
    label: normalizeLabel(raw.label),
    assumptions: asStringArray(raw.assumptions),
    stack: typeof raw.stack === 'string' ? raw.stack.trim() : '',
    files: asStringArray(raw.files),
    acceptanceCriteria: asStringArray(raw.acceptanceCriteria),
    openQuestions: asStringArray(raw.openQuestions),
  };
  if (!spec.goal && spec.acceptanceCriteria.length === 0) return null;
  return spec;
}

export async function compileIntent(
  project: Project,
  rawPrompt: string,
  model: string,
  tier: ModelTier,
  tree: string,
  signal?: AbortSignal,
): Promise<Spec | null> {
  const depthHint =
    tier === 'frontier'
      ? 'Be concise; a few sharp criteria are enough.'
      : 'Be explicit and thorough — the builder is a smaller model that benefits from a detailed, unambiguous spec.';

  const user = `Project: ${project.name}
Current files:
${tree || '(empty folder — building from scratch)'}

User request:
"""
${rawPrompt}
"""

${depthHint}
Produce the specification JSON now.`;

  let full = '';
  try {
    for await (const chunk of chatStream(model, [
      { role: 'system', content: INTENT_SYSTEM },
      { role: 'user', content: user },
    ], signal)) {
      full += chunk;
    }
  } catch {
    return null;
  }
  return toSpec(extractJson(full));
}

/** Render a Spec as the "# Approved specification" block injected into the build prompt. */
export function specToPromptBlock(spec: Spec): string {
  const lines: string[] = ['# Approved specification (build to THIS)'];
  lines.push(`Task type: ${spec.label}`);
  if (spec.goal) lines.push(`Goal: ${spec.goal}`);
  if (spec.stack) lines.push(`Stack: ${spec.stack}`);
  if (spec.files.length) lines.push(`Planned files: ${spec.files.join(', ')}`);
  if (spec.assumptions.length) {
    lines.push('Assumptions (proceed on these unless clearly wrong):');
    for (const a of spec.assumptions) lines.push(`  - ${a}`);
  }
  if (spec.acceptanceCriteria.length) {
    lines.push('Acceptance criteria — the task is DONE only when ALL hold:');
    for (const c of spec.acceptanceCriteria) lines.push(`  - [ ] ${c}`);
  }
  if (spec.openQuestions.length) {
    lines.push('Open questions (make a reasonable choice, note it in your final summary):');
    for (const q of spec.openQuestions) lines.push(`  - ${q}`);
  }
  return lines.join('\n');
}

/** Parse a raw model response (possibly fenced/prose-wrapped) into a Spec. Exposed for tests. */
export function parseSpec(text: string): Spec | null {
  return toSpec(extractJson(text));
}
