// Per-file compressed-size attribution by leave-one-out.
// Bundles everything except one file, minifies with the production settings and
// gzips; the delta against the full bundle is that file's real byte cost.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { minify } from 'terser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const names = readdirSync(join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort();
const src = Object.fromEntries(names.map(f => [f, readFileSync(join(ROOT, 'src', f), 'utf8')]));

// Keep-alive: reference every declared top-level binding so nothing is DCE'd.
function keepAlive(codes) {
  const ids = new Set();
  for (const c of codes)
    for (const m of c.matchAll(/(?:^|\n)(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)) ids.add(m[1]);
  return '\nwindow.__keep=[' + [...ids].join(',') + '];\n';
}

async function size(list) {
  const codes = list.map(f => src[f]);
  const js = 'const DEBUG=0;\n' + codes.join('\n') + keepAlive(codes);
  const r = await minify('(()=>{' + js + '})()', {
    ecma: 2020, compress: { passes: 3, unsafe: true, unsafe_arrows: true, unsafe_math: true, drop_console: true },
    mangle: { toplevel: true }, format: { comments: false },
  });
  if (r.error) throw r.error;
  return [r.code.length, gzipSync(Buffer.from(r.code), { level: 9 }).length];
}

const [fm, fg] = await size(names);
console.log('full bundle: min ' + fm + '  gzip ' + fg + '\n');
console.log('file'.padEnd(18) + 'src'.padStart(7) + 'Δmin'.padStart(8) + 'Δgzip'.padStart(8) + '   share');
for (const f of names) {
  const [m, g] = await size(names.filter(x => x !== f));
  console.log(f.padEnd(18) + String(src[f].length).padStart(7) + String(fm - m).padStart(8) +
    String(fg - g).padStart(8) + '   ' + ((fg - g) / fg * 100).toFixed(1) + '%');
}
