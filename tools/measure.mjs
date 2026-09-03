// One definition of "what the competition archive weighs".
//
// Every search tool in this directory scores candidates through this file, so
// a number printed by terflags, mangle, tourney or the build itself all mean
// the same thing. When they disagreed -- one of them was quietly running Terser
// without `compress.toplevel`, which the competition build sets -- the search
// optimised a configuration the product does not use.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { makeZip } from './zip.mjs';
import { TERSER_OPTS, RR_MEM, OWN_PROPS } from './build.mjs';
import { canon } from './canon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

/** The shell the archive actually ships, byte for byte. */
export const html = (s) => '<canvas><script>' + s + '</script>';

/** The cached Roadroller model the fast build uses. */
export function rrOptions() {
  const f = p('build', 'roadroller.json');
  const cached = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  return Object.assign({ maxMemoryMB: RR_MEM, allowFreeVars: true }, cached,
    { maxMemoryMB: RR_MEM, allowFreeVars: true });
}

// A key set to undefined is not the same as an absent key: Terser fills in its
// own default only for absent ones, and dereferences whatever is present. The
// searches need to ask for "Terser's own name generator", so honour a literal
// undefined by deleting the key.
function mangleOver(over) {
  const m = { ...TERSER_OPTS.mangle, ...(over || {}) };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m;
}

/**
 * The exact Terser options the competition build uses. The competition build
 * drops the IIFE, which is what makes `compress.toplevel` valid; the Wavedash
 * build keeps the wrapper and does not set it.
 */
export function competitionTerser(over = {}) {
  return {
    ...TERSER_OPTS, ...over,
    compress: { ...TERSER_OPTS.compress, toplevel: true, ...(over.compress || {}) },
    mangle: over.mangle === false ? false : mangleOver({ properties: OWN_PROPS, ...(over.mangle || {}) }),
    format: { ...TERSER_OPTS.format, ...(over.format || {}) },
  };
}

/** Zopfli + ECT, the same two stages and the same iteration ladder as the build. */
export async function zipOf(text, tag, iters) {
  let z = await makeZip([{ name: 'index.html', data: Buffer.from(text, 'utf8') }],
    { iterations: iters || [15, 200] });
  const ect = p('node_modules', 'ect-bin', 'vendor', 'ect.exe');
  if (existsSync(ect)) {
    const tmp = p('build', 'm-' + String(tag).replace(/[^\w]/g, '_') + '.zip');
    writeFileSync(tmp, z);
    try {
      execFileSync(ect, ['-9', '-zip', '-strip', tmp], { stdio: 'ignore' });
      const o = readFileSync(tmp);
      if (o.length < z.length) z = o;
    } catch { /* keep the zopfli result */ }
    try { rmSync(tmp); } catch { /* ignore */ }
  }
  return z;
}

/** Pack already-compiled JS and weigh the archive. */
export async function weigh(js, rr, tag, iters) {
  const { Packer } = await import('roadroller');
  const pk = new Packer([{ data: js, type: 'js', action: 'eval' }], rr);
  const d = pk.makeDecoder();
  const out = d.firstLine + '\n' + d.secondLine;
  if (/<\/script/i.test(out)) return { zip: Infinity, min: js.length, packed: out.length };
  const z = await zipOf(html(out), tag, iters);
  return { zip: z.length, min: js.length, packed: out.length };
}

/** Compile with `cfg`, then weigh. The full pipeline, one call. */
export async function score(raw, cfg, rr, tag, iters) {
  const { minify } = await import('terser');
  const r = await minify(raw, cfg);
  if (r.error) throw r.error;
  return weigh(canon(r.code), rr, tag, iters);
}
