// Live feel probe: drives the DEBUG build in a real browser and captures the
// moments the headless simulation cannot show me -- a tether mid-swing, a
// cascade mid-collapse, a lit target bank, a screen full of permanent drawings.
//   node tools/build.mjs --dev && node tests/feel.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'reports', 'shots');
mkdirSync(DIR, { recursive: true });
const html = readFileSync(join(ROOT, 'build', 'dev.html'));
const server = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  r.end(html);
}).listen(8116);

const b = await chromium.launch({ headless: true });
const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8116/');
await page.waitForTimeout(600);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);

const shot = async (n) => { await page.screenshot({ path: join(DIR, n + '.png') }); console.log('  ' + n); };
// A drag in screen space, which is the only way these verbs are ever used.
const drag = async (x1, y1, x2, y2) => {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
};

// --- permanent drawings: lay out a whole palette and let it sit --------------
await page.evaluate(() => window.jumpReg(0));
await page.waitForTimeout(300);
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('f');
  await page.keyboard.press(String(i + 1));
  await drag(620 + i * 90, 620, 690 + i * 90, 700);
  await page.waitForTimeout(80);
}
await page.waitForTimeout(1200);
await shot('feel-permanent-strokes');

// --- green tether: drawn long, held mid-swing -------------------------------
await page.keyboard.press('r');
await page.waitForTimeout(400);
// Draw a long Green line straight through the unicorn and catch the frame the
// rope is actually loaded, so the pin and the swept circle are both on screen.
let caught = 0;
for (let i = 0; i < 14 && !caught; i++) {
  await page.keyboard.press('f');
  await page.keyboard.press('4');
  const [ux, uy] = await page.evaluate(() => window.__pos());
  await drag(ux - 40, uy + 70, ux + 150, uy + 150);
  for (let j = 0; j < 8 && !caught; j++) {
    await page.waitForTimeout(60);
    const te = await page.evaluate(() => window.__te());
    if (te) { caught = te; await shot('feel-tether'); }
  }
}
console.log('  tether ' + (caught ? JSON.stringify(caught) : 'NOT CAUGHT'));

// --- destruction: park in Sunforge and detonate Red -------------------------
await page.keyboard.press('r');
await page.waitForTimeout(300);
await page.evaluate(() => window.jumpReg(1));
await page.waitForTimeout(700);
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('f');
  await page.keyboard.press('1');
  await drag(800, 500, 900, 560);
  await page.waitForTimeout(140);
  if (i === 5) await shot('feel-destruction');
}

// --- target banks -----------------------------------------------------------
await page.keyboard.press('r');
await page.waitForTimeout(300);
await page.evaluate(() => window.jumpReg(1));
await page.waitForTimeout(400);
// Light a bank by hand so the pips and the lit styling are both on screen.
const lit = await page.evaluate(() => {
  for (const c of window.__chunks()) {
    for (const k of c.bk) {
      if (k.n < 2) continue;
      window.__light(k.m[0]);
      return { n: k.n, l: k.l };
    }
  }
  return null;
});
console.log('  bank probe', JSON.stringify(lit));
await page.waitForTimeout(300);
await shot('feel-targets');

const speeds = await page.evaluate(() => window.__speeds());
console.log('  speed sample', JSON.stringify(speeds));

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await b.close();
server.close();
process.exit(errors.length ? 1 : 0);
