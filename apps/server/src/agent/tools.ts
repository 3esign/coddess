import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { resolveInProject, buildTree } from '../fsutil.js';
import { ALLOW_SHELL } from '../config.js';

export interface ToolResult {
  ok: boolean;
  output: string;
}

const MAX_READ = 60_000; // chars returned to the model

/**
 * Resolve a path for a READ operation. Allowed roots are the project root plus
 * any linked context folders. Relative paths resolve against the project root;
 * absolute paths are accepted only if they live inside an allowed root. Writes
 * never use this — they stay project-scoped via resolveInProject.
 */
function resolveRead(projectRoot: string, contextDirs: string[], p: string): string {
  const roots = [projectRoot, ...contextDirs].map((r) => path.resolve(r));
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(projectRoot, p);
  const ok = roots.some((root) => abs === root || abs.startsWith(root + path.sep));
  if (!ok) throw new Error(`Path is outside the project and linked context folders: ${p}`);
  return abs;
}

/** Execute one tool action. Reads may touch linked context folders; writes stay in the project root. */
export async function runTool(
  root: string,
  tool: string,
  args: Record<string, string>,
  contextDirs: string[] = [],
): Promise<ToolResult> {
  try {
    switch (tool) {
      case 'list_dir':
        return listDir(root, contextDirs, args.path ?? '.');
      case 'read_file':
        return readFile(root, contextDirs, req(args, 'path'));
      case 'write_file':
        return writeFile(root, req(args, 'path'), args.content ?? '');
      case 'edit_file':
        return editFile(root, req(args, 'path'), req(args, 'old'), args.new ?? '', args.replace_all === 'true');
      case 'search_code':
        return searchCode(root, contextDirs, req(args, 'query'), args.path ?? '.', args.glob ?? '');
      case 'git':
        return await gitTool(root, req(args, 'command'));
      case 'run':
        return await run(root, req(args, 'command'));
      case 'browser_eval':
        return await browserEval(root, req(args, 'path'), args.js ?? '');
      default:
        return { ok: false, output: `Unknown tool "${tool}". Available: list_dir, read_file, search_code, write_file, edit_file, git, run, browser_eval.` };
    }
  } catch (err) {
    return { ok: false, output: `Error: ${(err as Error).message}` };
  }
}

function req(args: Record<string, string>, key: string): string {
  const v = args[key];
  if (v === undefined || v === '') throw new Error(`Missing required arg "${key}"`);
  return v;
}

function flatten(nodes: ReturnType<typeof buildTree>, prefix = ''): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(`${prefix}${n.type === 'dir' ? n.name + '/' : n.name}`);
    if (n.children) out.push(...flatten(n.children, prefix + '  '));
  }
  return out;
}

function listDir(root: string, contextDirs: string[], rel: string): ToolResult {
  const abs = resolveRead(root, contextDirs, rel === '.' || rel === '' ? root : rel);
  const nodes = buildTree(abs, '', 0);
  if (nodes.length === 0) return { ok: true, output: '(empty)' };
  return { ok: true, output: flatten(nodes).join('\n').slice(0, MAX_READ) };
}

function readFile(root: string, contextDirs: string[], rel: string): ToolResult {
  const abs = resolveRead(root, contextDirs, rel);
  if (!fs.existsSync(abs)) return { ok: false, output: `File not found: ${rel}` };
  if (fs.statSync(abs).isDirectory()) return { ok: false, output: `${rel} is a directory. Use list_dir.` };
  const content = fs.readFileSync(abs, 'utf8');
  const clipped = content.length > MAX_READ;
  return { ok: true, output: clipped ? content.slice(0, MAX_READ) + `\n... [truncated, ${content.length} chars total]` : content };
}

function writeFile(root: string, rel: string, content: string): ToolResult {
  const abs = resolveInProject(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  const lines = content.split('\n').length;
  return { ok: true, output: `Wrote ${rel} (${lines} lines, ${content.length} bytes).` };
}

/**
 * Surgical edit: replace an exact substring instead of rewriting the whole file.
 * Cheaper on tokens and produces cleaner diffs. Fails loudly if the target text
 * is not found, or is ambiguous (appears more than once) unless replace_all set.
 */
function editFile(root: string, rel: string, oldStr: string, newStr: string, replaceAll: boolean): ToolResult {
  const abs = resolveInProject(root, rel);
  if (!fs.existsSync(abs)) return { ok: false, output: `File not found: ${rel}. Use write_file to create it.` };
  const original = fs.readFileSync(abs, 'utf8');
  const occurrences = original.split(oldStr).length - 1;
  if (occurrences === 0) {
    return { ok: false, output: `The 'old' text was not found in ${rel}. Read the file again and match it exactly (including whitespace).` };
  }
  if (occurrences > 1 && !replaceAll) {
    return { ok: false, output: `The 'old' text appears ${occurrences} times in ${rel}. Add more surrounding context to make it unique, or set replace_all=true.` };
  }
  const updated = replaceAll ? original.split(oldStr).join(newStr) : original.replace(oldStr, newStr);
  fs.writeFileSync(abs, updated, 'utf8');
  return { ok: true, output: `Edited ${rel} (${occurrences} replacement${occurrences === 1 ? '' : 's'}, now ${updated.split('\n').length} lines).` };
}

const SEARCH_IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.data', '.next', '.cache', '.coddess']);
const SEARCH_MAX_MATCHES = 200;
const SEARCH_MAX_FILE_BYTES = 1_000_000;
const BINARY_RE = /[\x00-\x08\x0e-\x1f]/;

/** Grep across the project (or a linked context folder). Returns file:line entries, capped. */
function searchCode(root: string, contextDirs: string[], query: string, rel: string, glob: string): ToolResult {
  let re: RegExp;
  try {
    re = new RegExp(query, 'i');
  } catch (err) {
    return { ok: false, output: `Invalid search regex: ${(err as Error).message}` };
  }
  const exts = glob
    .split(',')
    .map((s) => s.trim().replace(/^\*/, '').replace(/^\./, ''))
    .filter(Boolean)
    .map((s) => '.' + s.toLowerCase());

  const startAbs = resolveRead(root, contextDirs, rel === '.' || rel === '' ? root : rel);
  const base = fs.existsSync(startAbs) && fs.statSync(startAbs).isDirectory() ? startAbs : root;
  const matches: string[] = [];
  let scanned = 0;

  const walk = (dir: string) => {
    if (matches.length >= SEARCH_MAX_MATCHES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (matches.length >= SEARCH_MAX_MATCHES) return;
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      if (SEARCH_IGNORE.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (exts.length && !exts.includes(path.extname(e.name).toLowerCase())) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (BINARY_RE.test(content.slice(0, 4000))) continue;
      scanned++;
      const relPath = path.relative(base, abs).replace(/\\/g, '/');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          matches.push(`${relPath}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
          if (matches.length >= SEARCH_MAX_MATCHES) break;
        }
      }
    }
  };
  walk(base);

  if (matches.length === 0) return { ok: true, output: `No matches for /${query}/ in ${scanned} file(s).` };
  const capped = matches.length >= SEARCH_MAX_MATCHES ? `\n… (capped at ${SEARCH_MAX_MATCHES} matches)` : '';
  return { ok: true, output: matches.join('\n').slice(0, MAX_READ) + capped };
}

/** Split a git command string into argv, honoring single/double quotes. No shell involved. */
export function tokenizeArgs(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      has = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) { out.push(cur); cur = ''; has = false; }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/**
 * First-class git capability so the agent can version, connect, push, track, and
 * clone GitHub repos on demand via natural language. Runs `git` directly (no
 * shell), scoped to the project root — command chaining/injection is impossible.
 */
function gitTool(root: string, command: string): Promise<ToolResult> {
  let args = tokenizeArgs(command.trim());
  if (args.length === 0) return Promise.resolve({ ok: false, output: 'Provide a git subcommand, e.g. "status", "commit -m \'msg\'", "push", "clone <url> <dir>".' });
  if (args[0] === 'git') args = args.slice(1);
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ? '\n' + stderr : ''}`.trim().slice(0, MAX_READ);
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') resolve({ ok: false, output: 'git is not installed or not on PATH.' });
      else if (error && (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') resolve({ ok: false, output: (out + '\n[git timed out after 120s]').trim() });
      else if (error) resolve({ ok: false, output: (out || `git exited with code ${error.code ?? 1}`).trim() });
      else resolve({ ok: true, output: out || '(git: no output)' });
    });
  });
}

function run(root: string, command: string): Promise<ToolResult> {
  if (!ALLOW_SHELL) return Promise.resolve({ ok: false, output: 'Shell is disabled (set CODDESS_ALLOW_SHELL=1 to enable).' });
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const flag = process.platform === 'win32' ? '/c' : '-c';
    execFile(shell, [flag, command], { cwd: root, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ? '\n[stderr]\n' + stderr : ''}`.trim();
      if (error && (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') resolve({ ok: false, output: (out + '\n[timed out after 120s]').trim() });
      else if (error) resolve({ ok: false, output: (out + `\n[exit ${error.code ?? 1}]`).trim() || String(error) });
      else resolve({ ok: true, output: out.slice(0, MAX_READ) || '(no output)' });
    });
  });
}

async function browserEval(root: string, relPath: string, jsEval: string): Promise<ToolResult> {
  const abs = path.resolve(root, relPath);
  if (!fs.existsSync(abs)) {
    return { ok: false, output: `File not found: ${relPath}` };
  }

  let puppeteer;
  try {
    const pkgName = 'puppeteer';
    puppeteer = (await import(pkgName)).default;
  } catch (err) {
    return {
      ok: false,
      output: `Error: Puppeteer is not installed. To use browser verification, run 'npm install puppeteer -w @coddess/server' in the project root.`
    };
  }

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    const consoleErrors: string[] = [];
    page.on('pageerror', (err: any) => {
      consoleErrors.push(err.toString());
    });
    page.on('error', (err: any) => {
      consoleErrors.push(err.toString());
    });

    const fileUrl = `file://${abs.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 10000 });

    let evalResult = null;
    if (jsEval) {
      evalResult = await page.evaluate((code: any) => {
        try {
          const fn = new Function(code);
          return fn();
        } catch (e: any) {
          return `Eval Error: ${e.message}`;
        }
      }, jsEval);
    }

    const domSummary = await page.evaluate(() => {
      const title = document.title;
      const canvasCount = document.querySelectorAll('canvas').length;
      return { title, canvasCount };
    });

    await browser.close();

    let output = `Successfully loaded ${relPath} in headless browser.\n`;
    output += `Page Title: "${domSummary.title}"\n`;
    output += `Canvas Elements Found: ${domSummary.canvasCount}\n`;
    if (consoleErrors.length > 0) {
      output += `Console Errors Encountered:\n${consoleErrors.map(e => ` - ${e}`).join('\n')}\n`;
    } else {
      output += `Console Errors: None\n`;
    }
    if (jsEval) {
      output += `JS Evaluation Result: ${JSON.stringify(evalResult, null, 2)}\n`;
    }

    return { ok: consoleErrors.length === 0, output };
  } catch (err) {
    if (browser) await browser.close();
    return { ok: false, output: `Browser evaluation failed: ${(err as Error).message}` };
  }
}
