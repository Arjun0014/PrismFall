// PRISMFALL build pipeline.
//
//   node tools/build.mjs            fast size build (Terser -> HTML -> zip)
//   node tools/build.mjs --deep     deep competition pack (adds Roadroller search + ECT)
//   node tools/build.mjs --dev      unminified debug build in build/dev.html
//   node tools/build.mjs --wavedash Wavedash platform build in dist-wavedash/
//
// There are two products from one source tree. The competition build in dist/
// is the 13 KiB archive and contains no platform code at all; the Wavedash
// build in dist-wavedash/ adds src/95_wavedash.js (leaderboards, identity, SDK
// init) and has no size limit, so it is packed for legibility rather than
// bytes. Everything else -- every feature, every tuning constant -- is shared.
//
// Every run writes dist/index.html + dist/prismfall.zip and appends a row to
// reports/size-history.md.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { makeZip, readZip } from './zip.mjs';
import { bundle, readSources } from './src.mjs';
export { bundle, readSources };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 13312;
const args = process.argv.slice(2);
const DEEP = args.includes('--deep');
const DEV = args.includes('--dev');
const WAVE = args.includes('--wavedash');
const QUIET = args.includes('--quiet');
const QUICK = args.includes('--quick');   // roadroller only, light zopfli: fast feedback
const NOTE = (args.find((a) => a.startsWith('--note=')) || '').slice(7);

const p = (...a) => join(ROOT, ...a);
const log = (...a) => { if (!QUIET) console.log(...a); };


// ---------------------------------------------------------------- terser ----
const TERSER_OPTS = {
  ecma: 2020,
  module: false,
  toplevel: false,
  compress: {
    passes: 4,
    unsafe: true,
    unsafe_arrows: false,
    unsafe_math: true,
    unsafe_methods: true,
    unsafe_comps: true,
    unsafe_undefined: true,
    booleans_as_integers: true,
    pure_getters: true,
    hoist_funs: true,
    drop_console: true,
  },
  mangle: { toplevel: true },
  format: { comments: false, wrap_func_args: false },
};

async function terse(js) {
  const wrapped = '(()=>{\n' + js + '\n})()';
  const r = await minify(wrapped, TERSER_OPTS);
  if (r.error) throw r.error;
  return r.code;
}

// ------------------------------------------------------------------ html ----
// The page styles itself from JS (see 85_input.js), so the shell is minimal.
function html(script) {
  return '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' +
    script + '</script>';
}

// The Wavedash page needs a viewport tag and a matching page background, and
// it must not be gzip-golfed -- the platform serves static files and the only
// thing that matters here is that it runs.
function wavedashHtml(script) {
  return '<!doctype html><html lang=en><meta charset=utf-8>' +
    '<meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no">' +
    '<title>PRISMFALL</title><style>html,body{margin:0;height:100%;background:#05030c;overflow:hidden}' +
    'canvas{display:block}</style><canvas id=a></canvas><script>' + script + '</script></html>';
}

// Emitted next to the build so `wavedash dev` and the CLI upload both work
// from a clean checkout. game_id is filled in by `wavedash init`.
const WD_TOML = 'game_id = ""\nupload_dir = "./dist-wavedash"\n';

// ------------------------------------------------------------------ zips ----
async function zipOf(htmlText, iterations) {
  const data = Buffer.from(htmlText, 'utf8');
  return makeZip([{ name: 'index.html', data }], { iterations });
}

function ectShrink(buf, tag) {
  const ect = p('node_modules', 'ect-bin', 'vendor', 'ect.exe');
  if (!existsSync(ect)) return buf;
  const tmp = p('build', 'ect-' + tag + '.zip');
  writeFileSync(tmp, buf);
  try {
    execFileSync(ect, ['-9', '-zip', '-strip', tmp], { stdio: 'ignore' });
    const out = readFileSync(tmp);
    return out.length < buf.length ? out : buf;
  } catch {
    return buf;
  } finally {
    try { rmSync(tmp); } catch { /* ignore */ }
  }
}

// ------------------------------------------------------------ roadroller ----
const RR_CACHE = p('build', 'roadroller.json');
const RR_KEYS = ['sparseSelectors', 'precision', 'modelMaxCount', 'recipLearningRate', 'contextBits', 'modelRecipBaseCount', 'learningRateNum', 'learningRateDenom'];

// Roadroller's own optimizer does not search the abbreviation count, and it
// matters: the gap between the library default and the best value has measured
// ~70 archive bytes here, so the deep build sweeps it explicitly and caches it.
const RR_ABBREV = [4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 32];

async function roadroll(js, deep) {
  const { Packer } = await import('roadroller');
  let cached = null;
  if (existsSync(RR_CACHE)) { try { cached = JSON.parse(readFileSync(RR_CACHE, 'utf8')); } catch { /* ignore */ } }
  const inputs = [{ data: js, type: 'js', action: 'eval' }];
  const opts = Object.assign({ maxMemoryMB: 700, numAbbreviations: 8 }, cached);
  const packer = new Packer(inputs, opts);
  if (deep) {
    // Full model search at milestones, then sweep the abbreviation count on top
    // of whatever model it settled on. Cache both for the fast path.
    const res = await packer.optimize(2);
    const keep = {};
    for (const k of RR_KEYS) if (packer.options[k] !== undefined) keep[k] = packer.options[k];
    if (res && res.best) log('   roadroller model search -> est ' + (res.best.size | 0) + ' B');
    let best = null;
    for (const n of RR_ABBREV) {
      const pk = new Packer(inputs, Object.assign({ maxMemoryMB: 700 }, keep, { numAbbreviations: n }));
      const d = pk.makeDecoder();
      const out = d.firstLine + '\n' + d.secondLine;
      if (/<\/script/i.test(out)) continue;
      const z = await zipOf(html(out), [15]);
      if (!best || z.length < best.zip) best = { n, zip: z.length, out };
    }
    if (best) {
      keep.numAbbreviations = best.n;
      log('   roadroller abbrev sweep -> ' + best.n + ' (zip ' + best.zip + ' B)');
    }
    writeFileSync(RR_CACHE, JSON.stringify(keep, null, 1));
    if (best) return best.out;
  }
  const { firstLine, secondLine } = packer.makeDecoder();
  return firstLine + '\n' + secondLine;
}

// ------------------------------------------------------------------ main ----
async function main() {
  mkdirSync(p('build'), { recursive: true });
  mkdirSync(p('dist'), { recursive: true });
  mkdirSync(p('reports'), { recursive: true });

  if (DEV) {
    const dev = bundle(true, WAVE);
    writeFileSync(p('build', 'dev.html'), html('(()=>{\n' + dev + '\n})()'));
    log('dev build -> build/dev.html');
    return;
  }

  if (WAVE) {
    mkdirSync(p('dist-wavedash'), { recursive: true });
    const src = bundle(false, true);
    const js = await terse(src);
    const page = wavedashHtml(js);
    writeFileSync(p('dist-wavedash', 'index.html'), page);
    if (!existsSync(p('wavedash.toml'))) writeFileSync(p('wavedash.toml'), WD_TOML);
    log('  wavedash     ' + Buffer.byteLength(page, 'utf8') + ' B -> dist-wavedash/index.html');
    log('  next         npx wavedash dev   (sandbox)   ·   npx wavedash push   (upload)');
    return;
  }

  const raw = bundle(false);
  const min = await terse(raw);
  writeFileSync(p('build', 'bundle.min.js'), min);

  const candidates = [];

  // Candidate A: plain minified JS inlined.
  if (!QUICK) candidates.push({ tag: 'terser', html: html(min) });

  // Candidate B: Roadroller-packed JS.
  let rrBytes = 0;
  if (DEEP || min.length > 4000) {
    try {
      const packed = await roadroll(min, DEEP);
      if (/<\/script/i.test(packed)) {
        log('   ! roadroller output contains </script - skipping candidate');
      } else {
        rrBytes = Buffer.byteLength(packed, 'utf8');
        candidates.push({ tag: 'roadroller', html: html(packed) });
      }
    } catch (e) {
      log('   ! roadroller failed:', e.message);
    }
  }

  const iterations = DEEP ? [15, 200, 1000, 4000] : QUICK ? [15] : [15, 200];
  let best = null;
  for (const c of candidates) {
    let z = await zipOf(c.html, iterations);
    if (!QUICK) { const zi = ectShrink(z, c.tag); if (zi.length < z.length) z = zi; }
    log('   ' + c.tag.padEnd(11) + ' html ' + String(Buffer.byteLength(c.html, 'utf8')).padStart(6) +
      ' B  zip ' + String(z.length).padStart(6) + ' B');
    if (!best || z.length < best.zip.length) best = Object.assign({}, c, { zip: z });
  }

  // Validate before publishing.
  const entries = readZip(best.zip);
  if (entries.length !== 1 || entries[0].name !== 'index.html')
    throw new Error('archive must contain exactly index.html at top level');
  if (entries[0].data.toString('utf8') !== best.html) throw new Error('roundtrip mismatch');

  writeFileSync(p('dist', 'index.html'), best.html);
  writeFileSync(p('dist', 'prismfall.zip'), best.zip);

  const zb = best.zip.length;
  const left = LIMIT - zb;
  log('');
  log('  raw source   ' + Buffer.byteLength(raw) + ' B');
  log('  minified     ' + min.length + ' B');
  if (rrBytes) log('  roadroller   ' + rrBytes + ' B');
  log('  WINNER       ' + best.tag);
  log('  ZIP          ' + zb + ' B   (' + (zb / 1024).toFixed(2) + ' KiB)');
  log('  remaining    ' + left + ' B of ' + LIMIT + (left < 0 ? '   *** OVER LIMIT ***' : ''));

  recordHistory({ quick: QUICK, zip: zb, min: min.length, raw: Buffer.byteLength(raw), rr: rrBytes, tag: best.tag, deep: DEEP, note: NOTE });
  if (QUIET) console.log(zb + ' ' + left);
  if (left < 0) process.exitCode = 1;
}

function recordHistory(row) {
  const file = p('reports', 'size-history.md');
  const jsonFile = p('reports', 'size-history.json');
  let rows = [];
  if (existsSync(jsonFile)) { try { rows = JSON.parse(readFileSync(jsonFile, 'utf8')); } catch { /* ignore */ } }
  const prev = rows.length ? rows[rows.length - 1].zip : 0;
  const entry = Object.assign({ date: new Date().toISOString().slice(0, 16).replace('T', ' ') }, row, {
    delta: prev ? row.zip - prev : 0,
    left: LIMIT - row.zip,
  });
  if (row.quick) return;
  if (!prev || entry.delta !== 0 || row.note) {
    rows.push(entry);
    writeFileSync(jsonFile, JSON.stringify(rows, null, 1));
    const head = '# PRISMFALL size history\n\nHard limit 13312 B. Target <= 13000 B.\n\n' +
      '| date | note | raw | min | roadroller | zip | delta | left | pack |\n|---|---|---|---|---|---|---|---|---|\n';
    const body = rows.map((r) =>
      '| ' + r.date + ' | ' + (r.note || '') + ' | ' + r.raw + ' | ' + r.min + ' | ' + (r.rr || '-') +
      ' | **' + r.zip + '** | ' + (r.delta > 0 ? '+' : '') + r.delta + ' | ' + r.left + ' | ' + r.tag + (r.deep ? ' (deep)' : '') + ' |'
    ).join('\n');
    writeFileSync(file, head + body + '\n');
  }
}

// Only build when invoked directly; tests import bundle() from here.
import { resolve } from 'node:path';
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
