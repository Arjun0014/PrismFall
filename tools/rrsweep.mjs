// Sweep Roadroller knobs against the real archive size.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { Packer } from 'roadroller';
import { makeZip } from './zip.mjs';
import { bundle } from './src.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = (s) => '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' + s + '</script>';
const cached = JSON.parse(readFileSync(join(ROOT, 'build', 'roadroller.json'), 'utf8'));

const min = (await minify('(()=>{\n' + bundle(false) + '\n})()', {
  ecma: 2020,
  compress: {
    passes: 4, unsafe: true, unsafe_arrows: false, unsafe_math: true, unsafe_methods: true,
    unsafe_comps: true, unsafe_undefined: true, booleans_as_integers: true,
    pure_getters: true, hoist_funs: true, drop_console: true,
  },
  mangle: { toplevel: true },
  format: { comments: false, wrap_func_args: false },
})).code;
console.log('minified ' + min.length + '\n');

async function tryOpts(label, extra) {
  const opts = Object.assign({}, cached, { maxMemoryMB: 700, numAbbreviations: 32 }, extra);
  try {
    const packer = new Packer([{ data: min, type: 'js', action: 'eval' }], opts);
    const { firstLine, secondLine } = packer.makeDecoder();
    // Only the packed payload may not contain a closing script tag; the page
    // itself always ends with one.
    const packed = firstLine + '\n' + secondLine;
    if (/<\/script/i.test(packed)) return console.log(label.padEnd(26) + 'unsafe output');
    const page = html(packed);
    const zip = await makeZip([{ name: 'index.html', data: Buffer.from(page, 'utf8') }], { iterations: [200] });
    console.log(label.padEnd(26) + 'html ' + String(Buffer.byteLength(page)).padStart(6) + '  zip ' + String(zip.length).padStart(6));
  } catch (e) { console.log(label.padEnd(26) + 'failed: ' + e.message); }
}

for (const n of [2, 4, 5, 6, 7, 8, 9, 10, 12, 14]) await tryOpts('abbrev ' + n, { numAbbreviations: n });
for (const n of [6, 7, 8, 9]) await tryOpts('abbrev ' + n + ' + prec16', { numAbbreviations: n, precision: 16 });
