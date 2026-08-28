// Fetch the js13kGames rules page. The page renders client-side, so a plain
// HTTP fetch returns only the shell; this drives a real browser and dumps the
// rendered text.
//   node tools/fetchrules.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://js13kgames.com/2026/rules';
const b = await chromium.launch({ headless: true });
const page = await b.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);
const text = await page.evaluate(() => {
  const el = document.querySelector('main') || document.querySelector('article') || document.body;
  return el.innerText.replace(/\n{3,}/g, '\n\n');
});
console.log('=== ' + page.url() + ' ===');
console.log(text);
await b.close();
