import fs from 'node:fs';
import path from 'node:path';

/**
 * Ranked repository map (see docs/06-intelligence-upgrades.md W17). Gives the model a
 * whole-repo skeleton of top-level symbols — cheaper than dumping files and the single
 * biggest navigation aid for small-context local models.
 *
 * This is a deliberately dependency-free approximation of Aider's tree-sitter + PageRank
 * map: per-language regexes extract definitions, and files are ranked by how often their
 * symbols are referenced elsewhere (a cheap fan-in proxy) plus entry-file and prompt-hint
 * boosts, emitted within a token budget. Tree-sitter is a future upgrade for precision.
 */

const IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.data', '.next', '.cache', '.coddess',
  'coverage', '.turbo', 'out', 'vendor', '.venv', '__pycache__', 'target',
]);
const MAX_FILES = 400;
const MAX_FILE_BYTES = 400_000;
const BINARY_RE = /[\x00-\x08\x0e-\x1f]/;

const EXT_LANG: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'ts', '.js': 'ts', '.jsx': 'ts', '.mjs': 'ts', '.cjs': 'ts',
  '.py': 'py', '.go': 'go', '.rs': 'rust', '.java': 'java', '.rb': 'ruby', '.php': 'php',
  '.c': 'c', '.h': 'c', '.cpp': 'c', '.hpp': 'c', '.cc': 'c', '.cs': 'cs',
};

const LANG_PATTERNS: Record<string, RegExp[]> = {
  ts: [
    /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^\s*export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
    /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/,
    /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/,
  ],
  py: [/^\s*def\s+([A-Za-z_]\w*)/, /^\s*class\s+([A-Za-z_]\w*)/],
  go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, /^\s*type\s+([A-Za-z_]\w*)/],
  rust: [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/],
  java: [
    /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:class|interface|enum)\s+([A-Za-z_]\w*)/,
    /^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\],\s]+\s+([A-Za-z_]\w*)\s*\(/,
  ],
  ruby: [/^\s*def\s+([A-Za-z_]\w*[!?]?)/, /^\s*class\s+([A-Za-z_]\w*)/, /^\s*module\s+([A-Za-z_]\w*)/],
  php: [/function\s+([A-Za-z_]\w*)\s*\(/, /class\s+([A-Za-z_]\w*)/],
  c: [/^[A-Za-z_][\w\s\*]*\s+\*?([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{?\s*$/, /^\s*(?:struct|enum)\s+([A-Za-z_]\w*)/],
  cs: [/^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:class|interface|struct|enum)\s+([A-Za-z_]\w*)/],
};

export interface Def { name: string; sig: string }
interface FileInfo { rel: string; defs: Def[] }

/** Extract top-level definitions from one file's content for the given language. */
export function extractDefs(lang: string, content: string): Def[] {
  const defs: Def[] = [];
  const seen = new Set<string>();
  const patterns = LANG_PATTERNS[lang] || LANG_PATTERNS.ts!;
  for (const line of content.split('\n')) {
    if (line.length > 400) continue;
    for (const re of patterns) {
      const m = re.exec(line);
      if (m && m[1]) {
        const name = m[1];
        if (!seen.has(name)) {
          seen.add(name);
          defs.push({ name, sig: line.trim().replace(/\s*\{?\s*$/, '').slice(0, 160) });
        }
        break;
      }
    }
  }
  return defs;
}

function collect(root: string): { files: FileInfo[]; contents: string[] } {
  const files: FileInfo[] = [];
  const contents: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      if (e.name.startsWith('.') || IGNORE.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      const lang = EXT_LANG[path.extname(e.name).toLowerCase()];
      if (!lang) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (BINARY_RE.test(content.slice(0, 2000))) continue;
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      files.push({ rel, defs: extractDefs(lang, content) });
      contents.push(content);
    }
  };
  walk(root);
  return { files, contents };
}

function isEntry(rel: string): boolean {
  const base = (rel.split('/').pop() || '').toLowerCase();
  return /^(index|main|app|server|mod|lib|__init__|cli)\.[a-z]+$/.test(base) || base === 'index.html';
}

/** Number of mappable source files in the project (used to decide whether a map is worthwhile). */
export function sourceFileCount(root: string): number {
  return collect(root).files.length;
}

/**
 * Build the ranked map string, or undefined if there is nothing worth mapping.
 * `hints` (words from the prompt/spec) boost files whose path or symbols they mention.
 */
export function buildRepoMap(root: string, tokenBudget = 1000, hints: string[] = []): string | undefined {
  const { files, contents } = collect(root);
  if (files.length === 0) return undefined;

  // Identifier fan-in: how many files mention each identifier (proxy for importance).
  const idFileCount = new Map<string, number>();
  for (const content of contents) {
    const ids = new Set(content.match(/[A-Za-z_$][\w$]*/g) || []);
    for (const id of ids) idFileCount.set(id, (idFileCount.get(id) || 0) + 1);
  }

  const hintSet = new Set(hints.map((h) => h.toLowerCase()).filter((h) => h.length >= 3));
  const mentioned = (s: string) => {
    const low = s.toLowerCase();
    for (const h of hintSet) if (low.includes(h) || h.includes(low)) return true;
    return false;
  };

  const scored = files.map((f) => {
    let score = f.defs.length;
    for (const d of f.defs) score += Math.max(0, (idFileCount.get(d.name) || 1) - 1);
    if (isEntry(f.rel)) score += 6;
    if (mentioned(f.rel) || f.defs.some((d) => mentioned(d.name))) score += 12;
    return { f, score };
  });
  scored.sort((a, b) => b.score - a.score || a.f.rel.localeCompare(b.f.rel));

  const maxChars = Math.max(200, tokenBudget * 4);
  const out: string[] = [];
  let used = 0;
  for (const { f } of scored) {
    if (f.defs.length === 0) continue;
    const sigs = f.defs.slice(0, 12).map((d) => '  ' + d.sig);
    const block = `${f.rel}\n${sigs.join('\n')}`;
    if (used + block.length + 1 > maxChars) {
      if (used + f.rel.length + 1 <= maxChars) {
        out.push(f.rel);
        used += f.rel.length + 1;
      }
      break;
    }
    out.push(block);
    used += block.length + 1;
  }
  return out.length ? out.join('\n') : undefined;
}

/** The "# Repository map" block injected into the build prompt, or undefined when not useful. */
export function repoMapPromptBlock(root: string, tokenBudget: number, minFiles: number, hints: string[] = []): string | undefined {
  const { files } = collect(root);
  if (files.length < minFiles) return undefined;
  const map = buildRepoMap(root, tokenBudget, hints);
  if (!map) return undefined;
  return `# Repository map (ranked top-level symbols — use it to locate code before reading whole files)\n${map}`;
}
