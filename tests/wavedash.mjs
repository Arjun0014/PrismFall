// Verify the Wavedash build runs with NO SDK present (the platform injects it
// at runtime, so a bare load must degrade rather than break), and then again
// with a stubbed SDK so init / identity / leaderboard are actually exercised.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const html = readFileSync(join(ROOT, 'dist-wavedash', 'index.html'), 'utf8');
const server = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); r.end(html); }).listen(8117);
const b = await chromium.launch({ headless: true });
let fail = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x !== undefined ? '   [' + x + ']' : '')); if (!c) fail++; };

for (const withSdk of [0, 1]) {
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  if (withSdk) {
    await page.addInitScript(() => {
      const calls = [];
      window.__calls = calls;
      const R = (data) => Promise.resolve({ success: true, data });
      window.Wavedash = {
        LeaderboardSortOrder: { ASC: 0, DESC: 1 },
        LeaderboardDisplayType: { NUMERIC: 0 },
        AvatarSize: { SMALL: 0, MEDIUM: 1, LARGE: 2 },
        init: (o) => calls.push(['init', JSON.stringify(o || {})]),
        readyForEvents: () => calls.push(['readyForEvents']),
        loadComplete: () => calls.push(['loadComplete']),
        updateLoadProgressZeroToOne: (p) => calls.push(['progress', p]),
        getUser: () => ({ userId: 'u1', username: 'testrider', avatarUrl: '' }),
        getUserAvatarUrl: () => '',
        updateUserPresence: (p) => calls.push(['presence', p.status]),
        getOrCreateLeaderboard: (n) => { calls.push(['getOrCreate', n]); return R({ id: 'lb-' + n }); },
        listLeaderboardEntries: () => R([
          { globalRank: 1, username: 'ada', score: 99999 },
          { globalRank: 2, username: 'testrider', score: 4242 }]),
        getMyLeaderboardEntries: () => R([{ globalRank: 2, score: 4242 }]),
        uploadLeaderboardScore: (id, sc) => { calls.push(['upload', id, sc]); return R({ globalRank: 2, submittedRank: 7 }); },
      };
    });
  }
  await page.goto('http://localhost:8117/');
  await page.waitForTimeout(1200);
  const label = withSdk ? 'with stubbed SDK' : 'with NO SDK';
  console.log('\n=== wavedash build ' + label + ' ===');
  // querySelector, not getElementById: the game binds its canvas with
  // document.querySelector('canvas') and neither shell carries an id any more.
  // This assertion was still asking for #a and only passed because it ran
  // against a dist-wavedash/ built before the id was dropped.
  ok(await page.evaluate(() => !!document.querySelector('canvas')), 'canvas exists');
  const drew = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c.width > 0 && c.height > 0;
  });
  ok(drew, 'canvas sized');
  // Play a run and end it so a score submission is attempted.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(String((i % 7) + 1));
    await page.mouse.move(640, 420); await page.mouse.down();
    await page.mouse.move(720, 470, { steps: 3 }); await page.mouse.up();
    await page.waitForTimeout(100);
  }
  if (withSdk) {
    const calls = await page.evaluate(() => window.__calls.map((c) => c[0]));
    ok(calls.includes('init'), 'Wavedash.init() called', calls.join(','));
    ok(calls.includes('readyForEvents'), 'readyForEvents() called');
    ok(calls.includes('loadComplete'), 'loadComplete() called');
    ok(calls.filter((c) => c === 'getOrCreate').length === 2, 'both leaderboards resolved');
    ok(calls.includes('presence'), 'presence published');
    const board = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'getOrCreate').map((c) => c[1]));
    ok(board.includes('prismfall-score') && board.includes('prismfall-depth'),
      'leaderboards are named', board.join(','));
  }
  if (withSdk) {
    // Back to the title so the identity card and the board panel are on screen.
    // Pause -> QUIT RUN -> MENU, which is also the path a real score
    // submission takes, so the board has something of ours on it by the time
    // the title screen draws.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.mouse.click(640, 464);      // QUIT RUN
    await page.waitForTimeout(400);
    await page.mouse.click(640 + 105, 360 + 114);  // MENU
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(ROOT, 'reports', 'shots', 'wavedash-title.png') });
  }
  ok(errs.length === 0, 'no console errors ' + label, errs.join(' | '));
  await page.close();
}
// The store is a Wavedash-build feature now, so its coverage lives here rather
// than in tests/browser.mjs, which tests the competition build where it is
// compiled out. Seeded with enough coins to afford everything, then every tile
// is clicked.
{
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8117/');
  await page.waitForTimeout(600);
  await page.evaluate(() => { try { localStorage.pf26_save = '500,4000,0,9000,0,0,0,0,0'; } catch (e) {} });
  await page.reload();
  await page.waitForTimeout(900);
  console.log('\n=== wavedash store ===');
  await page.mouse.click(640 - 105, 360 + 26);
  await page.waitForTimeout(400);
  for (let n = 0; n < 12; n++) {
    const c = (n / 3) | 0, i = n % 3;
    await page.mouse.click(640 - 240 + i * 150 + 66, 360 - 118 + c * 48);
    await page.waitForTimeout(90);
  }
  const saved = await page.evaluate(() => { try { return localStorage.pf26_save; } catch (e) { return ''; } });
  ok(/^\d+(,-?\d+)+$/.test(saved), 'store writes a well-formed save (' + saved + ')');
  ok(saved.split(',').length > 8, 'the record carries the store fields (' + saved + ')');
  ok(saved.split(',').slice(5).some((v) => +v > 0), 'purchases actually equip (' + saved + ')');
  ok(errs.length === 0, 'no console errors in the store', errs.join(' | '));
  await page.close();
}

await b.close();
server.close();
console.log(fail ? '\n' + fail + ' failed' : '\nall wavedash checks passed');
process.exit(fail ? 1 : 0);
