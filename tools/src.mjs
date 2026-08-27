// Source discovery + bundling. Kept dependency-free so tests can import it
// without pulling in the compression toolchain.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readSources() {
  const dir = join(ROOT, 'src');
  return readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
    .map((f) => ({ name: f, code: readFileSync(join(dir, f), 'utf8') }));
}

export function bundle(debug) {
  const body = readSources().map((f) => '// ==== ' + f.name + ' ====\n' + f.code).join('\n');
  return 'const DEBUG=' + (debug ? 1 : 0) + ';\n' + body + '\n';
}
