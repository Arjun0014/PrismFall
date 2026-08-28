// Container audit: the HTML shell and the ZIP wrapper.
//
// The shell sits OUTSIDE the Roadroller payload, so it is deflated together
// with the packed script rather than modelled by it. A few characters here are
// worth measuring separately from anything in the game.
//
//   node tools/probe5.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer, defaultSparseSelectors } from 'roadroller';
import { makeZip, readZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rr = JSON.parse(readFileSync(join(ROOT, 'build', 'roadroller.json'), 'utf8'));
const min = readFileSync(join(ROOT, 'build', 'bundle.min.js'), 'utf8');

const opts = Object.assign({ maxMemoryMB: 150 }, rr, { allowFreeVars: true });
if (!opts.sparseSelectors || opts.sparseSelectors.length !== 20) opts.sparseSelectors = defaultSparseSelectors(20);
opts.maxMemoryMB = 150;
const packed = (() => {
  const d = new Packer([{ data: min, type: 'js', action: 'eval' }], opts).makeDecoder();
  return d.firstLine + '\n' + d.secondLine;
})();

async function zipOf(html, name) {
  return makeZip([{ name: name || 'index.html', data: Buffer.from(html, 'utf8') }], { iterations: [200, 1000] });
}

const S = '<script>' + packed + '</script>';
const VARIANTS = {
  'current': '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas>' + S,
  'no title': '<!doctype html><meta charset=utf-8><canvas id=a></canvas>' + S,
  'no doctype': '<meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas>' + S,
  'no charset (needs ASCII-only source)': '<!doctype html><title>PRISMFALL</title><canvas id=a></canvas>' + S,
  'no title, no doctype': '<meta charset=utf-8><canvas id=a></canvas>' + S,
  'no title, no doctype, no charset': '<meta charset=utf-8>'.replace(/.*/, '') + '<canvas id=a></canvas>' + S,
  'unclosed canvas tag': '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a>' + S,
  'unclosed script tag': '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a><script>' + packed,
  'ALL: no doctype/charset/title, unclosed tags': '<canvas id=a><script>' + packed,
  'keep doctype, drop the rest + unclosed': '<!doctype html><canvas id=a><script>' + packed,
  'body-tag canvas (no id, use body.firstChild)':
    '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas>' + S,
};

console.log('HTML shell variants (all keep the same packed payload)\n');
let base = 0;
for (const [name, html] of Object.entries(VARIANTS)) {
  const z = await zipOf(html);
  if (!base) base = z.length;
  console.log('  ' + name.padEnd(46) + 'html ' + String(html.length).padStart(6) +
    '  zip ' + String(z.length).padStart(6) + '  ' + (z.length - base > 0 ? '+' : '') + (z.length - base));
}

// --- ZIP container ----------------------------------------------------------
console.log('\nZIP container');
const html = VARIANTS.current;
const z = await zipOf(html);
const payload = Buffer.byteLength(html, 'utf8');
console.log('  html payload      ' + payload + ' B');
console.log('  archive           ' + z.length + ' B');
console.log('  container overhead ' + (z.length - (z.length - 0)) + ' -- see below');
const entries = readZip(z);
console.log('  entries           ' + entries.length + ' (' + entries.map((e) => e.name).join(',') + ')');
// The local header + central directory + EOCD for one stored name.
console.log('  structural bytes  ' + (30 + 46 + 22 + 2 * 'index.html'.length) +
  ' (local 30 + central 46 + EOCD 22 + 2 x filename)');
