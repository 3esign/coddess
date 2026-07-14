import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const proj = process.argv[2];
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

const f = path.join(proj, 'fizzbuzz.js');
if (!fs.existsSync(f)) fail('fizzbuzz.js was not created');

let mod;
try {
  mod = await import(pathToFileURL(f).href);
} catch (e) {
  fail('could not import fizzbuzz.js as an ES module: ' + e.message);
}

const fn = mod.fizzbuzz || (mod.default && mod.default.fizzbuzz) || mod.default;
if (typeof fn !== 'function') fail('no exported fizzbuzz function');

const expected = [1, 2, 'Fizz', 4, 'Buzz', 'Fizz', 7, 8, 'Fizz', 'Buzz', 11, 'Fizz', 13, 14, 'FizzBuzz'];
const out = fn(15);
if (JSON.stringify(out) !== JSON.stringify(expected)) fail('fizzbuzz(15) returned ' + JSON.stringify(out));

console.log('PASS');
process.exit(0);
