import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from './tools.js';

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-tools-'));
}

test('write_file then edit_file replaces an exact substring', async () => {
  const root = tmpProject();
  await runTool(root, 'write_file', { path: 'a.txt', content: 'hello world' });
  const res = await runTool(root, 'edit_file', { path: 'a.txt', old: 'world', new: 'coddess' });
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'hello coddess');
});

test('edit_file fails when the old text is not found', async () => {
  const root = tmpProject();
  await runTool(root, 'write_file', { path: 'b.txt', content: 'abc' });
  const res = await runTool(root, 'edit_file', { path: 'b.txt', old: 'zzz', new: 'q' });
  assert.equal(res.ok, false);
  assert.match(res.output, /not found/i);
});

test('edit_file refuses ambiguous matches unless replace_all', async () => {
  const root = tmpProject();
  await runTool(root, 'write_file', { path: 'c.txt', content: 'x x x' });
  const ambiguous = await runTool(root, 'edit_file', { path: 'c.txt', old: 'x', new: 'y' });
  assert.equal(ambiguous.ok, false);
  const all = await runTool(root, 'edit_file', { path: 'c.txt', old: 'x', new: 'y', replace_all: 'true' });
  assert.equal(all.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'y y y');
});

test('tools cannot escape the project root', async () => {
  const root = tmpProject();
  const res = await runTool(root, 'read_file', { path: '../../etc/passwd' });
  assert.equal(res.ok, false);
  assert.match(res.output, /outside the project|escapes project root/i);
  const w = await runTool(root, 'write_file', { path: '../../evil.txt', content: 'x' });
  assert.equal(w.ok, false);
  assert.match(w.output, /escapes project root/i);
});

test('search_code finds matches and reports file:line', async () => {
  const root = tmpProject();
  await runTool(root, 'write_file', { path: 'src/app.ts', content: 'const gravity = 9.8;\nfunction step() {}\n' });
  await runTool(root, 'write_file', { path: 'readme.md', content: 'no match here' });
  const res = await runTool(root, 'search_code', { query: 'gravity', glob: 'ts' });
  assert.equal(res.ok, true);
  assert.match(res.output, /src\/app\.ts:1/);
});

test('search_code respects the glob filter', async () => {
  const root = tmpProject();
  await runTool(root, 'write_file', { path: 'a.ts', content: 'needle' });
  await runTool(root, 'write_file', { path: 'b.md', content: 'needle' });
  const res = await runTool(root, 'search_code', { query: 'needle', glob: 'md' });
  assert.equal(res.ok, true);
  assert.match(res.output, /b\.md/);
  assert.doesNotMatch(res.output, /a\.ts/);
});

test('search_code reports no matches cleanly', async () => {
  const root = tmpProject();
  await runTool(root, 'write_file', { path: 'a.ts', content: 'abc' });
  const res = await runTool(root, 'search_code', { query: 'zzzznotfound' });
  assert.equal(res.ok, true);
  assert.match(res.output, /No matches/i);
});

import { tokenizeArgs } from './tools.js';

test('tokenizeArgs splits git commands honoring quotes', () => {
  assert.deepEqual(tokenizeArgs('status'), ['status']);
  assert.deepEqual(tokenizeArgs('commit -m "initial commit"'), ['commit', '-m', 'initial commit']);
  assert.deepEqual(tokenizeArgs("commit -m 'msg with spaces'"), ['commit', '-m', 'msg with spaces']);
  assert.deepEqual(tokenizeArgs('clone https://x/y.git vendor/lib'), ['clone', 'https://x/y.git', 'vendor/lib']);
});

test('read tools reach a linked context folder; writes cannot escape', async () => {
  const root = tmpProject();
  const ctx = fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-ctx-'));
  fs.writeFileSync(path.join(ctx, 'notes.txt'), 'external note');

  const linked = await runTool(root, 'read_file', { path: path.join(ctx, 'notes.txt') }, [ctx]);
  assert.equal(linked.ok, true);
  assert.match(linked.output, /external note/);

  const blocked = await runTool(root, 'read_file', { path: path.join(ctx, 'notes.txt') }, []);
  assert.equal(blocked.ok, false);
  assert.match(blocked.output, /outside the project/i);

  const ls = await runTool(root, 'list_dir', { path: ctx }, [ctx]);
  assert.equal(ls.ok, true);
  assert.match(ls.output, /notes\.txt/);

  // writes never escape, even to a linked context folder
  const w = await runTool(root, 'write_file', { path: path.join(ctx, 'x.txt'), content: 'no' }, [ctx]);
  assert.equal(w.ok, false);
});
