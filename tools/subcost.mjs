// Cost of a whole subsystem: stub every named function in a group and measure
// the archive delta. Tells you the ceiling on refactoring that group.
import { minify } from 'terser';
import { Packer } from 'roadroller';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './zip.mjs';
import { bundle } from './src.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rr = JSON.parse(readFileSync(join(ROOT, 'build', 'roadroller.json'), 'utf8'));
const html = (s) => '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' + s + '</script>';
const raw = bundle(false);

function spans(src) {
  const out = [];
  const re = /(?:^|\n)function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + (m[0][0] === '\n' ? 1 : 0);
    let i = src.indexOf('{', re.lastIndex), depth = 0, q = 0, esc = 0;
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
function keepAlive(src) {
  const ids = new Set();
  for (const m of src.matchAll(/(?:^|\n)(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)) ids.add(m[1]);
  return '\nwindow.__keep=[' + [...ids].join(',') + '];\n';
}
async function zipOf(src) {
  const r = await minify('(()=>{\n' + src + keepAlive(raw) + '\n})()', {
    ecma: 2020,
    compress: { passes: 4, unsafe: true, unsafe_arrows: false, unsafe_math: true, unsafe_methods: true, unsafe_comps: true, unsafe_undefined: true, booleans_as_integers: true, pure_getters: true, hoist_funs: true, drop_console: true },
    mangle: { toplevel: true }, format: { comments: false, wrap_func_args: false },
  });
  const pk = new Packer([{ data: r.code, type: 'js', action: 'eval' }], Object.assign({ maxMemoryMB: 700 }, rr));
  const d = pk.makeDecoder();
  const z = await makeZip([{ name: 'index.html', data: Buffer.from(html(d.firstLine + '\n' + d.secondLine), 'utf8') }], { iterations: [15] });
  return z.length;
}

const fns = spans(raw);
const base = await zipOf(raw);
console.log('baseline zip ' + base + '\n');

const GROUPS = {
  'audio cues (snd*)': (n) => /^snd/.test(n),
  'menus (screen*/modal/btn)': (n) => /^screen|^modal$|^btn$|^uiClick$/.test(n),
  'world archetypes': (n) => /^(pegField|barrier|bowl|shaft|rotor|chamber|decorate|buildVault|buildGate|rewards|arcSegs)$/.test(n),
  'hud + wheel + bar': (n) => /^(hud|prismBar|prismWheel|cursor|txt)$/.test(n),
  'render world+items': (n) => /^(drawWorld|drawItem|obStyle|background|motif|strokeColor|drawStrokes)$/.test(n),
  'unicorn + trail + parts': (n) => /^(unicornBody|drawUnicorn|drawTrail|pushTrail|drawParts|partStep|pt|burst|warpFX|strokeFX|pop)$/.test(n),
  'music (musicTick/ARP)': (n) => /^(musicTick|ARP)$/.test(n),
  'store': (n) => /^(screenStore|buyEquip|owned)$/.test(n),
};

for (const [label, pick] of Object.entries(GROUPS)) {
  const hit = fns.filter((f) => pick(f.name));
  let src = raw, off = 0;
  for (const f of hit.slice().sort((a, b) => a.start - b.start)) {
    const stub = 'function ' + f.name + '(){}';
    src = src.slice(0, f.start + off) + stub + src.slice(f.end + off);
    off += stub.length - (f.end - f.start);
  }
  try {
    const z = await zipOf(src);
    console.log(label.padEnd(28) + String(hit.length).padStart(3) + ' fns   -' + String(base - z).padStart(5) + ' B');
  } catch (e) { console.log(label.padEnd(28) + 'failed ' + e.message); }
}
