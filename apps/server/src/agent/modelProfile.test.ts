import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelTier, isFrontierModel, scaffoldFor } from './modelProfile.js';

test('hosted providers classify as frontier', () => {
  for (const m of [
    'anthropic/claude-3-5-sonnet',
    'claude-3-5-sonnet-20241022',
    'openrouter/openai/gpt-4o',
    'gemini/gemini-2.5-pro',
    'deepseek/deepseek-chat',
    'custom/prov/model',
  ]) {
    assert.equal(isFrontierModel(m), true, `${m} should be frontier`);
    assert.equal(modelTier(m), 'frontier', m);
  }
});

test('bare local families are NOT frontier (they route to Ollama)', () => {
  for (const m of ['mistral', 'devstral', 'llama3', 'qwen2.5-coder']) {
    assert.equal(isFrontierModel(m), false, `${m} must not be misrouted as hosted`);
  }
});

test('local tier uses size then strong-family heuristics', () => {
  assert.equal(modelTier('qwen2.5-coder'), 'local-large'); // strong coder family, no size tag
  assert.equal(modelTier('llama3.2:1b'), 'local-small'); // small by size
  assert.equal(modelTier('llama3.1:70b'), 'local-large'); // large by size
  assert.equal(modelTier('somerandommodel'), 'local-small'); // unknown → smallest
});

test('scaffoldFor scales structure by tier', () => {
  assert.equal(scaffoldFor('claude-3-5-sonnet').requireStructuredThinking, false);
  assert.equal(scaffoldFor('llama3.2:3b').smallSteps, true);
});
