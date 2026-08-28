// Granular byte cost of individual presentation pieces.
//
//   node tools/sweep.mjs            every probe
//   node tools/sweep.mjs audio      only probes whose name matches
//
// tools/cutcost.mjs measures whole systems -- "all 24 audio cues", "particles
// and shockwaves". That is the wrong granularity for deciding what to spend:
// it can only answer "keep it or lose it". This measures one cue, one music
// layer, one VFX branch, one reward branch at a time, so the question becomes
// "which of these earns its bytes" instead.
//
// Nothing here is applied. Every row is a real Terser -> Roadroller -> Zopfli
// + ECT archive built from a temporary copy of the source.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { score, competitionTerser, rrOptions } from './measure.mjs';
import { readSources } from './src.mjs';
import { topLevel } from './ast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

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

if (isMainThread) {
  const filter = (process.argv[2] || '').toLowerCase();
  const JOBS = +((process.argv.find((a) => a.startsWith('--jobs=')) || '').slice(7)) || 5;
  const rr = rrOptions();
  const files = readSources(false);
  const names = files.map((f) => f.name);
  const base = Object.fromEntries(files.map((f) => [f.name, f.code]));

  // ---- edit helpers -------------------------------------------------------
  const cut = (o, file, text) => {
    if (!o[file].includes(text)) throw new Error('not found in ' + file + ': ' + text.slice(0, 50));
    o[file] = o[file].replace(text, '');
  };
  const swap = (o, file, a, b) => {
    if (!o[file].includes(a)) throw new Error('not found in ' + file + ': ' + a.slice(0, 50));
    o[file] = o[file].replace(a, b);
  };
  /** Replace a whole top-level function's body with `body`. */
  const body = (o, file, name, b) => {
    const { items } = topLevel(o[file]);
    const it = items.find((x) => x.kind === 'FunctionDeclaration' && x.name === name);
    if (!it) throw new Error('no function ' + name + ' in ' + file);
    const src = o[file];
    const open = src.indexOf('{', it.node.start);
    o[file] = src.slice(0, open + 1) + b + src.slice(it.node.end - 1);
  };
  /** Alias one cue onto another: it keeps firing, it just borrows a sound. */
  const alias = (o, name, to, args) =>
    body(o, 'audio.js', name, ' ' + to + '(' + (args || '') + '); ');

  // ---- probes -------------------------------------------------------------
  // Each is [label, mutate]. Cheap first so the table reads as a menu.
  const P = [];
  const add = (label, fn) => P.push([label, fn]);

  // --- individual cues: alias rather than delete, so the event still sounds --
  const CUEALIAS = [
    ['sndFuse', 'sndUI', '1'], ['sndRefund', 'sndCoin', '0'], ['sndPower', 'sndBank', ''],
    ['sndEmpty', 'sndUI', '0'], ['sndTarget', 'sndCoin', 'f * 8'], ['sndPig', 'sndCoin', 'c'],
    ['sndCrown', 'sndBank', ''], ['sndWell', 'sndBank', ''], ['sndGate', 'sndBank', ''],
    ['sndStall', 'sndUI', '0'], ['sndBank', 'sndCrown', ''],
  ];
  for (const [name, to, args] of CUEALIAS)
    add('SFX  ' + name + ' reuses ' + to, (o) => alias(o, name, to, args));

  // --- whole cues, for comparison ------------------------------------------
  for (const n of ['sndWarp', 'sndGrav', 'sndTether', 'sndSpring', 'sndVector', 'sndBoost',
    'sndBreak', 'sndHit', 'sndDeath', 'sndSpectrum', 'sndCoin'])
    add('SFX  ' + n + ' silent', (o) => body(o, 'audio.js', n, ''));

  // --- music layers ---------------------------------------------------------
  add('MUS  kick', (o) => swap(o, 'audio.js',
    "if (kick >> b & 1) { O('sine', 120, 40, .16, .5, musG, t); N(.03, .12, 'lowpass', 900, 200, 1, musG, t); }", ''));
  add('MUS  bass', (o) => swap(o, 'audio.js', "if (bassr >> b & 1) O(w, NOTE(bass), 0, .2, .3, musG, t);", ''));
  add('MUS  pad (the chord that makes a region a place)', (o) => swap(o, 'audio.js',
    "if (!b) for (const o of [0, 3 + (sc[2] > 3 ? 1 : 0), 7])\n      O('triangle', NOTE(root + sc[deg] + o), 0, spb * 15, .1, musG, t);", ''));
  add('MUS  hats', (o) => swap(o, 'audio.js',
    "if (inten > .22 && (b & 1)) N(.03, .04 + inten * .03, 'highpass', 7000, 6000, 1, musG, t);", ''));
  add('MUS  lead', (o) => swap(o, 'audio.js', "if (inten > .8 && !(b & 1)) {", "if (0) {"));
  add('MUS  snare', (o) => swap(o, 'audio.js',
    "if (inten > .5 && b % 4 === 2) N(.1, .12, 'bandpass', 1800, 900, 1.2, musG, t);", ''));

  // --- VFX branches ---------------------------------------------------------
  add('VFX  debris fragments (k=4)', (o) => swap(o, 'render.js',
    "    if (p.k === 4) {", "    if (0) {"));
  add('VFX  ring particles (k=2)', (o) => swap(o, 'render.js',
    "    if (p.k === 2) CIR(x, y, (1 - a) * p.s * 9 * SC, 0, hsl(p.h | 0, 100, 70, a), mx(1, 3 * a * SC));\n    else ", "    "));
  add('VFX  shockwaves', (o) => body(o, 'render.js', 'shock', ''));
  add('VFX  score pops', (o) => body(o, 'render.js', 'pop', ''));
  add('VFX  the trail', (o) => { body(o, 'render.js', 'pushTrail', ''); body(o, 'render.js', 'drawTrail', ''); });
  add('VFX  warpFX', (o) => body(o, 'render.js', 'warpFX', ''));
  add('VFX  strokeFX', (o) => body(o, 'render.js', 'strokeFX', ''));

  // --- background -----------------------------------------------------------
  add('BG   motif: clouds (prim 0)', (o) => swap(o, 'render.js', "  if (!k[0]) {", "  if (0) {"));
  add('BG   motif: rings+spokes (prim 2)', (o) => swap(o, 'render.js',
    "  } else {\n    const span = a2 < 0 ? 2.4 : TAU, n = abs(a2);", "  } else if (0) {\n    const span = a2 < 0 ? 2.4 : TAU, n = abs(a2);"));
  add('BG   both parallax layers -> one', (o) => swap(o, 'render.js', "for (let L = 0; L < 2; L++) {", "for (let L = 1; L < 2; L++) {"));
  add('BG   whole background (gradient stays)', (o) => swap(o, 'render.js',
    "  const k = MOT[reg];", "  if (1) return;\n  const k = MOT[reg];"));

  // --- reward placement branches --------------------------------------------
  add('RWD  coin arc', (o) => swap(o, 'world.js', "  if (rp(.8)) {", "  if (0) {"));
  add('RWD  destruction cache', (o) => swap(o, 'world.js', "  if (rp(.22 * rich)) {", "  if (0) {"));
  add('RWD  upward temptation', (o) => swap(o, 'world.js',
    "  if (rp(.3 * rich)) place(rp(.3) ? I_BOOST : I_CROWN, ri(0, 6), .02, .16);\n", ''));
  add('RWD  mid booster', (o) => swap(o, 'world.js', "  if (rp(.16 * rich)) place(I_BOOST, ri(0, 6), .3, .8);\n", ''));

  // --- the low-impact list, for comparison ---------------------------------
  add('LOW  focus vaults', (o) => body(o, 'world.js', 'buildVault', ''));
  add('LOW  region gates', (o) => body(o, 'world.js', 'buildGate', ''));
  add('LOW  world filler', (o) => body(o, 'world.js', 'decorate', ''));
  add('LOW  onboarding hints', (o) => swap(o, 'hud.js',
    "    const t = ['DRAG TO DRAW A RAINBOW RAIL', 'PRESS 1-7 OR SCROLL TO CHANGE COLOUR',\n      'PIGMENT IS FINITE - GRAB SHARDS'][hint];", '    const t = 0;'));
  add('LOW  archetype: bowl', (o) => body(o, 'world.js', 'bowl', ''));
  add('LOW  archetype: rotor', (o) => body(o, 'world.js', 'rotor', ''));
  add('LOW  archetype: crushers', (o) => body(o, 'world.js', 'crushers', ''));
  add('LOW  archetype: pegField', (o) => body(o, 'world.js', 'pegField', ''));

  // ---- run ----------------------------------------------------------------
  const pool = [];
  for (let i = 0; i < JOBS; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { rr, id: 's' + i, names } });
    w.unref(); pool.push({ w, busy: 0 });
  }
  let seq = 0;
  const pending = new Map();
  for (const s of pool) s.w.on('message', (m) => {
    if (m.ready) return;
    const cb = pending.get(m.seq); pending.delete(m.seq); s.busy = 0; if (cb) cb(m);
  });
  const submit = (code) => new Promise((res) => {
    const tick = () => {
      const s = pool.find((x) => !x.busy);
      if (!s) { setTimeout(tick, 15); return; }
      s.busy = 1; const id = seq++; pending.set(id, res);
      s.w.postMessage({ seq: id, code });
    };
    tick();
  });

  const b0 = await submit(names.map((n) => base[n]));
  console.log('baseline ' + b0.zip + ' B   (limit 13312, gap ' + (b0.zip - 13312) + ')\n');

  const live = P.filter(([label]) => !filter || label.toLowerCase().includes(filter));
  const rows = await Promise.all(live.map(async ([label, fn]) => {
    const o = { ...base };
    try { fn(o); } catch (e) { return { label, err: e.message }; }
    const r = await submit(names.map((n) => o[n]));
    return { label, save: b0.zip - r.zip };
  }));
  rows.sort((a, b) => (b.save || 0) - (a.save || 0));
  console.log('  saves  probe');
  for (const r of rows)
    console.log('  ' + (r.err ? ' ERR ' : String(r.save).padStart(5)) + '  ' + r.label + (r.err ? '  -- ' + r.err.slice(0, 60) : ''));
  writeFileSync(p('reports', 'sweep.json'), JSON.stringify({ base: b0.zip, rows }, null, 1));
  for (const s of pool) s.w.terminate();
  process.exit(0);
}
