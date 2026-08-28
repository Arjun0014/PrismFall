// Re-audit of the HTML shell and the ZIP container.
//
//   node tools/shell.mjs
//
// The shell sits OUTSIDE the Roadroller payload but inside the zip, so it is
// deflated alongside high-entropy packed data and compresses essentially not at
// all: experiment 2 measured dropping a 22-character <title> as exactly -22 B.
// That makes every character in it worth about a full byte, which is why it is
// worth re-checking whenever anything else moves.
//
// The interesting question is whether markup can be moved INTO the payload,
// where characters cost roughly 0.75 B after packing. Creating the canvas from
// JS trades ~22 shell characters for ~32 payload characters, which is close
// enough to break even that it has to be measured rather than reasoned about.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import { competitionTerser, rrOptions, zipOf } from './measure.mjs';
import { bundle, readSources } from './src.mjs';
import { smoke } from './smoke.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rr = rrOptions();

async function pack(js) {
  const { Packer } = await import('roadroller');
  const pk = new Packer([{ data: js, type: 'js', action: 'eval' }], rr);
  const d = pk.makeDecoder();
  return d.firstLine + '\n' + d.secondLine;
}

// Source variants: how the canvas comes into existence.
const CANVAS_SRC = readSources(false).find((f) => /state/.test(f.name));
const cur = CANVAS_SRC.code;
const CVLINE = cur.match(/const CV = [^\n]*\n/)[0];
console.log('current canvas binding: ' + CVLINE.trim());

const VARIANTS = [
  {
    name: 'current',
    shell: (s) => '<!doctype html><canvas id=a></canvas><script>' + s + '</script>',
    src: cur,
  },
  {
    name: 'no id, querySelector',
    shell: (s) => '<!doctype html><canvas></canvas><script>' + s + '</script>',
    src: cur.replace(CVLINE, "const CV = document.querySelector('canvas');\n"),
  },
  {
    name: 'canvas created in JS (body first)',
    shell: (s) => '<!doctype html><body><script>' + s + '</script>',
    src: cur.replace(CVLINE, "const CV = document.body.appendChild(document.createElement('canvas'));\n"),
  },
  {
    name: 'canvas created in JS (documentElement)',
    shell: (s) => '<!doctype html><script>' + s + '</script>',
    src: cur.replace(CVLINE, "const CV = document.documentElement.appendChild(document.createElement('canvas'));\n"),
  },
  {
    // Recorded only. smoke() calls it "ok" because it runs the JS directly and
    // never parses the HTML. In a browser, a script terminated by end-of-file
    // rather than a closing tag is never executed: the page loads clean, the
    // console stays empty, and the canvas sits at 300x150 doing nothing. See #2.
    name: 'no closing </script>  [KNOWN BAD, never take]',
    shell: (s) => '<!doctype html><canvas id=a></canvas><script>' + s,
    src: cur,
  },
];

const files = readSources(false);
// Match by NAME, not by object identity. `f === CANVAS_SRC` never matched --
// readSources returns a fresh array on every call -- so each variant below was
// measured with a trimmed shell and an UNCHANGED payload, which is not a
// program that runs. It reported 22 B of savings that do not exist, and
// smoke() could not catch it: the harness's getElementById returns the canvas
// whatever id is asked for.
const asBundle = (replacement) => 'const DEBUG=0,WD=0;\n' +
  files.map((f) => '// ==== ' + f.name + ' ====\n' + (f.name === CANVAS_SRC.name ? replacement : f.code)).join('\n') + '\n';

let base = 0;
console.log('\n   zip   shell  ok   variant');
for (const v of VARIANTS) {
  const r = await minify(asBundle(v.src), competitionTerser());
  if (r.error) { console.log('   ERROR ' + v.name); continue; }
  const ok = smoke(r.code, { frames: 90 }).ok;
  const packed = await pack(r.code);
  const page = v.shell(packed);
  const z = await zipOf(page, 'shell-' + v.name.replace(/\W/g, ''));
  if (!base) base = z.length;
  console.log('  ' + String(z.length).padStart(6) + '  ' + String(v.shell('').length).padStart(4) +
    '   ' + (ok ? 'y' : 'N') + '   ' + v.name + '   (' + (z.length - base > 0 ? '+' : '') + (z.length - base) + ')');
}

// The container. Nothing here is negotiable, but it should be on the record.
const zip = readFileSync(join(ROOT, 'dist', 'prismfall.zip'));
const html = readFileSync(join(ROOT, 'dist', 'index.html'));
console.log('\nZIP container, byte for byte:');
console.log('  local file header            30 B');
console.log('  file name "index.html"       10 B   (required at top level by the rules)');
console.log('  central directory header     46 B');
console.log('  file name again              10 B');
console.log('  end of central directory     22 B');
console.log('  ------------------------------------');
console.log('  fixed overhead              118 B');
console.log('  deflate stream           ' + String(zip.length - 118).padStart(6) + ' B   from ' + html.length + ' B of HTML');
console.log('  total                    ' + String(zip.length).padStart(6) + ' B');
console.log('\n  no extra fields, no data descriptor, no directory entry, no comment.');
