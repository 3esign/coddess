import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, toSpec, specToPromptBlock } from './intent.js';

test('parseSpec extracts JSON wrapped in a code fence', () => {
  const raw = 'Here is the spec:\n```json\n{"goal":"Build a landing page","assumptions":["dark theme"],"stack":"HTML/CSS","files":["index.html"],"acceptanceCriteria":["renders a hero"],"openQuestions":[]}\n```\nDone.';
  const spec = parseSpec(raw);
  assert.ok(spec);
  assert.equal(spec!.goal, 'Build a landing page');
  assert.deepEqual(spec!.acceptanceCriteria, ['renders a hero']);
});

test('parseSpec extracts a bare JSON object amid prose', () => {
  const raw = 'Sure. {"goal":"X","acceptanceCriteria":["a","b"]} hope that helps';
  const spec = parseSpec(raw);
  assert.ok(spec);
  assert.equal(spec!.goal, 'X');
  assert.equal(spec!.acceptanceCriteria.length, 2);
});

test('toSpec returns null when there is no goal and no criteria', () => {
  assert.equal(toSpec({ assumptions: ['x'] }), null);
});

test('specToPromptBlock renders criteria as a checklist, with no emoji/ASCII banner', () => {
  const block = specToPromptBlock({ goal: 'G', label: 'Feature', assumptions: [], stack: 'S', files: ['f.ts'], acceptanceCriteria: ['does X'], openQuestions: [] });
  assert.match(block, /Approved specification/);
  assert.match(block, /- \[ \] does X/);
  // The old emoji/ASCII banner format is gone (the harness forbids emojis/fluff).
  assert.doesNotMatch(block, /TARGET SPECIFICATION|={5,}/);
});

test('specToPromptBlock renders the ordered build plan', () => {
  const block = specToPromptBlock({ goal: 'G', label: 'Feature', assumptions: [], stack: 'S', files: [], acceptanceCriteria: ['c'], openQuestions: [], plan: [{ title: 'Scaffold server', verify: 'curl /health returns 200' }] });
  assert.match(block, /Build plan/);
  assert.match(block, /1\. Scaffold server/);
  assert.match(block, /Verify: curl \/health returns 200/);
});

test('parseSpec parses an ordered plan array', () => {
  const raw = '{"goal":"X","acceptanceCriteria":["a"],"plan":[{"title":"step one","detail":"d","verify":"v"},{"title":"step two"}]}';
  const spec = parseSpec(raw);
  assert.ok(spec);
  assert.equal(spec!.plan!.length, 2);
  assert.equal(spec!.plan![0]!.title, 'step one');
  assert.equal(spec!.plan![0]!.verify, 'v');
});
