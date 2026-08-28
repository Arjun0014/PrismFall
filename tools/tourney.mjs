// Compressor tournament: score every compiler/packer combination by the only
// number that counts -- the bytes in the competition ZIP.
//
//   node tools/tourney.mjs                     every entry, cached RR model
//   node tools/tourney.mjs --only=a,b          just these
//   node tools/tourney.mjs --deep=3            give the top 3 their own optimize(2)
//   node tools/tourney.mjs --list
//
// Every entry is validated by tools/smoke.mjs before it is ranked: a minifier
// that produces a smaller archive by breaking the game is not a winner, and
// several of them do exactly that.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { makeZip } from './zip.mjs';
import { bundle } from './src.mjs';
import { smoke } from './smoke.mjs';
import * as C from './compilers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const deepN = +((args.find((a) => a.startsWith('--deep=')) || '').slice(7)) || 0;
const NOSMOKE = args.includes('--no-smoke');

// The shipping shell, byte for byte -- see build.mjs.
const html = (s) => '<!doctype html><canvas id=a></canvas><script>' + s + '</script>';
const RR = JSON.parse(readFileSync(p('build', 'roadroller.json'), 'utf8'));
const raw = bundle(false);

function ectShrink(buf, tag) {
  const ect = p('node_modules', 'ect-bin', 'vendor', 'ect.exe');
  if (!existsSync(ect)) return buf;
  const tmp = p('build', 'trn-' + tag.replace(/[^\w]/g, '_') + '.zip');
  writeFileSync(tmp, buf);
  try {
    execFileSync(ect, ['-9', '-zip', '-strip', tmp], { stdio: 'ignore' });
    const out = readFileSync(tmp);
    return out.length < buf.length ? out : buf;
  } catch { return buf; }
}

async function zipOf(text, tag, iters) {
  const z = await makeZip([{ name: 'index.html', data: Buffer.from(text, 'utf8') }],
    { iterations: iters || [15, 200] });
  const e = ectShrink(z, tag);
  return e.length < z.length ? e : z;
}

// ---------------------------------------------------------------- packers ---
async function packRoadroller(js, opts) {
  const { Packer } = await import('roadroller');
  const pk = new Packer([{ data: js, type: 'js', action: 'eval' }],
    Object.assign({ maxMemoryMB: 150 }, RR, opts || {}));
  const d = pk.makeDecoder();
  return d.firstLine + '\n' + d.secondLine;
}

// ---------------------------------------------------------------- entries ---
// A compiler is `(raw) => js`. Chains just compose them.
const cc = (lvl, extra = []) => (js) => C.closure(js, ['--compilation_level', lvl, ...extra]);
const ENTRIES = {
  // --- single compilers ----------------------------------------------------
  'terser-cur': (s) => C.terser(s),
  'terser-stock': (s) => C.terser(s, { compress: { passes: 1, reduce_funcs: true, sequences: true, inline: true } }),
  'esbuild': (s) => C.esbuild(s),
  'swc': (s) => C.swc(s),
  'uglify': (s) => C.uglify(s),
  'closure-ws': cc('WHITESPACE_ONLY'),
  'closure-simple': cc('SIMPLE'),
  'closure-adv': cc('ADVANCED'),
  // --- chains: another compiler first, terser's anti-inlining block last ----
  'esbuild>terser': async (s) => C.terser(await C.esbuild(s)),
  'swc>terser': async (s) => C.terser(await C.swc(s)),
  'uglify>terser': async (s) => C.terser(await C.uglify(s)),
  'ccsimple>terser': async (s) => C.terser(C.closure(s, ['--compilation_level', 'SIMPLE'])),
  'ccws>terser': async (s) => C.terser(C.closure(s, ['--compilation_level', 'WHITESPACE_ONLY'])),
  // --- chains: terser first ------------------------------------------------
  'terser>esbuild': async (s) => C.esbuild(await C.terser(s)),
  'terser>swc': async (s) => C.swc(await C.terser(s)),
  'terser>uglify': async (s) => C.uglify(await C.terser(s)),
  'terser>ccsimple': async (s) => C.closure(await C.terser(s), ['--compilation_level', 'SIMPLE']),
  // --- controls ------------------------------------------------------------
  'none': (s) => s,
};

const PACKERS = {
  rr: { label: 'roadroller', run: (js) => packRoadroller(js) },
  plain: { label: 'plain', run: (js) => js },
};

if (args.includes('--list')) { console.log(Object.keys(ENTRIES).join('\n')); process.exit(0); }

const rows = [];
for (const [name, fn] of Object.entries(ENTRIES)) {
  if (only.length && !only.includes(name)) continue;
  let js;
  const t0 = Date.now();
  try { js = await fn(raw); }
  catch (e) { console.log(name.padEnd(18) + ' COMPILE ERROR ' + String(e.message).slice(0, 90)); continue; }
  const sm = NOSMOKE ? { ok: 1 } : smoke(js);
  for (const [pk, packer] of Object.entries(PACKERS)) {
    let script;
    try { script = await packer.run(js); }
    catch (e) { console.log((name + '/' + pk).padEnd(24) + ' PACK ERROR ' + String(e.message).slice(0, 70)); continue; }
    if (/<\/script/i.test(script)) { console.log((name + '/' + pk).padEnd(24) + ' skipped (</script)'); continue; }
    const z = await zipOf(html(script), name + '-' + pk);
    const row = { name, pk, min: js.length, packed: script.length, zip: z.length, ok: sm.ok, err: sm.err, why: sm.where };
    rows.push(row);
    console.log(
      (name + ' / ' + packer.label).padEnd(28) +
      ' min ' + String(js.length).padStart(6) +
      '  packed ' + String(script.length).padStart(6) +
      '  ZIP ' + String(z.length).padStart(6) +
      (sm.ok ? '  ok' : '  ** BROKEN (' + sm.where + ': ' + String(sm.err).slice(0, 40) + ')') +
      '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'
    );
  }
}

rows.sort((a, b) => a.zip - b.zip);
console.log('\n---- ranking (valid entries only) ----');
for (const r of rows.filter((r) => r.ok).slice(0, 12))
  console.log('  ' + String(r.zip).padStart(6) + '  ' + r.name + ' / ' + r.pk);
const broken = rows.filter((r) => !r.ok);
if (broken.length) {
  console.log('\n---- broken (not eligible) ----');
  for (const r of broken) console.log('  ' + String(r.zip).padStart(6) + '  ' + r.name + ' / ' + r.pk + '  [' + r.why + '] ' + String(r.err).slice(0, 60));
}
writeFileSync(p('reports', 'tourney.json'), JSON.stringify(rows, null, 1));

// ------------------------------------------------------------ deep round ---
if (deepN) {
  const { Packer } = await import('roadroller');
  const fin = rows.filter((r) => r.ok && r.pk === 'rr').slice(0, deepN);
  console.log('\n---- deep round: own optimize(2) per finalist ----');
  for (const r of fin) {
    const js = await ENTRIES[r.name](raw);
    const pk = new Packer([{ data: js, type: 'js', action: 'eval' }],
      { maxMemoryMB: 150, numAbbreviations: 8, allowFreeVars: true, sparseSelectors: RR.sparseSelectors });
    await pk.optimize(2);
    const keep = {};
    for (const k of ['sparseSelectors', 'precision', 'modelMaxCount', 'recipLearningRate', 'contextBits', 'modelRecipBaseCount', 'learningRateNum', 'learningRateDenom'])
      if (pk.options[k] !== undefined) keep[k] = pk.options[k];
    let best = null;
    for (const n of [4, 6, 8, 10, 12, 16, 24]) {
      const q = new Packer([{ data: js, type: 'js', action: 'eval' }],
        Object.assign({ maxMemoryMB: 150, allowFreeVars: true }, keep, { numAbbreviations: n }));
      const d = q.makeDecoder();
      const out = d.firstLine + '\n' + d.secondLine;
      if (/<\/script/i.test(out)) continue;
      const z = await zipOf(html(out), r.name + '-deep', [15, 200, 1000]);
      if (!best || z.length < best.zip) best = { n, zip: z.length, keep };
    }
    console.log('  ' + r.name.padEnd(18) + ' cached ' + r.zip + '  ->  own model ' + best.zip + '  (abbrev ' + best.n + ')');
    writeFileSync(p('build', 'rr-' + r.name.replace(/[^\w]/g, '_') + '.json'),
      JSON.stringify(Object.assign({}, best.keep, { numAbbreviations: best.n }), null, 1));
  }
}
