import fs from 'node:fs';
import path from 'node:path';

const proj = process.argv[2];
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };

const idx = path.join(proj, 'index.html');
if (!fs.existsSync(idx)) fail('index.html was not created');
const html = fs.readFileSync(idx, 'utf8');
const low = html.toLowerCase();

if (!/<h1[\s>]/.test(low)) fail('no <h1> hero heading');
if (!/acme/.test(low)) fail('the word "Acme" is missing');
if (!/<nav[\s>]/.test(low)) fail('no <nav> element');

const links = (low.match(/<a\b[^>]*>/g) || []).length;
if (links < 3) fail(`expected at least 3 nav links, found ${links}`);

if (!/<form[\s>]/.test(low)) fail('no <form> element');
if (!/type\s*=\s*["']?email/.test(low) && !/name\s*=\s*["']?email/.test(low)) fail('no email field');
if (!/type\s*=\s*["']?submit/.test(low) && !/<button[\s>]/.test(low)) fail('no submit button');

console.log('PASS');
process.exit(0);
