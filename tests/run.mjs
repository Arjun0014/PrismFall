// Run every suite in order and summarise.
//   npm test                full pass (build + all suites + browsers)
//   node tests/run.mjs      suites only
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const SUITES = [
  ['feature simulation', 'tests/sim.mjs', []],
  ['procedural generator', 'tests/gen.mjs', [args.includes('--quick') ? '16' : '80']],
  ['audio', 'tests/audio.mjs', []],
];
if (!args.includes('--no-browser')) {
  SUITES.push(['browser', 'tests/browser.mjs', []]);
  // The Wavedash build is a separate product from the same source, so it needs
  // its own gate: it must run with the SDK and, just as importantly, without it.
  SUITES.push(['wavedash build', 'tests/wavedash.mjs', []]);
  // ...and it is built first. tests/wavedash.mjs reads dist-wavedash/index.html
  // off disk, so without this the suite happily certifies whatever was there
  // from a previous session -- which it did, once.
  spawnSync(process.execPath, [join(ROOT, 'tools/build.mjs'), '--wavedash'], { cwd: ROOT, stdio: 'ignore' });
}

let failed = 0;
for (const [name, file, extra] of SUITES) {
  console.log('\n########  ' + name + '  ########');
  const r = spawnSync(process.execPath, [join(ROOT, file), ...extra], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log('!! ' + name + ' FAILED'); }
}
console.log('\n' + (failed ? failed + ' suite(s) failed' : 'all suites passed'));
process.exit(failed ? 1 : 0);
