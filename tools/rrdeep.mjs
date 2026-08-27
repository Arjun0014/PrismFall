// Compare Roadroller optimizer levels against the real archive.
import { minify } from 'terser';
import { Packer } from 'roadroller';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './zip.mjs';
import { bundle } from './src.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = (s) => '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' + s + '</script>';
const min = (await minify('(()=>{\n' + bundle(false) + '\n})()', {
  ecma: 2020,
  compress: { passes: 4, unsafe: true, unsafe_arrows: false, unsafe_math: true, unsafe_methods: true, unsafe_comps: true, unsafe_undefined: true, booleans_as_integers: true, pure_getters: true, hoist_funs: true, drop_console: true },
  mangle: { toplevel: true }, format: { comments: false, wrap_func_args: false },
})).code;
console.log('minified ' + min.length);

const KEYS = ['sparseSelectors', 'precision', 'modelMaxCount', 'recipLearningRate', 'contextBits', 'modelRecipBaseCount', 'learningRateNum', 'learningRateDenom', 'numAbbreviations'];

for (const level of [1, 2]) {
  const t0 = Date.now();
  const pk = new Packer([{ data: min, type: 'js', action: 'eval' }], { maxMemoryMB: 900 });
  const res = await pk.optimize(level);
  const d = pk.makeDecoder();
  const out = d.firstLine + '\n' + d.secondLine;
  const z = await makeZip([{ name: 'index.html', data: Buffer.from(html(out), 'utf8') }], { iterations: [200] });
  const keep = {};
  for (const k of KEYS) if (pk.options[k] !== undefined) keep[k] = pk.options[k];
  console.log('optimize(' + level + ')  zip ' + z.length + '   est ' + ((res && res.best && res.best.size) | 0) +
    '   ' + ((Date.now() - t0) / 1000 | 0) + 's   abbrev ' + pk.options.numAbbreviations);
  writeFileSync(join(ROOT, 'build', 'rr-level' + level + '.json'), JSON.stringify(keep, null, 1));
}
