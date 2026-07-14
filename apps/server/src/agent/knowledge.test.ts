import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Project } from '@coddess/shared';
import {
  emptyKnowledge,
  mergeFacts,
  parseFactsJson,
  loadKnowledge,
  saveKnowledge,
  knowledgePromptBlock,
  countFacts,
  isEmpty,
} from './knowledge.js';

function tmpProject(): Project {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-know-'));
  return { id: 'p1', name: 'p', path: dir, createdAt: Date.now() };
}

test('mergeFacts adds new facts and dedups case-insensitively', () => {
  const base = { ...emptyKnowledge(), conventions: ['Uses ES modules'] };
  const merged = mergeFacts(base, { conventions: ['uses es modules', 'Ports 8921/8922'], pitfalls: ['No native dialogs'] });
  assert.equal(merged.conventions.length, 2); // dup dropped
  assert.deepEqual(merged.pitfalls, ['No native dialogs']);
});

test('mergeFacts caps a category at 20 (keeps newest)', () => {
  const incoming = Array.from({ length: 30 }, (_, i) => `fact ${i}`);
  const merged = mergeFacts(emptyKnowledge(), { commands: incoming });
  assert.equal(merged.commands.length, 20);
  assert.equal(merged.commands[merged.commands.length - 1], 'fact 29');
});

test('parseFactsJson handles fenced and bare JSON', () => {
  const fenced = parseFactsJson('```json\n{"conventions":["a"],"pitfalls":["b"]}\n```');
  assert.deepEqual(fenced?.conventions, ['a']);
  const bare = parseFactsJson('sure: {"commands":["npm run dev"]} ok');
  assert.deepEqual(bare?.commands, ['npm run dev']);
  assert.equal(parseFactsJson('no json here'), null);
});

test('save + load round-trips and prompt block reflects content', () => {
  const project = tmpProject();
  assert.equal(isEmpty(loadKnowledge(project)), true);
  assert.equal(knowledgePromptBlock(project), undefined);

  const k = mergeFacts(emptyKnowledge(), { architecture: ['index.ts wires routes'], commands: ['npm test'] });
  saveKnowledge(project, k);

  const loaded = loadKnowledge(project);
  assert.equal(countFacts(loaded), 2);
  assert.ok(fs.existsSync(path.join(project.path, '.coddess', 'knowledge.md')));

  const block = knowledgePromptBlock(project);
  assert.match(block!, /Project knowledge/);
  assert.match(block!, /index\.ts wires routes/);
  assert.match(block!, /npm test/);
});
