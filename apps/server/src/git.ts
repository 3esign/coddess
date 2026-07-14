import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Thin git wrapper used by the orchestration layer.
 *
 * Two things depend on this: (1) the Review/diff UI, which shows what an agent
 * changed before you accept it, and (2) parallel tasks, each of which runs in
 * its own `git worktree` so multiple agents can build simultaneously without
 * stepping on each other. Everything shells out to the system `git`.
 */

export interface GitFileChange {
  path: string;
  status: string; // e.g. 'M', 'A', 'D', '??'
  added: number;
  removed: number;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  clean: boolean;
}

function git(cwd: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export async function isGitAvailable(): Promise<boolean> {
  const r = await git(process.cwd(), ['--version'], 5000);
  return r.ok;
}

export async function isRepo(root: string): Promise<boolean> {
  if (!fs.existsSync(root)) return false;
  const r = await git(root, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

/** Initialise a repo if the folder isn't one yet. Returns true if a repo exists afterwards. */
export async function ensureRepo(root: string): Promise<boolean> {
  if (await isRepo(root)) return true;
  const init = await git(root, ['init']);
  if (!init.ok) return false;
  // Make an initial commit so diffs/worktrees have a base, if there's anything to commit.
  await git(root, ['add', '-A']);
  await git(root, ['-c', 'user.email=agent@coddess.local', '-c', 'user.name=Coddess', 'commit', '-m', 'Initial commit (Coddess)', '--allow-empty']);
  return true;
}

export async function currentBranch(root: string): Promise<string> {
  const r = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.stdout.trim() : '';
}

export async function status(root: string): Promise<GitStatus> {
  const repo = await isRepo(root);
  if (!repo) {
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [], clean: true };
  }
  const branch = await currentBranch(root);

  // Change list with rename-awareness.
  const porcelain = await git(root, ['status', '--porcelain=v1']);
  const numstat = await git(root, ['diff', '--numstat', 'HEAD']);

  const numMap = new Map<string, { added: number; removed: number }>();
  for (const line of numstat.stdout.split('\n')) {
    const parts = line.trim().split('\t');
    if (parts.length >= 3) {
      const added = parts[0] === '-' ? 0 : parseInt(parts[0]!, 10) || 0;
      const removed = parts[1] === '-' ? 0 : parseInt(parts[1]!, 10) || 0;
      numMap.set(parts.slice(2).join('\t'), { added, removed });
    }
  }

  const files: GitFileChange[] = [];
  for (const line of porcelain.stdout.split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2).trim();
    const file = line.slice(3).trim();
    const nm = numMap.get(file) || { added: 0, removed: 0 };
    files.push({ path: file, status: code || '??', added: nm.added, removed: nm.removed });
  }

  return { isRepo: true, branch, ahead: 0, behind: 0, files, clean: files.length === 0 };
}

/** Full unified diff of the working tree (unstaged + staged) against HEAD, including untracked files. */
export async function diff(root: string): Promise<string> {
  if (!(await isRepo(root))) return '';
  const tracked = await git(root, ['diff', 'HEAD', '--']);
  let out = tracked.stdout;

  // Include untracked files by diffing them against /dev/null.
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard']);
  for (const f of untracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const d = await git(root, ['diff', '--no-index', '--', devNull(), f]);
    // --no-index exits non-zero when there is a diff; still returns the patch text.
    if (d.stdout) out += '\n' + d.stdout;
  }
  return out;
}

function devNull(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

export async function commitAll(root: string, message: string): Promise<{ ok: boolean; output: string }> {
  if (!(await ensureRepo(root))) return { ok: false, output: 'Not a git repository and could not initialise one.' };
  await git(root, ['add', '-A']);
  const r = await git(root, ['-c', 'user.email=agent@coddess.local', '-c', 'user.name=Coddess', 'commit', '-m', message || 'Coddess changes']);
  return { ok: r.ok, output: (r.stdout + r.stderr).trim() };
}

export async function discardAll(root: string): Promise<{ ok: boolean; output: string }> {
  if (!(await isRepo(root))) return { ok: false, output: 'Not a git repository.' };
  await git(root, ['reset', '--hard', 'HEAD']);
  const clean = await git(root, ['clean', '-fd']);
  return { ok: clean.ok, output: (clean.stdout + clean.stderr).trim() };
}

/* ------------------------- worktrees (parallel tasks) ------------------------- */

export interface Worktree {
  path: string;
  branch: string;
  head: string;
}

const WORKTREE_ROOT = '.coddess/worktrees';

/** Create a new worktree + branch for an isolated task. Returns the absolute worktree path. */
export async function addWorktree(root: string, taskId: string, branch: string): Promise<{ ok: boolean; path: string; output: string }> {
  if (!(await ensureRepo(root))) return { ok: false, path: '', output: 'Could not initialise git repository.' };
  const wtPath = path.join(root, WORKTREE_ROOT, taskId);
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  // Create a branch off HEAD in a fresh worktree.
  const r = await git(root, ['worktree', 'add', '-b', branch, wtPath, 'HEAD']);
  if (!r.ok) {
    // branch may already exist — try without -b
    const r2 = await git(root, ['worktree', 'add', wtPath, branch]);
    if (!r2.ok) return { ok: false, path: '', output: (r.stderr + r2.stderr).trim() };
  }
  return { ok: true, path: wtPath, output: 'worktree created' };
}

export async function listWorktrees(root: string): Promise<Worktree[]> {
  if (!(await isRepo(root))) return [];
  const r = await git(root, ['worktree', 'list', '--porcelain']);
  const trees: Worktree[] = [];
  let cur: Partial<Worktree> = {};
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) trees.push(cur as Worktree);
      cur = { path: line.slice('worktree '.length).trim(), branch: '', head: '' };
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5).trim();
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
    }
  }
  if (cur.path) trees.push(cur as Worktree);
  return trees;
}

export async function removeWorktree(root: string, taskId: string): Promise<{ ok: boolean; output: string }> {
  const wtPath = path.join(root, WORKTREE_ROOT, taskId);
  const r = await git(root, ['worktree', 'remove', '--force', wtPath]);
  return { ok: r.ok, output: (r.stdout + r.stderr).trim() };
}

/** Merge a task's branch back into the current branch (fast-forward or merge commit). */
export async function abortMerge(root: string): Promise<void> {
  await git(root, ['merge', '--abort']);
}

export async function mergeBranch(root: string, branch: string): Promise<{ ok: boolean; output: string }> {
  if (!(await isRepo(root))) return { ok: false, output: 'Not a git repository.' };
  const r = await git(root, ['merge', '--no-edit', branch]);
  return { ok: r.ok, output: (r.stdout + r.stderr).trim() };
}
