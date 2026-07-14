import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPlanProgress } from './loop.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-loop-'));
}

test('getPlanProgress returns warning when PLAN.md is missing', () => {
  const root = tmpDir();
  const progress = getPlanProgress(root);
  assert.match(progress, /PLAN.md was not found/);
});

test('getPlanProgress returns warning when no tasks are found', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'PLAN.md'), '# Implementation Plan\nNo tasks here', 'utf8');
  const progress = getPlanProgress(root);
  assert.match(progress, /No checklist tasks found/);
});

test('getPlanProgress parses tasks and returns remaining list', () => {
  const root = tmpDir();
  const md = `# Plan
- [x] Done task
- [/] In progress task
- [ ] Todo task 1
- [ ] Todo task 2
`;
  fs.writeFileSync(path.join(root, 'PLAN.md'), md, 'utf8');
  const progress = getPlanProgress(root);
  assert.match(progress, /Progress: 1\/4 tasks completed/);
  assert.match(progress, /\(1 in progress\)/);
  assert.match(progress, /- \[\/\] In progress task/);
  assert.match(progress, /- \[ \] Todo task 1/);
});
