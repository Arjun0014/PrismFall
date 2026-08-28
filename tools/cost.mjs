// Where the archive bytes actually are.
//
//   node tools/cost.mjs              every top-level declaration, by real cost
//   node tools/cost.mjs --files      per source file
//   node tools/cost.mjs --top=30
//
// Leave-one-out against the REAL pipeline: delete one top-level declaration,
// run the complete Terser -> Roadroller -> Zopfli + ECT build, and report the
// difference. Earlier passes at this used gzip as a fast proxy; gzip ranks
// duplication, and duplication is precisely what this archive does not pay for,
// so the proxy answers a different question than the one being asked.
//
// The resulting program does not run -- that is fine and expected, this is
// attribution, not a candidate build. Nothing here is ever shipped.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { score, competitionTerser, rrOptions } from './measure.mjs';
import { topLevel } from './ast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

if (!isMainThread) {
  const { rr, id } = workerData;
  parentPort.on('message', async (msg) => {
    try {
      // compress.toplevel is OFF here and only here. With it on, deleting the
      // one function that drives the game makes every other function
      // unreferenced, Terser drops the lot, and the entry point appears to
      // "cost" 12,744 B while everything it calls appears to cost nothing.
      // Attribution needs each removal to remove exactly itself.
      const s = await score(msg.src, competitionTerser({ compress: { toplevel: false } }), rr, id + '-' + msg.seq);
      parentPort.postMessage({ seq: msg.seq, ...s });
    } catch (e) {
      parentPort.postMessage({ seq: msg.seq, zip: Infinity, err: String(e && e.message || e) });
    }
  });
  parentPort.postMessage({ ready: 1 });
}

if (isMainThread) {
  const { readSources, bundle } = await import('./src.mjs');
  const args = process.argv.slice(2);
  const FILES = args.includes('--files');
  const TOP = +((args.find((a) => a.startsWith('--top=')) || '').slice(6)) || 999;
  const JOBS = +((args.find((a) => a.startsWith('--jobs=')) || '').slice(7)) || 5;
  const rr = rrOptions();
  const files = readSources(false);
  const full = bundle(false);

  const pool = [];
  for (let i = 0; i < JOBS; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { rr, id: 'c' + i } });
    w.unref(); pool.push({ w, busy: 0 });
  }
  let seq = 0;
  const pending = new Map();
  for (const s of pool) s.w.on('message', (m) => {
    if (m.ready) return;
    const cb = pending.get(m.seq); pending.delete(m.seq); s.busy = 0; if (cb) cb(m);
  });
  const submit = (src) => new Promise((res) => {
    const tick = () => {
      const s = pool.find((x) => !x.busy);
      if (!s) { setTimeout(tick, 15); return; }
      s.busy = 1; const id = seq++; pending.set(id, res);
      s.w.postMessage({ seq: id, src });
    };
    tick();
  });

  // The bundle is rebuilt from parts so a candidate is always the real thing
  // the build would compile, header line included.
  const head = 'const DEBUG=0,WD=0;\n';
  const asBundle = (parts) => head + parts.map((f) => '// ==== ' + f.name + ' ====\n' + f.code).join('\n') + '\n';

  const base = await submit(full);
  console.log('full archive ' + base.zip + ' B\n');

  const cands = [];
  if (FILES) {
    for (let i = 0; i < files.length; i++)
      cands.push({ label: files[i].name, src: asBundle(files.filter((_, j) => j !== i)) });
  } else {
    for (const f of files) {
      let items;
      try { items = topLevel(f.code).items; }
      catch (e) { console.log('  ! cannot parse ' + f.name + ': ' + e.message); continue; }
      items.forEach((it, i) => {
        if (!it.name) return;                       // expression statements: not removable alone
        const cut = f.code.slice(0, it.start) + f.code.slice(it.end);
        cands.push({
          label: (it.kind === 'FunctionDeclaration' ? '' : 'const ') + it.name,
          file: f.name,
          chars: it.end - it.start,
          src: asBundle(files.map((g) => (g === f ? { name: g.name, code: cut } : g))),
        });
      });
    }
  }

  console.log('measuring ' + cands.length + ' removals against the real archive');
  const rows = await Promise.all(cands.map((c) => submit(c.src).then((r) => ({ ...c, src: undefined, ...r }))));
  for (const r of rows) r.cost = isFinite(r.zip) ? base.zip - r.zip : 0;
  rows.sort((a, b) => b.cost - a.cost);

  let sum = 0;
  console.log('\n  cost  chars  c/B   where');
  for (const r of rows.slice(0, TOP)) {
    sum += r.cost;
    console.log('  ' + String(r.cost).padStart(4) + '  ' + String(r.chars || '').padStart(5) +
      '  ' + (r.chars ? (r.chars / (r.cost || 1)).toFixed(1) : '').padStart(4) +
      '   ' + (r.label || '') + (r.file ? '   [' + r.file.replace(/^\d+_|\.js$/g, '') + ']' : ''));
  }
  console.log('\n  listed ' + Math.min(TOP, rows.length) + ' of ' + rows.length +
    ', their total cost ' + rows.reduce((a, r) => a + r.cost, 0) + ' B of ' + base.zip);
  writeFileSync(p('reports', FILES ? 'cost-files.json' : 'cost.json'),
    JSON.stringify({ base: base.zip, rows }, null, 1));
  for (const s of pool) s.w.terminate();
  process.exit(0);
}
