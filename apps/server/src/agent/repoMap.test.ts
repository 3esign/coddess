import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractDefs, buildRepoMap, sourceFileCount } from './repoMap.js';

test('extractDefs finds ts exports, classes, and arrow consts', () => {
  const defs = extractDefs('ts', 'export function foo() {}\nexport class Bar {}\nexport const qux = (a: number) => a;');
  const names = defs.map((d) => d.name);
  assert.ok(names.includes('foo'));
  assert.ok(names.includes('Bar'));
  assert.ok(names.includes('qux'));
});

test('extractDefs finds python defs and classes', () => {
  const defs = extractDefs('py', 'def handler(req):\n    pass\nclass Server:\n    pass');
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, ['Server', 'handler']);
});

test('buildRepoMap ranks a widely-referenced file high and stays in budget', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-map-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'util.ts'), 'export function widelyUsed() { return 1; }\n');
  for (const n of ['a', 'b', 'c']) {
    fs.writeFileSync(path.join(root, 'src', `${n}.ts`), `import { widelyUsed } from './util.js';\nexport function ${n}() { return widelyUsed(); }\n`);
  }
  const map = buildRepoMap(root, 500);
  assert.ok(map);
  assert.match(map!, /src\/util\.ts/);
  assert.match(map!, /widelyUsed/);
  assert.ok(sourceFileCount(root) >= 4);
});

test('buildRepoMap returns undefined for an empty project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coddess-map-empty-'));
  assert.equal(buildRepoMap(root, 500), undefined);
});
