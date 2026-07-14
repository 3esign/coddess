import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenAIResponse, parseAnthropicResponse, providerSupportsNativeTools, toOpenAITools, toAnthropicTools, CODDESS_TOOLS } from './nativeTools.js';

test('providerSupportsNativeTools: frontier yes, ollama no', () => {
  assert.equal(providerSupportsNativeTools('anthropic/claude-3-5-sonnet-20241022'), true);
  assert.equal(providerSupportsNativeTools('openrouter/x/y'), true);
  assert.equal(providerSupportsNativeTools('gemini/gemini-2.5-pro'), true);
  assert.equal(providerSupportsNativeTools('qwen2.5-coder'), false);
  assert.equal(providerSupportsNativeTools('llama3'), false);
});

test('toOpenAITools / toAnthropicTools include the finish tool', () => {
  const oa = toOpenAITools() as any[];
  assert.equal(oa.length, CODDESS_TOOLS.length);
  assert.ok(oa.some((t) => t.function.name === 'finish'));
  const an = toAnthropicTools() as any[];
  assert.ok(an.some((t) => t.name === 'write_file' && t.input_schema.required.includes('content')));
});

test('parseOpenAIResponse extracts text + first tool call with parsed args', () => {
  const r = parseOpenAIResponse({ choices: [{ message: { content: 'ok', tool_calls: [{ function: { name: 'write_file', arguments: '{"path":"a.txt","content":"hi"}' } }] } }] });
  assert.equal(r.text, 'ok');
  assert.equal(r.call!.name, 'write_file');
  assert.equal(r.call!.args.path, 'a.txt');
});

test('parseOpenAIResponse with no tool call returns null call', () => {
  const r = parseOpenAIResponse({ choices: [{ message: { content: 'just text' } }] });
  assert.equal(r.call, null);
  assert.equal(r.text, 'just text');
});

test('parseAnthropicResponse extracts text + tool_use input', () => {
  const r = parseAnthropicResponse({ content: [{ type: 'text', text: 'thinking' }, { type: 'tool_use', name: 'run', input: { command: 'npm test' } }] });
  assert.equal(r.text, 'thinking');
  assert.equal(r.call!.name, 'run');
  assert.equal(r.call!.args.command, 'npm test');
});
