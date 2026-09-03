// Two Wavedash pages, two contracts.
//
// dist-wavedash/index.html is the PUBLISHED game: the competition game plus
// SDK init, presence and leaderboard submission, and nothing else -- the
// rules say the Wavedash deployment is the js13k entry with no extra
// features. It must run with NO SDK present (the platform injects it at
// runtime, so a bare load has to degrade rather than break), and with a
// stubbed SDK it must init, resolve both boards, publish presence and upload
// the score when a run ends. It must carry no store, no cosmetics, no
// on-screen board, and write the same three-field save as the zip.
//
// build/wavedash-full.html is the --full variant with the store and
// cosmetics. It is never uploaded; the store round trip is covered here so
// that code keeps working.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const lean = readFileSync(join(ROOT, 'dist-wavedash', 'index.html'), 'utf8');
const full = readFileSync(join(ROOT, 'build', 'wavedash-full.html'), 'utf8');
const serve = (html, port) => createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); r.end(html); }).listen(port);
const s1 = serve(lean, 8117), s2 = serve(full, 8116);
const b = await chromium.launch({ headless: true });
let fail = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (x !== undefined ? '   [' + x + ']' : '')); if (!c) fail++; };

const SDK = () => {
  const calls = [];
  window.__calls = calls;
  const R = (data) => Promise.resolve({ success: true, data });
  // The real SDK (@wvdsh/sdk-js) validates every argument and answers
  // { success: false, message } on a mismatch. The one that bit: Terser's
  // booleans_as_integers made keepBest a 1, and the platform rejected every
  // upload. So this stub is exactly as strict as the real one for the
  // arguments the game sends.
  const F = (m) => { calls.push(['REJECTED', m]); return Promise.resolve({ success: false, data: null, message: m }); };
  const isId = (v) => typeof v === 'string' && v.length > 0;
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
    getOrCreateLeaderboard: (n, so, dt) => {
      if (typeof n !== 'string') return F('getOrCreateLeaderboard.name: expected string');
      if (![0, 1].includes(so)) return F('getOrCreateLeaderboard.sortOrder: expected LeaderboardSortOrder, got ' + so);
      if (![0, 1, 2, 3].includes(dt)) return F('getOrCreateLeaderboard.displayType: expected LeaderboardDisplayType, got ' + dt);
      calls.push(['getOrCreate', n]); return R({ id: 'lb-' + n });
    },
    listLeaderboardEntries: () => R([
      { globalRank: 1, username: 'ada', score: 99999 },
      { globalRank: 2, username: 'testrider', score: 4242 }]),
    getMyLeaderboardEntries: () => R([{ globalRank: 2, score: 4242 }]),
    uploadLeaderboardScore: (id, sc, keep, ugc, meta) => {
      if (!isId(id)) return F('uploadLeaderboardScore.leaderboardId: expected Id, got ' + typeof id);
      if (typeof sc !== 'number') return F('uploadLeaderboardScore.score: expected number, got ' + typeof sc);
      if (typeof keep !== 'boolean') return F('uploadLeaderboardScore.keepBest: expected boolean, got ' + typeof keep + ' ' + keep);
      if (ugc !== undefined && !isId(ugc)) return F('uploadLeaderboardScore.ugcId: expected Id');
      if (meta !== undefined && (typeof meta !== 'object' || Object.values(meta).some((v) => !['string', 'number'].includes(typeof v))))
        return F('uploadLeaderboardScore.metadata: values must be strings or numbers');
      calls.push(['upload', id, sc]); return R({ globalRank: 2, submittedRank: 7 });
    },
  };
};

console.log('\n=== published build: same game as the zip ===');
// (In-run coins are part of the competition game, so the marker for the
// banked total is the title screen's '   COINS ' readout, not 'COINS'.)
for (const mark of ['PRISM STORE', 'EQUIPPED', 'STARTIP', 'GLOBAL TOP 8', 'never steer', '   COINS ']) {
  ok(!lean.includes(mark), 'no "' + mark + '" in the published page');
}
ok(lean.includes('prismfall-score') && lean.includes('prismfall-depth'), 'leaderboard names are in the published page');
ok(full.includes('PRISM STORE') && full.includes('GLOBAL TOP 8'), 'the --full variant still carries the store and the board');

for (const withSdk of [0, 1]) {
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  if (withSdk) await page.addInitScript(SDK);
  await page.goto('http://localhost:8117/');
  await page.waitForTimeout(1200);
  const label = withSdk ? 'with stubbed SDK' : 'with NO SDK';
  console.log('\n=== published build ' + label + ' ===');
  ok(await page.evaluate(() => !!document.querySelector('canvas')), 'canvas exists');
  ok(await page.evaluate(() => { const c = document.querySelector('canvas'); return c.width > 0 && c.height > 0; }), 'canvas sized');
  // Play a run, then end it through pause -> QUIT RUN, which is the path a
  // real score submission takes.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(String((i % 7) + 1));
    await page.mouse.move(640, 420); await page.mouse.down();
    await page.mouse.move(720, 470, { steps: 3 }); await page.mouse.up();
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.mouse.click(640, 464);      // QUIT RUN
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => { try { return localStorage.pf26_save; } catch (e) { return ''; } });
  ok(/^\d+,\d+,\d$/.test(saved), 'three-field save, same record as the zip (' + saved + ')');
  if (withSdk) {
    const calls = await page.evaluate(() => window.__calls);
    const names = calls.map((c) => c[0]);
    ok(names.includes('init'), 'Wavedash.init() called', names.join(','));
    ok(names.includes('readyForEvents'), 'readyForEvents() called');
    ok(names.includes('loadComplete'), 'loadComplete() called');
    const boards = calls.filter((c) => c[0] === 'getOrCreate').map((c) => c[1]);
    ok(boards.length === 2 && boards.includes('prismfall-score') && boards.includes('prismfall-depth'), 'both leaderboards resolved', boards.join(','));
    ok(names.includes('presence'), 'presence published');
    const ups = calls.filter((c) => c[0] === 'upload');
    ok(ups.some((c) => c[1] === 'lb-prismfall-score' && c[2] > 0), 'the run\'s score was uploaded to the score board', ups.map((c) => c[1] + ':' + c[2]).join(' '));
    ok(ups.some((c) => c[1] === 'lb-prismfall-depth'), 'and its depth to the depth board');
    const rej = calls.filter((c) => c[0] === 'REJECTED');
    ok(rej.length === 0, 'no SDK call was rejected by argument validation', rej.map((c) => c[1]).join(' | '));
  }
  await page.mouse.click(640, 474);      // MENU
  await page.waitForTimeout(600);
  if (withSdk) await page.screenshot({ path: join(ROOT, 'reports', 'shots', 'wavedash-title.png') });
  ok(errs.length === 0, 'no console errors ' + label, errs.join(' | '));
  await page.close();
}

// The store lives in the --full variant only. Seeded with enough coins to
// afford everything, then every tile is clicked.
{
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(SDK);
  await page.goto('http://localhost:8116/');
  await page.waitForTimeout(600);
  await page.evaluate(() => { try { localStorage.pf26_save = '500,4000,0,9000,0,0,0,0,0'; } catch (e) {} });
  await page.reload();
  await page.waitForTimeout(900);
  console.log('\n=== --full variant: the store ===');
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
s1.close(); s2.close();
console.log(fail ? '\n' + fail + ' failed' : '\nall wavedash checks passed');
process.exit(fail ? 1 : 0);
