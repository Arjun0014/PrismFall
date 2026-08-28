// Title-screen capture at three aspect ratios, since the copy block at the
// bottom is the part most likely to collide with something when the window
// changes shape.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'reports', 'shots');
mkdirSync(DIR, { recursive: true });
const html = readFileSync(join(ROOT, 'build', 'dev.html'));
const server = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); r.end(html); }).listen(8118);

const b = await chromium.launch({ headless: true });
const errors = [];
for (const [w, h] of [[1600, 900], [1280, 1024], [1024, 620]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8118/');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(DIR, 'title-' + w + 'x' + h + '.png') });
  console.log('  title ' + w + 'x' + h);
  await page.close();
}
await b.close();
server.close();
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
process.exit(errors.length ? 1 : 0);
