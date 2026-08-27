// Visual playtest capture. Drives the packed build in a real browser and takes
// annotated screenshots at scripted moments so gameplay, regions, HUD and menus
// can actually be looked at.
//
//   node tests/shots.mjs              chromium, 1920x1080
//   node tests/shots.mjs firefox
import { chromium, firefox } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const NAME = args.find((a) => !a.startsWith('--')) || 'chromium';
const PORT = 8114;
const DIR = join(ROOT, 'reports', 'shots');
mkdirSync(DIR, { recursive: true });

const html = readFileSync(join(ROOT, 'dist', 'index.html'));
const server = createServer((req, r) => {
  r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  r.end(html);
}).listen(PORT);

const launcher = NAME === 'firefox' ? firefox : chromium;
const b = await launcher.launch({ headless: true });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto('http://localhost:' + PORT + '/');
await page.waitForTimeout(900);

const shot = async (n) => { await page.screenshot({ path: join(DIR, NAME + '-' + n + '.png') }); console.log('  shot ' + n); };

// Reach into the packed build. The bundle is an IIFE, so drive it through real
// input events exactly as a player would.
const drawStroke = async (x1, y1, x2, y2, steps) => {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: steps || 4 });
  await page.mouse.up();
};

await shot('01-title');

// Start a run and play with a scripted but plausible hand.
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
await shot('02-run-start');

const W = 1920, H = 1080;
for (let i = 0; i < 26; i++) {
  await page.keyboard.press(String((i % 7) + 1));
  const ang = i * 0.9;
  const x = W / 2 + Math.cos(ang) * 200, y = H / 2 + 120 + Math.sin(ang) * 90;
  await drawStroke(x, y, x + Math.cos(ang + 1) * 120, y + Math.sin(ang + 1) * 120);
  await page.waitForTimeout(120);
  if (i === 6) await shot('03-playing');
  if (i === 16) await shot('04-playing-later');
}

// Two crossed strokes to show a fused prism node.
await page.keyboard.press('1');
await drawStroke(W / 2 - 140, H / 2 + 60, W / 2 + 60, H / 2 + 60, 3);
await page.keyboard.press('5');
await drawStroke(W / 2 - 40, H / 2 - 20, W / 2 - 40, H / 2 + 160, 3);
await page.waitForTimeout(150);
await shot('05-mixing');

// Pause, store, results.
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
await shot('06-pause');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Deep run: let it play a while to reach later regions.
for (let i = 0; i < 60; i++) {
  await page.keyboard.press(String((i % 7) + 1));
  const x = W / 2 + Math.sin(i * 1.3) * 260, y = H / 2 + 90;
  await drawStroke(x, y, x + 130, y + 40, 3);
  await page.waitForTimeout(90);
  if (i === 30) await shot('07-mid-run');
}
await shot('08-deep-run');

// Narrower viewport check.
await page.setViewportSize({ width: 1366, height: 768 });
await page.waitForTimeout(400);
await shot('09-1366x768');
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(300);

// Store, via the title screen.
await page.evaluate(() => { /* no-op: keep the packed bundle opaque */ });
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
await shot('10-pause2');

console.log(errors.length ? 'CONSOLE ERRORS: ' + errors.slice(0, 5).join(' | ') : 'no console errors');
await b.close();
server.close();
