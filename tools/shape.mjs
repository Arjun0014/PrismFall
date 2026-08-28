// Free text shape.
//
//   node tools/shape.mjs
//
// `format.beautify + braces` added 28,515 characters to the minified bundle and
// took 14 bytes OFF the archive (COMPRESSION_EXPERIMENTS.md #12). Whitespace and
// mandatory punctuation are, to a context-mixing model, very nearly free -- and
// they break up token sequences it would otherwise mispredict.
//
// If that is true in general then Terser's formatter is not the only place to
// look, because Terser only offers the shapes it happens to implement. This
// applies further reshapings directly to the minified text, all of them
// semantics-preserving, and weighs each one.
//
// Every edit is placed using acorn's span information, so nothing inside a
// string, template literal, regex or comment is ever touched.
import { parse } from 'acorn';
import { weigh, competitionTerser, rrOptions } from './measure.mjs';
import { bundle } from './src.mjs';
import { smoke } from './smoke.mjs';

const rr = rrOptions();
const { minify } = await import('terser');
const r = await minify(bundle(false), competitionTerser());
if (r.error) throw r.error;
const min = r.code;

/** Character index ranges that must not be rewritten: strings, templates, regexes. */
function protectedRanges(src) {
  const ast = parse(src, { ecmaVersion: 2022, sourceType: 'script' });
  const out = [];
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Literal' && (typeof node.value === 'string' || node.regex)) {
      out.push([node.start, node.end]); return;
    }
    if (node.type === 'TemplateLiteral') { out.push([node.start, node.end]); return; }
    for (const k of Object.keys(node)) {
      if (k === 'start' || k === 'end' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) walk(c); }
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(ast);
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

const PROT = protectedRanges(min);
const isProtected = (i) => {
  let lo = 0, hi = PROT.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (i < PROT[m][0]) hi = m - 1;
    else if (i >= PROT[m][1]) lo = m + 1;
    else return true;
  }
  return false;
};

/** Rewrite every unprotected occurrence of `ch` as `rep`. */
function respace(src, ch, rep) {
  let out = '';
  for (let i = 0; i < src.length; i++) out += (src[i] === ch && !isProtected(i)) ? rep : src[i];
  return out;
}

const VARIANTS = {
  'baseline': (s) => s,
  // Line endings. Two characters where there was one, and the second is fully
  // determined by the first.
  'CRLF line endings': (s) => s.replace(/\n/g, '\r\n'),
  'LF -> LF LF': (s) => s.replace(/\n/g, '\n\n'),
  // Punctuation padding, outside strings only.
  'space after comma': (s) => respace(s, ',', ', '),
  'space around =': (s) => s.replace(/([^=!<>+\-*/%&|^])=([^=])/g, (m, a, b) => a + ' = ' + b),
  'space after semicolon': (s) => respace(s, ';', '; '),
  'double space indent': (s) => s.replace(/\n( +)/g, (m, sp) => '\n' + sp + sp),
  'tab indent': (s) => s.replace(/\n( +)/g, (m, sp) => '\n' + '\t'.repeat(sp.length / 4 | 0 || 1)),
  // Blank line between top-level declarations: the same idea as beautify, one
  // level up. Uses acorn spans rather than a regex over `}`.
  'blank line between decls': (s) => {
    const ast = parse(s, { ecmaVersion: 2022, sourceType: 'script' });
    let out = s;
    for (const node of [...ast.body].reverse()) out = out.slice(0, node.start) + '\n' + out.slice(node.start);
    return out;
  },
  // A banner above every top-level declaration: maximally predictable text,
  // repeated ~300 times. If free text really is free, this is the limit case.
  'banner above decls': (s) => {
    const ast = parse(s, { ecmaVersion: 2022, sourceType: 'script' });
    let out = s;
    const bar = '\n/*' + '-'.repeat(60) + '*/\n';
    for (const node of [...ast.body].reverse()) out = out.slice(0, node.start) + bar + out.slice(node.start);
    return out;
  },
};

const base = await weigh(min, rr, 'sh');
console.log('baseline ' + base.zip + ' B   ' + min.length + ' chars\n');
console.log('  delta   chars  ok  variant');
for (const [name, fn] of Object.entries(VARIANTS)) {
  let src;
  try { src = fn(min); } catch (e) { console.log('      ?       -   -  ' + name + '  (' + e.message.slice(0, 40) + ')'); continue; }
  let ok = '-';
  try { parse(src, { ecmaVersion: 2022, sourceType: 'script' }); ok = smoke(src, { frames: 90 }).ok ? 'y' : 'N'; }
  catch { ok = 'N'; }
  if (ok === 'N') { console.log('      -  ' + String(src.length - min.length).padStart(6) + '   N  ' + name + '   (broken, not eligible)'); continue; }
  const w = await weigh(src, rr, 'sh-' + name.replace(/\W/g, ''));
  const d = w.zip - base.zip;
  console.log('  ' + (d > 0 ? '+' : '') + String(d).padStart(5) + '  ' + String(src.length - min.length).padStart(6) +
    '   ' + ok + '  ' + name);
}
