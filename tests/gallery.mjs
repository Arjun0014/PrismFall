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
  // Play a beat FIRST, then jump: playing after the jump let a fast run drift
  // into the next region, which is how half of these shots ended up being of
  // the wrong region entirely.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('f');
    await page.keyboard.press(String((i % 7) + 1));
    await page.mouse.move(800 + Math.sin(i) * 160, 560);
    await page.mouse.down();
    await page.mouse.move(800 + Math.sin(i) * 160 + 110, 600, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(110);
  }
  // Absolute jump, not r relative hops: play drifts and the hops compounded it,
  // so shots kept landing one region past the one they were labelled with.
  await page.evaluate((n) => window.jumpReg(n), r);
  await page.keyboard.press('f');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(DIR, 'region-' + r + '-' + NAMES[r] + '.png') });
  console.log('  region ' + r + ' ' + NAMES[r]);
}
await page.keyboard.press('1');
await page.waitForTimeout(300);

// Store, reached from the title screen with plenty of coins banked.
await page.evaluate(() => { try { localStorage.pf26_save = '5000,900,9000,0,0,1,0,0,0,0'; } catch (e) {} });
await page.reload();
await page.waitForTimeout(800);
await page.screenshot({ path: join(DIR, 'title.png') });
// STORE sits left of centre, one row below PLAY.
await page.mouse.move(800 - 105, 450 + 26);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(500);
await page.mouse.move(700, 372);
await page.waitForTimeout(350);
await page.screenshot({ path: join(DIR, 'store.png') });
console.log('  store');
console.log(errors.length ? 'ERRORS: ' + errors.slice(0, 4).join(' | ') : 'no console errors');
await b.close();
server.close();
