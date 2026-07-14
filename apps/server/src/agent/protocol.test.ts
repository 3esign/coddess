import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAction, extractThinking } from './protocol.js';

test('parses a write_file tool with content', () => {
  const out = `<thinking>make the page</thinking>
<tool name="write_file">
  <arg name="path">index.html</arg>
  <arg name="content"><h1>Hi</h1></arg>
</tool>`;
  const a = parseAction(out);
  assert.equal(a.type, 'tool');
  if (a.type !== 'tool') return;
  assert.equal(a.tool, 'write_file');
  assert.equal(a.args.path, 'index.html');
  assert.equal(a.args.content, '<h1>Hi</h1>');
});

test('extracts thinking', () => {
  assert.equal(extractThinking('<thinking>plan A</thinking>'), 'plan A');
});

test('final beats a later tool', () => {
  const out = `<final>all done, site built</final> and maybe <tool name="read_file"><arg name="path">x</arg></tool>`;
  const a = parseAction(out);
  assert.equal(a.type, 'final');
});

test('tool beats a later final', () => {
  const out = `<tool name="list_dir"><arg name="path">.</arg></tool> then <final>x</final>`;
  const a = parseAction(out);
  assert.equal(a.type, 'tool');
});

test('strips a code fence inside an arg', () => {
  const out = '<tool name="write_file"><arg name="path">a.js</arg><arg name="content">```js\nconst x=1;\n```</arg></tool>';
  const a = parseAction(out);
  assert.equal(a.type === 'tool' && a.args.content, 'const x=1;');
});

test('decodes entities', () => {
  const out = '<tool name="write_file"><arg name="path">a.html</arg><arg name="content">&lt;div&gt;&amp;&lt;/div&gt;</arg></tool>';
  const a = parseAction(out);
  assert.equal(a.type === 'tool' && a.args.content, '<div>&</div>');
});

test('no action when tags absent', () => {
  assert.equal(parseAction('just chatting, no tags here').type, 'none');
});
