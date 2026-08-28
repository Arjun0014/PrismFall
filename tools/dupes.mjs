// Is there any duplicated logic left to fuse?
//
//   node tools/dupes.mjs            largest repeated structures
//   node tools/dupes.mjs --min=40   only subtrees of at least 40 AST nodes
//
// "Make systems do multiple jobs" is only worth doing where two systems really
// are the same machine twice. This answers that objectively instead of by
// reading: it hashes every subtree of the minified bundle by SHAPE -- node types
// and operators, with identifiers and literals erased -- and groups the matches.
//
// Erasing names is the point. Two functions that do the same thing to different
// variables have the same shape and different text, so this finds duplication a
// diff never would.
//
// What it cannot tell you is whether fusing a group would pay. Repeated text is
// nearly free to this packer (COMPRESSION_EXPERIMENTS.md, standing measurements),
// so a group has to be genuinely large before it is worth collapsing. The point
// of the tool is to establish the ceiling.
import { parse } from 'acorn';
import { minify } from 'terser';
import { competitionTerser } from './measure.mjs';
import { bundle, readSources } from './src.mjs';

const args = process.argv.slice(2);
const MIN = +((args.find((a) => a.startsWith('--min=')) || '').slice(6)) || 25;
const SRC = args.includes('--source');

// Shape hash: structure only. Identifiers and literals collapse to a placeholder
// so `a.x += b * 2` and `q.y += r * 9` hash identically.
function shapeOf(n, counts) {
  if (!n || typeof n.type !== 'string') return '';
  if (n.type === 'Identifier') return 'I';
  if (n.type === 'Literal') return 'L';
  let s = n.type;
  if (n.operator) s += n.operator;
  const kids = [];
  for (const k of Object.keys(n)) {
    if (k === 'start' || k === 'end' || k === 'type' || k === 'operator') continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const c of v) if (c && c.type) kids.push(shapeOf(c, counts)); }
    else if (v && typeof v === 'object' && v.type) kids.push(shapeOf(v, counts));
  }
  const out = s + '(' + kids.join(',') + ')';
  const size = 1 + kids.reduce((a, k) => a + (k.match(/\(/g) || []).length, 0);
  if (size >= MIN) {
    if (!counts.has(out)) counts.set(out, { n: 0, size, ex: null, node: n });
    const e = counts.get(out);
    e.n++;
    if (!e.ex) e.ex = n;
  }
  return out;
}

const raw = bundle(false);
let code = raw;
if (!SRC) {
  const r = await minify(raw, competitionTerser({ format: { beautify: false } }));
  if (r.error) throw r.error;
  code = r.code;
}
const ast = parse(code, { ecmaVersion: 2022, sourceType: 'script' });
const counts = new Map();
shapeOf(ast, counts);

const rows = [...counts.values()].filter((e) => e.n > 1);
// Value of fusing a group, in characters: every copy after the first, minus the
// call that would replace it.
for (const e of rows) e.chars = (e.ex.end - e.ex.start) * (e.n - 1);
rows.sort((a, b) => b.chars - a.chars);

console.log((SRC ? 'source' : 'minified') + ': ' + code.length + ' chars, ' +
  rows.length + ' repeated shapes of >= ' + MIN + ' nodes\n');
console.log('  copies  each   total   example');
for (const e of rows.slice(0, 14)) {
  const t = code.slice(e.ex.start, e.ex.end).replace(/\s+/g, ' ');
  console.log('  ' + String(e.n).padStart(6) + '  ' + String(e.ex.end - e.ex.start).padStart(4) +
    '  ' + String(e.chars).padStart(6) + '   ' + t.slice(0, 96));
}
const total = rows.reduce((a, e) => a + e.chars, 0);
console.log('\nevery redundant copy of every repeated shape: ' + total + ' chars of ' + code.length +
  '  (' + (total / code.length * 100).toFixed(1) + '%)');
console.log('at the measured rate for repeated text (~8.5 chars per archive byte)' +
  ' that whole ceiling is about ' + Math.round(total / 8.5) + ' B.');
