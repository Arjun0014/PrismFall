// What is "generate the whole soundscape from one formula" actually worth?
//
//   node tools/audioform.mjs
//
// This measures a proposal; it does not apply one. Nothing here is written to
// src/ and no sound in the game changes.
//
// The proposal: rather than 24 hand-written cue recipes, derive every cue's
// waveform, pitch, sweep, duration and envelope arithmetically from its event
// id plus whatever runtime value it already receives. This is NOT the audio
// patch VM of experiment 1 -- that stored a packed parameter table and lost by
// 17 B because the table was dense novel data. This stores nothing at all.
//
// To put a ceiling on it, every cue body below is replaced with a call to one
// generator whose parameters come only from `id` and the cue's own argument.
// The result is a real archive measurement of the *shape* of the idea. It is
// deliberately the most favourable version: the generator is as small as it can
// be while still producing a two-layer, pitch-swept, envelope-shaped sound per
// cue, so the number it produces is an upper bound on the saving.
//
// The sounds it makes are arbitrary. That is the point of measuring first.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, competitionTerser, rrOptions } from './measure.mjs';
import { topLevel } from './ast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const rr = rrOptions();
// Through readSources, so these tools compile the files in the same searched
// order the build does -- alphabetical order is a different program.
const files = readSources(false).map((f) => f.name);
const base = Object.fromEntries(files.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));
const asBundle = (o) => 'const DEBUG=0,WD=0;\n' +
  files.map((f) => '// ==== ' + f + ' ====\n' + o[f]).join('\n') + '\n';

// The 24 cues, with the signature each call site already uses.
const CUES = [
  ['sndHit', 'imp, kind, tune'], ['sndBreak', 'd'], ['sndTarget', 'f'], ['sndBank', ''],
  ['sndBoost', 'ns'], ['sndVector', 'sup'], ['sndSpring', 'imp'], ['sndTether', 'on'],
  ['sndGrav', 'ny'], ['sndWarp', ''], ['sndCoin', 'cmb'], ['sndCrown', ''],
  ['sndPig', 'c'], ['sndWell', ''], ['sndSpectrum', ''], ['sndFuse', ''],
  ['sndRefund', ''], ['sndPower', ''], ['sndEmpty', ''], ['sndStall', 'u'],
  ['sndDeath', ''], ['sndUI', 'up'], ['sndGate', ''],
];

// One generator. Waveform, root pitch, sweep ratio, duration and peak all fall
// out of the id; the runtime argument only scales loudness and pitch, which is
// what makes a cue reactive at all.
const GEN = `
function SND(id, v) {
  const k = v === undefined ? 1 : clamp(abs(v) / 900 + .3, .12, 1.4);
  const f0 = 70 + (id * 137 % 23) * 62;
  const f1 = f0 * (.3 + (id % 7) * .42);
  const du = .05 + (id % 5) * .07;
  const pk = (.06 + (id % 3) * .05) * k;
  O(WAVE[id % 3], f0 * k, f1, du, pk);
  O('sine', NOTE(52 + id % 24), NOTE(52 + id % 24 + (id % 5)), du * 1.4, pk * .6);
  N(du * .7, pk * .8, id & 1 ? 'bandpass' : 'lowpass', 400 + f0 * 2, f1, 1);
}
`;

function formulaAudio(o) {
  // Spans come from acorn, not a brace counter. A hand-rolled walker died here
  // on the apostrophe in the comment "// region's mode" -- it read that as the
  // start of a string, resynchronised on the quote in 'sine', and swallowed
  // half the file. That is precisely the failure that sank experiment 4.
  const { items } = topLevel(o['audio.js']);
  const want = new Map(CUES.map(([n, a2], i) => [n, { i, args: a2 }]));
  const edits = [];
  for (const it of items) {
    if (it.kind !== 'FunctionDeclaration' || !want.has(it.name)) continue;
    const { i, args } = want.get(it.name);
    const first = args.split(',')[0].trim();
    edits.push({
      start: it.node.start, end: it.node.end,
      text: 'function ' + it.name + '(' + args + ') { SND(' + i + (first ? ', ' + first : '') + '); }',
    });
    want.delete(it.name);
  }
  if (want.size) throw new Error('cues not found: ' + [...want.keys()].join(','));
  let s2 = o['audio.js'];
  for (const e of edits.sort((x, y) => y.start - x.start)) s2 = s2.slice(0, e.start) + e.text + s2.slice(e.end);
  o['audio.js'] = s2 + GEN;
}

const now = { ...base };
const b0 = await score(asBundle(base), competitionTerser(), rr, 'af0', [15, 200, 1000]);
formulaAudio(now);
const b1 = await score(asBundle(now), competitionTerser(), rr, 'af1', [15, 200, 1000]);

console.log('current archive            ' + b0.zip + ' B   (' + b0.min + ' minified chars)');
console.log('all 24 cues from a formula ' + b1.zip + ' B   (' + b1.min + ' minified chars)');
console.log('');
console.log('saving ' + (b0.zip - b1.zip) + ' B, and every sound in the game becomes a different sound.');
console.log('For reference, deleting all 24 cues outright is worth 686 B, so the');
console.log('generator itself costs ' + (686 - (b0.zip - b1.zip)) + ' B of that.');
