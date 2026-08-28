// Source discovery + bundling. Kept dependency-free so tests can import it
// without pulling in the compression toolchain.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Platform glue lives in its own file and is compiled into the Wavedash build
// only. The competition archive must not carry a byte of it, and every call
// site is behind `if (WD)` so Terser drops those too when WD is 0.
const PLATFORM = /^9[5-9]_/;

export function readSources(wd) {
  const dir = join(ROOT, 'src');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js') && (wd || !PLATFORM.test(f))).sort()
    .map((f) => ({ name: f, code: readFileSync(join(dir, f), 'utf8') }));
}

export function bundle(debug, wd) {
  const body = readSources(wd).map((f) => '// ==== ' + f.name + ' ====\n' + f.code).join('\n');
  return 'const DEBUG=' + (debug ? 1 : 0) + ',WD=' + (wd ? 1 : 0) + ';\n' + body + '\n';
}
