// Try a grid of Roadroller configurations against the current minified bundle
// and report the resulting ZIP size for each. Also times the browser-side decode
// cost proxy (pack time) so we do not ship an absurd memory setting.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer } from 'roadroller';
import { makeZip } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const min = readFileSync(join(ROOT, 'build', 'bundle.min.js'), 'utf8');
const html = (s) => '<!doctype html><meta charset=utf-8><title>PRISMFALL</title><canvas id=a></canvas><script>' + s + '</script>';

const cached = JSON.parse(readFileSync(join(ROOT, 'build', 'roadroller.json'), 'utf8'));
const configs = [];
for (const mem of [150, 300, 400, 700, 1000])
  for (const abbr of [64, 32, 16])
    configs.push({ name: 'mem' + mem + ' abbr' + abbr, opt: { ...cached, maxMemoryMB: mem, numAbbreviations: abbr } });
configs.push({ name: 'mem1000 abbr64 free', opt: { ...cached, maxMemoryMB: 1000, numAbbreviations: 64, allowFreeVars: true } });

let best = null;
for (const c of configs) {
  try {
    const t0 = Date.now();
    const p = new Packer([{ data: min, type: 'js', action: 'eval' }], c.opt);
    const d = p.makeDecoder();
    const out = d.firstLine + '\n' + d.secondLine;
    if (/<\/script/i.test(out)) { console.log(c.name.padEnd(24) + ' SKIP (</script)'); continue; }
    const z = await makeZip([{ name: 'index.html', data: Buffer.from(html(out), 'utf8') }], { iterations: [200] });
    console.log(c.name.padEnd(24) + ' packed ' + String(Buffer.byteLength(out)).padStart(6) +
      '  zip ' + String(z.length).padStart(6) + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    if (!best || z.length < best.z) best = { z: z.length, name: c.name, opt: c.opt };
  } catch (e) { console.log(c.name.padEnd(24) + ' ERR ' + e.message); }
}
console.log('\nbest: ' + best.name + ' -> ' + best.z);
