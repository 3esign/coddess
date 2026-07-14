import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isGitAvailable, ensureRepo, isRepo, status, diff, commitAll } from './git.js';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-git-'));
}

test('ensureRepo initialises a repo and commitAll persists changes', async (t) => {
  if (!(await isGitAvailable())) {
    t.skip('git not available in this environment');
    return;
  }
  const root = tmp();
  assert.equal(await isRepo(root), false);
  assert.equal(await ensureRepo(root), true);
  assert.equal(await isRepo(root), true);

  // New untracked file shows up in status + diff.
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>\n');
  const st = await status(root);
  assert.equal(st.isRepo, true);
  assert.equal(st.files.some((f) => f.path === 'index.html'), true);

  const d = await diff(root);
  assert.match(d, /index\.html/);

  const commit = await commitAll(root, 'add index');
  assert.equal(commit.ok, true);

  const st2 = await status(root);
  assert.equal(st2.clean, true);
});
