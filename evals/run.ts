/**
 * Coddess eval harness (see docs/06-intelligence-upgrades.md Part 5).
 *
 * Each task is a folder under evals/tasks/<name>/ containing:
 *   - prompt.md        the build request handed to the agent
 *   - check.mjs        a Node script run as `node check.mjs <projectDir>`; exit 0 = PASS
 *   - seed/ (optional) files copied into the project dir before the run (for bug-fix tasks)
 *
 * For each task we copy the seed into a temp project dir, run the real agent loop against
 * the configured model, then run the programmatic check. We record pass/fail plus cheap
 * signals (tool calls, approx output tokens, wall time) and compare to evals/baseline.json.
 *
 * Requirements: Ollama running with the model pulled (or API keys set). This talks to a LIVE
 * model, so run it on your machine, not in CI without a model.
 *
 * Usage:
 *   npm run eval                      # run all tasks, compare to baseline
 *   npm run eval -- static-landing    # run one task by name
 *   npm run eval -- --update-baseline # save current results as the new baseline
 *
 * Env: CODDESS_EVAL_MODEL (default CODDESS_MODEL or qwen2.5-coder), CODDESS_EVAL_TIMEOUT ms.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runAgent } from '../apps/server/src/agent/loop.js';
import type { Project, NormalizedEntry } from '@coddess/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(__dirname, 'tasks');
const BASELINE = path.join(__dirname, 'baseline.json');
const RESULTS = path.join(__dirname, 'results.json');
const MODEL = process.env.CODDESS_EVAL_MODEL || process.env.CODDESS_MODEL || 'qwen2.5-coder';
const TIMEOUT_MS = Number(process.env.CODDESS_EVAL_TIMEOUT ?? 240_000);

interface TaskResult {
  task: string;
  pass: boolean;
  status: string;
  toolUses: number;
  approxOutTokens: number;
  ms: number;
  note?: string;
}

function listTasks(): string[] {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs
    .readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(TASKS_DIR, d.name, 'prompt.md')))
    .map((d) => d.name)
    .sort();
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function runOne(name: string): Promise<TaskResult> {
  const taskDir = path.join(TASKS_DIR, name);
  const prompt = fs.readFileSync(path.join(taskDir, 'prompt.md'), 'utf8').trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `coddess-eval-${name}-`));
  const seed = path.join(taskDir, 'seed');
  if (fs.existsSync(seed)) copyDir(seed, tmp);

  const project: Project = { id: `eval-${name}`, name, path: tmp, createdAt: Date.now(), model: MODEL };
  const events: NormalizedEntry[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  let status = 'error';
  try {
    status = await runAgent(project, prompt, MODEL, `r-${name}`, 'eval', {}, controller.signal, () => false, (e) => events.push(e));
  } catch (err) {
    status = 'error';
    events.push({ kind: 'error', runId: 'eval', projectId: project.id, ts: Date.now(), message: (err as Error).message });
  }
  clearTimeout(timer);
  const ms = Date.now() - t0;

  const toolUses = events.filter((e) => e.kind === 'tool_use').length;
  const approxOutTokens = Math.round(
    events.filter((e) => e.kind === 'assistant_token').reduce((n, e) => n + ((e as { text?: string }).text?.length || 0), 0) / 4,
  );

  const checkMjs = path.join(taskDir, 'check.mjs');
  let pass = false;
  let note: string | undefined;
  if (fs.existsSync(checkMjs)) {
    const r = spawnSync(process.execPath, [checkMjs, tmp], { encoding: 'utf8', timeout: 60_000 });
    pass = r.status === 0;
    if (!pass) note = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-3).join(' | ').slice(0, 200);
  } else {
    note = 'no check.mjs';
  }

  // Leave tmp on failure for inspection; clean up on pass.
  if (pass) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  } else {
    note = `${note ? note + ' — ' : ''}project left at ${tmp}`;
  }

  return { task: name, pass, status, toolUses, approxOutTokens, ms, note };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const update = args.includes('--update-baseline');
  const names = args.filter((a) => !a.startsWith('--'));
  const tasks = names.length ? names : listTasks();

  if (tasks.length === 0) {
    console.error('No eval tasks found under evals/tasks/. Add <name>/prompt.md + check.mjs.');
    process.exit(2);
  }

  console.log(`Model: ${MODEL}  •  Tasks: ${tasks.length}  •  Timeout: ${TIMEOUT_MS}ms\n`);
  const results: TaskResult[] = [];
  for (const t of tasks) {
    process.stdout.write(`▶ ${pad(t, 22)} `);
    const r = await runOne(t);
    results.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${pad(r.status, 8)} tools=${pad(String(r.toolUses), 3)} ~tok=${pad(String(r.approxOutTokens), 6)} ${(r.ms / 1000).toFixed(1)}s${r.note ? `  (${r.note})` : ''}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\npass@1: ${passed}/${results.length}  (${Math.round((100 * passed) / results.length)}%)`);
  fs.writeFileSync(RESULTS, JSON.stringify({ model: MODEL, ts: Date.now(), results }, null, 2));

  if (update) {
    const base: Record<string, boolean> = {};
    for (const r of results) base[r.task] = r.pass;
    fs.writeFileSync(BASELINE, JSON.stringify(base, null, 2));
    console.log(`\nBaseline updated (${RESULTS.replace(/results\.json$/, 'baseline.json')}).`);
    return;
  }

  if (fs.existsSync(BASELINE)) {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Record<string, boolean>;
    const regressions = results.filter((r) => base[r.task] === true && !r.pass).map((r) => r.task);
    if (regressions.length) {
      console.error(`\nREGRESSIONS vs baseline: ${regressions.join(', ')}`);
      process.exit(1);
    }
    console.log('\nNo regressions vs baseline.');
  } else {
    console.log('\nNo baseline yet — run with --update-baseline to set one.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
