import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReview, decideReview } from './review.js';

test('parseReview parses results with mixed met flags', () => {
  const j = parseReview('{"results":[{"criterion":"has hero","met":true,"reason":"h1 present"},{"criterion":"has form","met":false,"reason":"no form tag"}]}');
  assert.ok(j);
  assert.equal(j!.length, 2);
  assert.equal(j![0]!.met, true);
  assert.equal(j![1]!.met, false);
});

test('parseReview tolerates a code fence and string booleans', () => {
  const j = parseReview('```json\n{"results":[{"criterion":"x","met":"true","reason":"ok"}]}\n```');
  assert.ok(j);
  assert.equal(j![0]!.met, true);
});

test('parseReview returns null on non-JSON', () => {
  assert.equal(parseReview('no json here'), null);
});

test('decideReview passes only when every criterion is met', () => {
  assert.equal(decideReview([{ criterion: 'a', met: true, reason: '' }]).pass, true);
  const d = decideReview([
    { criterion: 'a', met: true, reason: '' },
    { criterion: 'b', met: false, reason: 'missing' },
  ]);
  assert.equal(d.pass, false);
  assert.equal(d.met, 1);
  assert.equal(d.total, 2);
  assert.equal(d.unmet.length, 1);
  assert.equal(d.unmet[0]!.criterion, 'b');
});

test('decideReview fails an empty verdict list (fail-closed here; caller fails open on parse error)', () => {
  assert.equal(decideReview([]).pass, false);
});
