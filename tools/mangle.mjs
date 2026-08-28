// Compression-aware identifier naming.
//
//   node tools/mangle.mjs              alphabet families, then a hill-climb
//   node tools/mangle.mjs --survey     families only, no climb
//   node tools/mangle.mjs --climb=300
//
// Terser picks mangled names from a 54-character alphabet that it sorts by how
// often each character already appears in the source. That is exactly right for
// a Huffman-coded stream: skew the histogram and the common symbols get short
// codes. It is not obviously right for a context-mixing coder, which cares
// about how PREDICTABLE the next character is given the last few, not about how
// often it occurs overall.
//
// So this searches the alphabet instead of assuming it. Mangling is the safest
// transformation available -- Terser guarantees the names are unique, non-
// reserved and non-shadowing whatever alphabet it draws from -- which makes
// this a free variable with zero gameplay risk.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { score, competitionTerser, rrOptions } from './measure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

const FULL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_';
const DIGITS = '0123456789';

// The generator itself lives in build.mjs, so what is searched here is exactly
// what ships. Workers rebuild it from the two alphabet strings.
export { nameGen as nth } from './build.mjs';
import { nameGen as nth } from './build.mjs';

if (!isMainThread) {
  const { raw, rr, id } = workerData;
  parentPort.on('message', async (msg) => {
    try {
      const cfg = competitionTerser(
        msg.lead === null
          ? { mangle: { nth_identifier: undefined } }   // Terser's own frequency-sorted base54
          : { mangle: { nth_identifier: nth(msg.lead, msg.tail || msg.lead + DIGITS) } });
      const s = await score(raw, cfg, rr, id + '-' + msg.seq);
      parentPort.postMessage({ seq: msg.seq, ...s });
    } catch (e) {
      parentPort.postMessage({ seq: msg.seq, zip: Infinity, min: 0, err: String(e && e.message || e) });
    }
  });
  parentPort.postMessage({ ready: 1 });
}

if (isMainThread) {
  const { bundle } = await import('./src.mjs');
  const args = process.argv.slice(2);
  const SURVEY = args.includes('--survey');
  const CLIMB = +((args.find((a) => a.startsWith('--climb=')) || '').slice(8)) || 240;
  const JOBS = +((args.find((a) => a.startsWith('--jobs=')) || '').slice(7)) || 4;
  const raw = bundle(false);
  const rr = rrOptions();

  const pool = [];
  for (let i = 0; i < JOBS; i++) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { raw, rr, id: 'm' + i } });
    w.unref(); pool.push({ w, busy: 0 });
  }
  let seq = 0;
  const pending = new Map();
  for (const s of pool) s.w.on('message', (m) => {
    if (m.ready) return;
    const cb = pending.get(m.seq); pending.delete(m.seq); s.busy = 0; if (cb) cb(m);
  });
  const submit = (lead, tail) => new Promise((res) => {
    const tick = () => {
      const s = pool.find((x) => !x.busy);
      if (!s) { setTimeout(tick, 15); return; }
      s.busy = 1; const id = seq++; pending.set(id, res);
      s.w.postMessage({ seq: id, lead, tail });
    };
    tick();
  });

  // ---- families -----------------------------------------------------------
  const fam = [['terser default (frequency-sorted)', null, null],
    ['shipping alphabet', 'YBCDEFHIJKLMNOPQSVTURWXAZ', null]];
  fam.push(['fixed order, no frequency sort', FULL, FULL + DIGITS]);
  fam.push(['fixed order, letters only in tail', FULL, FULL]);
  fam.push(['reversed', [...FULL].reverse().join(''), [...FULL].reverse().join('') + DIGITS]);
  // Restricting the alphabet makes names LONGER but draws them from a smaller
  // set. On the standing measurement -- repeated text ~8.5 chars per archive
  // byte, novel text ~1.8 -- that trade is not obviously bad, so measure it.
  for (const k of [2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25, 26, 27, 28, 30, 32, 40, 54])
    fam.push(['first ' + k + ' chars', FULL.slice(0, k), FULL.slice(0, k) + DIGITS]);
  // The tail alphabet is a separate axis: it only shows up from the 27th name
  // onward, but that is where most of a 2,000-identifier program lives.
  for (const k of [20, 24, 26, 30])
    fam.push([k + ' lead / no digits', FULL.slice(0, k), FULL.slice(0, k)]);
  fam.push(['26 lead / 54 tail', FULL.slice(0, 26), FULL]);
  fam.push(['26 lead / 62 tail', FULL.slice(0, 26), FULL + DIGITS]);
  fam.push(['26 lead / 36 tail rev', FULL.slice(0, 26), [...(FULL.slice(0, 26) + DIGITS)].reverse().join('')]);
  fam.push(['26 upper lead', FULL.slice(26, 52), FULL.slice(26, 52) + DIGITS]);
  // Vowel/consonant splits change how identifier text reads against the
  // surrounding keywords, which is what a context model actually sees.
  fam.push(['vowels first', 'aeiouAEIOU' + FULL.replace(/[aeiouAEIOU]/g, ''), null]);
  fam.push(['consonants first', FULL.replace(/[aeiouAEIOU]/g, '') + 'aeiouAEIOU', null]);
  fam.push(['uppercase first', FULL.slice(26, 52) + FULL.slice(0, 26) + '$_', null]);
  fam.push(['$_ first', '$_' + FULL.slice(0, 52), null]);

  console.log('scoring ' + fam.length + ' alphabet families\n');
  const rows = await Promise.all(fam.map(([label, lead, tail]) =>
    submit(lead, tail).then((r) => ({ label, lead, tail, ...r }))));
  const base = rows[0];
  rows.sort((a, b) => a.zip - b.zip);
  for (const r of rows) {
    if (!isFinite(r.zip)) { console.log('  ' + r.label.padEnd(34) + ' ERROR ' + String(r.err).slice(0, 50)); continue; }
    const d = r.zip - base.zip;
    console.log('  ' + r.label.padEnd(34) + String(r.zip).padStart(7) + '  ' + (d > 0 ? '+' : '') + d + '   min ' + r.min);
  }

  let best = rows[0];
  console.log('\nbest family: ' + best.label + '  ' + best.zip + ' (' + (best.zip - base.zip) + ')');
  if (SURVEY || best.lead === null) {
    writeFileSync(p('reports', 'mangle.json'), JSON.stringify({ base: base.zip, best }, null, 1));
    for (const s of pool) s.w.terminate();
    process.exit(0);
  }

  // ---- hill-climb over the alphabet ---------------------------------------
  // Neighbourhood: swap two positions, substitute a character for one not in
  // use, drop a character, or add one. Length is part of the search because the
  // family survey came out strongly non-monotonic in it (22 chars beat 24, 25,
  // 26 and 27), which is the signature of a rugged landscape rather than a
  // smooth trade -- so the ordering matters at least as much as the size.
  //
  // Every candidate is a valid alphabet by construction: Terser guarantees
  // uniqueness, skips reserved words and avoids shadowing whatever it draws
  // from, so nothing in this loop can produce an invalid program.
  console.log('\nhill-climbing the alphabet (' + CLIMB + ' probes)');
  let lead = best.lead, bestZip = best.zip, bestLead = best.lead;
  const PATIENCE = 30;
  const tailOf = (l) => l + DIGITS;
  let sinceWin = 0;
  const BATCH = JOBS;
  const neighbour = (l) => {
    const a = [...l];
    const unused = [...FULL].filter((c) => !a.includes(c));
    const move = Math.random();
    if (move < 0.45 && a.length > 1) {                       // swap
      const x = Math.random() * a.length | 0;
      let y = Math.random() * a.length | 0;
      if (x === y) y = (y + 1) % a.length;
      [a[x], a[y]] = [a[y], a[x]];
    } else if (move < 0.75 && unused.length) {               // substitute
      a[Math.random() * a.length | 0] = unused[Math.random() * unused.length | 0];
    } else if (move < 0.88 && a.length > 2) {                // drop
      a.splice(Math.random() * a.length | 0, 1);
    } else if (unused.length) {                              // insert
      a.splice(Math.random() * (a.length + 1) | 0, 0, unused[Math.random() * unused.length | 0]);
    }
    return a.join('');
  };

  const seen = new Set([lead]);
  for (let i = 0; i < CLIMB; i += BATCH) {
    const cands = [];
    let guard = 0;
    while (cands.length < BATCH && guard++ < 200) {
      const nl = neighbour(lead);
      if (!seen.has(nl)) { seen.add(nl); cands.push(nl); }
    }
    if (!cands.length) break;
    const res = await Promise.all(cands.map((nl) =>
      submit(nl, tailOf(nl)).then((r) => ({ nl, ...r }))));
    res.sort((x, y) => x.zip - y.zip);
    if (res[0].zip < bestZip) {
      console.log('  ' + String(i).padStart(4) + '  ' + bestZip + ' -> ' + res[0].zip +
        '  (' + res[0].nl.length + ') ' + res[0].nl);
      bestZip = res[0].zip; lead = bestLead = res[0].nl; sinceWin = 0;
    } else if (res[0].zip === bestZip && Math.random() < .5) {
      // Drift across ties. Equal-scoring alphabets are common and are the only
      // way off a plateau in a landscape this rugged; the best score is kept
      // separately so drifting can never make the result worse.
      lead = res[0].nl; sinceWin++;
      if (sinceWin > PATIENCE) { console.log('  plateau at ' + bestZip + ' after ' + i + ' probes'); break; }
    } else if (++sinceWin > PATIENCE) { console.log('  plateau at ' + bestZip + ' after ' + i + ' probes'); break; }
  }

  console.log('\nfinal ' + bestZip + '  (terser default ' + base.zip + ', delta ' + (bestZip - base.zip) + ')');
  console.log('lead: ' + JSON.stringify(lead));
  writeFileSync(p('reports', 'mangle.json'),
    JSON.stringify({ base: base.zip, zip: bestZip, lead, tail: tailOf(lead) }, null, 1));
  for (const s of pool) s.w.terminate();
  process.exit(0);
}
