import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlan } from './orchestrator.js';

test('toPlan parses an ordered task list', () => {
  const plan = toPlan({ overview: 'build a site', tasks: [
    { title: 'Scaffold', prompt: 'Create index.html' },
    { title: 'Style', prompt: 'Add style.css' },
  ] });
  assert.ok(plan);
  assert.equal(plan!.tasks.length, 2);
  assert.equal(plan!.tasks[0]!.title, 'Scaffold');
});

test('toPlan drops tasks with no prompt and caps at 8', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, prompt: `do ${i}` }));
  const plan = toPlan({ tasks: [...many, { title: 'empty', prompt: '' }] });
  assert.ok(plan);
  assert.equal(plan!.tasks.length, 8);
});

test('toPlan returns null without a usable tasks array', () => {
  assert.equal(toPlan({ overview: 'x' }), null);
  assert.equal(toPlan({ tasks: [] }), null);
  assert.equal(toPlan(null), null);
});
