// Systematic ZIP-driven search over Terser's compress/format/mangle flags.
//
//   node tools/terflags.mjs                coordinate descent from the current config
//   node tools/terflags.mjs --probe        one round only: what each flag is worth alone
//   node tools/terflags.mjs --rounds=4
//   node tools/terflags.mjs --jobs=6
//
// Why this exists rather than trusting Terser's defaults: this project measured
// (COMPRESSION_EXPERIMENTS.md #7) that switching OFF inlining, sequences and the
// unsafe family makes the minified file 945 characters LONGER and the archive
// 152 bytes SMALLER. A context-mixing packer predicts repeated text almost for
// free and pays full price for novel text, so any Terser option that trades
// repetition for brevity is suspect. That is not a rule you can apply by
// reading the option list -- it has to be measured, one flag at a time, on the
// real archive.
//
// Every candidate is scored as a complete Terser -> Roadroller -> Zopfli+ECT
// archive. Minified length is reported but never ranked on.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);
const html = (s) => '<!doctype html><canvas id=a></canvas><script>' + s + '</script>';

// -------------------------------------------------------------- scoring ----
// Shared by the main thread and the workers.
export async function score(raw, cfg, rr, tag) {
  const { minify } = await import('terser');
  const r = await minify(raw, cfg);
  if (r.error) throw r.error;
  const { Packer } = await import('roadroller');
  const pk = new Packer([{ data: r.code, type: 'js', action: 'eval' }],
    Object.assign({ maxMemoryMB: 150, allowFreeVars: true }, rr));
  const d = pk.makeDecoder();
  const out = d.firstLine + '\n' + d.secondLine;
  if (/<\/script/i.test(out)) return { zip: Infinity, min: r.code.length };
  let z = await makeZip([{ name: 'index.html', data: Buffer.from(html(out), 'utf8') }],
    { iterations: [15, 200] });
  const ect = p('node_modules', 'ect-bin', 'vendor', 'ect.exe');
  if (existsSync(ect)) {
    const tmp = p('build', 'tf-' + tag + '.zip');
    writeFileSync(tmp, z);
    try {
      execFileSync(ect, ['-9', '-zip', '-strip', tmp], { stdio: 'ignore' });
      const o = readFileSync(tmp);
      if (o.length < z.length) z = o;
    } catch { /* keep zopfli result */ }
    try { rmSync(tmp); } catch { /* ignore */ }
  }
  return { zip: z.length, min: r.code.length, packed: out.length };
}

// -------------------------------------------------------------- workers ----
if (!isMainThread) {
  const { raw, rr, id } = workerData;
  parentPort.on('message', async (msg) => {
    if (msg === null) { process.exit(0); return; }
    try {
      const s = await score(raw, msg.cfg, rr, id + '-' + msg.seq);
      parentPort.postMessage({ seq: msg.seq, ...s });
    } catch (e) {
      parentPort.postMessage({ seq: msg.seq, zip: Infinity, min: 0, err: String(e && e.message || e) });
    }
  });
  parentPort.postMessage({ ready: 1 });
}

// ----------------------------------------------------------------- main ----
if (isMainThread) {
  const { bundle } = await import('./src.mjs');
  const { TERSER_CUR } = await import('./compilers.mjs');
  const args = process.argv.slice(2);
  const PROBE = args.includes('--probe');
  const ROUNDS = +((args.find((a) => a.startsWith('--rounds=')) || '').slice(9)) || 4;
  const JOBS = +((args.find((a) => a.startsWith('--jobs=')) || '').slice(7)) || 6;
  const raw = bundle(false);
  const rr = JSON.parse(readFileSync(p('build', 'roadroller.json'), 'utf8'));

  // ---- the candidate moves ------------------------------------------------
  // Each is [label, patch]. A patch is applied over the current best config.
  // Grouped by what they trade. Anything that makes output LONGER but more
  // repetitive is a live candidate here, not a mistake.
  const B = (k, v) => [k + '=' + v, { compress: { [k]: v } }];
  const F = (k, v) => ['fmt.' + k + '=' + v, { format: { [k]: v } }];
  const M = (k, v) => ['mangle.' + k + '=' + v, { mangle: { [k]: v } }];
  const MOVES = [
    // -- structure: brevity vs repetition (the axis that has paid here) -----
    B('booleans', false), B('conditionals', false), B('comparisons', false),
    B('if_return', false), B('join_vars', false), B('loops', false),
    B('switches', false), B('typeofs', false), B('properties', false),
    B('computed_props', false), B('arrows', false), B('defaults', false),
    B('negate_iife', false), B('lhs_constants', false), B('directives', false),
    B('side_effects', false), B('collapse_vars', false), B('reduce_vars', false),
    B('hoist_props', true), B('hoist_vars', true), B('keep_fargs', true),
    B('keep_infinity', true), B('evaluate', false), B('dead_code', false),
    B('unused', false), B('arguments', false),
    // -- re-test the ones already on, in case the optimum moved ------------
    B('reduce_funcs', true), B('sequences', true), B('inline', true),
    B('inline', 1), B('inline', 2), B('inline', 3),
    B('sequences', 20), B('sequences', 200), B('sequences', 800),
    B('booleans_as_integers', false), B('pure_getters', false),
    B('hoist_funs', false), B('toplevel', false),
    B('unsafe', true), B('unsafe_math', true), B('unsafe_methods', true),
    B('unsafe_arrows', true), B('unsafe_comps', true), B('unsafe_undefined', true),
    B('passes', 1), B('passes', 2), B('passes', 3), B('passes', 6),
    B('passes', 8), B('passes', 12),
    // -- output formatting: pure repetition levers --------------------------
    F('semicolons', false), F('braces', true), F('keep_numbers', true),
    F('quote_style', 1), F('quote_style', 2), F('quote_style', 3),
    F('wrap_func_args', true), F('shorthand', false), F('ascii_only', true),
    F('beautify', true), F('indent_level', 0), F('max_line_len', 120),
    ['fmt.beautify+ind1', { format: { beautify: true, indent_level: 1 } }],
    ['fmt.beautify+ind2', { format: { beautify: true, indent_level: 2 } }],
    ['fmt.beautify+ind4', { format: { beautify: true, indent_level: 4 } }],
    ['fmt.beautify+braces', { format: { beautify: true, braces: true } }],
    F('max_line_len', 40), F('max_line_len', 80), F('max_line_len', 500),
    F('semicolons', true), F('preserve_annotations', true),
    F('inline_script', false), F('keep_quoted_props', true),
    // -- mangling ------------------------------------------------------------
    M('toplevel', false), M('keep_fnames', true), M('safari10', true),
    ['ecma=2015', { ecma: 2015 }], ['ecma=2016', { ecma: 2016 }],
    ['ecma=2017', { ecma: 2017 }], ['ecma=2018', { ecma: 2018 }],
    ['ecma=2019', { ecma: 2019 }], ['ecma=2021', { ecma: 2021 }],
    ['ecma=2022', { ecma: 2022 }], ['ecma=2024', { ecma: 2024 }],
  ];

  const merge = (base, patch) => ({
    ...base, ...patch,
    compress: { ...base.compress, ...(patch.compress || {}) },
    mangle: patch.mangle === false ? false : { ...base.mangle, ...(patch.mangle || {}) },
    format: { ...base.format, ...(patch.format || {}) },
  });

  // ---- worker pool --------------------------------------------------------
  const pool = [];
  for (let i = 0; i < JOBS; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { raw, rr, id: 'w' + i } });
    w.unref();
    pool.push({ w, busy: 0 });
  }
  let seq = 0;
  const pending = new Map();
  for (const s of pool) {
    s.w.on('message', (m) => {
      if (m.ready) return;
      const cb = pending.get(m.seq);
      pending.delete(m.seq);
      s.busy = 0;
      if (cb) cb(m);
    });
  }
  function submit(cfg) {
    return new Promise((res) => {
      const tick = () => {
        const s = pool.find((x) => !x.busy);
        if (!s) { setTimeout(tick, 20); return; }
        s.busy = 1;
        const id = seq++;
        pending.set(id, res);
        s.w.postMessage({ seq: id, cfg });
      };
      tick();
    });
  }

  // ---- run ----------------------------------------------------------------
  let best = TERSER_CUR;
  const base = await submit(best);
  console.log('baseline  zip ' + base.zip + '   min ' + base.min + '\n');
  let bestZip = base.zip;
  const taken = [];
  const deadFlags = new Set();

  for (let round = 1; round <= (PROBE ? 1 : ROUNDS); round++) {
    console.log('---- round ' + round + ' (best ' + bestZip + ') ----');
    const live = MOVES.filter(([label]) => !deadFlags.has(label));
    const results = await Promise.all(live.map(([label, patch]) =>
      submit(merge(best, patch)).then((r) => ({ label, patch, ...r }))));
    results.sort((a, b) => a.zip - b.zip);
    for (const r of results) {
      if (!isFinite(r.zip)) { console.log('  ' + r.label.padEnd(26) + ' ERROR ' + String(r.err).slice(0, 60)); continue; }
      const d = r.zip - bestZip;
      if (d <= 0) console.log('  ' + r.label.padEnd(26) + String(r.zip).padStart(7) + '  ' + (d > 0 ? '+' : '') + d + '   min ' + r.min);
    }
    const win = results[0];
    if (!isFinite(win.zip) || win.zip >= bestZip) {
      console.log('  no further improvement (best candidate ' + win.label + ' ' + win.zip + ')');
      break;
    }
    console.log('  TAKE ' + win.label + '  ' + bestZip + ' -> ' + win.zip + ' (' + (win.zip - bestZip) + ')');
    best = merge(best, win.patch);
    bestZip = win.zip;
    taken.push(win.label);
    deadFlags.add(win.label);
    // Retiring the whole family a taken move belongs to would hide interactions;
    // only the exact move is retired.
    if (PROBE) break;
  }

  console.log('\nbest ' + bestZip + ' (baseline ' + base.zip + ', delta ' + (bestZip - base.zip) + ')');
  console.log('moves: ' + (taken.join(', ') || 'none'));
  writeFileSync(p('reports', 'terflags.json'), JSON.stringify({ base: base.zip, best: bestZip, taken, cfg: best }, null, 1));
  for (const s of pool) s.w.terminate();
  process.exit(0);
}
