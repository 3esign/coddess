import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const proj = process.argv[2];
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

const f = path.join(proj, 'src', 'sum.js');
if (!fs.existsSync(f)) fail('src/sum.js is missing');

let mod;
try {
  mod = await import(pathToFileURL(f).href);
} catch (e) {
  fail('could not import src/sum.js: ' + e.message);
}

const sum = mod.sum || mod.default;
if (typeof sum !== 'function') fail('no exported sum function');

for (const [a, b, want] of [[2, 3, 5], [-1, 1, 0], [0, 0, 0], [10, 5, 15]]) {
  const got = sum(a, b);
  if (got !== want) fail(`sum(${a}, ${b}) returned ${got}, expected ${want}`);
}

console.log('PASS');
process.exit(0);
