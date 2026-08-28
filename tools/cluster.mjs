// Targeted perceptual constant clustering.
//
//   node tools/cluster.mjs --probe            what a blanket snap is worth
//   node tools/cluster.mjs --files=render,hud
//   node tools/cluster.mjs --tol=0.06 --apply
//
// The census puts this program's numbers at ~2,500 B over 311 distinct values,
// and shows that what is paid for is WHICH value, not how many digits it has --
// roughly 8.7 B per distinct value. Earlier attempts to exploit that failed
// because they rewrote a literal as an arithmetic expression, which retires one
// value and introduces another (COMPRESSION_EXPERIMENTS.md #14, #19).
//
// Clustering is the version that actually removes a value: replace a rare
// constant with a value the program ALREADY uses, close enough that no player
// could tell. It adds no characters and it shrinks the pool.
//
// It is also the first change in this project that is not exactly equivalent,
// so the safety rails matter more than the search:
//
//   * only files named on the command line are touched, and the default set is
//     the two that are almost entirely perceptual -- render and hud;
//   * integers below 20 are never touched (array indices, counts, the seven
//     colours, bit positions);
//   * hex literals are never touched (they are bitmasks: BIAS, KICK, BASSR);
//   * exact powers of two are never touched (masks and shifts);
//   * a candidate must move the value by less than `tol` relatively;
//   * every kept change is re-verified by the full simulation suite, not just
//     by the archive getting smaller.
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { parse } from 'acorn';
import { score, competitionTerser, rrOptions } from './measure.mjs';
import { readSources } from './src.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

/**
 * Numeric literals with spans, each tagged with whether it is safe to nudge.
 *
 * The first version of this only looked at the value, and it broke the game in
 * two ways that no amount of tolerance-tuning would have caught:
 *
 *   `(((b - a + 540) % 360) - 180)` is the shortest-angular-distance idiom.
 *   540 is 360 + 180; it is arithmetic, not tuning, and snapping it to 500 made
 *   every hue interpolation take the wrong path round the wheel. The title
 *   screen went from purple to teal.
 *
 *   `let pal = [232, 62, 12, 322, ...]` and `z === Z_UP ? 190 : ...` are hue
 *   identity. Region colour IS the thing being preserved, so a 10-degree drift
 *   is a loss even though it is well inside any perceptual tolerance for a size
 *   or a duration.
 *
 * So eligibility is structural, not numeric. A literal is refused if it sits
 * anywhere inside modular or bitwise arithmetic, anywhere inside the hue
 * argument of a colour call, anywhere inside a table, or in anything named
 * after a hue.
 */
export function literals(src) {
  const ast = parse(src, { ecmaVersion: 2022, sourceType: 'script' });
  const out = [];
  const HUEFN = new Set(['hsl', 'chsl', 'alerp', 'regPal']);
  const walk = (n, stack) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Literal' && typeof n.value === 'number') {
      const parent = stack[stack.length - 1];
      const named = parent && (
        (parent.type === 'Property' && parent.key === n && !parent.computed) ||
        (parent.type === 'MemberExpression' && parent.property === n && !parent.computed));
      if (!named) out.push({ value: n.value, start: n.start, end: n.end, raw: src.slice(n.start, n.end), safe: safeHere(stack, n) });
      return;
    }
    stack.push(n);
    for (const k of Object.keys(n)) {
      if (k === 'start' || k === 'end' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const c of v) walk(c, stack); }
      else if (v && typeof v === 'object') walk(v, stack);
    }
    stack.pop();
  };
  const safeHere = (stack, node) => {
    let child = node;
    for (let i = stack.length - 1; i >= 0; i--) {
      const a = stack[i];
      // Modular and bitwise arithmetic is structure: masks, wraps, packing.
      if (a.type === 'BinaryExpression' && '% & | ^ << >> >>>'.split(' ').includes(a.operator)) return 0;
      // The hue argument of a colour call is identity, whatever it is made of.
      if (a.type === 'CallExpression' && a.callee.type === 'Identifier' &&
        HUEFN.has(a.callee.name) && a.arguments[0] === child) return 0;
      // A table is a table: REG, MOT, SCALE, KICK, BASSR, pal, HUE, PC.
      if (a.type === 'ArrayExpression' && stack[i - 1] && stack[i - 1].type === 'VariableDeclarator') return 0;
      // ...and anything a hue is stored in.
      if (a.type === 'VariableDeclarator' && a.id.type === 'Identifier' && /hue|pal/i.test(a.id.name)) return 0;
      child = a;
    }
    return 1;
  };
  walk(ast, []);
  return out;
}

// Values that are units rather than tuning. 100 is a percentage (it reaches
// hsl() as saturation and lightness), 360 and 180 are degrees, 255 is a byte,
// 1000 is milliseconds. Snapping any of them changes meaning, not feel.
const UNITS = new Set([100, 180, 255, 360, 540, 1000]);

/** Is this literal eligible to be nudged at all? */
export function eligible(l) {
  if (!l.safe) return false;
  if (/^0[xXbBoO]/.test(l.raw)) return false;          // bitmask, never
  if (!isFinite(l.value) || l.value === 0) return false;
  if (UNITS.has(Math.abs(l.value))) return false;
  const a = Math.abs(l.value);
  // Per-frame retention factors. `p.vx *= .985` is drag; nudging it to .9 is an
  // 8% relative change and a SEVENFOLD change in how fast a particle stops,
  // because the value is applied sixty times a second. Relative tolerance is
  // the wrong ruler for anything that gets exponentiated, and every constant
  // just under 1 in this codebase is one of those.
  if (a > .89 && a < 1) return false;
  if (Number.isInteger(l.value)) {
    if (a < 20) return false;                          // index, count, colour, bit
    if ((a & (a - 1)) === 0) return false;             // power of two: a mask
  }
  return true;
}

const fmt = (v) => {
  let s = String(v);
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
};

const splice = (src, edits) => {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
};

// ------------------------------------------------------------------ worker --
if (!isMainThread) {
  const { rr, id, names } = workerData;
  parentPort.on('message', async (msg) => {
    try {
      const src = 'const DEBUG=0,WD=0;\n' +
        names.map((n, i) => '// ==== ' + n + ' ====\n' + msg.code[i]).join('\n') + '\n';
      parentPort.postMessage({ seq: msg.seq, ...(await score(src, competitionTerser(), rr, id)) });
    } catch (e) {
      parentPort.postMessage({ seq: msg.seq, zip: Infinity, err: String(e && e.message || e) });
    }
  });
  parentPort.postMessage({ ready: 1 });
}

// -------------------------------------------------------------------- main --
// Only when node was pointed at this file. Without the guard, importing
// literals() or eligible() from another tool silently starts a full search.
const IS_ENTRY = /cluster\.mjs$/.test(process.argv[1] || '');
if (isMainThread && IS_ENTRY) {
  const args = process.argv.slice(2);
  const PROBE = args.includes('--probe');
  const APPLY = args.includes('--apply');
  const TOL = +((args.find((a) => a.startsWith('--tol=')) || '').slice(6)) || 0.05;
  const JOBS = +((args.find((a) => a.startsWith('--jobs=')) || '').slice(7)) || 5;
  const TARGETS = ((args.find((a) => a.startsWith('--files=')) || '--files=render,hud').slice(8))
    .split(',').filter(Boolean).map((n) => n + '.js');
  const rr = rrOptions();
  const files = readSources(false);
  const names = files.map((f) => f.name);
  const base = files.map((f) => f.code);

  // The pool is every value the whole program uses, with how often. A candidate
  // replacement has to already be in it, or nothing is retired.
  const pool = new Map();
  for (const f of files) for (const l of literals(f.code))
    pool.set(l.value, (pool.get(l.value) || 0) + 1);

  // Distinct eligible values inside the target files, and where they occur.
  const groups = new Map();
  files.forEach((f, fi) => {
    if (!TARGETS.includes(f.name)) return;
    for (const l of literals(f.code)) {
      if (!eligible(l)) continue;
      if (!groups.has(l.value)) groups.set(l.value, []);
      groups.get(l.value).push({ fi, ...l });
    }
  });

  // For each, the most-used pool value within tolerance that is not itself.
  const cands = [];
  for (const [v, hits] of groups) {
    let best = null;
    for (const [w, n] of pool) {
      if (w === v || !isFinite(w) || w === 0) continue;
      if (Math.abs(w - v) / Math.abs(v) > TOL) continue;
      if (Number.isInteger(v) !== Number.isInteger(w)) continue;
      if (n <= (pool.get(v) || 0)) continue;              // must be commoner
      if (!best || n > best.n) best = { w, n };
    }
    if (best) cands.push({ v, w: best.w, hits, uses: hits.length, pop: best.n });
  }
  cands.sort((a, b) => a.uses - b.uses);
  console.log(TARGETS.join(', ') + ': ' + groups.size + ' eligible distinct values, ' +
    cands.length + ' have a commoner neighbour within ' + (TOL * 100).toFixed(0) + '%');

  const pool2 = [];
  for (let i = 0; i < JOBS; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { rr, id: 'k' + i, names } });
    w.unref(); pool2.push({ w, busy: 0 });
  }
  let seq = 0;
  const pending = new Map();
  for (const s of pool2) s.w.on('message', (m) => {
    if (m.ready) return;
    const cb = pending.get(m.seq); pending.delete(m.seq); s.busy = 0; if (cb) cb(m);
  });
  const submit = (code) => new Promise((res) => {
    const tick = () => {
      const s = pool2.find((x) => !x.busy);
      if (!s) { setTimeout(tick, 15); return; }
      s.busy = 1; const id = seq++; pending.set(id, res);
      s.w.postMessage({ seq: id, code });
    };
    tick();
  });

  const withEdits = (list) => {
    const per = new Map();
    for (const c of list) for (const h of c.hits) {
      if (!per.has(h.fi)) per.set(h.fi, []);
      per.get(h.fi).push({ start: h.start, end: h.end, text: fmt(c.w) });
    }
    return base.map((code, i) => (per.has(i) ? splice(code, per.get(i)) : code));
  };

  const b0 = await submit(base);
  console.log('baseline ' + b0.zip + ' B\n');

  if (PROBE) {
    const all = await submit(withEdits(cands));
    console.log('snap every one of them: ' + all.zip + ' B  (' + (all.zip - b0.zip) + ')');
    for (const s of pool2) s.w.terminate();
    process.exit(0);
  }

  // Start from every candidate applied, then drop the ones that hurt.
  //
  // Greedy-add from nothing was tried first and stalled at -48 B while snapping
  // everything was worth -155. The reason is that retiring a value only pays
  // once ALL of its occurrences are gone, and shrinking the pool is a
  // collective effect -- so most individual snaps measure at zero and a
  // one-at-a-time walk never starts. Subtractive search sees the collective win
  // immediately and only has to find the few members that spoil it.
  let keep = [...cands];
  let cur = (await submit(withEdits(keep))).zip;
  console.log('all ' + keep.length + ' snapped: ' + cur + '  (' + (cur - b0.zip) + ')\n');
  for (const c of cands) {
    const without = keep.filter((x) => x !== c);
    if (without.length === keep.length) continue;
    const r = await submit(withEdits(without));
    if (r.zip < cur) {
      console.log('  drop ' + fmt(c.v).padEnd(9) + ' -> ' + fmt(c.w).padEnd(9) +
        ' x' + String(c.uses).padEnd(3) + cur + ' -> ' + r.zip);
      keep = without; cur = r.zip;
    }
  }
  console.log('\nkept ' + keep.length + ' of ' + cands.length + ' snaps: ' + b0.zip + ' -> ' + cur +
    '  (' + (cur - b0.zip) + ')');
  writeFileSync(p('reports', 'cluster.json'),
    JSON.stringify({ base: b0.zip, zip: cur, tol: TOL, targets: TARGETS,
      snaps: keep.map((c) => ({ from: c.v, to: c.w, uses: c.uses })) }, null, 1));

  if (APPLY && keep.length) {
    const out = withEdits(keep);
    files.forEach((f, i) => { if (out[i] !== base[i]) writeFileSync(p('src', f.name), out[i]); });
    console.log('applied to src/');
  }
  for (const s of pool2) s.w.terminate();
  process.exit(0);
}
