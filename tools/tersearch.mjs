// Search Terser/wrapper variants and measure the REAL archive for each.
// Minified length is a poor proxy once a context-mixing packer is involved --
// a change can add characters and still shrink the archive -- so every row here
// is a full Terser -> Roadroller -> Zopfli pass.
//
//   node tools/tersearch.mjs            all variants
//   node tools/tersearch.mjs name,name  only these
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { Packer } from 'roadroller';
import { makeZip } from './zip.mjs';
import { bundle } from './src.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = (s) => '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' + s + '</script>';
const rr = JSON.parse(readFileSync(join(ROOT, 'build', 'roadroller.json'), 'utf8'));
const raw = bundle(false);
const only = (process.argv[2] || '').split(',').filter(Boolean);

const baseCompress = {
  passes: 4, unsafe: true, unsafe_arrows: true, unsafe_math: true,
  unsafe_methods: true, unsafe_comps: true, unsafe_undefined: true,
  booleans_as_integers: true, pure_getters: true, hoist_funs: true, drop_console: true,
};

// Each variant may override compress options, mangle options, and the wrapper.
// `wrap: 0` drops the IIFE entirely: the packer evals the code, so leaking the
// game's declarations into that eval scope is harmless, and it lets Terser
// treat every top-level name as manglable and droppable.
const variants = {
  current: {},
  passes8: { c: { passes: 8 } },
  passes12: { c: { passes: 12 } },
  hoist_props: { c: { hoist_props: true } },
  inline3: { c: { inline: 3 } },
  sequences400: { c: { sequences: 400 } },
  'arrows-off': { c: { unsafe_arrows: false } },
  'keep_fargs-off': { c: { keep_fargs: false } },
  'reduce_funcs-off': { c: { reduce_funcs: false } },
  // reduce_funcs:false won by making the output LONGER but more repetitive.
  // These are the rest of the options in that family -- every one of them
  // trades inlining (unique text) for indirection (repeated text), which is
  // the trade this packer rewards.
  'reduce_vars-off': { c: { reduce_vars: false } },
  'collapse_vars-off': { c: { collapse_vars: false } },
  'inline-off': { c: { inline: false } },
  'join_vars-off': { c: { join_vars: false } },
  'sequences-off': { c: { sequences: false } },
  'conditionals-off': { c: { conditionals: false } },
  'evaluate-off': { c: { evaluate: false } },
  'unsafe-off': { c: { unsafe: false, unsafe_arrows: false, unsafe_math: false, unsafe_methods: false, unsafe_comps: false, unsafe_undefined: false } },
  'no-inline-family': { c: { reduce_funcs: false, reduce_vars: false, inline: false, collapse_vars: false } },
  'rf+seq-off': { c: { reduce_funcs: false, sequences: false } },
  'rf+rv-off': { c: { reduce_funcs: false, reduce_vars: false } },
  'rf+inline-off': { c: { reduce_funcs: false, inline: false } },
  // Round two: build on the rf+seq winner (B). Anything that trades unique
  // text for repeated text is a candidate.
  'B': { c: { reduce_funcs: false, sequences: false } },
  'B+arrows-off': { c: { reduce_funcs: false, sequences: false, unsafe_arrows: false } },
  'B+unsafe-off': { c: { reduce_funcs: false, sequences: false, unsafe: false, unsafe_arrows: false, unsafe_math: false, unsafe_methods: false, unsafe_comps: false, unsafe_undefined: false } },
  'B+collapse-off': { c: { reduce_funcs: false, sequences: false, collapse_vars: false } },
  'B+inline-off': { c: { reduce_funcs: false, sequences: false, inline: false } },
  'B+no-bool-int': { c: { reduce_funcs: false, sequences: false, booleans_as_integers: false } },
  'B+keep_fargs': { c: { reduce_funcs: false, sequences: false, keep_fargs: true } },
  'B+hoist_props': { c: { reduce_funcs: false, sequences: false, hoist_props: true } },
  'B+if_return-off': { c: { reduce_funcs: false, sequences: false, if_return: false } },
  'B+passes8': { c: { reduce_funcs: false, sequences: false, passes: 8 } },
  'B+unwrapped': { wrap: 0, c: { reduce_funcs: false, sequences: false, toplevel: true } },
  // Round three: stack the round-two winners. U = B with the unsafe family off.
  'U': { c: { reduce_funcs: false, sequences: false, unsafe: false, unsafe_arrows: false, unsafe_math: false, unsafe_methods: false, unsafe_comps: false, unsafe_undefined: false } },
  'U+unwrapped': { wrap: 0, c: { toplevel: true, reduce_funcs: false, sequences: false, unsafe: false, unsafe_arrows: false, unsafe_math: false, unsafe_methods: false, unsafe_comps: false, unsafe_undefined: false } },
  'U+inline-off': { c: { reduce_funcs: false, sequences: false, inline: false, unsafe: false, unsafe_arrows: false, unsafe_math: false, unsafe_methods: false, unsafe_comps: false, unsafe_undefined: false } },
  'U+unwrapped+inline-off': { wrap: 0, c: { toplevel: true, reduce_funcs: false, sequences: false, inline: false, unsafe: false, unsafe_arrows: false, unsafe_math: false, unsafe_methods: false, unsafe_comps: false, unsafe_undefined: false } },
  'U+no-mangle-toplevel': { m: { toplevel: false }, c: { reduce_funcs: false, sequences: false, unsafe: false, unsafe_arrows: false, unsafe_math: false, unsafe_methods: false, unsafe_comps: false, unsafe_undefined: false } },
  'no-bool-int': { c: { booleans_as_integers: false } },
  'compress-toplevel': { c: { toplevel: true } },
  ecma2022: { ecma: 2022 },
  unwrapped: { wrap: 0, c: { toplevel: true } },
  'unwrapped+passes8': { wrap: 0, c: { toplevel: true, passes: 8 } },
  // Property mangling, restricted to names this codebase invented. The regex
  // is an allow-list so no DOM or Web Audio property can ever be renamed.
  'mangle-props': {
    m: { properties: { regex: /^(paid|cap|kt|kd|lt|os|op|ox|oy)$/ } },
  },
};

let best = null;
for (const [name, v] of Object.entries(variants)) {
  if (only.length && !only.includes(name)) continue;
  const compress = Object.assign({}, baseCompress, v.c || {});
  const mangle = Object.assign({ toplevel: true }, v.m || {});
  const src = v.wrap === 0 ? raw : '(()=>{\n' + raw + '\n})()';
  let r;
  try {
    r = await minify(src, {
      ecma: v.ecma || 2020, compress, mangle,
      format: { comments: false, wrap_func_args: false },
    });
  } catch (e) { console.log(name.padEnd(20) + ' ERROR ' + e.message); continue; }
  if (r.error) { console.log(name.padEnd(20) + ' ERROR'); continue; }
  const pk = new Packer([{ data: r.code, type: 'js', action: 'eval' }],
    Object.assign({ maxMemoryMB: 700 }, rr));
  const d = pk.makeDecoder();
  const out = d.firstLine + '\n' + d.secondLine;
  if (/<\/script/i.test(out)) { console.log(name.padEnd(20) + ' skipped (</script)'); continue; }
  const z = await makeZip([{ name: 'index.html', data: Buffer.from(html(out), 'utf8') }], { iterations: [200] });
  const row = { name, min: r.code.length, zip: z.length };
  if (!best || z.length < best.zip) best = row;
  console.log(name.padEnd(20) + ' min ' + String(r.code.length).padStart(6) +
    '  zip ' + String(z.length).padStart(6));
}
if (best) console.log('\nbest: ' + best.name + ' -> ' + best.zip + ' B');
