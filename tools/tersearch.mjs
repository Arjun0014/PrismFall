// Try Terser variants and measure the final ZIP for each. Minified length is a
// poor proxy once Roadroller is involved, so we measure the archive.
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

const base = {
  ecma: 2020, passes: 4, unsafe: true, unsafe_arrows: true, unsafe_math: true,
  unsafe_methods: true, unsafe_comps: true, unsafe_undefined: true,
  booleans_as_integers: true, pure_getters: true, hoist_funs: true, drop_console: true,
};
const variants = {
  current: {},
  'no-bool-int': { booleans_as_integers: false },
  'no-hoist-funs': { hoist_funs: false },
  'passes8': { passes: 8 },
  'hoist_props': { hoist_props: true },
  'inline3+seq': { inline: 3, sequences: 400 },
  'no-unsafe-arrows': { unsafe_arrows: false },
  'reduce_funcs-off': { reduce_funcs: false },
  'keep_fargs-off': { keep_fargs: false },
  'arrows-off+all': { unsafe_arrows: false, hoist_props: true, keep_fargs: false, passes: 8 },
};

for (const [name, over] of Object.entries(variants)) {
  const compress = { ...base, ...over };
  delete compress.ecma;
  const r = await minify('(()=>{\n' + raw + '\n})()', {
    ecma: 2020, compress, mangle: { toplevel: true }, format: { comments: false, wrap_func_args: false },
  });
  if (r.error) { console.log(name.padEnd(20) + ' ERROR'); continue; }
  const p = new Packer([{ data: r.code, type: 'js', action: 'eval' }], { ...rr, maxMemoryMB: 700, numAbbreviations: 32 });
  const d = p.makeDecoder();
  const out = d.firstLine + '\n' + d.secondLine;
  const z = await makeZip([{ name: 'index.html', data: Buffer.from(html(out), 'utf8') }], { iterations: [200] });
  console.log(name.padEnd(20) + ' min ' + String(r.code.length).padStart(6) + '  zip ' + String(z.length).padStart(6));
}
