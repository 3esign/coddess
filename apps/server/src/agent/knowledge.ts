import fs from 'node:fs';
import path from 'node:path';
import type { NormalizedEntry, Project } from '@coddess/shared';
import { chatStream } from './provider/providerRouter.js';
import { chatPaths, readMessages } from './chatStore.js';

/**
 * Per-project knowledge base (pipeline cross-cutting component). Durable,
 * project-level facts — conventions, architecture, pitfalls, commands — learned
 * from completed runs, injected into every future run's system prompt so the
 * agent stops relearning the same things. See docs/05-reasoning-pipeline.md §4.
 *
 * Canonical store is .coddess/knowledge.json; a human-readable .coddess/knowledge.md
 * is rendered alongside it (you can edit it freely — it is read before each run).
 */

export interface Knowledge {
  conventions: string[];
  architecture: string[];
  pitfalls: string[];
  commands: string[];
  updatedAt: number;
}

export const CATEGORIES = ['conventions', 'architecture', 'pitfalls', 'commands'] as const;
export type Category = (typeof CATEGORIES)[number];

const CAP_PER_CATEGORY = 20;
const MAX_ITEM_LEN = 240;
const TITLES: Record<Category, string> = {
  conventions: 'Conventions',
  architecture: 'Architecture',
  pitfalls: 'Pitfalls & gotchas',
  commands: 'Commands',
};

export function emptyKnowledge(): Knowledge {
  return { conventions: [], architecture: [], pitfalls: [], commands: [], updatedAt: 0 };
}

function jsonPath(project: Project): string {
  return path.join(project.path, '.coddess', 'knowledge.json');
}
function mdPath(project: Project): string {
  return path.join(project.path, '.coddess', 'knowledge.md');
}

function coerceList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, CAP_PER_CATEGORY);
}

export function loadKnowledge(project: Project): Knowledge {
  try {
    const p = jsonPath(project);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return {
        conventions: coerceList(raw.conventions),
        architecture: coerceList(raw.architecture),
        pitfalls: coerceList(raw.pitfalls),
        commands: coerceList(raw.commands),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      };
    }
  } catch (err) {
    console.error('Failed to read knowledge.json:', err);
  }
  return emptyKnowledge();
}

export function isEmpty(k: Knowledge): boolean {
  return CATEGORIES.every((c) => k[c].length === 0);
}

export function renderKnowledgeMd(k: Knowledge): string {
  const lines = ['# Project knowledge (Coddess)', '', 'Learned automatically from previous runs. Edit freely — Coddess reads this before each run.', ''];
  for (const c of CATEGORIES) {
    if (k[c].length === 0) continue;
    lines.push(`## ${TITLES[c]}`);
    for (const item of k[c]) lines.push(`- ${item}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function saveKnowledge(project: Project, k: Knowledge): void {
  const dir = path.join(project.path, '.coddess');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(jsonPath(project), JSON.stringify(k, null, 2), 'utf8');
  fs.writeFileSync(mdPath(project), renderKnowledgeMd(k), 'utf8');
}

/** The "# Project knowledge" block injected into the build system prompt (or undefined if empty). */
export function knowledgePromptBlock(project: Project): string | undefined {
  const k = loadKnowledge(project);
  if (isEmpty(k)) return undefined;
  const lines = ['# Project knowledge (learned from previous runs — trust unless the current task contradicts it)'];
  for (const c of CATEGORIES) {
    if (k[c].length === 0) continue;
    lines.push(`${TITLES[c]}:`);
    for (const item of k[c]) lines.push(`  - ${item}`);
  }
  return lines.join('\n');
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Merge proposed facts into current knowledge: trim, dedup (case-insensitive), cap per category. */
export function mergeFacts(current: Knowledge, incoming: Partial<Record<Category, string[]>>): Knowledge {
  const out: Knowledge = {
    conventions: [...current.conventions],
    architecture: [...current.architecture],
    pitfalls: [...current.pitfalls],
    commands: [...current.commands],
    updatedAt: current.updatedAt,
  };
  for (const c of CATEGORIES) {
    const seen = new Set(out[c].map(normalize));
    for (const raw of incoming[c] ?? []) {
      const t = String(raw).trim().slice(0, MAX_ITEM_LEN);
      if (!t) continue;
      const n = normalize(t);
      if (seen.has(n)) continue;
      out[c].push(t);
      seen.add(n);
    }
    if (out[c].length > CAP_PER_CATEGORY) out[c] = out[c].slice(out[c].length - CAP_PER_CATEGORY);
  }
  out.updatedAt = Date.now();
  return out;
}

export function countFacts(k: Knowledge): number {
  return CATEGORIES.reduce((n, c) => n + k[c].length, 0);
}

/** Parse a model response (fenced or bare JSON) into a category→facts object. Exposed for tests. */
export function parseFactsJson(text: string): Partial<Record<Category, string[]>> | null {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const raw = JSON.parse(t.slice(start, end + 1));
    const out: Partial<Record<Category, string[]>> = {};
    for (const c of CATEGORIES) out[c] = coerceList(raw[c]);
    return out;
  } catch {
    return null;
  }
}

type Emit = (e: NormalizedEntry) => void;

const DISTILL_SYSTEM = `You are the knowledge distiller for Coddess. Given a completed build run and the facts already known about a project, extract NEW, DURABLE, project-level facts that would help a future agent working in this same project. Only include things that generalize beyond this one task: conventions (languages, module style, formatting, ports), architecture (key files/modules and their roles), pitfalls (gotchas, things that broke and why), and commands (how to build/test/run).
Do NOT repeat facts already known. Do NOT include task-specific chatter, TODOs, or transient state. Keep each fact to one concise sentence.
Respond with ONLY a JSON object: {"conventions":[],"architecture":[],"pitfalls":[],"commands":[]}. Use empty arrays if there is nothing new worth remembering.`;

/** After a completed run, distill new durable facts and merge them into the knowledge base. */
export async function updateKnowledgeFromRun(
  project: Project,
  chatId: string,
  model: string,
  emit: Emit,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const paths = chatPaths(project, chatId);
    const conversation = readMessages(paths).filter((m) => m.role !== 'system');
    if (conversation.length === 0) return;

    const current = loadKnowledge(project);
    const known = isEmpty(current) ? '(none yet)' : JSON.stringify(current, null, 0);
    const transcript = JSON.stringify(conversation).slice(0, 24000);

    let full = '';
    for await (const chunk of chatStream(model, [
      { role: 'system', content: DISTILL_SYSTEM },
      { role: 'user', content: `Facts already known:\n${known}\n\nRun transcript (truncated):\n${transcript}\n\nReturn the new-facts JSON.` },
    ], signal)) {
      full += chunk;
    }

    const parsed = parseFactsJson(full);
    if (!parsed) return;
    const before = countFacts(current);
    const merged = mergeFacts(current, parsed);
    const added = countFacts(merged) - before;
    if (added <= 0) return;
    saveKnowledge(project, merged);
    emit({ kind: 'assistant_message', runId: 'knowledge', projectId: project.id, chatId, ts: Date.now(), text: `📚 Learned ${added} new project fact${added === 1 ? '' : 's'} (saved to .coddess/knowledge.md).` });
  } catch (err) {
    console.error('Failed to update knowledge base:', err);
  }
}
