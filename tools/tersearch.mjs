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
