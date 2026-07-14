import fs from 'node:fs';
import path from 'node:path';
import type { Project, Spec } from '@coddess/shared';
import { chatStream } from './provider/providerRouter.js';

/**
 * Acceptance-criteria review gate (pipeline Stage 3b, see docs/06-intelligence-upgrades.md
 * W15). Build-verification proves the code COMPILES/RUNS; it cannot prove the code does what
 * was ASKED. This is a fresh-context LLM judge that grades the built code against each
 * acceptance criterion and returns per-criterion met/unmet, so the loop can repair genuine
 * feature gaps before honoring <final>.
 *
 * It fails OPEN: if the judge call or its output is unusable, the gate does not block a build
 * that already passed verification (avoids false negatives killing a good result).
 */

export interface ReviewResult {
  ran: boolean;
  pass: boolean;
  met: number;
  total: number;
  unmet: { criterion: string; reason: string }[];
  output: string;
}

const REVIEW_SYSTEM = `You are the acceptance reviewer for Coddess, an autonomous software builder.
You are given a list of acceptance criteria and the relevant project source code. For EACH criterion, decide strictly from the code whether it is MET or NOT met, with a one-line reason citing the evidence (or what is missing). Judge only the criteria given; do not invent new requirements or demand extra features.
Respond with ONLY a JSON object (no prose, no fences):
{"results":[{"criterion":"<restate the criterion>","met":true,"reason":"one concise line"}]}`;

const SNAP_BUDGET = 12000;
const PER_FILE_CAP = 4000;
const READ_EXT = new Set(['.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.py', '.go', '.rs', '.java', '.rb', '.php', '.vue', '.svelte', '.md', '.txt']);
const SNAP_IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.data', '.next', '.cache', '.coddess', 'coverage', 'vendor', '.venv', '__pycache__', 'target']);

function walkSource(root: string, limit = 60): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith('.') || SNAP_IGNORE.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (READ_EXT.has(path.extname(e.name).toLowerCase())) out.push(path.relative(root, abs).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out;
}

/** Read the most relevant files (spec.files + entry points + a walk) up to a char budget. */
function gatherSnapshot(root: string, spec: Spec): string {
  const rootAbs = path.resolve(root);
  const picked: string[] = [];
  const seen = new Set<string>();
  let used = 0;

  const tryRead = (rel: string) => {
    if (used >= SNAP_BUDGET || !rel) return;
    const abs = path.resolve(root, rel);
    if (seen.has(abs)) return;
    seen.add(abs);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return;
    try {
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return;
      let c = fs.readFileSync(abs, 'utf8');
      if (/[\x00-\x08]/.test(c.slice(0, 1000))) return;
      const cap = Math.min(PER_FILE_CAP, SNAP_BUDGET - used);
      if (c.length > cap) c = c.slice(0, cap) + '\n... [truncated]';
      const relClean = rel.replace(/\\/g, '/');
      picked.push(`--- ${relClean} ---\n${c}`);
      used += c.length + relClean.length + 10;
    } catch {
      /* skip unreadable */
    }
  };

  for (const f of spec.files) tryRead(f);
  for (const e of ['index.html', 'src/index.html', 'src/main.ts', 'src/main.tsx', 'src/index.ts', 'src/index.tsx', 'src/App.tsx', 'app.py', 'main.py', 'main.go', 'index.js', 'src/index.js']) tryRead(e);
  if (used < SNAP_BUDGET) for (const rel of walkSource(root)) { if (used >= SNAP_BUDGET) break; tryRead(rel); }

  return picked.join('\n\n') || '(no readable source files found)';
}

interface JudgedCriterion { criterion: string; met: boolean; reason: string }

/** Parse the judge's JSON (tolerant of fences/prose) into per-criterion verdicts. */
export function parseReview(text: string): JudgedCriterion[] | null {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let raw: any;
  try {
    raw = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  const results = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : null;
  if (!results) return null;
  const out: JudgedCriterion[] = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const criterion = String((r as any).criterion ?? (r as any).name ?? '').trim();
    const met = (r as any).met === true || String((r as any).met).toLowerCase() === 'true' || String((r as any).status).toLowerCase() === 'met';
    const reason = String((r as any).reason ?? '').trim();
    if (criterion) out.push({ criterion, met, reason });
  }
  return out.length ? out : null;
}

/** Compute the gate decision from parsed verdicts. Exposed for tests. */
export function decideReview(judged: JudgedCriterion[]): { pass: boolean; met: number; total: number; unmet: { criterion: string; reason: string }[] } {
  const total = judged.length;
  const met = judged.filter((j) => j.met).length;
  const unmet = judged.filter((j) => !j.met).map((j) => ({ criterion: j.criterion, reason: j.reason || 'not satisfied by the current code' }));
  return { pass: unmet.length === 0 && total > 0, met, total, unmet };
}

/** Run the acceptance-criteria review. Fails open (ran:false, pass:true) on any judge failure. */
export async function reviewAgainstCriteria(project: Project, spec: Spec, model: string, signal?: AbortSignal): Promise<ReviewResult> {
  const criteria = spec.acceptanceCriteria;
  if (!criteria.length) return { ran: false, pass: true, met: 0, total: 0, unmet: [], output: 'No acceptance criteria to review.' };

  const snapshot = gatherSnapshot(project.path, spec);
  const user = `Acceptance criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nProject source (relevant files):\n${snapshot}\n\nJudge every criterion now and return the JSON.`;

  let full = '';
  try {
    for await (const chunk of chatStream(model, [
      { role: 'system', content: REVIEW_SYSTEM },
      { role: 'user', content: user },
    ], signal, { format: 'json' })) {
      full += chunk;
    }
  } catch {
    return { ran: false, pass: true, met: 0, total: 0, unmet: [], output: 'Reviewer call failed — skipped (build verification already passed).' };
  }

  const judged = parseReview(full);
  if (!judged) return { ran: false, pass: true, met: 0, total: 0, unmet: [], output: 'Reviewer output was unparseable — skipped.' };

  const d = decideReview(judged);
  const output = d.pass
    ? `All ${d.total} acceptance criteria met.`
    : `${d.met}/${d.total} criteria met. Unmet:\n${d.unmet.map((u) => `- ${u.criterion} — ${u.reason}`).join('\n')}`;
  return { ran: true, pass: d.pass, met: d.met, total: d.total, unmet: d.unmet, output };
}
