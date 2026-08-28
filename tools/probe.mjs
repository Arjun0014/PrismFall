// Size-opportunity probes.
//
// Every number here is measured as a REAL archive delta -- pack, zip, compare --
// because intuition about what compresses is worthless against a context-mixing
// coder. Several probes deliberately produce a bundle that would not play
// correctly; they exist to size a ceiling, not to ship. Each says which it is.
//
//   node tools/probe.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer } from 'roadroller';
import { makeZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);
const cached = JSON.parse(readFileSync(p('build', 'roadroller.json'), 'utf8'));
const min = readFileSync(p('build', 'bundle.min.js'), 'utf8');

const html = (s) =>
  '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' +
  s + '</script>';

async function pack(js) {
  const pk = new Packer([{ data: js, type: 'js', action: 'eval' }],
    Object.assign({ maxMemoryMB: 700 }, cached));
  const d = pk.makeDecoder();
  return d.firstLine + '\n' + d.secondLine;
}
async function zipOf(text) {
  return makeZip([{ name: 'index.html', data: Buffer.from(text, 'utf8') }], { iterations: [15] });
}
async function measure(js) {
  const packed = await pack(js);
  const z = await zipOf(html(packed));
  return { chars: js.length, packed: packed.length, zip: z.length };
}

const base = await measure(min);
console.log('BASELINE  chars ' + base.chars + '  packed ' + base.packed + '  zip ' + base.zip + '\n');

const results = [];
async function probe(name, js, note) {
  const m = await measure(js);
  const dChars = base.chars - m.chars, dZip = base.zip - m.zip;
  results.push({ name, dChars, dZip, ratio: dChars && dZip > 0 ? dChars / dZip : 0 });
  console.log(
    name.padEnd(34) +
    ' chars -' + String(dChars).padStart(6) +
    '  zip -' + String(dZip).padStart(5) +
    '  chars/byte ' + (dZip > 0 ? (dChars / dZip).toFixed(1) : '   -').padStart(6) +
    (note ? '   ' + note : ''));
}

// --- 1. What do NUMERIC LITERALS actually cost? ------------------------------
// Digits are 12% of the minified text and are the least predictable thing in
// it. This rounds every float to two significant decimals; the result would
// play slightly differently, so it is a CEILING measurement, not a change.
await probe('floats -> 2 decimals (CEILING)',
  min.replace(/(?<![\w.$])(\d*\.\d+)/g, (m0) => {
    const v = parseFloat(m0);
    const r = Number(v.toPrecision(2));
    return String(r).replace(/^0\./, '.');
  }), 'behaviour-changing');

await probe('floats -> 1 decimal (CEILING)',
  min.replace(/(?<![\w.$])(\d*\.\d+)/g, (m0) => {
    const r = Number(parseFloat(m0).toPrecision(1));
    return String(r).replace(/^0\./, '.');
  }), 'behaviour-changing');

// --- 2. What does the AUDIO subsystem cost end to end? -----------------------
// Leave-one-out on whole subsystems tells me which are worth restructuring.
// Deleting a call site is not valid JS in general, so these replace function
// BODIES with empty ones -- the declarations stay, the logic goes.
const blankBodies = (src, names) => {
  let out = src;
  for (const n of names) {
    // minified names are unknown; match by the original source instead below
  }
  return out;
};

// --- 3. Identifier length: does Terser's mangling leave anything on the table?
const idHist = {};
for (const t of min.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) idHist[t] = (idHist[t] || 0) + 1;
const long = Object.entries(idHist).filter(([t]) => t.length > 4)
  .map(([t, n]) => [t, n, t.length * n]).sort((a, b) => b[2] - a[2]);
console.log('\nlongest surviving identifiers (name, uses, chars):');
for (const [t, n, c] of long.slice(0, 22)) console.log('  ' + t.padEnd(30) + String(n).padStart(5) + String(c).padStart(7));
console.log('  ... ' + long.length + ' distinct names >4 chars, ' +
  long.reduce((a, r) => a + r[2], 0) + ' chars total');

// --- 4. Character-class entropy ---------------------------------------------
const cls = { ident: 0, digit: 0, punct: 0, space: 0, quote: 0 };
for (const ch of min) {
  cls[/[a-zA-Z_$]/.test(ch) ? 'ident' : /[0-9]/.test(ch) ? 'digit'
    : /['"`]/.test(ch) ? 'quote' : /\s/.test(ch) ? 'space' : 'punct']++;
}
console.log('\ncharacter classes:', JSON.stringify(cls));

// --- 5. How much is the ZIP layer still doing over Roadroller? ---------------
const packed = await pack(min);
const nl = packed.indexOf('\n');
const line1 = packed.slice(0, nl), line2 = packed.slice(nl + 1);
const z1 = await zipOf(line1), z2 = await zipOf(line2), zBoth = await zipOf(packed);
console.log('\nroadroller output split:');
console.log('  line 1 (packed data) ' + String(line1.length).padStart(6) + ' -> zip ' + String(z1.length).padStart(6) +
  '   ratio ' + (z1.length / line1.length).toFixed(3));
console.log('  line 2 (decoder)     ' + String(line2.length).padStart(6) + ' -> zip ' + String(z2.length).padStart(6) +
  '   ratio ' + (z2.length / line2.length).toFixed(3));
console.log('  together             ' + String(packed.length).padStart(6) + ' -> zip ' + String(zBoth.length).padStart(6) +
  '   ratio ' + (zBoth.length / packed.length).toFixed(3));
console.log('  separate would be    ' + (z1.length + z2.length) +
  '  (deflate gains ' + (z1.length + z2.length - zBoth.length) + ' B from sharing one stream)');
