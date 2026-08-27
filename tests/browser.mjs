// Browser smoke + soak tests against the PACKED production artifact.
//   node tests/browser.mjs            both browsers, headless
//   node tests/browser.mjs chromium   one browser
//   node tests/browser.mjs --head     headed
//   node tests/browser.mjs --shots    write screenshots to reports/shots
import { chromium, firefox } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const HEAD = args.includes('--head');
const SHOTS = args.includes('--shots');
const only = args.find((a) => !a.startsWith('--'));
const PORT = 8113;

const SIZES = [[1920, 1080], [1366, 768], [2560, 1080], [1024, 768]];

function serve() {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'));
  return new Promise((res) => {
    const s = createServer((req, r) => {
      // Anything other than the single self-contained page is a rule violation.
      if (req.url !== '/' && req.url !== '/index.html') { external.push(req.url); r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
      r.end(html);
    }).listen(PORT, () => res(s));
  });
}
const external = [];

let failures = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) failures++; };

async function runBrowser(name, launcher) {
  console.log('\n=== ' + name + ' ===');
  const b = await launcher.launch({ headless: !HEAD });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('http://localhost:' + PORT)) external.push(u); });

  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForTimeout(700);

  ok(await page.evaluate(() => !!document.querySelector('canvas')), 'canvas exists');
  ok(await page.evaluate(() => { const c = document.querySelector('canvas'); return c.width > 100 && c.height > 100; }), 'canvas sized');

  // rAF must be ticking
  const t1 = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(performance.now()))));
  await page.waitForTimeout(200);
  const t2 = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(performance.now()))));
  ok(t2 > t1, 'render loop running');

  if (SHOTS) { mkdirSync(join(ROOT, 'reports', 'shots'), { recursive: true }); await page.screenshot({ path: join(ROOT, 'reports', 'shots', name + '-title.png') }); }

  // Start a run: click PLAY (centre-ish) — a keyboard Enter also starts.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Play for a while: draw strokes with every colour, use the wheel, scroll.
  const w = 1920, h = 1080;
  for (let i = 0; i < 40; i++) {
    const c = (i % 7) + 1;
    await page.keyboard.press(String(c));
    const x = w / 2 + Math.sin(i) * 220, y = h / 2 + Math.cos(i * 1.7) * 160;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + Math.cos(i) * 110, y + Math.sin(i) * 110, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(90);
  }
  // right-drag radial wheel
  await page.mouse.move(w / 2, h / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(w / 2 + 70, h / 2 - 70, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(200);

  const state = await page.evaluate(() => ({
    audio: typeof AudioContext !== 'undefined',
    keys: Object.keys(localStorage).filter((k) => !k.startsWith('pf26_')),
  }));
  ok(state.keys.length === 0, 'only pf26_ localStorage keys touched (' + state.keys.join(',') + ')');

  if (SHOTS) await page.screenshot({ path: join(ROOT, 'reports', 'shots', name + '-play.png') });

  // Resize matrix
  for (const [vw, vh] of SIZES) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.waitForTimeout(250);
    const good = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return c.width > 100 && c.height > 100 && getComputedStyle(document.body).overflow === 'hidden';
    });
    ok(good, 'viewport ' + vw + 'x' + vh);
    if (SHOTS && vw === 1366) await page.screenshot({ path: join(ROOT, 'reports', 'shots', name + '-1366.png') });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Pause / store / results flow
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (SHOTS) await page.screenshot({ path: join(ROOT, 'reports', 'shots', name + '-pause.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Soak: leave it running to catch runaway allocation / audio node leaks.
  await page.waitForTimeout(6000);

  // Restart repeatedly — the classic source of leaks.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('r');
    await page.waitForTimeout(350);
    await page.mouse.move(w / 2 - 100, h / 2);
    await page.mouse.down();
    await page.mouse.move(w / 2 + 100, h / 2 + 60, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }

  ok(errors.length === 0, 'no console errors' + (errors.length ? ' -> ' + errors.slice(0, 4).join(' | ') : ''));
  if (SHOTS) await page.screenshot({ path: join(ROOT, 'reports', 'shots', name + '-late.png') });

  await b.close();
}

const server = await serve();
try {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('build first: npm run build');
  if (!only || only === 'chromium') await runBrowser('chromium', chromium);
  if (!only || only === 'firefox') await runBrowser('firefox', firefox);
  ok(external.length === 0, 'no external requests' + (external.length ? ' -> ' + external.slice(0, 3).join(',') : ''));
} finally {
  server.close();
}
console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall browser checks passed');
process.exit(failures ? 1 : 0);
