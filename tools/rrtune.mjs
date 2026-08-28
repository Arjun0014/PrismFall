// Roadroller axes the library's own optimizer never searches.
//
//   node tools/rrtune.mjs --models     model count, each given its own optimize
//   node tools/rrtune.mjs --quick      cheap axes: input type, abbreviations
//
// `numModels` is literally `sparseSelectors.length`, and Roadroller optimises
// WHICH selectors to use but never HOW MANY, so the count is ours to choose.
// It was last searched against a 45,000-character payload; the payload is now
// 77,000 characters (beautified), which is a different enough shape that the
// old optimum cannot be assumed.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { zipOf, html, competitionTerser, rrOptions } from './measure.mjs';
import { RR_MEM } from './build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

const RR_KEYS = ['sparseSelectors', 'precision', 'modelMaxCount', 'recipLearningRate',
  'contextBits', 'modelRecipBaseCount', 'learningRateNum', 'learningRateDenom'];

async function packAndWeigh(min, opts, tag) {
  const { Packer } = await import('roadroller');
  const pk = new Packer([{ data: min, type: opts.type || 'js', action: 'eval' }],
    Object.assign({ maxMemoryMB: RR_MEM, allowFreeVars: true }, opts.rr));
  if (opts.optimize) await pk.optimize(opts.optimize);
  const kept = {};
  for (const k of RR_KEYS) if (pk.options[k] !== undefined) kept[k] = pk.options[k];
  let best = null;
  for (const n of opts.abbrev || [pk.options.numAbbreviations]) {
    const q = new Packer([{ data: min, type: opts.type || 'js', action: 'eval' }],
      Object.assign({ maxMemoryMB: RR_MEM, allowFreeVars: true }, kept, { numAbbreviations: n }));
    const d = q.makeDecoder();
    const out = d.firstLine + '\n' + d.secondLine;
    if (/<\/script/i.test(out)) continue;
    const z = await zipOf(html(out), tag + '-' + n);
    if (!best || z.length < best.zip) best = { n, zip: z.length, packed: out.length };
  }
  return { ...best, model: kept };
}

if (!isMainThread) {
  const { min, id } = workerData;
  parentPort.on('message', async (msg) => {
    try { parentPort.postMessage({ seq: msg.seq, ...(await packAndWeigh(min, msg.opts, id)) }); }
    catch (e) { parentPort.postMessage({ seq: msg.seq, zip: Infinity, err: String(e && e.message || e) }); }
  });
  parentPort.postMessage({ ready: 1 });
}

if (isMainThread) {
  const { bundle } = await import('./src.mjs');
  const { minify } = await import('terser');
  const { defaultSparseSelectors } = await import('roadroller');
  const args = process.argv.slice(2);
  const JOBS = +((args.find((a) => a.startsWith('--jobs=')) || '').slice(7)) || 4;
  const r = await minify(bundle(false), competitionTerser());
  if (r.error) throw r.error;
  const min = r.code;

  const pool = [];
  for (let i = 0; i < JOBS; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { min, id: 'r' + i } });
    w.unref(); pool.push({ w, busy: 0 });
  }
  let seq = 0;
  const pending = new Map();
  for (const s of pool) s.w.on('message', (m) => {
    if (m.ready) return;
    const cb = pending.get(m.seq); pending.delete(m.seq); s.busy = 0; if (cb) cb(m);
  });
  const submit = (opts) => new Promise((res) => {
    const tick = () => {
      const s = pool.find((x) => !x.busy);
      if (!s) { setTimeout(tick, 20); return; }
      s.busy = 1; const id = seq++; pending.set(id, res);
      s.w.postMessage({ seq: id, opts });
    };
    tick();
  });

  const ABB = [6, 7, 8, 9, 10, 11, 12, 14, 16, 20];
  const cached = rrOptions();
  const cur = await submit({ rr: cached, abbrev: ABB });
  console.log('shipping model  zip ' + cur.zip + '  (abbrev ' + cur.n + ')\n');

  if (args.includes('--quick')) {
    // Roadroller's 'text' input model drops the JS tokeniser. The payload is
    // JS, so this should lose -- but it is one line to ask and the answer is
    // worth having on record rather than assumed.
    const t = await submit({ rr: cached, abbrev: ABB, type: 'text' });
    console.log("input type 'text'   zip " + t.zip + '   (' + (t.zip - cur.zip) + ')');
    process.exit(0);
  }

  const counts = [12, 14, 16, 18, 20, 22, 24, 26, 28, 32];
  console.log('model count, each with its own optimize(2) and abbreviation sweep');
  const rows = await Promise.all(counts.map((n) =>
    submit({ rr: { sparseSelectors: defaultSparseSelectors(n) }, optimize: 2, abbrev: ABB })
      .then((x) => ({ n, ...x }))));
  rows.sort((a, b) => a.zip - b.zip);
  for (const row of rows)
    console.log('  ' + String(row.n).padStart(3) + ' models   zip ' + String(row.zip).padStart(6) +
      '   (' + (row.zip - cur.zip > 0 ? '+' : '') + (row.zip - cur.zip) + ')   abbrev ' + row.n);
  const win = rows[0];
  if (win.zip < cur.zip) {
    writeFileSync(p('reports', 'rrtune.json'),
      JSON.stringify(Object.assign({}, win.model, { numAbbreviations: win.n }), null, 1));
    console.log('\nbetter model written to reports/rrtune.json (' + (win.zip - cur.zip) + ' B)');
  } else console.log('\nshipping model still wins');
  for (const s of pool) s.w.terminate();
  process.exit(0);
}
