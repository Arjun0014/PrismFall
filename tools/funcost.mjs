// Per-function compressed-size attribution.
//
// Removes one top-level function at a time, minifies with the production
// settings and gzips; the delta against the full bundle is that function's real
// compressed cost. gzip stands in for the Roadroller+deflate pipeline because it
// ranks candidates the same way and is ~100x faster to iterate on.
//
//   node tools/funcost.mjs            all functions, sorted by cost
//   node tools/funcost.mjs 20         top 20 only
import { gzipSync } from 'node:zlib';
import { minify } from 'terser';
import { bundle } from './src.mjs';

const LIMIT = +(process.argv[2] || 999);
const raw = bundle(false);

// Find every top-level `function name(...) { ... }` and its exact span.
function findFunctions(src) {
  const out = [];
  const re = /(?:^|\n)function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + (m[0][0] === '\n' ? 1 : 0);
    // Walk to the matching close brace, skipping strings, template literals,
    // comments and regex-looking slashes well enough for this codebase.
    let i = src.indexOf('{', re.lastIndex);
    let depth = 0, q = 0, esc = 0;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (esc) { esc = 0; continue; }
      if (ch === '\\') { esc = 1; continue; }
      if (q) { if (ch === q) q = 0; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
      if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (!depth) break; }
    }
    out.push({ name: m[1], start, end: i + 1 });
  }
  return out;
}

// Reference every top-level binding so removing one body does not let Terser
// delete unrelated code and skew the measurement.
function keepAlive(src) {
  const ids = new Set();
  for (const m of src.matchAll(/(?:^|\n)(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)) ids.add(m[1]);
  return '\nwindow.__keep=[' + [...ids].join(',') + '];\n';
}

const OPTS = {
  ecma: 2020,
  compress: {
    passes: 4, unsafe: true, unsafe_arrows: false, unsafe_math: true,
    unsafe_methods: true, unsafe_comps: true, unsafe_undefined: true,
    booleans_as_integers: true, pure_getters: true, hoist_funs: true, drop_console: true,
  },
  mangle: { toplevel: true },
  format: { comments: false },
};

async function measure(src) {
  const r = await minify('(()=>{\n' + src + keepAlive(raw) + '\n})()', OPTS);
  if (r.error) throw r.error;
  return [r.code.length, gzipSync(Buffer.from(r.code), { level: 9 }).length];
}

const fns = findFunctions(raw);
const [baseMin, baseGz] = await measure(raw);
console.log('full bundle: min ' + baseMin + '  gzip ' + baseGz + '   (' + fns.length + ' top-level functions)\n');

const rows = [];
for (const f of fns) {
  // Replace the body with an empty one so call sites still resolve.
  const stub = 'function ' + f.name + '(){}';
  const cut = raw.slice(0, f.start) + stub + raw.slice(f.end);
  try {
    const [m, g] = await measure(cut);
    rows.push([f.name, f.end - f.start, baseMin - m, baseGz - g]);
  } catch { /* a stub that breaks parsing is not a candidate anyway */ }
}

rows.sort((a, b) => b[3] - a[3]);
console.log('function              src    Δmin   Δgzip   share');
let shown = 0;
for (const [n, src, dm, dg] of rows) {
  if (shown++ >= LIMIT) break;
  console.log(n.padEnd(20), String(src).padStart(6), String(dm).padStart(7), String(dg).padStart(7),
    (100 * dg / baseGz).toFixed(1).padStart(6) + '%');
}
console.log('\nsum of listed Δgzip: ' + rows.slice(0, shown).reduce((a, r) => a + r[3], 0));
