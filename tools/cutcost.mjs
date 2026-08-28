// What each candidate reduction is ACTUALLY worth, measured against the current
// build configuration.
//
// Unlike tools/subcost.mjs, which stubs whole functions, this applies a real
// source edit for each candidate -- including "keep the system, halve its
// content" cases like twelve cosmetics becoming six, which cannot be expressed
// by removing a function. Every row is a full Terser -> Roadroller -> Zopfli
// pass against a temporary copy of src/.
//
// Nothing here is applied to the repo. It measures a menu; it does not order
// from it.
//
//   node tools/cutcost.mjs [filter]
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { Packer } from 'roadroller';
import { makeZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const rr = JSON.parse(readFileSync(join(ROOT, 'build', 'roadroller.json'), 'utf8'));
const filter = process.argv[2] || '';

const TERSER = {
  ecma: 2020,
  compress: {
    passes: 4, booleans_as_integers: true, pure_getters: true, hoist_funs: true,
    drop_console: true, toplevel: true,
    reduce_funcs: false, sequences: false, inline: false,
    unsafe: false, unsafe_arrows: false, unsafe_math: false,
    unsafe_methods: false, unsafe_comps: false, unsafe_undefined: false,
  },
  mangle: { toplevel: true }, format: { comments: false, wrap_func_args: false },
};

const files = readdirSync(SRC).filter((f) => f.endsWith('.js') && !/^9[5-9]_/.test(f)).sort();
const base = Object.fromEntries(files.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));

async function measure(mutate) {
  const now = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v]));
  if (mutate) mutate(now);
  const src = 'const DEBUG=0,WD=0;\n' +
    files.map((f) => '// ==== ' + f + ' ====\n' + now[f]).join('\n') + '\n';
  const r = await minify(src, TERSER);
  if (r.error) throw r.error;
  const pk = new Packer([{ data: r.code, type: 'js', action: 'eval' }],
    Object.assign({ maxMemoryMB: 150 }, rr, { allowFreeVars: true }));
  const d = pk.makeDecoder();
  const out = d.firstLine + '\n' + d.secondLine;
  const html = '<!doctype html><canvas id=a></canvas><script>' + out + '</script>';
  const z = await makeZip([{ name: 'index.html', data: Buffer.from(html, 'utf8') }], { iterations: [15, 200, 1000] });
  return z.length;
}

// Helper: replace in one file, asserting the target existed.
const sub = (o, f, a, b) => {
  if (!o[f].includes(a)) throw new Error('not found in ' + f + ': ' + a.slice(0, 50));
  o[f] = o[f].replace(a, b);
};
// Helper: cut a whole function body out (declaration stays so callers still work).
const stub = (o, f, name) => {
  const re = new RegExp('(function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{)');
  const m = re.exec(o[f]);
  if (!m) throw new Error('no function ' + name + ' in ' + f);
  let i = m.index + m[1].length, d = 1, q = 0, e = 0;
  for (; i < o[f].length && d; i++) {
    const c = o[f][i];
    if (e) { e = 0; continue; }
    if (c === '\\') { e = 1; continue; }
    if (q) { if (c === q) q = 0; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    const nx = o[f][i + 1];
    if (c === '/' && nx === '/') { const j = o[f].indexOf('\n', i); i = j < 0 ? o[f].length : j; continue; }
    if (c === '/' && nx === '*') { const j = o[f].indexOf('*/', i); i = j < 0 ? o[f].length : j + 1; continue; }
    if (c === '{') d++; else if (c === '}') d--;
  }
  o[f] = o[f].slice(0, m.index + m[1].length) + o[f].slice(i - 1);
};

// ---------------------------------------------------------------------------
// The menu. Grouped by what the player actually loses.
const CUTS = [
  // --- content quantity: the system survives, there is less inside it -------
  ['QTY  cosmetics 12 -> 6 (store intact)', (o) => {
    sub(o, '80_hud.js', "const COSN = ('CLOUD SHADOW NEON SPIRAL LANCE STARTIP ' +\n  'RAINBOW DASHED COMET SPARKS SHARDS RINGS').split(' ');",
      "const COSN = 'CLOUD NEON SPIRAL STARTIP RAINBOW COMET SPARKS RINGS'.split(' ');");
    sub(o, '80_hud.js', 'const COSP = [0, 180, 420];', 'const COSP = [0, 300];');
    sub(o, '80_hud.js', 'const owned = (c, i) => !i || (SAVE.o >> (c * 3 + i)) & 1;',
      'const owned = (c, i) => !i || (SAVE.o >> (c * 2 + i)) & 1;');
    o['80_hud.js'] = o['80_hud.js'].split('CATS * 3').join('CATS * 2').split('n % 3').join('n % 2')
      .split('n / 3 | 0').join('n / 2 | 0').split('c * 3 + i').join('c * 2 + i');
  }],
  ['QTY  boons 10 -> 6 (Ascension intact)', (o) => {
    sub(o, '00_config.js', "'RESONANCE|bumpers pay double|WIDE PALETTE|+2 stroke slots|' +\n  'HARD LIGHT|strokes fire twice|GOLDEN HOUR|coins worth triple'",
      "'RESONANCE|bumpers pay double'");
  }],
  ['QTY  boosters 7 -> 5', (o) => {
    sub(o, '00_config.js', "  [5, 1.9, 11],     // Indigo Flux    - gravity stays bent\n  [6, 1.9, 11],     // Violet Echo    - longer phase, longer warp\n", '');
    sub(o, '00_config.js', "const BNAME = 'OVERDRIVE SUPERCOIL REACH SUPERRAIL FLUX ECHO EFFICIENCY'.split(' ');",
      "const BNAME = 'OVERDRIVE SUPERCOIL REACH SUPERRAIL EFFICIENCY'.split(' ');");
  }],
  ['QTY  regions 7 -> 5', (o) => {
    o['30_world.js'] = o['30_world.js'].replace(/\n[^\n]*'INVERSION TEMPLE'[^\n]*\n[^\n]*'RAINBOW ENGINE'[^\n]*/, '');
    sub(o, '00_config.js', 'const NREG = 7;', 'const NREG = 5;');
    o['30_world.js'] = o['30_world.js'].split('i < 7 ? i : i % 7').join('i < 5 ? i : i % 5')
      .split('/ REGD) / 7)').join('/ REGD) / 5)').split('r > 5 ?').join('r > 3 ?');
  }],
  ['QTY  world archetypes 9 -> 7 (drop bowl + crushers)', (o) => {
    stub(o, '30_world.js', 'bowl'); stub(o, '30_world.js', 'crushers');
  }],

  // --- meta systems: no effect on moment-to-moment play ---------------------
  ['META store + cosmetics entirely', (o) => {
    stub(o, '80_hud.js', 'screenStore'); stub(o, '80_hud.js', 'buyEquip');
  }],
  ['META Ascension + all boons', (o) => {
    stub(o, '80_hud.js', 'screenAscend'); stub(o, '90_game.js', 'ascend'); stub(o, '90_game.js', 'takeBoon');
  }],
  ['META onboarding hints', (o) => {
    sub(o, '80_hud.js', "    const t = ['DRAG TO DRAW A RAINBOW RAIL', 'PRESS 1-7 OR SCROLL TO CHANGE COLOUR',\n      'PIGMENT IS FINITE - GRAB SHARDS'][hint];", '    const t = 0;');
  }],
  ['META title screen copy block', (o) => {
    const i = o['80_hud.js'].indexOf('  [\n    \'DRAG near the unicorn');
    const j = o['80_hud.js'].indexOf('  if (WD) wdIdentity');
    o['80_hud.js'] = o['80_hud.js'].slice(0, i) + o['80_hud.js'].slice(j);
  }],

  // --- content flourishes ---------------------------------------------------
  ['CONTENT focus vaults', (o) => stub(o, '30_world.js', 'buildVault')],
  ['CONTENT region gates', (o) => stub(o, '30_world.js', 'buildGate')],
  ['CONTENT reward placement', (o) => stub(o, '30_world.js', 'rewards')],
  ['CONTENT world filler pass', (o) => stub(o, '30_world.js', 'decorate')],

  // --- looks and feel: measured so the trade is visible, NOT recommended ----
  ['FEEL background motifs', (o) => { stub(o, '70_render.js', 'background'); stub(o, '70_render.js', 'motif'); }],
  ['FEEL music arrangement', (o) => stub(o, '60_audio.js', 'musicTick')],
  ['FEEL the trail', (o) => { stub(o, '70_render.js', 'pushTrail'); stub(o, '70_render.js', 'drawTrail'); }],
  ['FEEL region force fields', (o) => { stub(o, '30_world.js', 'zoneF'); stub(o, '70_render.js', 'drawZone'); }],
  ['FEEL all 24 audio cues', (o) => {
    for (const n of ['sndHit', 'sndBreak', 'sndTarget', 'sndBank', 'sndBoost', 'sndVector', 'sndSpring',
      'sndTether', 'sndGrav', 'sndWarp', 'sndCoin', 'sndCrown', 'sndPig', 'sndWell', 'sndSpectrum',
      'sndFuse', 'sndRefund', 'sndPower', 'sndEmpty', 'sndStall', 'sndDeath', 'sndUI', 'sndGate']) {
      try { stub(o, '60_audio.js', n); } catch { /* already gone */ }
    }
  }],
  ['FEEL particles + shockwaves', (o) => {
    for (const n of ['burst', 'warpFX', 'strokeFX', 'drawParts', 'shock']) {
      try { stub(o, '70_render.js', n); } catch { /* skip */ }
    }
  }],
];

const baseline = await measure(null);
console.log('baseline ' + baseline + ' B   (limit 13312, gap ' + (baseline - 13312) + ')\n');
console.log('  saving  candidate');
const rows = [];
for (const [name, fn] of CUTS) {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
  let z;
  try { z = await measure(fn); } catch (e) { console.log('   ERROR  ' + name + ' -- ' + e.message.slice(0, 60)); continue; }
  rows.push([name, baseline - z]);
  console.log('  ' + String(baseline - z).padStart(6) + '  ' + name);
}
rows.sort((a, b) => b[1] - a[1]);
console.log('\nby value:');
let run = 0;
for (const [n, v] of rows) { run += v; console.log('  ' + String(v).padStart(5) + '  (running ' + String(run).padStart(5) + ')  ' + n); }
console.log('\nnaive total if every one were taken: ' + run + ' B against a gap of ' + (baseline - 13312) + ' B');
