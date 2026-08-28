// Sweep the NUMBER OF CONTEXT MODELS Roadroller uses.
//
// Roadroller's `sparseSelectors` array doubles as the model count -- numModels
// is literally its length (index.mjs: `const numModels = sparseSelectors.length`)
// -- and the library defaults to 12 while accepting up to 64. Its own optimizer
// searches *which* selectors to use but not *how many*, so this axis has never
// been touched here.
//
// It is not free: contextBits is derived by dividing maxMemoryMB across the
// models, so more models means a smaller table each, and decode time and memory
// both grow. This measures the real archive size at each count so the tradeoff
// is a number rather than a guess.
//
//   node tools/rrmodels.mjs [counts...]        default: 12 16 20 24 32
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer, defaultSparseSelectors } from 'roadroller';
import { makeZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);
const LIMIT = 13312;

const counts = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const COUNTS = counts.length ? counts : [12, 16, 20, 24, 32];
const OPT = process.argv.includes('--optimize');
const MEMS = (process.argv.includes('--mem') ? [150, 300, 700, 1000] : [700]);

const min = readFileSync(p('build', 'bundle.min.js'), 'utf8');
const cached = existsSync(p('build', 'roadroller.json'))
  ? JSON.parse(readFileSync(p('build', 'roadroller.json'), 'utf8')) : {};

const html = (s) =>
  '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' +
  s + '</script>';

async function zipOf(text, iters) {
  return makeZip([{ name: 'index.html', data: Buffer.from(text, 'utf8') }], { iterations: iters });
}

console.log('baseline cached options:', JSON.stringify(cached));
console.log('minified input: ' + min.length + ' B\n');
console.log('models  mem     contextBits  packed     zip      vs limit');

const rows = [];
for (const mem of MEMS) {
  for (const n of COUNTS) {
    const opts = Object.assign({}, cached, {
      maxMemoryMB: mem,
      sparseSelectors: defaultSparseSelectors(n),
    });
    // contextBits is derived from memory unless pinned; let it float so each
    // model count gets the table size that memory budget actually allows.
    delete opts.contextBits;
    let packer;
    try {
      packer = new Packer([{ data: min, type: 'js', action: 'eval' }], opts);
      if (OPT) await packer.optimize(1);
    } catch (e) {
      console.log(String(n).padStart(6) + '  ' + String(mem).padStart(5) + '   ! ' + e.message);
      continue;
    }
    const d = packer.makeDecoder();
    const out = d.firstLine + '\n' + d.secondLine;
    if (/<\/script/i.test(out)) { console.log(String(n).padStart(6) + '  skipped: </script in output'); continue; }
    const z = await zipOf(html(out), [15]);
    rows.push({ n, mem, bits: packer.options.contextBits, packed: out.length, zip: z.length });
    console.log(
      String(n).padStart(6) + '  ' + String(mem).padStart(5) + '   ' +
      String(packer.options.contextBits).padStart(11) + '  ' +
      String(out.length).padStart(7) + '  ' + String(z.length).padStart(7) + '  ' +
      String(z.length - LIMIT).padStart(7));
  }
}

rows.sort((a, b) => a.zip - b.zip);
if (rows.length) {
  const b = rows[0];
  console.log('\nbest: ' + b.n + ' models, ' + b.mem + ' MB, contextBits ' + b.bits +
    ' -> ' + b.zip + ' B (' + (rows[rows.length - 1].zip - b.zip) + ' B better than the worst tried)');
  writeFileSync(p('build', 'rrmodels.json'), JSON.stringify(rows, null, 1));
}
