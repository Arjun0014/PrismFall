// Source ordering as a free variable.
//
//   node tools/reorder.mjs --files      hill-climb the source file order
//   node tools/reorder.mjs --funcs      hill-climb top-level function order
//   node tools/reorder.mjs --apply      rewrite src/ with the winner
//
// Two orderings are searched, and their safety arguments are different:
//
//   functions   A function declaration is hoisted and fully initialised before
//               any statement in the script runs, so moving it among top-level
//               statements cannot change when it exists, what it closes over,
//               or what anything else sees. Every non-function statement keeps
//               its exact relative position, which preserves both evaluation
//               order and every temporal dead zone. This one is provable, and
//               it is the transformation the previous attempt got wrong by
//               splitting the bundle with a brace counter that did not know
//               about regex literals (COMPRESSION_EXPERIMENTS.md #4).
//
//   files       NOT provable. `const CV = document.getElementById('a')` lives
//               in 20_state.js and 85_input.js touches CV at top level, so file
//               order carries real dependencies. Every file-order candidate is
//               therefore gated on tools/smoke.mjs, which boots the compiled
//               bundle, starts a run and drives 240 frames of real input; an
//               order that does not survive that is not a candidate at all.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { weigh, competitionTerser, rrOptions } from './measure.mjs';
import { readSources } from './src.mjs';
import { topLevel, rebuild } from './ast.mjs';
import { smoke } from './smoke.mjs';
import { canon } from './canon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);
const args = process.argv.slice(2);
const FILES = args.includes('--files');
const FUNCS = args.includes('--funcs');
const APPLY = args.includes('--apply');
const PROBES = +((args.find((a) => a.startsWith('--probes=')) || '').slice(9)) || 300;

const rr = rrOptions();
const files = readSources(false);
const asBundle = (parts) =>
  'const DEBUG=0,WD=0;\n' + parts.map((f) => '// ==== ' + f.name + ' ====\n' + f.code).join('\n') + '\n';

async function measure(parts, { check } = {}) {
  const r = await minify(asBundle(parts), competitionTerser());
  if (r.error) throw r.error;
  if (check) {
    const s = smoke(r.code, { frames: 150 });
    if (!s.ok) return { zip: Infinity, broken: s.where + ': ' + s.err };
  }
  // Scored the way the build ships: after the canonical pass.
  return weigh(canon(r.code), rr, 'ro');
}

const base = await measure(files);
console.log('baseline ' + base.zip + ' B');

// ------------------------------------------------------------- functions ---
if (FUNCS) {
  // Each file is searched independently. Cross-file moves are also safe by the
  // hoisting argument, but they would dissolve the file structure that the
  // codebase is organised around for a lever this size.
  const orders = new Map();
  let cur = files.map((f) => ({ ...f }));
  let curZip = base.zip;

  for (const f of files) {
    const { items } = topLevel(f.code);
    const idx = items.map((it, i) => (it.kind === 'FunctionDeclaration' ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 3) continue;
    let order = [...idx], sinceWin = 0;
    const probes = Math.min(PROBES, idx.length * 8);
    for (let t = 0; t < probes; t++) {
      const cand = [...order];
      const a = Math.random() * cand.length | 0;
      let b = Math.random() * cand.length | 0;
      if (a === b) b = (b + 1) % cand.length;
      // Move rather than swap: adjacency is what the model rewards, and a move
      // changes one neighbourhood while a swap disturbs two.
      const [x] = cand.splice(a, 1); cand.splice(b, 0, x);
      const code = rebuild(f.code, items, cand);
      const parts = cur.map((g) => (g.name === f.name ? { name: g.name, code } : g));
      const m = await measure(parts);
      if (m.zip < curZip) {
        console.log('  ' + f.name.padEnd(14) + curZip + ' -> ' + m.zip + '  (' + (m.zip - curZip) + ')');
        curZip = m.zip; order = cand; cur = parts; sinceWin = 0;
      } else if (++sinceWin > 40) break;
    }
    orders.set(f.name, order);
  }
  console.log('\nfunction order: ' + curZip + ' (baseline ' + base.zip + ', delta ' + (curZip - base.zip) + ')');
  if (APPLY && curZip < base.zip) {
    for (const f of cur) writeFileSync(p('src', f.name), f.code);
    console.log('rewrote src/');
  }
  writeFileSync(p('reports', 'reorder-funcs.json'),
    JSON.stringify({ base: base.zip, zip: curZip, orders: [...orders] }, null, 1));
}

// ----------------------------------------------------------------- files ---
if (FILES) {
  // The source files are named with a numeric prefix that fixes their order.
  // A different order means renaming them, so the search reports rather than
  // applies, and every candidate must survive a real run first.
  let order = files.map((_, i) => i), curZip = base.zip, sinceWin = 0;
  const nameOf = (o) => o.map((i) => files[i].name.replace(/^(\d+)_|\.js$/g, '')).join(' ');
  let broken = 0;
  for (let t = 0; t < PROBES; t++) {
    const cand = [...order];
    const a = Math.random() * cand.length | 0;
    let b = Math.random() * cand.length | 0;
    if (a === b) b = (b + 1) % cand.length;
    const [x] = cand.splice(a, 1); cand.splice(b, 0, x);
    const m = await measure(cand.map((i) => files[i]), { check: true });
    if (m.broken) { broken++; continue; }
    if (m.zip < curZip) {
      console.log('  ' + curZip + ' -> ' + m.zip + '  ' + nameOf(cand));
      curZip = m.zip; order = cand; sinceWin = 0;
    } else if (++sinceWin > 60) break;
  }
  console.log('\nfile order: ' + curZip + ' (baseline ' + base.zip + ', delta ' + (curZip - base.zip) + ')');
  console.log('  ' + nameOf(order));
  console.log('  ' + broken + ' candidate orders did not run and were rejected');
  writeFileSync(p('reports', 'reorder-files.json'),
    JSON.stringify({ base: base.zip, zip: curZip, order: order.map((i) => files[i].name) }, null, 1));
}

if (!FILES && !FUNCS) console.log('nothing to do: pass --files or --funcs');
