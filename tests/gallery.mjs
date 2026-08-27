// Region gallery: drives the DEBUG build through every region and captures one
// screenshot each, so region identity can actually be compared side by side.
//   node tools/build.mjs --dev && node tests/gallery.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'reports', 'shots');
mkdirSync(DIR, { recursive: true });
const html = readFileSync(join(ROOT, 'build', 'dev.html'));
const server = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); r.end(html); }).listen(8115);

const b = await chromium.launch({ headless: true });
const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8115/');
await page.waitForTimeout(700);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);

const NAMES = ['cloudbreak', 'sunforge', 'verdant', 'crystal', 'mine', 'inversion', 'engine'];
for (let r = 0; r < 7; r++) {
  // Fresh run per region so a death mid-capture can never poison the next shot.
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  for (let j = 0; j < r; j++) { await page.keyboard.press('g'); await page.waitForTimeout(220); }
  await page.waitForTimeout(700);
  // Play a beat so the palette settles and geometry is on screen.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('f');
    await page.keyboard.press(String((i % 7) + 1));
    await page.mouse.move(800 + Math.sin(i) * 160, 560);
    await page.mouse.down();
    await page.mouse.move(800 + Math.sin(i) * 160 + 110, 600, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(110);
  }
  await page.keyboard.press('f');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(DIR, 'region-' + r + '-' + NAMES[r] + '.png') });
  console.log('  region ' + r + ' ' + NAMES[r]);
}
console.log(errors.length ? 'ERRORS: ' + errors.slice(0, 4).join(' | ') : 'no console errors');
await b.close();
server.close();
