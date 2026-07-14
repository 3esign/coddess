import type { Project, Spec, TaskLabel, PlanStep } from '@coddess/shared';
import type { ModelTier } from './modelProfile.js';
import { chatStream } from './provider/providerRouter.js';

/**
 * Intent compiler + planner (pipeline Stage 0 → Stage 1). Turns a raw — possibly
 * vague — prompt into a structured spec AND an ordered build plan BEFORE any code
 * is written, so the build loop has a concrete target and a route to it, and the
 * user can see the assumptions being made. It also CLASSIFIES the task
 * automatically (feature / bug fix / refactor / …). See docs/05-reasoning-pipeline.md
 * §3 and docs/06-intelligence-upgrades.md.
 */

const LABELS: TaskLabel[] = ['Feature', 'Bug Fix', 'Refactor', 'Optimization', 'Research', 'Chore'];

const INTENT_SYSTEM = `You are the intent compiler and planner for Coddess, an autonomous software builder.
Read the user's build request and the project's current file list, then produce a compact, concrete SPECIFICATION and an ordered BUILD PLAN. The request may be vague — infer the most reasonable interpretation, fill gaps with sensible defaults, and make your assumptions EXPLICIT. Also CLASSIFY the task.

CRITICAL DIRECTIVES:
- DO NOT use emojis or emoticons anywhere in your output.
- Plan steps MUST be strictly linear, "right direction" steps. No exploratory coding, no guessing, no trial-and-error. Ensure each step moves the project strictly forward toward completion without wasting tokens.

Reason in two phases before you answer:
1) UNDERSTAND — what outcome does the user actually want, and what concretely defines success?
2) PLAN — the shortest ordered sequence of steps that reaches EVERY acceptance criterion, each step naming how it will be verified.

Respond with ONLY a single JSON object (no prose, no markdown fences) of exactly this shape:
{
  "goal": "one or two sentences restating what to build, concretely",
  "label": "one of: Feature, Bug Fix, Refactor, Optimization, Research, Chore",
  "stack": "the chosen technologies, kept as simple as the task allows",
  "assumptions": ["each assumption you made to resolve ambiguity"],
  "files": ["the main files you expect to create or change"],
  "acceptanceCriteria": ["specific, checkable statements that define DONE"],
  "plan": [
    { "title": "short imperative step", "detail": "what to do and the key decisions/edge cases", "verify": "how this step is confirmed working" }
  ],
  "openQuestions": ["at most 3 genuinely blocking unknowns, or empty if none"]
}
Rules:
- Choose the single best-fitting label. Prefer the simplest stack that satisfies the request.
- Acceptance criteria must be concrete and verifiable (e.g. "GET /todos returns the seeded items as JSON", not "the API works").
- The plan must be ORDERED so later steps build on earlier ones, must together cover every acceptance criterion, and each step should say how it is verified. Keep it to 2-7 steps for most tasks.
- Keep every array tight. Output valid JSON only.`;

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

/** Parse the plan array tolerantly: accept objects {title,detail,verify} or bare strings. */
function asPlan(v: unknown): PlanStep[] {
  if (!Array.isArray(v)) return [];
  const out: PlanStep[] = [];
  for (const item of v) {
    if (typeof item === 'string') {
      const title = item.trim();
      if (title) out.push({ title });
      continue;
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : typeof o.step === 'string' ? o.step.trim() : '';
      if (!title) continue;
      const step: PlanStep = { title };
      if (typeof o.detail === 'string' && o.detail.trim()) step.detail = o.detail.trim();
      if (typeof o.verify === 'string' && o.verify.trim()) step.verify = o.verify.trim();
      out.push(step);
    }
  }
  return out.slice(0, 12);
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
  const plan = asPlan(raw.plan);
  const spec: Spec = {
    goal,
    label: normalizeLabel(raw.label),
    assumptions: asStringArray(raw.assumptions),
    stack: typeof raw.stack === 'string' ? raw.stack.trim() : '',
    files: asStringArray(raw.files),
    acceptanceCriteria: asStringArray(raw.acceptanceCriteria),
    openQuestions: asStringArray(raw.openQuestions),
  };
  if (plan.length) spec.plan = plan;
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
      ? 'Be concise; a few sharp criteria and a lean plan are enough.'
      : 'Be explicit and thorough — the builder is a smaller model that benefits from a detailed, unambiguous spec and a step-by-step plan.';

  const user = `Project: ${project.name}
Current files:
${tree || '(empty folder — building from scratch)'}

User request:
"""
${rawPrompt}
"""

${depthHint}
Produce the specification + plan JSON now.`;

  let full = '';
  try {
    // Constrain local models to valid JSON (Ollama structured output); hosted
    // providers ignore `format` and stay reliable via the "JSON only" instruction.
    for await (const chunk of chatStream(
      model,
      [
        { role: 'system', content: INTENT_SYSTEM },
        { role: 'user', content: user },
      ],
      signal,
      { format: 'json' },
    )) {
      full += chunk;
    }
  } catch {
    return null;
  }
  return toSpec(extractJson(full));
}

/** Render a Spec as the "# Approved specification" block injected into the build prompt. */
export function specToPromptBlock(spec: Spec): string {
  const lines: string[] = [];
  lines.push('# Approved specification & build plan');
  lines.push('Build to this. If reality forces a deviation, note it in your final summary.');
  lines.push('');
  lines.push(`Task type: ${spec.label}`);
  if (spec.goal) lines.push(`Goal: ${spec.goal}`);
  if (spec.stack) lines.push(`Stack: ${spec.stack}`);
  if (spec.files.length) lines.push(`Target files: ${spec.files.join(', ')}`);

  if (spec.acceptanceCriteria.length) {
    lines.push('');
    lines.push('## Acceptance criteria (the task is DONE only when every item is verified)');
    for (const c of spec.acceptanceCriteria) lines.push(`- [ ] ${c}`);
  }

  if (spec.plan && spec.plan.length) {
    lines.push('');
    lines.push('## Build plan (ordered — follow it, refine it as you learn)');
    spec.plan.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title}`);
      if (s.detail) lines.push(`   - ${s.detail}`);
      if (s.verify) lines.push(`   - Verify: ${s.verify}`);
    });
  }

  if (spec.assumptions.length) {
    lines.push('');
    lines.push('## Assumptions made to resolve ambiguity');
    for (const a of spec.assumptions) lines.push(`- ${a}`);
  }

  if (spec.openQuestions.length) {
    lines.push('');
    lines.push('## Open questions (resolve autonomously with the best engineering judgment)');
    for (const q of spec.openQuestions) lines.push(`- ${q}`);
  }
  return lines.join('\n');
}

/** Render the plan + acceptance criteria as an initial PLAN.md checklist for a fresh run. */
export function specToPlanFile(spec: Spec): string {
  const lines: string[] = ['# PLAN', ''];
  if (spec.goal) {
    lines.push(`Goal: ${spec.goal}`);
    lines.push('');
  }
  lines.push('## Steps');
  if (spec.plan && spec.plan.length) {
    for (const s of spec.plan) {
      lines.push(`- [ ] ${s.title}${s.verify ? ` (verify: ${s.verify})` : ''}`);
    }
  } else {
    lines.push('- [ ] Break the goal into steps and implement them.');
  }
  if (spec.acceptanceCriteria.length) {
    lines.push('');
    lines.push('## Acceptance criteria');
    for (const c of spec.acceptanceCriteria) lines.push(`- [ ] ${c}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Parse a raw model response (possibly fenced/prose-wrapped) into a Spec. Exposed for tests. */
export function parseSpec(text: string): Spec | null {
  return toSpec(extractJson(text));
}
