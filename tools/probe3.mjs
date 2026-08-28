// Third round: the two levers I had not tested, both of which change how the
// text COMPRESSES rather than how long it is.
//
//   1. Property-name aliasing. Terser mangles identifiers but never property
//      accesses, so every `.exponentialRampToValueAtTime`, `.createLinearGradient`
//      and `.addEventListener` survives at full length. Rewriting them as
//      `[a]` against a table of string constants is lossless and automatic.
//
//   2. Source ORDER. A context-mixing coder predicts from recent history, so
//      putting similar code next to itself is worth real bytes for free. This
//      costs nothing but a different concatenation order.
//
// Probe 1 rewrites minified output with a regex and is a CEILING measurement --
// it is not automatically safe to ship. Probe 2 is directly shippable.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { Packer, defaultSparseSelectors } from 'roadroller';
import { makeZip } from './zip.mjs';
import { readSources } from './src.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rr = JSON.parse(readFileSync(join(ROOT, 'build', 'roadroller.json'), 'utf8'));
const html = (s) => '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' + s + '</script>';

const TERSER = {
  ecma: 2020,
  compress: {
    passes: 4, unsafe: true, unsafe_arrows: true, unsafe_math: true, unsafe_methods: true,
    unsafe_comps: true, unsafe_undefined: true, booleans_as_integers: true,
    pure_getters: true, hoist_funs: true, drop_console: true,
  },
  mangle: { toplevel: true },
  format: { comments: false, wrap_func_args: false },
};

async function terse(src) {
  const r = await minify('(()=>{\n' + src + '\n})()', TERSER);
  if (r.error) throw r.error;
  return r.code;
}
async function zipOf(js) {
  const o = Object.assign({ maxMemoryMB: 700 }, rr, { allowFreeVars: true });
  if (!o.sparseSelectors || o.sparseSelectors.length !== 20) o.sparseSelectors = defaultSparseSelectors(20);
  const d = new Packer([{ data: js, type: 'js', action: 'eval' }], o).makeDecoder();
  const out = d.firstLine + '\n' + d.secondLine;
  if (/<\/script/i.test(out)) return null;
  return (await makeZip([{ name: 'index.html', data: Buffer.from(html(out), 'utf8') }], { iterations: [200] })).length;
}

const files = readSources(false);
const byName = Object.fromEntries(files.map((f) => [f.name, f.code]));
const ORDER = files.map((f) => f.name);
const build = (order) => 'const DEBUG=0,WD=0;\n' + order.map((n) => byName[n]).join('\n') + '\n';

const baseMin = await terse(build(ORDER));
const base = await zipOf(baseMin);
console.log('baseline: min ' + baseMin.length + '  zip ' + base + '\n');

// --- 1. property-name aliasing ----------------------------------------------
console.log('=== property aliasing (ceiling) ===');
// Count `.name` accesses that are not part of a number and not already short.
const hits = {};
for (const m of baseMin.matchAll(/\.([A-Za-z_$][\w$]*)/g)) hits[m[1]] = (hits[m[1]] || 0) + 1;
const cands = Object.entries(hits)
  .map(([n, c]) => [n, c, (n.length - 3) * c - (n.length + 5)])   // .name -> [x] plus one table entry
  .filter((r) => r[2] > 0)
  .sort((a, b) => b[2] - a[2]);
console.log('  aliasable properties: ' + cands.length +
  ', theoretical char saving ' + cands.reduce((a, r) => a + r[2], 0));
console.log('  top: ' + cands.slice(0, 8).map((r) => r[0] + '(' + r[1] + ')').join(' '));

for (const topN of [10, 25, 60, cands.length]) {
  const use = cands.slice(0, topN);
  if (!use.length) continue;
  const names = use.map((r) => r[0]);
  const tbl = 'const $p=' + JSON.stringify(names.join(' ')) + '.split(" ");\n';
  let out = baseMin;
  names.forEach((n, i) => {
    out = out.split('.' + n).join('[$p[' + i + ']]');
  });
  // Guard: the naive split would also hit `.name` inside string literals. This
  // is a ceiling probe, so accept that and only report the size.
  const js = tbl + out;
  const z = await zipOf(js);
  console.log('  top ' + String(topN).padStart(3) + '  chars ' + String(js.length - baseMin.length).padStart(6) +
    '  zip ' + z + '  (' + (z - base > 0 ? '+' : '') + (z - base) + ')');
}

// --- 2. source order --------------------------------------------------------
console.log('\n=== source order (free, shippable) ===');
const ORDERS = {
  current: ORDER,
  // Put the two Canvas-heavy files adjacent, and the two data-heavy ones.
  'render+hud adjacent': ['config.js', 'util.js', 'state.js', 'world.js',
    'physics.js', 'colors.js', 'render.js', 'hud.js', 'audio.js',
    'input.js', 'game.js'],
  'sim together, draw together': ['config.js', 'util.js', 'state.js',
    'physics.js', 'colors.js', 'world.js', 'render.js', 'hud.js',
    'audio.js', 'input.js', 'game.js'],
  'audio first': ['config.js', 'util.js', 'state.js', 'audio.js',
    'world.js', 'physics.js', 'colors.js', 'render.js', 'hud.js',
    'input.js', 'game.js'],
  'data last': ['util.js', 'state.js', 'world.js', 'physics.js',
    'colors.js', 'audio.js', 'render.js', 'hud.js', 'input.js',
    'game.js', 'config.js'],
  reversed: [...ORDER].reverse(),
};
for (const [name, ord] of Object.entries(ORDERS)) {
  if (ord.length !== ORDER.length) { console.log('  ' + name + ' SKIP (file list mismatch)'); continue; }
  let z;
  try { z = await zipOf(await terse(build(ord))); } catch (e) { console.log('  ' + name.padEnd(30) + 'ERROR'); continue; }
  console.log('  ' + name.padEnd(30) + z + '  (' + (z - base > 0 ? '+' : '') + (z - base) + ')');
}
