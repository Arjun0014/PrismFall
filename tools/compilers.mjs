// The compiler bench: every JS minifier available to this project behind one
// interface, so the packer/zip stages can score them on equal terms.
//
// A "compiler" takes the raw bundle and returns JS. Nothing here optimises for
// character count -- the archive is the fitness function, and this project has
// already measured cases where a LONGER intermediate file produces a SMALLER
// archive (see COMPRESSION_EXPERIMENTS.md, experiment 7).
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify as terserMinify } from 'terser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

// ---- terser ---------------------------------------------------------------
// The shipping configuration is owned by the build, not duplicated here, so a
// search can never be run against a config the product does not actually use.
export { TERSER_OPTS as TERSER_CUR } from './build.mjs';
import { TERSER_OPTS as TERSER_CUR } from './build.mjs';

export async function terser(js, over = {}) {
  const opts = {
    ...TERSER_CUR, ...over,
    compress: { ...TERSER_CUR.compress, ...(over.compress || {}) },
    mangle: over.mangle === false ? false : { ...TERSER_CUR.mangle, ...(over.mangle || {}) },
    format: { ...TERSER_CUR.format, ...(over.format || {}) },
  };
  const r = await terserMinify(js, opts);
  if (r.error) throw r.error;
  return r.code;
}

// ---- esbuild --------------------------------------------------------------
export async function esbuild(js, over = {}) {
  const { transform } = await import('esbuild');
  const r = await transform(js, {
    minify: true, target: 'es2020', format: 'iife', legalComments: 'none', ...over,
  });
  return r.code;
}

// ---- swc ------------------------------------------------------------------
export async function swc(js, over = {}) {
  const { minifySync } = await import('@swc/core');
  const r = minifySync(js, {
    compress: { passes: 4, toplevel: true, ...(over.compress || {}) },
    mangle: over.mangle === false ? false : { toplevel: true, ...(over.mangle || {}) },
    format: { comments: false },
    ecma: 2020, module: false, toplevel: true,
  });
  return r.code;
}

// ---- uglify ---------------------------------------------------------------
export async function uglify(js, over = {}) {
  const U = (await import('uglify-js')).default;
  const r = U.minify(js, {
    compress: { passes: 4, toplevel: true, ...(over.compress || {}) },
    mangle: over.mangle === false ? false : { toplevel: true, ...(over.mangle || {}) },
    output: { comments: false },
    // uglify-js is ES5-only for *output*; it parses ES2020 in recent versions
    // but will refuse arrow/class syntax it cannot reprint. Failures surface
    // as thrown errors and are reported, not silently swallowed.
    ...over.top,
  });
  if (r.error) throw new Error(r.error.message || String(r.error));
  return r.code;
}

// ---- closure --------------------------------------------------------------
const CC = p('node_modules', 'google-closure-compiler-windows', 'compiler.exe');
let ccSeq = 0;
export function closure(js, flags = []) {
  const tag = 'cc' + (ccSeq++) + '-' + process.pid;
  const inF = p('build', tag + '.js');
  const outF = p('build', tag + '.out.js');
  writeFileSync(inF, js);
  try {
    execFileSync(CC, [
      '--js', inF, '--js_output_file', outF,
      '--language_in', 'ECMASCRIPT_2020', '--language_out', 'ECMASCRIPT_2020',
      '--rewrite_polyfills', 'false',
      '--warning_level', 'QUIET',
      ...flags,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return readFileSync(outF, 'utf8');
  } finally {
    for (const f of [inF, outF]) if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
}
