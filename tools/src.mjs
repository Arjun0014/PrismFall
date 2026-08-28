// Source discovery + bundling. Kept dependency-free so tests can import it
// without pulling in the compression toolchain.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Concatenation order, and it is a SEARCHED BUILD PARAMETER, not a reading
// order. Roadroller's context model adapts as it goes, so which file follows
// which changes how well it predicts the next one; tools/reorder.mjs hill-climbs
// this list against the real archive and it has been worth 46 B so far.
//
// It is also the one ordering in this project that is not provably safe.
// `const CV = document.getElementById('a')` lives in state.js and input.js
// touches CV at top level, so the list carries real temporal-dead-zone
// dependencies. Every candidate order in the search is compiled, booted in a
// stubbed DOM and driven for 150 frames before it is weighed -- 100 candidate
// orders have been rejected that way for not running at all.
//
//   npm run reorder     re-search it after any significant source change
//
// Files used to carry numeric prefixes to force this order. They do not any
// more: renaming eleven files every time the search moves churned history for
// no reason, and a prefix that no longer matches the real order is worse than
// no prefix.
export const ORDER = [
  'config', 'state', 'colors', 'physics', 'world',
  'render', 'audio', 'hud', 'util', 'input', 'game',
];

// Platform glue is compiled into the Wavedash build only. The competition
// archive must not carry a byte of it, and every call site is behind `if (WD)`
// so Terser drops those too when WD is 0.
const PLATFORM = ['wavedash'];

export function readSources(wd) {
  const names = wd ? [...ORDER, ...PLATFORM] : ORDER;
  return names.map((n) => ({
    name: n + '.js',
    code: readFileSync(join(ROOT, 'src', n + '.js'), 'utf8'),
  }));
}

export function bundle(debug, wd) {
  const body = readSources(wd).map((f) => '// ==== ' + f.name + ' ====\n' + f.code).join('\n');
  return 'const DEBUG=' + (debug ? 1 : 0) + ',WD=' + (wd ? 1 : 0) + ';\n' + body + '\n';
}
