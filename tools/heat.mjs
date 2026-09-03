// Per-byte cost of the packed build, from Roadroller's own model.
//
// Runs the exact model the archive ships (cached selectors, precision, counts,
// abbreviations, 150 MB table) over the exact bytes it models -- the
// whitespace-stripped, abbreviated text Packer.prepareJs produces -- with
// calculateByteEntropy on, and reports where the bits go. Nothing else in this
// directory measures below the level of a whole function; this is the only
// instrument that can say what one string, one number or one statement costs
// in the context of everything before it.
//
//   node tools/heat.mjs [--lines=N] [--file=build/bundle.min.js]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rrOptions } from './measure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const N = +((args.find((a) => a.startsWith('--lines=')) || '').slice(8)) || 40;
const FILE = (args.find((a) => a.startsWith('--file=')) || '').slice(7) || 'build/bundle.min.js';

const { Packer, compressWithModel, DefaultModel } = await import('roadroller');
const js = readFileSync(join(ROOT, FILE), 'utf8');
const pk = new Packer([{ data: js, type: 'js', action: 'eval' }], rrOptions());
const prepared = Packer.prepareJs(pk.inputsByType.js, pk.options);
const text = prepared.code;
const input = [...text].map((c) => c.charCodeAt(0));
const inBits = input.every((c) => c <= 0x7f) ? 7 : 8;
const opts = {
  ...pk.options, inBits, outBits: 6, modelQuotes: !!(pk.options.dynamicModels & 1),
  contextBits: pk.options.contextBits || contextBitsFromMaxMemory(pk.options),
  calculateByteEntropy: true, disableWasm: true,
};
// Mirrors Roadroller's contextBitsFromMaxMemory (not exported).
function contextBitsFromMaxMemory(o) {
  const bytesPerContext = (o.precision <= 8 ? 1 : o.precision <= 16 ? 2 : 4) + (o.modelMaxCount < 128 ? 1 : o.modelMaxCount < 32768 ? 2 : 4);
  const numModels = o.sparseSelectors.length;
  let bits = 1;
  while ((numModels << (bits + 1)) * bytesPerContext <= o.maxMemoryMB * 1048576) bits++;
  return bits;
}
const model = new DefaultModel(opts);
const t0 = Date.now();
const res = compressWithModel(input, model, opts);
const bits = res.byteEntropy;
const total = bits.reduce((a, b) => a + b, 0);
console.log('prepared ' + text.length + ' chars, modelled ' + (total / 8).toFixed(0) + ' B (' + (total / text.length).toFixed(3) +
  ' bits/char), packer says ' + res.bufLengthInBytes + ' B, ' + (Date.now() - t0) + ' ms');
console.log('abbreviations: ' + prepared.abbrs.map(([w, c]) => w + '=\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '));

// ---- by character class ---------------------------------------------------
const cls = {};
let inStr = 0;
for (let i = 0; i < text.length; i++) {
  const c = text[i];
  let k;
  if (inStr) { k = 'string'; if (c === inStr && text[i - 1] !== '\\') inStr = 0; }
  else if (c === '"' || c === "'" || c === '`') { k = 'string'; inStr = c; }
  else if (c.charCodeAt(0) < 32 && c !== '\n') k = 'abbrev';
  else if (c === '\n') k = 'newline';
  else if (/[0-9.]/.test(c) && /[0-9.]/.test(text[i - 1] || '') === false && /[0-9]/.test(text[i] + (text[i + 1] || ''))) k = 'number';
  else if (/[0-9.]/.test(c) && (cls.last === 'number')) k = 'number';
  else if (/[A-Za-z_$]/.test(c)) k = 'ident';
  else if (c === ' ') k = 'space';
  else k = 'punct';
  cls.last = k;
  (cls[k] ||= { n: 0, bits: 0 }).n++;
  cls[k].bits += bits[i];
}
delete cls.last;
console.log('\nby class          chars     bytes  bits/char');
for (const [k, v] of Object.entries(cls).sort((a, b) => b[1].bits - a[1].bits))
  console.log('  ' + k.padEnd(10) + String(v.n).padStart(9) + String((v.bits / 8).toFixed(0)).padStart(9) + String((v.bits / v.n).toFixed(2)).padStart(10));

// ---- by line ----------------------------------------------------------------
const lines = [];
let s = 0;
for (let i = 0; i <= text.length; i++) {
  if (i === text.length || text[i] === '\n') {
    let b = 0; for (let j = s; j < i; j++) b += bits[j];
    lines.push({ s, e: i, bits: b, text: text.slice(s, i) });
    s = i + 1;
  }
}
const show = (t) => t.replace(/[\x00-\x1f]/g, (m) => '\\' + m.charCodeAt(0).toString(16)).slice(0, 110);
console.log('\nmost expensive lines (bytes, bits/char):');
for (const l of [...lines].sort((a, b) => b.bits - a.bits).slice(0, N))
  console.log('  ' + String((l.bits / 8).toFixed(1)).padStart(7) + String((l.bits / Math.max(1, l.text.length)).toFixed(2)).padStart(6) + '  ' + show(l.text));
console.log('\nhighest bits/char (len >= 12):');
for (const l of lines.filter((l) => l.text.length >= 12).sort((a, b) => b.bits / b.text.length - a.bits / a.text.length).slice(0, N))
  console.log('  ' + String((l.bits / 8).toFixed(1)).padStart(7) + String((l.bits / l.text.length).toFixed(2)).padStart(6) + '  ' + show(l.text));

// ---- string literals, each priced in place ---------------------------------
console.log('\nstring literals (bytes, bits/char):');
const strs = [];
const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
let m;
while ((m = re.exec(text))) {
  let b = 0; for (let j = m.index; j < m.index + m[0].length; j++) b += bits[j];
  strs.push({ t: m[0], bits: b });
}
for (const x of strs.sort((a, b) => b.bits - a.bits).slice(0, N))
  console.log('  ' + String((x.bits / 8).toFixed(1)).padStart(7) + String((x.bits / x.t.length).toFixed(2)).padStart(6) + '  ' + show(x.t));

// ---- numbers, grouped by literal -------------------------------------------
console.log('\nnumeric literals, total cost by value (top ' + N + '):');
const nums = new Map();
const nre = /(?<![\w$.])(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g;
while ((m = nre.exec(text))) {
  let b = 0; for (let j = m.index; j < m.index + m[0].length; j++) b += bits[j];
  const v = nums.get(m[0]) || { n: 0, bits: 0 };
  v.n++; v.bits += b; nums.set(m[0], v);
}
for (const [k, v] of [...nums].sort((a, b) => b[1].bits - a[1].bits).slice(0, N))
  console.log('  ' + String((v.bits / 8).toFixed(1)).padStart(7) + String(v.n).padStart(5) + 'x' + String((v.bits / v.n / 8).toFixed(2)).padStart(7) + ' B each  ' + k);

// ---- identifiers of 4+ characters: first occurrence vs the rest ------------
console.log('\nidentifiers >= 4 chars, total cost (bytes), first occurrence, mean of the rest:');
const ids = new Map();
const ire = /[A-Za-z_$][\w$]{3,}/g;
inStr = 0;
while ((m = ire.exec(text))) {
  // skip matches inside string literals (rough: count quotes before the match on this line)
  const ls = text.lastIndexOf('\n', m.index) + 1;
  const q = (text.slice(ls, m.index).match(/"/g) || []).length;
  if (q & 1) continue;
  let b = 0; for (let j = m.index; j < m.index + m[0].length; j++) b += bits[j];
  const v = ids.get(m[0]) || { n: 0, bits: 0, first: 0, rest: 0 };
  v.n++; v.bits += b; if (v.n === 1) v.first = b; else v.rest += b; ids.set(m[0], v);
}
for (const [k, v] of [...ids].sort((a, b) => b[1].bits - a[1].bits).slice(0, N))
  console.log('  ' + String((v.bits / 8).toFixed(1)).padStart(7) + String(v.n).padStart(4) + 'x  first ' + (v.first / 8).toFixed(1).padStart(5) + '  rest ' + (v.n > 1 ? (v.rest / 8 / (v.n - 1)).toFixed(2) : '   -').padStart(5) + ' B  ' + k);
