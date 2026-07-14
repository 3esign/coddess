import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from './provider/providerRouter.js';
import { messagesTokens, needsCompaction, splitForCompaction, assembleCompacted, compactIfNeeded } from './compaction.js';

function msgs(n: number): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: 'SYS' }];
  for (let i = 0; i < n; i++) out.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i} ` + 'x'.repeat(50) });
  return out;
}

test('messagesTokens sums content', () => {
  assert.ok(messagesTokens([{ role: 'user', content: 'x'.repeat(400) }]) >= 100);
});

test('needsCompaction respects the threshold', () => {
  const m = msgs(20);
  assert.equal(needsCompaction(m, 5), true);
  assert.equal(needsCompaction(m, 10_000_000), false);
});

test('splitForCompaction keeps system + recent, middle is the rest', () => {
  const m = msgs(10); // 1 system + 10 body
  const { system, middle, recent } = splitForCompaction(m, 4);
  assert.equal(system!.role, 'system');
  assert.equal(recent.length, 4);
  assert.equal(middle.length, 6);
  assert.equal(recent[recent.length - 1]!.content.startsWith('turn 9'), true);
});

test('splitForCompaction with fewer than keepRecent yields no middle', () => {
  const { middle, recent } = splitForCompaction(msgs(3), 6);
  assert.equal(middle.length, 0);
  assert.equal(recent.length, 3);
});

test('assembleCompacted = system + summary + recent', () => {
  const sys: ChatMessage = { role: 'system', content: 'SYS' };
  const recent: ChatMessage[] = [{ role: 'user', content: 'latest' }];
  const out = assembleCompacted(sys, 'the summary', recent);
  assert.equal(out.length, 3);
  assert.equal(out[0]!.content, 'SYS');
  assert.match(out[1]!.content, /CONVERSATION SUMMARY/);
  assert.match(out[1]!.content, /the summary/);
  assert.equal(out[2]!.content, 'latest');
});

test('compactIfNeeded is a no-op below threshold (no model call)', async () => {
  const m = msgs(3);
  const r = await compactIfNeeded(m, 'nonexistent-model', 10_000_000, 6);
  assert.equal(r.compacted, false);
  assert.equal(r.messages, m);
});
