import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ALLOW_SHELL } from '../config.js';

/**
 * Verification for the verify→repair loop (pipeline Stage 3). Determines how to
 * check that what the agent built actually works, runs it, and reports pass/fail.
 * Two strategies:
 *   - "command": a build/test/typecheck script (Node projects) run via the shell.
 *   - "static":  a no-build project (e.g. plain HTML) — check that the entry file
 *                exists and its local asset references resolve.
 * See docs/05-reasoning-pipeline.md §3.
 */

export interface VerifyResult {
  ran: boolean; // false when there was nothing to verify (don't treat as failure)
  ok: boolean;
  command: string;
  output: string;
}

const OVERRIDE_FILE = '.coddess/verify.cmd';
const VERIFY_TIMEOUT_MS = 180_000;
const MAX_OUTPUT = 8000;

/** `node --check <file>` as an async, timed call — never blocks the event loop. */
function nodeSyntaxCheck(target: string): Promise<{ ok: boolean; error: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--check', target], { timeout: 10_000, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) resolve({ ok: false, error: stderr?.toString() || (error as Error).message || String(error) });
      else resolve({ ok: true, error: '' });
    });
  });
}

/**
 * Race a promise against a timeout so a stuck async op (e.g. a Chromium launch
 * that never returns) can't wedge a run forever. If the promise resolves after
 * the timeout, best-effort close the value so a late browser doesn't leak.
 */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(msg)); } }, ms);
    p.then(
      (v) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(v); }
        else { try { (v as any)?.close?.(); } catch { /* ignore */ } }
      },
      (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } },
    );
  });
}

/** Pick a verification command, or null if the project has no obvious one. */
export function detectVerifyCommand(root: string): string | null {
  const override = path.join(root, OVERRIDE_FILE);
  if (fs.existsSync(override)) {
    try {
      const cmd = fs.readFileSync(override, 'utf8').trim();
      if (cmd) return cmd;
    } catch {
      /* ignore */
    }
  }
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      const s = pkg.scripts || {};
      if (typeof s.typecheck === 'string') return 'npm run typecheck';
      if (typeof s.lint === 'string') return 'npm run lint';
      if (typeof s.build === 'string') return 'npm run build';
      if (typeof s.test === 'string' && !/no test specified/i.test(s.test)) return 'npm test';
    } catch {
      /* ignore malformed package.json */
    }
    if (fs.existsSync(path.join(root, 'tsconfig.json'))) return 'npx tsc --noEmit';
  }
  return null;
}

function firstHtml(root: string): string | null {
  const index = path.join(root, 'index.html');
  if (fs.existsSync(index)) return index;
  try {
    const html = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.html'));
    return html ? path.join(root, html) : null;
  } catch {
    return null;
  }
}

async function checkBrowserErrors(htmlPath: string): Promise<{ ok: boolean; errors: string[]; note?: string }> {
  let puppeteer: any;
  try {
    const pkgName = 'puppeteer';
    puppeteer = (await import(pkgName)).default;
  } catch {
    return { ok: true, errors: [], note: 'Puppeteer not installed — skipped runtime browser checks.' };
  }

  let browser: any;
  try {
    browser = await withTimeout(puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--use-gl=angle',
        '--enable-webgl',
        '--ignore-gpu-blocklist'
      ]
    }), 20_000, 'Puppeteer launch timed out after 20s');
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err: any) => {
      errors.push(err.toString());
    });
    page.on('error', (err: any) => {
      errors.push(err.toString());
    });

    const fileUrl = `file://${htmlPath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 8000 });

    // Wait 2 seconds for scripts to boot and run
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await browser.close();
    return { ok: errors.length === 0, errors };
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    return { ok: false, errors: [`Browser runtime check error: ${(err as Error).message}`] };
  }
}

/** Static check for no-build projects: entry HTML exists and its local refs resolve. */
export async function staticCheck(root: string): Promise<VerifyResult> {
  const htmlPath = firstHtml(root);
  if (!htmlPath) {
    return { ran: false, ok: true, command: '(static check)', output: 'No build step and no HTML entry point — nothing to auto-verify.' };
  }
  let content: string;
  try {
    content = fs.readFileSync(htmlPath, 'utf8');
  } catch {
    return { ran: false, ok: true, command: '(static check)', output: 'Could not read HTML entry.' };
  }
  const dir = path.dirname(htmlPath);
  const refs = [...content.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1]!)
    .filter((r) => !/^(https?:|\/\/|#|data:|mailto:|tel:)/i.test(r));

  const missing: string[] = [];
  for (const ref of refs) {
    const clean = ref.split('?')[0]!.split('#')[0]!;
    if (!clean) continue;
    const target = path.resolve(dir, clean.replace(/^\//, ''));
    if (!fs.existsSync(target)) missing.push(ref);
  }
  const rel = path.basename(htmlPath);
  if (missing.length) {
    return {
      ran: true,
      ok: false,
      command: `static check (${rel})`,
      output: `${rel} references files that do not exist:\n${missing.map((m) => '  - ' + m).join('\n')}\nCreate them or fix the references.`,
    };
  }

  // Dry-run JS syntax check on local JS references. Uses async execFile with a
  // timeout (never execSync) so a slow/stuck `node --check` cannot block the
  // single server event loop — which would freeze REST + WebSocket together.
  const jsRefs = refs.filter((r) => r.toLowerCase().endsWith('.js'));
  const syntaxErrors: string[] = [];
  for (const ref of jsRefs) {
    const clean = ref.split('?')[0]!.split('#')[0]!;
    if (!clean) continue;
    const target = path.resolve(dir, clean.replace(/^\//, ''));
    if (fs.existsSync(target)) {
      const check = await nodeSyntaxCheck(target);
      if (!check.ok) syntaxErrors.push(`- ${ref}:\n${check.error.trim()}`);
    }
  }

  if (syntaxErrors.length > 0) {
    return {
      ran: true,
      ok: false,
      command: `static check (${rel})`,
      output: `JavaScript syntax validation failed for referenced script(s):\n${syntaxErrors.join('\n\n')}`,
    };
  }

  // Runtime browser check for unhandled exceptions
  const browserCheck = await checkBrowserErrors(htmlPath);
  if (!browserCheck.ok) {
    return {
      ran: true,
      ok: false,
      command: `static check (${rel})`,
      output: `Runtime browser console errors detected in ${rel}:\n${browserCheck.errors.map((e) => `  - ${e}`).join('\n')}\nFix these runtime crashes.`,
    };
  }

  const note = browserCheck.note ? `\nNote: ${browserCheck.note}` : '';
  return {
    ran: true,
    ok: true,
    command: `static check (${rel})`,
    output: `${rel} OK — ${refs.length} local reference(s) resolve and verify successfully.${note}`,
  };
}

function execVerify(root: string, command: string): Promise<VerifyResult> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const flag = process.platform === 'win32' ? '/c' : '-c';
    execFile(
      shell,
      [flag, command],
      { cwd: root, timeout: VERIFY_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const out = `${stdout ?? ''}${stderr ? '\n' + stderr : ''}`.trim().slice(-MAX_OUTPUT);
        if (error && (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
          resolve({ ran: true, ok: false, command, output: (out + '\n[verification timed out]').trim() });
        } else if (error) {
          resolve({ ran: true, ok: false, command, output: out || `[exit ${error.code ?? 1}]` });
        } else {
          resolve({ ran: true, ok: true, command, output: out || '(passed, no output)' });
        }
      },
    );
  });
}

/** Run whichever verification strategy fits the project. */
export async function runVerification(root: string): Promise<VerifyResult> {
  const command = detectVerifyCommand(root);
  if (command) {
    if (!ALLOW_SHELL) {
      return { ran: false, ok: true, command, output: 'Shell disabled — skipped command verification.' };
    }
    return execVerify(root, command);
  }
  return await staticCheck(root);
}
