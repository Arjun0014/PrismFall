// PRISMFALL build pipeline.
//
//   node tools/build.mjs            fast size build (Terser -> HTML -> zip)
//   node tools/build.mjs --deep     deep competition pack (adds Roadroller search + ECT)
//   node tools/build.mjs --dev      unminified debug build in build/dev.html
//   node tools/build.mjs --wavedash Wavedash platform build in dist-wavedash/ (the competition game + SDK)
//   node tools/build.mjs --wavedash --full   ...with the store and cosmetics, to build/wavedash-full.html
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
import { canon } from './canon.mjs';
export { bundle, readSources };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 13312;
const args = process.argv.slice(2);
const DEEP = args.includes('--deep');
const DEV = args.includes('--dev');
const WAVE = args.includes('--wavedash');
const FULL = args.includes('--full');      // with --wavedash: the store/cosmetics variant, to build/
const QUIET = args.includes('--quiet');
const QUICK = args.includes('--quick');   // roadroller only, light zopfli: fast feedback
const NOTE = (args.find((a) => a.startsWith('--note=')) || '').slice(7);

const p = (...a) => join(ROOT, ...a);
const log = (...a) => { if (!QUIET) console.log(...a); };


// ---------------------------------------------------------------- terser ----
// ---- mangled-name alphabet -------------------------------------------------
// Terser draws mangled names from a 54-character alphabet that it sorts by how
// often each character already appears in the source. That is the right move
// for a Huffman-coded stream -- skew the histogram, shorten the common codes --
// and the wrong one here, because a context-mixing coder cares about how
// PREDICTABLE the next character is given the last few, not how often it occurs
// overall. Simply switching the frequency sort off is worth 136 B.
//
// The alphabet below was then searched directly against the archive by
// tools/mangle.mjs (family survey, then a hill-climb over swap / substitute /
// drop / insert). Total against Terser's default: -253 B.
//
// After the Ascension removal and the constant clustering it came back to the
// plain 26-letter uppercase alphabet, and 700 probes could not beat it -- the
// hand-searched 25-character permutation that won on the old source is now 14 B
// WORSE. The optimum really does move with the payload, so re-search it after
// any significant source change:
//
//   npm run mangle
//
// This is a build parameter, exactly like the Roadroller model. Nothing about
// the game depends on it: Terser guarantees the names it emits are unique,
// non-reserved and non-shadowing whatever alphabet it is handed.
const NAME_LEAD = '_BCDEFGHIJKLMNOPQRSTUVWXYZ';
const NAME_TAIL = NAME_LEAD + '0123456789';

/** A Terser `nth_identifier`. Omitting reset/sort is what disables the sort. */
export function nameGen(lead = NAME_LEAD, tail = NAME_TAIL) {
  const L = [...lead], T = [...tail];
  return {
    get(num) {
      let ret = '', chars = L, base = L.length;
      num++;
      do {
        num--;
        ret += chars[num % base];
        num = Math.floor(num / base);
        chars = T; base = T.length;
      } while (num > 0);
      return ret;
    },
  };
}

export const TERSER_OPTS = {
  ecma: 2020,
  module: false,
  toplevel: false,
  compress: {
    // ---- the anti-repetition block ----
    // Every option below is switched to the setting that makes Terser's output
    // LONGER, and each one makes the archive SMALLER. That is not a paradox:
    // this packer predicts repeated text almost for free and pays full price
    // for novel text, so trading an inlined body (unique) for a call to a
    // shared function (repeated) is a win even though the character count
    // rises. Minified length is not the fitness function. The archive is.
    //
    // Every value here was found by tools/terflags.mjs, which scores one flag
    // at a time as a complete Terser -> Roadroller -> Zopfli+ECT archive. Do
    // not "tidy" any of them back to a Terser default without re-running it.
    passes: 3,
    reduce_funcs: false,    // keep single-use functions as functions
    sequences: false,       // do not comma-fold statements together
    // Re-searched after the canonical pass (tools/canon.mjs) went in: with
    // every declaration already split and every statement in one shape, letting
    // Terser inline is worth -8 B and join_vars:false another -2. Both found by
    // tools/terflags.mjs; do not tidy without re-running it.
    inline: true,
    join_vars: false,
    loops: false,           // leave for/while shapes as written          -9 B
    // `a = a + b` -> `a += b` shortens the text and destroys a repeated
    // pattern the model was predicting nearly free. The single largest flag
    // win found so far, and it costs exactly one character of output.
    lhs_constants: false,   //                                           -46 B
    unsafe: false,          // the unsafe rewrites all shorten and specialise
    unsafe_arrows: true,    // except this one, which is repetition-neutral -7 B
    unsafe_math: false,
    unsafe_methods: false,
    unsafe_comps: false,
    unsafe_undefined: false,
    booleans_as_integers: true,
    pure_getters: true,
    hoist_funs: true,
    drop_console: true,
  },
  mangle: { toplevel: true, nth_identifier: nameGen() },
  // Yes, pretty-printed. beautify + braces takes the bundle from 45,878 to
  // 74,393 characters -- 62% larger -- and the archive 14 B SMALLER, because
  // indentation and always-present braces are the most predictable text there
  // is and they break up token sequences the model would otherwise mispredict.
  format: { comments: false, wrap_func_args: false, beautify: true, braces: true },
};

// `wrap` keeps the IIFE. The competition build drops it -- Roadroller evals the
// payload, so the declarations land in that eval's scope and nothing else on
// the page can see them, and losing the wrapper lets Terser mangle and compress
// at top level for another 14 B.
//
// The Wavedash build keeps the wrapper, because there the script is NOT packed:
// it is plain minified JS inline on a page that also carries the injected
// Wavedash SDK, and unwrapping it would put every name in the game into the
// same scope as the platform's.
async function terse(js, wrap) {
  const src = wrap ? '(()=>{\n' + js + '\n})()' : js;
  const opts = wrap ? TERSER_OPTS
    : Object.assign({}, TERSER_OPTS, {
      compress: Object.assign({}, TERSER_OPTS.compress, { toplevel: true }),
      mangle: Object.assign({}, TERSER_OPTS.mangle, { properties: OWN_PROPS }),
    });
  const r = await minify(src, opts);
  if (r.error) throw r.error;
  // The packed build is then rewritten into one canonical shape per construct
  // (tools/canon.mjs): -203 B measured, no change in behaviour.
  return wrap ? r.code : canon(r.code);
}

// The game's own two-letter object properties (P.vx, o.kt, c.bk ...) mangled
// to single characters in the packed build only: -46 B measured. The regex is
// a whitelist, so nothing the DOM or Web Audio owns can be touched. The
// Wavedash build keeps the real names because its save record and the SDK
// calls are read by code outside this tree.
// builtins: true, because Terser reserves every name on its DOM-property list
// REGARDLESS of the whitelist, and x1/y1/x2/y2 (SVGLineElement), cap and os are
// on it -- so six of these names were silently never mangled. The regex is
// still the only thing that decides what CAN be renamed; builtins only stops
// the reserve list from vetoing a whitelisted name. -6 B measured.
export const OWN_PROPS = {
  regex: /^(x1|y1|x2|y2|paid|cap|kt|kd|os|op|ox|oy|lt|bk|pl|pr|rg|vx|vy|sp|ra|rt|rs|rw|te|ph|rp|st|gt|al|tz|fn)$/,
  builtins: true,
};

// ------------------------------------------------------------------ html ----
// The page styles itself from JS (see 85_input.js), so the shell is minimal.
// The shell sits outside the Roadroller payload, so it is deflated alongside
// the packed script rather than modelled by it, and every character in it is
// paid for at close to full price. Measured, against the previous shell:
//
//   drop <title>            -22 B   the tab shows the filename instead
//   drop <meta charset>     -24 B   safe only because the source is now ASCII
//
//   omit </canvas>    -7 B   taken. The <script> becomes the canvas element's
//                            fallback content, and fallback content is parsed
//                            into the DOM like anything else: a script there
//                            runs (the HTML spec only says the content is not
//                            RENDERED). An earlier session recorded this as
//                            fatal; re-tested on the real dist page in Chromium
//                            and WebKit (build/x/shell.mjs): the script's
//                            parent is CANVAS, the canvas is sized by the
//                            script, the game plays, no errors. The browser
//                            suite runs against this shell.
//   omit </script>    NOT taken: a script terminated by end-of-file rather
//                     than a closing tag is never executed. The page loads,
//                     throws nothing, and the canvas sits at 300x150.
//   drop <!doctype html>    -14 B   taken. Quirks mode changes nothing here:
//                                   the canvas is position:fixed, so its
//                                   percentage size resolves against the
//                                   viewport in either mode. Verified in
//                                   Chromium at three viewports (BackCompat,
//                                   canvas rect == viewport, no overflow).
function html(script) {
  return '<canvas><script>' + script + '</script>';
}

// The Wavedash page needs a viewport tag and a matching page background, and
// it must not be gzip-golfed -- the platform serves static files and the only
// thing that matters here is that it runs.
function wavedashHtml(script) {
  return '<!doctype html><html lang=en><meta charset=utf-8>' +
    '<meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no">' +
    '<title>PRISMFALL</title><style>html,body{margin:0;height:100%;background:#05030c;overflow:hidden}' +
    'canvas{display:block}</style><canvas></canvas><script>' + script + '</script></html>';
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

// The decoder's context-table budget, and the one Roadroller option that is a
// safety limit rather than a size knob. Measured allocations at this payload:
//   150 MB setting -> 120 MB actual   700 MB setting -> 486 MB actual
// The larger table packs 43 characters better and is worth ~7 archive bytes.
// It is not available: the decoder allocates before the game exists, so a
// phone that cannot hand over half a gigabyte does not get a smaller game, it
// gets a blank canvas. One figure, used by every packer this file constructs.
export const RR_MEM = 150;

async function roadroll(js, deep) {
  const { Packer, defaultSparseSelectors } = await import('roadroller');
  let cached = null;
  if (existsSync(RR_CACHE)) { try { cached = JSON.parse(readFileSync(RR_CACHE, 'utf8')); } catch { /* ignore */ } }
  const inputs = [{ data: js, type: 'js', action: 'eval' }];
  // 20 context models rather than the library default of 12, and allowFreeVars.
  // numModels is literally sparseSelectors.length, and Roadroller optimises
  // WHICH selectors to use but never HOW MANY, so this axis is ours to set; a
  // sweep of 12/16/20/24/32 put the minimum at 20. allowFreeVars is safe here
  // because the packed script is the only code on the page -- the Wavedash
  // build, which does coexist with an injected SDK, is not packed at all.
  // 150 MB, not 700. The decoder allocates this table before the game exists,
  // so an over-ambitious figure is not a size trade -- it is a "does the game
  // start at all" trade. No phone can hand out 700 MB, and the rules require
  // the game to run in Firefox as well as Chrome. Measured cost of dropping
  // back to Roadroller's own default: 52 bytes.
  const opts = Object.assign({
    maxMemoryMB: RR_MEM, numAbbreviations: 8, allowFreeVars: true,
    sparseSelectors: defaultSparseSelectors(20),
  }, cached);
  // The cache is written by a previous --deep run and may hold a 12-selector
  // model; the count is our decision, not the optimizer's, so re-assert it.
  if (!opts.sparseSelectors || opts.sparseSelectors.length !== 20)
    opts.sparseSelectors = defaultSparseSelectors(20);
  opts.allowFreeVars = true;
  opts.maxMemoryMB = RR_MEM;
  const packer = new Packer(inputs, opts);
  if (deep) {
    // Full model search at milestones, then sweep the abbreviation count on top
    // of whatever model it settled on. Cache both for the fast path.
    //
    // The cached model competes too, and wins ties. Roadroller's optimize() is
    // a greedy walk with a random component, so re-running it on a changed
    // payload can and does land somewhere WORSE than the model already in the
    // cache -- measured at +22 B on the beautified bundle. A search allowed to
    // overwrite its own best answer is not a search.
    const prior = cached ? Object.assign({}, cached) : null;
    const res = await packer.optimize(2);
    const keep = {};
    for (const k of RR_KEYS) if (packer.options[k] !== undefined) keep[k] = packer.options[k];
    if (res && res.best) log('   roadroller model search -> est ' + (res.best.size | 0) + ' B');
    let best = null;
    const models = prior ? [['searched', keep], ['cached', prior]] : [['searched', keep]];
    for (const [tag, model] of models) for (const n of RR_ABBREV) {
      // 150 MB, like the main packer. Roadroller's own default is 150, and at
      // that setting the decoder allocates 120 MB before the game exists; the
      // 700 this sweep used allocates 486 MB, which no phone will hand over.
      // The sweep returns its winner directly, so a different figure here does
      // not merely mis-measure -- it SHIPS. Worth 7 B and not available.
      // allowFreeVars, like the fast path. Without it this sweep was ranking --
      // and then SHIPPING -- models built under options the product does not
      // use, which cost it 15 B and made every deep run a regression.
      const pk = new Packer(inputs, Object.assign({ maxMemoryMB: RR_MEM, allowFreeVars: true },
        model, { numAbbreviations: n }));
      const d = pk.makeDecoder();
      const out = d.firstLine + '\n' + d.secondLine;
      if (/<\/script/i.test(out)) continue;
      // Scored the way the archive is actually built. A single zopfli pass at
      // 15 iterations and no ECT was cheap and WRONG: it ranked a model 5 B
      // ahead that came out 13 B behind once the real ladder ran, and the
      // sweep then cached the loser. A comparison is only as good as the
      // metric it ranks on.
      let z = await zipOf(html(out), [15, 200]);
      z = ectShrink(z, 'rr-' + tag + '-' + n);
      if (!best || z.length < best.zip) best = { n, tag, model, zip: z.length, out };
    }
    if (best) {
      log('   roadroller sweep -> ' + best.tag + ' model, abbrev ' + best.n + ' (zip ' + best.zip + ' B)');
      writeFileSync(RR_CACHE, JSON.stringify(Object.assign({}, best.model, { numAbbreviations: best.n }), null, 1));
      return best.out;
    }
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
    const dev = bundle(true, WAVE, FULL);
    writeFileSync(p('build', 'dev.html'), html('(()=>{\n' + dev + '\n})()'));
    log('dev build -> build/dev.html');
    return;
  }

  if (WAVE) {
    mkdirSync(p('dist-wavedash'), { recursive: true });
    // The published Wavedash game is the competition game plus the SDK glue
    // (WD=1, WDX=0). --full adds the store, cosmetics, coin bank and the
    // on-screen board, and goes to build/ so it can never be what gets pushed.
    const src = bundle(false, true, FULL);
    const js = await terse(src, 1);
    const page = wavedashHtml(js);
    if (FULL) {
      writeFileSync(p('build', 'wavedash-full.html'), page);
      log('  wavedash     ' + Buffer.byteLength(page, 'utf8') + ' B -> build/wavedash-full.html  (store + cosmetics variant, not for upload)');
      return;
    }
    for (const mark of ['PRISM STORE', 'EQUIPPED', 'STARTIP', 'cosmetics only', 'GLOBAL TOP 8', 'never steer']) {
      if (js.includes(mark)) throw new Error('extras text reached the published Wavedash build: ' + mark);
    }
    writeFileSync(p('dist-wavedash', 'index.html'), page);
    if (!existsSync(p('wavedash.toml'))) writeFileSync(p('wavedash.toml'), WD_TOML);
    log('  wavedash     ' + Buffer.byteLength(page, 'utf8') + ' B -> dist-wavedash/index.html');
    log('  next         npx wavedash dev   (sandbox)   ·   npx wavedash push   (upload)');
    return;
  }

  const raw = bundle(false);
  const min = await terse(raw, 0);
  writeFileSync(p('build', 'bundle.min.js'), min);

  // The store and its cosmetics are a Wavedash-build feature. Every site that
  // reads one is behind `WD`, which is 0 here, so Terser should fold the
  // branches and drop the screen, the tables and the variant renderers as
  // unreferenced -- but "should" is how COSN survived the first attempt, its
  // `.split(' ')` initialiser being something Terser will not assume is pure.
  // So the build asserts it rather than trusting it.
  for (const mark of ['PRISM STORE', 'EQUIPPED', 'STARTIP', 'cosmetics only']) {
    if (min.includes(mark)) throw new Error('store text reached the competition bundle: ' + mark);
  }

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
