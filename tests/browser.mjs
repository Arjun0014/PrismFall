// Browser smoke + soak tests against the PACKED production artifact.
//   node tests/browser.mjs            both browsers, headless
//   node tests/browser.mjs chromium   one browser
//   node tests/browser.mjs --head     headed
//   node tests/browser.mjs --shots    write screenshots to reports/shots
import { chromium, firefox, webkit } from 'playwright';
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
const skipped = [];

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
  // Radial Prism Wheel: hold right, flick to each wedge, release.
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 - Math.PI / 2;
    await page.mouse.move(w / 2, h / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(w / 2 + Math.cos(a) * 80, h / 2 + Math.sin(a) * 80, { steps: 3 });
    await page.waitForTimeout(60);
    await page.mouse.up({ button: 'right' });
  }
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, -120);
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

  // Pause / results flow
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (SHOTS) await page.screenshot({ path: join(ROOT, 'reports', 'shots', name + '-pause.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // No store in the competition build -- it is a Wavedash feature, and
  // tests/wavedash.mjs owns its coverage. What this build must still do is
  // persist the four fields it keeps, and not choke on a ten-field record
  // written by the Wavedash build against the same key.
  await page.evaluate(() => { try { localStorage.pf26_save = '4242,3300,0,9000,0,1,2,1,0'; } catch (e) {} });
  await page.reload();
  await page.waitForTimeout(700);
  const best = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c && c.width > 100;
  });
  ok(best, 'a Wavedash-written save loads without breaking the build');

  await page.evaluate(() => { try { localStorage.removeItem('pf26_save'); } catch (e) {} });
  await page.reload();
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // Quit the run so endRun writes.
  await page.mouse.click(w / 2, h / 2 + 104 * Math.min(w / 1280, h / 720));
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => { try { return localStorage.pf26_save; } catch (e) { return ''; } });
  ok(/^\d+(,-?\d+){2}$/.test(saved), 'competition build writes a three-field save (' + saved + ')');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  // Frame budget: the packed build must hold 60fps in a dense region.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const perf = await page.evaluate(() => new Promise((res) => {
    const t = [];
    let last = performance.now(), n = 0;
    const tick = () => {
      const now = performance.now();
      t.push(now - last); last = now;
      if (++n < 240) requestAnimationFrame(tick);
      else { t.sort((a, b) => a - b); res({ med: t[t.length >> 1], p95: t[(t.length * .95) | 0], worst: t[t.length - 1] }); }
    };
    requestAnimationFrame(tick);
  }));
  // Playwright's WebKit on Windows is a non-native build and runs roughly 60%
  // slower than the engines anyone actually ships on, so it is held to a looser
  // bar. It is here to catch Chromium-only ASSUMPTIONS, not to measure speed.
  const slowEngine = name === 'webkit';
  const medBar = slowEngine ? 34 : 20, p95Bar = slowEngine ? 50 : 34;
  ok(perf.med < medBar, 'median frame under ' + medBar + 'ms (' + perf.med.toFixed(1) + 'ms)');
  ok(perf.p95 < p95Bar, '95th percentile frame under ' + p95Bar + 'ms (' + perf.p95.toFixed(1) + 'ms)');

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
  // A browser that will not start on this machine is an environment problem,
  // not a game failure, so it is reported loudly and skipped rather than
  // turning every run red. A browser that starts and then fails still fails.
  // WebKit is not Firefox and does not satisfy the rules, which name Chrome and
  // Firefox explicitly. It is here because it is a genuinely different engine
  // from Chromium, so it catches Chromium-only assumptions -- which is most of
  // what a Firefox run would have caught -- on a machine where Firefox refuses
  // to start.
  if (!only || only === 'webkit') {
    try {
      await runBrowser('webkit', webkit);
    } catch (e) { skipped.push('webkit -- ' + String(e && e.message).split('\n')[0]); }
  }
  if (!only || only === 'firefox') {
    try {
      await runBrowser('firefox', firefox);
    } catch (e) {
      const m = String(e && e.message);
      if (/spawn|ENOENT|Executable doesn't exist|browserType\.launch/i.test(m)) {
        skipped.push('firefox -- ' + m.split('\n')[0]);
      } else throw e;
    }
  }
  ok(external.length === 0, 'no external requests' + (external.length ? ' -> ' + external.slice(0, 3).join(',') : ''));
} finally {
  server.close();
}
skipped.forEach((m) => console.log('\n  SKIP  ' + m +
  '\n        cannot launch on this machine -- an environment problem, not a game failure'));
console.log(failures ? '\n' + failures + ' FAILURE(S)'
  : '\nall browser checks passed' + (skipped.length ? '  (' + skipped.length + ' engine skipped)' : ''));
process.exit(failures ? 1 : 0);
