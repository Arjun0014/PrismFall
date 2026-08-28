// Retire a distinct numeric value by expressing it in values the program
// already contains.
//
//   node tools/numpool.mjs --survey
//   node tools/numpool.mjs
//
// The census (COMPRESSION_EXPERIMENTS.md #15) puts the cost of this program's
// numbers at 2,700 B over 311 distinct values -- about **8.7 bytes per distinct
// value** -- and shows that what is paid for is which value, not how many digits
// it has. The first attempt at exploiting that (#14, numsyn) rewrote a literal
// as `n/d`, and it failed for a reason that is obvious in hindsight: `122/2`
// retires the value 61 and introduces the value 122. The distinct-value count
// does not go down, so the expensive thing was never removed and all that
// happened was five more characters.
//
// This only admits expressions whose every operand is a value the program
// already uses somewhere else. Then the count really does drop by one, and the
// question is whether 8.7 bytes of distinct-value cost beats the two or three
// characters the operator costs.
//
// No tuning value changes: admission is Object.is(eval(expr), value), and every
// rewrite is an acorn-driven span replacement.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { parse } from 'acorn';
import { weigh, competitionTerser, rrOptions } from './measure.mjs';
import { numericLiterals, spliceAll } from './numsyn-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

if (!isMainThread) {
  const { min, rr, id } = workerData;
  parentPort.on('message', async (msg) => {
    try {
      const src = msg.edits.length ? spliceAll(min, msg.edits) : min;
      parse(src, { ecmaVersion: 2022, sourceType: 'script' });
      parentPort.postMessage({ seq: msg.seq, ...(await weigh(src, rr, id + '-' + msg.seq)) });
    } catch (e) {
      parentPort.postMessage({ seq: msg.seq, zip: Infinity, err: String(e && e.message || e) });
    }
  });
  parentPort.postMessage({ ready: 1 });
}

if (isMainThread) {
  const { bundle } = await import('./src.mjs');
  const { minify } = await import('terser');
  const args = process.argv.slice(2);
  const SURVEY = args.includes('--survey');
  const JOBS = +((args.find((a) => a.startsWith('--jobs=')) || '').slice(7)) || 5;
  const rr = rrOptions();
  const r = await minify(bundle(false), competitionTerser());
  if (r.error) throw r.error;
  const min = r.code;

  const lits = numericLiterals(min);
  const byVal = new Map();
  for (const l of lits) {
    const k = String(l.value);
    if (!byVal.has(k)) byVal.set(k, { value: l.value, raw: l.raw, hits: [] });
    byVal.get(k).hits.push(l);
  }
  const groups = [...byVal.values()];
  const pool = groups.map((g) => g.value);
  console.log(lits.length + ' literals, ' + groups.length + ' distinct values');

  // Retiring a value only pays if the value is rare. A value used 40 times is
  // cheap per use and the operator cost would be paid 40 times over.
  const targets = groups.filter((g) => g.hits.length <= 3);

  // Every exact two-operand combination of pool values, plus a scale by an
  // existing value. Operands must both already exist, or the count does not drop.
  function express(v, hits) {
    const out = [];
    const others = pool.filter((x) => x !== v);
    const uniq = [...new Set(others)];
    const rank = new Map();
    for (const g of groups) if (g.value !== v) rank.set(g.value, g.hits.length);
    const lit = (x) => (Number.isInteger(x) || Math.abs(x) >= 1 ? String(x) : String(x).replace(/^0\./, '.'));
    const push = (a, op, b) => {
      const e = lit(a) + op + lit(b);
      let got; try { got = Function('return(' + e + ')')(); } catch { return; }
      if (Object.is(got, v)) out.push({ e, w: (rank.get(a) || 0) + (rank.get(b) || 0), len: e.length });
    };
    for (const a of uniq) {
      for (const b of uniq) {
        if (out.length > 400) break;
        push(a, '*', b); push(a, '/', b); push(a, '+', b); push(a, '-', b);
      }
    }
    // Shortest first, and among equals prefer the operands the program already
    // leans on hardest -- those are the ones the model predicts best.
    out.sort((x, y) => x.len - y.len || y.w - x.w);
    return out.map((o) => o.e);
  }

  const live = [];
  for (const g of targets) {
    const e = express(g.value, g.hits)[0];
    if (e) live.push({ g, expr: e });
  }
  console.log(live.length + ' rare values can be retired using only values the program already has');

  if (SURVEY) {
    console.log('\nexamples:');
    for (const { g, expr } of live.slice(0, 24))
      console.log('  ' + g.raw.padEnd(10) + ' x' + String(g.hits.length).padEnd(3) + ' -> ' + expr);
    process.exit(0);
  }

  const workers = [];
  for (let i = 0; i < JOBS; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { min, rr, id: 'q' + i } });
    w.unref(); workers.push({ w, busy: 0 });
  }
  let seq = 0;
  const pending = new Map();
  for (const s of workers) s.w.on('message', (m) => {
    if (m.ready) return;
    const cb = pending.get(m.seq); pending.delete(m.seq); s.busy = 0; if (cb) cb(m);
  });
  const submit = (edits) => new Promise((res) => {
    const tick = () => {
      const s = workers.find((x) => !x.busy);
      if (!s) { setTimeout(tick, 15); return; }
      s.busy = 1; const id = seq++; pending.set(id, res);
      s.w.postMessage({ seq: id, edits });
    };
    tick();
  });

  const base = await submit([]);
  console.log('baseline ' + base.zip + ' B\n');

  const probes = await Promise.all(live.map(({ g, expr }) => {
    const edits = g.hits.map((h) => ({ start: h.start, end: h.end, text: '(' + expr + ')' }));
    return submit(edits).then((s) => ({ g, expr, edits, delta: s.zip - base.zip }));
  }));
  probes.sort((a, b) => a.delta - b.delta);
  const wins = probes.filter((x) => x.delta < 0);
  console.log('  win  value      x   expression');
  for (const x of probes.slice(0, 20))
    console.log('  ' + String(x.delta).padStart(4) + '  ' + x.g.raw.padEnd(10) +
      String(x.g.hits.length).padStart(2) + '   ' + x.expr);
  console.log('\n' + wins.length + ' of ' + probes.length + ' retire profitably on their own');

  if (wins.length) {
    // Individual deltas do not add up, so a descending greedy walk is only one
    // strategy and it is the one most likely to stall: each rewrite shifts
    // every byte downstream of it, so what a candidate is worth depends on
    // which others are already in. Three strategies, best wins.
    const all = wins.flatMap((x) => x.edits);
    const together = await submit(all);
    console.log('\n  all ' + wins.length + ' together        ' + together.zip + '  (' + (together.zip - base.zip) + ')');

    let cur = all, curZip = together.zip;
    for (const x of wins) {
      const without = cur.filter((e) => !x.edits.includes(e));
      if (without.length === cur.length) continue;
      const s = await submit(without);
      if (s.zip < curZip) { cur = without; curZip = s.zip; }
    }
    console.log('  take all, drop losers  ' + curZip + '  (' + (curZip - base.zip) + ')');

    let cur2 = [], cur2Zip = base.zip;
    for (const x of [...wins].reverse()) {
      const next = [...cur2, ...x.edits];
      const s = await submit(next);
      if (s.zip < cur2Zip) { cur2 = next; cur2Zip = s.zip; }
    }
    console.log('  ascending greedy       ' + cur2Zip + '  (' + (cur2Zip - base.zip) + ')');

    let cur3 = [], cur3Zip = base.zip;
    for (const x of wins) {
      const next = [...cur3, ...x.edits];
      const s = await submit(next);
      if (s.zip < cur3Zip) { cur3 = next; cur3Zip = s.zip; }
    }
    console.log('  descending greedy      ' + cur3Zip + '  (' + (cur3Zip - base.zip) + ')');

    const best = [{ z: curZip, e: cur }, { z: cur2Zip, e: cur2 }, { z: cur3Zip, e: cur3 },
      { z: together.zip, e: all }].sort((a, b) => a.z - b.z)[0];
    console.log('\nbest combined ' + best.z + ' (delta ' + (best.z - base.zip) + ') over ' + best.e.length + ' edits');
    writeFileSync(p('reports', 'numpool.json'),
      JSON.stringify({ base: base.zip, zip: best.z, edits: best.e.length }, null, 1));
  }
  for (const s of workers) s.w.terminate();
  process.exit(0);
}
