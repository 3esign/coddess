import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAction, parseActions, extractThinking, type ToolAction, type FinalAction } from './protocol.js';

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

test('heals fused XML tag typos', () => {
  const out = '<tool name="write_file"><arg name="path">index.html</arg name="content"><h1>Hi</h1></arg></tool>';
  const a = parseAction(out);
  assert.equal(a.type, 'tool');
  if (a.type !== 'tool') return;
  assert.equal(a.tool, 'write_file');
  assert.equal(a.args.path, 'index.html');
  assert.equal(a.args.content, '<h1>Hi</h1>');
});

test('parses an unclosed tool (forgotten </tool> or stop-token stripped)', () => {
  const out = '<tool name="write_file"><arg name="path">a.txt</arg><arg name="content">hello world';
  const a = parseAction(out);
  assert.equal(a.type, 'tool');
  if (a.type !== 'tool') return;
  assert.equal(a.tool, 'write_file');
  assert.equal(a.args.path, 'a.txt');
  assert.equal(a.args.content, 'hello world');
});

test('parses an unclosed final', () => {
  const a = parseAction('<final>all done building the site');
  assert.equal(a.type, 'final');
  if (a.type !== 'final') return;
  assert.match(a.summary, /all done/);
});

test('parses multiple tool calls', () => {
  const out = `<tool name="read_file"><arg name="path">a.txt</arg></tool>
some prose
<tool name="list_dir"><arg name="path">src</arg></tool>`;
  const acts = parseActions(out);
  assert.equal(acts.length, 2);
  assert.equal(acts[0]!.type, 'tool');
  const act0 = acts[0] as ToolAction;
  assert.equal(act0.tool, 'read_file');
  assert.equal(act0.args.path, 'a.txt');
  assert.equal(acts[1]!.type, 'tool');
  const act1 = acts[1] as ToolAction;
  assert.equal(act1.tool, 'list_dir');
  assert.equal(act1.args.path, 'src');
});

test('parses multiple tools with unclosed last tag', () => {
  const out = `<tool name="read_file"><arg name="path">a.txt</arg></tool>
<tool name="read_file"><arg name="path">b.txt</arg>`;
  const acts = parseActions(out);
  assert.equal(acts.length, 2);
  const act0 = acts[0] as ToolAction;
  assert.equal(act0.tool, 'read_file');
  assert.equal(act0.args.path, 'a.txt');
  const act1 = acts[1] as ToolAction;
  assert.equal(act1.tool, 'read_file');
  assert.equal(act1.args.path, 'b.txt');
});

test('parses mixed tool and final, returning both', () => {
  const out = `<tool name="read_file"><arg name="path">a.txt</arg></tool> <final>done</final>`;
  const acts = parseActions(out);
  assert.equal(acts.length, 2);
  assert.equal(acts[0]!.type, 'tool');
  assert.equal(acts[1]!.type, 'final');
  const act1 = acts[1] as FinalAction;
  assert.equal(act1.summary, 'done');
});


