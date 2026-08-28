// Exact numeric-expression synthesis.
//
//   node tools/numsyn.mjs --survey     what the literal histogram looks like
//   node tools/numsyn.mjs              measure one candidate value at a time
//   node tools/numsyn.mjs --apply      write the winning set to build/numsyn.json
//
// No tuning value changes. For each numeric literal in the MINIFIED bundle this
// looks for an arithmetic expression that evaluates to bit-identically the same
// IEEE-754 double, built from smaller integers, and asks the archive whether it
// prefers the expression.
//
// Why that can win at all: the standing measurement in
// COMPRESSION_EXPERIMENTS.md is that repeated text costs ~8.5 source characters
// per archive byte and novel text ~1.8. A literal like `.0525` that appears
// once is novel text at full price; `21/400` is longer but every character in
// it is drawn from the most common tokens in the file. Longer and cheaper is
// the same trade the anti-repetition Terser block already exploits.
//
// Why it has to run AFTER Terser: `evaluate` would fold every one of these
// straight back to the literal it came from.
//
// Exactness is not assumed anywhere. A candidate is admitted only if
// Object.is(eval(expr), value) -- which rejects the 0/-0 confusion as well as
// every inexact division -- and the whole rewrite is a span replacement driven
// by acorn, so nothing is matched textually.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { parse } from 'acorn';
import { weigh, competitionTerser, rrOptions } from './measure.mjs';
import { numericLiterals, spliceAll } from './numsyn-lib.mjs';
export { numericLiterals, spliceAll } from './numsyn-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

// ---------------------------------------------------------- synthesis ------
/**
 * Exact expressions for `v`, shortest first. Only forms whose characters are
 * already everywhere in minified JS: integer division, integer product, and a
 * product scaled by a power of ten.
 */
export function candidates(v, maxLen) {
  if (!isFinite(v) || Number.isInteger(v) && Math.abs(v) < 1000) return [];
  const out = [];
  const add = (e) => {
    // eslint-disable-next-line no-new-func
    let got; try { got = Function('return (' + e + ')')(); } catch { return; }
    if (Object.is(got, v) && e.length <= maxLen) out.push(e);
  };
  const a = Math.abs(v);
  // n / d
  for (let d = 2; d <= 4096; d++) {
    const n = v * d;
    if (!Number.isInteger(n) || Math.abs(n) > 1e7) continue;
    add(n + '/' + d);
  }
  // n * d, for values that are large or have few significant digits
  if (a >= 1) for (let d = 2; d <= 4096; d++) {
    const n = v / d;
    if (!Number.isInteger(n) || Math.abs(n) > 1e7) continue;
    add(n + '*' + d);
  }
  // n / 10^k -- the commonest shape for a decimal, and every character of it
  // is a digit and a slash
  for (let k = 1; k <= 6; k++) {
    const n = v * Math.pow(10, k);
    if (Number.isInteger(n) && Math.abs(n) <= 1e9) add(n + '/' + Math.pow(10, k));
  }
  out.sort((x, y) => x.length - y.length);
  return [...new Set(out)];
}

// ------------------------------------------------------------- workers -----
if (!isMainThread) {
  const { min, rr, id } = workerData;
  parentPort.on('message', async (msg) => {
    try {
      const src = msg.edits.length ? spliceAll(min, msg.edits) : min;
      // A rewrite that does not parse is a bug here, not a bad candidate.
      parse(src, { ecmaVersion: 2022, sourceType: 'script' });
      const s = await weigh(src, rr, id + '-' + msg.seq);
      parentPort.postMessage({ seq: msg.seq, ...s });
    } catch (e) {
      parentPort.postMessage({ seq: msg.seq, zip: Infinity, err: String(e && e.message || e) });
    }
  });
  parentPort.postMessage({ ready: 1 });
}

// ---------------------------------------------------------------- main -----
if (isMainThread) {
  const { bundle } = await import('./src.mjs');
  const { minify } = await import('terser');
  const args = process.argv.slice(2);
  const SURVEY = args.includes('--survey');
  const APPLY = args.includes('--apply');
  const JOBS = +((args.find((a) => a.startsWith('--jobs=')) || '').slice(7)) || 5;
  const MAXLEN = +((args.find((a) => a.startsWith('--maxlen=')) || '').slice(9)) || 9;
  const rr = rrOptions();

  const r = await minify(bundle(false), competitionTerser());
  if (r.error) throw r.error;
  const min = r.code;
  const lits = numericLiterals(min);

  // Group by exact value.
  const byVal = new Map();
  for (const l of lits) {
    const k = Object.is(l.value, -0) ? '-0' : String(l.value);
    if (!byVal.has(k)) byVal.set(k, { value: l.value, raw: l.raw, hits: [] });
    byVal.get(k).hits.push(l);
  }
  const groups = [...byVal.values()].sort((a, b) => a.hits.length - b.hits.length);
  console.log(lits.length + ' numeric literals, ' + groups.length + ' distinct values');

  if (SURVEY) {
    const buckets = {};
    for (const g of groups) { const b = g.hits.length; buckets[b] = (buckets[b] || 0) + 1; }
    console.log('\noccurrences -> how many distinct values');
    for (const k of Object.keys(buckets).sort((a, b) => a - b).slice(0, 14))
      console.log('  ' + String(k).padStart(4) + ' x   ' + buckets[k]);
    let withCand = 0, chars = 0;
    for (const g of groups) {
      const c = candidates(g.value, MAXLEN);
      if (c.length) { withCand++; chars += (c[0].length - g.raw.length) * g.hits.length; }
    }
    console.log('\n' + withCand + ' of ' + groups.length + ' values have an exact expression at <= ' +
      MAXLEN + ' chars');
    console.log('applying every one of them would add ' + chars + ' characters');
    console.log('\nexamples:');
    for (const g of groups.filter((g) => candidates(g.value, MAXLEN).length).slice(0, 16))
      console.log('  ' + g.raw.padEnd(10) + ' x' + String(g.hits.length).padEnd(4) + ' -> ' +
        candidates(g.value, MAXLEN).slice(0, 3).join('  '));
    process.exit(0);
  }

  // ---- pool -------------------------------------------------------------
  const pool = [];
  for (let i = 0; i < JOBS; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { min, rr, id: 'n' + i } });
    w.unref(); pool.push({ w, busy: 0 });
  }
  let seq = 0;
  const pending = new Map();
  for (const s of pool) s.w.on('message', (m) => {
    if (m.ready) return;
    const cb = pending.get(m.seq); pending.delete(m.seq); s.busy = 0; if (cb) cb(m);
  });
  const submit = (edits) => new Promise((res) => {
    const tick = () => {
      const s = pool.find((x) => !x.busy);
      if (!s) { setTimeout(tick, 15); return; }
      s.busy = 1; const id = seq++; pending.set(id, res);
      s.w.postMessage({ seq: id, edits });
    };
    tick();
  });

  const base = await submit([]);
  console.log('baseline archive ' + base.zip + ' B\n');

  // ---- one value at a time ----------------------------------------------
  const live = groups.filter((g) => candidates(g.value, MAXLEN).length);
  console.log('probing ' + live.length + ' values that have an exact expression');
  const probes = await Promise.all(live.map((g) => {
    const expr = candidates(g.value, MAXLEN)[0];
    const edits = g.hits.map((h) => ({ start: h.start, end: h.end, text: '(' + expr + ')' }));
    return submit(edits).then((s) => ({ g, expr, edits, zip: s.zip }));
  }));
  for (const pr of probes) pr.delta = pr.zip - base.zip;
  probes.sort((a, b) => a.delta - b.delta);
  const wins = probes.filter((pr) => pr.delta < 0);
  console.log('\n  win  raw        x    expression');
  for (const pr of wins.slice(0, 40))
    console.log('  ' + String(pr.delta).padStart(4) + '  ' + pr.g.raw.padEnd(10) +
      String(pr.g.hits.length).padStart(3) + '    ' + pr.expr);
  console.log('\n' + wins.length + ' of ' + probes.length + ' values improve the archive alone, ' +
    'sum of individual deltas ' + wins.reduce((a, w) => a + w.delta, 0) + ' B');

  if (!wins.length) { for (const s of pool) s.w.terminate(); process.exit(0); }

  // ---- greedy accumulation ------------------------------------------------
  // Individual deltas do not add up: two rewrites can help alone and fight each
  // other together, because each one changes what the model has already seen.
  // So take them one at a time, keeping only what still helps on top of what is
  // already taken.
  let cur = [], curZip = base.zip;
  for (const pr of wins) {
    const next = [...cur, ...pr.edits];
    const s = await submit(next);
    if (s.zip < curZip) {
      console.log('  take ' + pr.g.raw.padEnd(10) + ' -> ' + pr.expr.padEnd(12) +
        curZip + ' -> ' + s.zip);
      cur = next; curZip = s.zip;
    }
  }
  console.log('\ncombined ' + curZip + '  (baseline ' + base.zip + ', delta ' + (curZip - base.zip) + ')');

  const table = {};
  for (const pr of wins) {
    if (!cur.some((e) => pr.edits.some((q) => q.start === e.start))) continue;
    table[Object.is(pr.g.value, -0) ? '-0' : String(pr.g.value)] = pr.expr;
  }
  writeFileSync(p('reports', 'numsyn.json'),
    JSON.stringify({ base: base.zip, zip: curZip, table }, null, 1));
  if (APPLY) {
    writeFileSync(p('build', 'numsyn.json'), JSON.stringify(table, null, 1));
    console.log('wrote build/numsyn.json (' + Object.keys(table).length + ' substitutions)');
  }
  for (const s of pool) s.w.terminate();
  process.exit(0);
}
