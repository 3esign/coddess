import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isGitAvailable, ensureRepo, addWorktree, listWorktrees, removeWorktree, commitAll, mergeBranch } from './git.js';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-wt-'));
}

test('worktree lifecycle: add, commit in it, merge back, remove', async (t) => {
  if (!(await isGitAvailable())) { t.skip('git not available'); return; }
  const root = tmp();
  await ensureRepo(root);

  const wt = await addWorktree(root, 'task1', 'coddess/task1');
  assert.equal(wt.ok, true);
  assert.equal(fs.existsSync(wt.path), true);

  const trees = await listWorktrees(root);
  assert.ok(trees.length >= 2); // main + task1

  // write + commit inside the worktree
  fs.writeFileSync(path.join(wt.path, 'feature.txt'), 'from task1\n');
  const c = await commitAll(wt.path, 'task1 work');
  assert.equal(c.ok, true);

  // merge the task branch back into the main worktree
  const m = await mergeBranch(root, 'coddess/task1');
  assert.equal(m.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'feature.txt')), true);

  const rm = await removeWorktree(root, 'task1');
  assert.equal(rm.ok, true);
});
