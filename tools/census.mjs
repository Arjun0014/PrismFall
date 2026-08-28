// What is the archive actually made of?
//
//   node tools/census.mjs
//
// Attribution by class rather than by function. Each row replaces one kind of
// content in the MINIFIED bundle with a trivial stand-in of the same shape and
// weighs the archive; the difference is what that class of content costs.
//
// None of these are candidate builds -- most of them do not run. This exists to
// answer "how much of PRISMFALL is English, how much is tuning numbers, and how
// much is program structure", which is the question that decides whether any
// amount of restructuring can close a given gap.
import { parse } from 'acorn';
import { weigh, competitionTerser, rrOptions } from './measure.mjs';
import { bundle } from './src.mjs';

const rr = rrOptions();
const { minify } = await import('terser');
const r = await minify(bundle(false), competitionTerser());
if (r.error) throw r.error;
const min = r.code;

// Collect spans by class with a real parser, so nothing is matched textually.
function spans(src) {
  const ast = parse(src, { ecmaVersion: 2022, sourceType: 'script' });
  const out = { string: [], number: [], ident: [], regex: [] };
  const seen = new Set();
  const walk = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Literal') {
      if (typeof node.value === 'string') out.string.push({ start: node.start, end: node.end, raw: src.slice(node.start, node.end) });
      else if (typeof node.value === 'number') {
        const key = parent && ((parent.type === 'Property' && parent.key === node && !parent.computed) ||
          (parent.type === 'MemberExpression' && parent.property === node && !parent.computed));
        if (!key) out.number.push({ start: node.start, end: node.end, raw: src.slice(node.start, node.end) });
      } else if (node.regex) out.regex.push({ start: node.start, end: node.end });
      return;
    }
    if (node.type === 'Identifier' && !seen.has(node.start)) { seen.add(node.start); out.ident.push({ start: node.start, end: node.end, name: node.name }); }
    for (const k of Object.keys(node)) {
      if (k === 'start' || k === 'end' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) walk(c, node); }
      else if (v && typeof v === 'object') walk(v, node);
    }
  };
  walk(ast, null);
  return out;
}

const splice = (src, edits) => {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
};

const S = spans(min);
const base = await weigh(min, rr, 'cen');
console.log('archive ' + base.zip + ' B   minified ' + min.length + ' chars\n');

// Strings that carry English, as opposed to CSS/canvas keywords the API demands.
const isWord = (raw) => /[A-Za-z]{3,}/.test(raw) && /[A-Za-z] [A-Za-z]|[A-Z]{3,}/.test(raw);

const rows = [
  ['every string literal -> ""', S.string.map((s) => ({ ...s, text: '""' }))],
  ['English text only -> ""', S.string.filter((s) => isWord(s.raw)).map((s) => ({ ...s, text: '""' }))],
  ['every number -> 1', S.number.map((s) => ({ ...s, text: '1' }))],
  ['numbers, keeping 0/1/2 -> 1', S.number.filter((s) => !/^[012]$/.test(s.raw)).map((s) => ({ ...s, text: '1' }))],
];

console.log('  cost   count  what');
for (const [label, edits] of rows) {
  if (!edits.length) { console.log('     -       0  ' + label); continue; }
  const src = splice(min, edits);
  let w;
  try { parse(src, { ecmaVersion: 2022 }); w = await weigh(src, rr, 'cen2'); }
  catch (e) { console.log('     ?  ' + String(edits.length).padStart(6) + '  ' + label + '  (' + e.message.slice(0, 40) + ')'); continue; }
  const chars = min.length - src.length;
  console.log('  ' + String(base.zip - w.zip).padStart(4) + '  ' + String(edits.length).padStart(6) +
    '  ' + label.padEnd(30) + ' (' + chars + ' chars)');
}

// How much of the archive is the packer's own decoder rather than the game?
const { Packer } = await import('roadroller');
const pk = new Packer([{ data: min, type: 'js', action: 'eval' }], rr);
const d = pk.makeDecoder();
console.log('\n  decoder second line: ' + d.secondLine.length + ' chars');
console.log('  packed payload:      ' + d.firstLine.length + ' chars');
console.log('  zip container:       118 B of headers for one stored name');
const bits = (base.zip - 118) * 8 / min.length;
console.log('\n  ' + bits.toFixed(3) + ' bits per minified character, over ' + min.length + ' characters');
