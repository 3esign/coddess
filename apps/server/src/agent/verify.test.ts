import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectVerifyCommand, staticCheck } from './verify.js';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-verify-'));
}

test('detectVerifyCommand prefers a build script', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', test: 'x' } }));
  assert.equal(detectVerifyCommand(root), 'npm run build');
});

test('detectVerifyCommand falls back to test, then tsc', () => {
  const a = tmp();
  fs.writeFileSync(path.join(a, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  assert.equal(detectVerifyCommand(a), 'npm test');

  const b = tmp();
  fs.writeFileSync(path.join(b, 'package.json'), JSON.stringify({ scripts: {} }));
  fs.writeFileSync(path.join(b, 'tsconfig.json'), '{}');
  assert.equal(detectVerifyCommand(b), 'npx tsc --noEmit');
});

test('detectVerifyCommand ignores the npm default test placeholder', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  assert.equal(detectVerifyCommand(root), null);
});

test('staticCheck fails when HTML references a missing file', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.html'), '<link href="style.css"><script src="app.js"></script>');
  const res = await staticCheck(root);
  assert.equal(res.ran, true);
  assert.equal(res.ok, false);
  assert.match(res.output, /style\.css/);
});

test('staticCheck passes when all local references resolve', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(root, 'index.html'), '<link href="style.css"><a href="https://x.com">x</a>');
  const res = await staticCheck(root);
  assert.equal(res.ok, true);
});

test('staticCheck is a no-op when there is nothing to verify', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'notes.txt'), 'hi');
  const res = await staticCheck(root);
  assert.equal(res.ran, false);
  assert.equal(res.ok, true);
});
