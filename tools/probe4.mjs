// Fourth round: what the game's TEXT costs, and where the minified characters
// actually live per source file.
//
// Text matters because it is the one part of the archive that is pure unique
// content but is NOT a feature: shortening a boon's description removes no
// mechanic. Everything else measured so far has been either free to compress
// or impossible to shrink without deleting behaviour.
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
  mangle: { toplevel: true }, format: { comments: false, wrap_func_args: false },
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
  return (await makeZip([{ name: 'index.html', data: Buffer.from(html(out), 'utf8') }], { iterations: [200] })).length;
}

const files = readSources(false);
const full = 'const DEBUG=0,WD=0;\n' + files.map((f) => f.code).join('\n') + '\n';
const baseMin = await terse(full);
const base = await zipOf(baseMin);
console.log('baseline: min ' + baseMin.length + '  zip ' + base + '\n');

// NOTE: a per-file size breakdown was tried here and removed. Minifying one
// file alone is meaningless -- nothing in it is referenced, so Terser dead-code
// eliminates almost the whole file and reports near zero. Per-function
// leave-one-out on the real bundle (tools/subcost.mjs) is the valid measurement.

// --- what does the game's TEXT cost? ----------------------------------------
// Replace the CONTENT of every string literal with a single character. This is
// a ceiling: it removes all copy, all labels and all style strings at once.
const BS = String.fromCharCode(92);
function squashStrings(src, keepStyle) {
  let out = '', i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1, buf = '';
      while (j < src.length) {
        if (src[j] === BS) { buf += src[j] + (src[j + 1] || ''); j += 2; continue; }
        if (src[j] === ch) break;
        buf += src[j]; j++;
      }
      const style = /hsl|px |monospace|%|margin|position|:/.test(buf);
      out += ch + (keepStyle && style ? buf : (buf.length ? 'x' : '')) + ch;
      i = j + 1; continue;
    }
    // skip comments so their apostrophes do not open a fake string
    if (ch === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); out += src.slice(i, j < 0 ? src.length : j); i = j < 0 ? src.length : j; continue; }
    if (ch === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i); out += src.slice(i, j < 0 ? src.length : j + 2); i = j < 0 ? src.length : j + 2; continue; }
    out += ch; i++;
  }
  return out;
}

console.log('\n=== what the game text costs (ceiling) ===');
for (const [name, keepStyle] of [['all strings squashed', false], ['copy only (styles kept)', true]]) {
  const src = squashStrings(full, keepStyle);
  let m;
  try { m = await terse(src); } catch (e) { console.log('  ' + name.padEnd(26) + 'PARSE ERROR'); continue; }
  const z = await zipOf(m);
  console.log('  ' + name.padEnd(26) + 'chars -' + String(baseMin.length - m.length).padStart(5) +
    '   zip -' + String(base - z).padStart(4) +
    '   ' + ((baseMin.length - m.length) / Math.max(1, base - z)).toFixed(1) + ' chars/byte');
}
