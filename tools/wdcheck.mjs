// Inspect the LIVE Wavedash build: which of our two builds actually shipped,
// whether the SDK is injected, and whether our leaderboard calls are firing.
//
//   node tools/wdcheck.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://wavedash.com/games/prismfall';
const b = await chromium.launch({ headless: true });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });

const docs = [];      // every HTML document fetched, with its body
const sdkHits = [];   // anything that looks like the SDK
page.on('response', async (r) => {
  const u = r.url();
  const ct = (r.headers()['content-type'] || '');
  if (/wvdsh|wavedash-sdk|sdk\.js/i.test(u)) sdkHits.push(u);
  if (!ct.includes('text/html')) return;
  try {
    const t = await r.text();
    docs.push({ url: u, len: t.length, wavedash: (t.match(/Wavedash/g) || []).length,
      prismfall: /PRISMFALL|prismfall/i.test(t), canvasA: /canvas id=a/.test(t) });
  } catch { /* opaque */ }
});
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 140)); });

await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(4000);

// The game is behind a play control on the store page; click whatever looks
// like it so the build actually loads and the SDK is injected.
for (const sel of ['text=/^play$/i', 'button:has-text("Play")', '[aria-label*="Play" i]', 'canvas']) {
  try {
    const el = await page.$(sel);
    if (el) { await el.click({ timeout: 4000 }); console.log('clicked: ' + sel); break; }
  } catch (e) { /* try the next one */ }
}
await page.waitForTimeout(9000);

console.log('=== HTML documents fetched ===');
for (const d of docs) {
  console.log('  ' + (d.prismfall ? '[GAME] ' : '       ') + d.url.slice(0, 96));
  console.log('         ' + d.len + ' B   "Wavedash" mentions: ' + d.wavedash +
    '   our canvas shell: ' + d.canvasA);
}
console.log('\n=== SDK-looking requests ===');
console.log(sdkHits.length ? sdkHits.map((u) => '  ' + u).join('\n') : '  none');

// Does the SDK global exist in the game frame?
console.log('\n=== frames ===');
for (const f of page.frames()) {
  let probe;
  try {
    probe = await f.evaluate(() => ({
      hasWavedash: typeof window.Wavedash !== 'undefined',
      keys: typeof window.Wavedash !== 'undefined'
        ? Object.keys(window.Wavedash).filter((k) => /leaderboard|init|user/i.test(k)).slice(0, 14)
        : [],
      hasCanvas: !!document.querySelector('canvas#a'),
    }));
  } catch (e) { probe = { err: String(e.message).slice(0, 60) }; }
  console.log('  ' + (f.url() || '(blank)').slice(0, 90));
  console.log('    ' + JSON.stringify(probe));
}

console.log('\n=== errors ===');
console.log(errs.length ? errs.map((e) => '  ' + e).join('\n') : '  none');
await b.close();
