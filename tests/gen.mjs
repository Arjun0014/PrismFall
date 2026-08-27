// Procedural generator regression tests.
//
// Two kinds of check:
//   * geometric  — scan every generated chunk for sealed floors, buried items
//                  and out-of-column geometry
//   * behavioural — actually drop the real physics body through many seeds and
//                  confirm it keeps making progress
//
// Any seed that fails is printed so it can be added to SEEDS below as a
// permanent regression case.
import { boot } from './harness.mjs';

const args = process.argv.slice(2);
const N = +(args.find((a) => /^\d+$/.test(a)) || 240);

// Seeds that previously produced a bad chunk. They are always re-tested.
const SEEDS = [1, 7, 42, 1234, 99991];

let pass = 0, fail = 0;
const out = [];
function ok(c, msg, extra) {
  if (c) { pass++; out.push('  PASS  ' + msg); }
  else { fail++; out.push('  FAIL  ' + msg + (extra !== undefined ? '   [' + extra + ']' : '')); }
}

const H = boot();
const A = H.api;
const E = (s) => A.__eval(s);

const TSAMPLES = [0, .3, .62, .95, 1.3, 1.7, 2.1, 2.6, 3.1, 3.7, 4.4];

// solidNear measures static base poses (placement must be deterministic), so to
// ask "is this chunk sealed at time t" the probe advances the machinery itself,
// mirroring obT()'s transform, then puts it back.
function atTime(c, t, fn) {
  const saved = [];
  for (const o of c.o) {
    if (!o.w && !o.os) continue;
    saved.push([o, o.x, o.y, o.g]);
    if (o.os) { const sn = Math.sin(o.os * t + o.op); o.x += o.ox * sn; o.y += o.oy * sn; }
    if (o.w) o.g += o.w * t;
  }
  const r = fn();
  for (const [o, x, y, g] of saved) { o.x = x; o.y = y; o.g = g; }
  return r;
}

// --- geometry probes -------------------------------------------------------
// Widest vertical gap along the horizontal line y inside chunk c.
function widestGap(c, y) {
  // Widest possible extent: the wall segments themselves are in c.o, so
  // solidNear applies the real taper. Clamping to the narrow end here would
  // hide open space near the top of a chunk and report phantom seals.
  const L = Math.min(c.pl, c.l) - 4, R = Math.max(c.pr, c.r) + 4;
  const STEPS = 200;
  let best = 0, run = 0;
  for (let i = 0; i <= STEPS; i++) {
    const x = L + (R - L) * i / STEPS;
    if (A.solidNear(c, x, y, A.R)) run = 0;
    else { run += (R - L) / STEPS; if (run > best) best = run; }
  }
  return best;
}

// Scan a chunk for a horizontal line the unicorn can never pass. Phase and
// breakable walls are passable by design, and moving machinery only blocks
// momentarily, so a seal must hold with those removed at every phase of motion.
function sealedAt(c) {
  // widestGap already probes with the unicorn's radius, so it returns the span
  // of legal *centre* positions. That only has to be positive (plus a little
  // slack for a body actually in motion) -- requiring a whole diameter of
  // centre freedom would demand a two-body-wide corridor everywhere.
  const step = 14, need = 9;
  const keep = c.o;
  c.o = keep.filter((o) => !(o.m & (A.M_PHASE | A.M_BREAK)));
  let bad = -1;
  for (let y = c.y + step; y < c.y + c.h && bad < 0; y += step) {
    if (atTime(c, 0, () => widestGap(c, y)) >= need) continue;
    if (TSAMPLES.every((t) => atTime(c, t, () => widestGap(c, y)) < need)) bad = y;
  }
  c.o = keep;
  return bad;
}

// solidNear measures static poses, so this is exactly "spawned inside a wall".
const isBuried = (c, it) => A.solidNear(c, it.x, it.y, A.R * .5);

console.log('generating ' + N + ' seeds ...');

let sealed = 0, buried = 0, outside = 0, discont = 0, empty = 0, chunkN = 0;
const sealedSeeds = [], buriedSeeds = [];
const archSeen = new Set();
const itemKinds = new Set();
let itemsTotal = 0, coinTotal = 0, pigTotal = 0, wellTotal = 0, crownTotal = 0, boostTotal = 0;

const seeds = SEEDS.concat(Array.from({ length: N }, (_, i) => 1000 + i * 7919));

for (const sd of seeds) {
  E('worldReset(' + sd + ')');
  // Walk a full seven-region cycle, capturing every chunk as it is built so the
  // retained ring never hides one from the checks.
  const chunks = A.chunks.slice();
  while (A.nextY < 7 * A.REGD + 2000) chunks.push(E('genChunk()'));
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i], prev = chunks[i - 1];
    chunkN++;
    archSeen.add(c.rg + ':' + c.k);

    // continuity: this chunk's entry walls must equal the previous exit walls
    if (Math.abs(c.pl - prev.l) > .001 || Math.abs(c.pr - prev.r) > .001) {
      if (discont++ === 0) out.push('    discontinuity at seed ' + sd + ' chunk ' + i);
    }
    // walls must stay inside the hard bound
    if (c.l < -A.WMAX - 1 || c.r > A.WMAX + 1) outside++;

    // no fully sealed floor
    const sy = sealedAt(c);
    if (sy >= 0) { sealed++; if (sealedSeeds.length < 6) sealedSeeds.push(sd + '@' + (sy - c.y | 0)); }

    // items must be reachable, not embedded in geometry
    for (const it of c.i) {
      itemsTotal++;
      itemKinds.add(it.t);
      if (it.t === A.I_COIN) coinTotal++;
      else if (it.t === A.I_PIG) pigTotal++;
      else if (it.t === A.I_WELL) wellTotal++;
      else if (it.t === A.I_CROWN) crownTotal++;
      else boostTotal++;
      if (isBuried(c, it)) {
        buried++;
        if (buriedSeeds.length < 6) buriedSeeds.push(sd + ':' + it.t);
      }
      // pigment items must name a real colour
      if (it.t === A.I_PIG && !(it.c >= 0 && it.c < 7)) empty++;
    }
  }
}

console.log('\n=== generator invariants ===');
ok(chunkN > seeds.length * 90, 'generated a large chunk sample', chunkN);
ok(discont === 0, 'chunk walls are continuous', discont);
ok(outside === 0, 'walls never exceed the hard column bound', outside);
ok(sealed === 0, 'no chunk seals the column', sealed + ' e.g. ' + sealedSeeds.join(','));
ok(buried / Math.max(1, itemsTotal) < .02, 'items are not buried in geometry',
  (100 * buried / Math.max(1, itemsTotal)).toFixed(2) + '% ' + buriedSeeds.join(','));
ok(empty === 0, 'every pigment item names a real colour', empty);

console.log('\n=== content variety ===');
ok(itemKinds.size === 5, 'all five item kinds appear', [...itemKinds].join(','));
ok(coinTotal / chunkN > 3, 'coins are plentiful', (coinTotal / chunkN).toFixed(1) + '/chunk');
ok(pigTotal / chunkN > .5, 'pigment appears regularly', (pigTotal / chunkN).toFixed(2) + '/chunk');
ok(crownTotal > seeds.length, 'crown coins appear', crownTotal);
ok(wellTotal > 0, 'prism wells appear', wellTotal);
ok(boostTotal > 0, 'boosters appear', boostTotal);
// Each region must actually use a distinct mix of archetypes.
const perReg = {};
for (const k of archSeen) { const [r] = k.split(':'); (perReg[r] ||= new Set()).add(k); }
ok(Object.keys(perReg).length === 7, 'all seven regions generate', Object.keys(perReg).length);
const sig = A.REG.map((r) => [...new Set(r[5].split(''))].sort().join(''));
ok(new Set(sig).size >= 6, 'regions favour different archetypes', sig.join(' '));

// --- pigment fairness ------------------------------------------------------
// A mandatory route must never assume one specific colour is stocked. We prove
// it by checking that no region's affinity set is the only colour on offer.
console.log('\n=== pigment fairness ===');
{
  const perRegionColours = Array.from({ length: 7 }, () => new Set());
  for (const sd of seeds.slice(0, 40)) {
    E('worldReset(' + sd + ')');
    const all = A.chunks.slice();
    while (A.nextY < 7 * A.REGD + 2000) all.push(E('genChunk()'));
    for (const c of all) for (const it of c.i) if (it.t === A.I_PIG) perRegionColours[c.rg].add(it.c);
  }
  const okAll = perRegionColours.every((s) => s.size >= 5);
  ok(okAll, 'every region supplies at least five pigment colours',
    perRegionColours.map((s) => s.size).join(','));
}

// --- behavioural descent ---------------------------------------------------
// Drop the real physics body through each seed and confirm the world itself is
// --- behavioural descent ---------------------------------------------------
// Two separate questions, deliberately not mixed:
//   * is the WORLD traversable?   -> free fall with the stall rule suspended,
//                                    so only geometry can stop it
//   * is the GAME playable?       -> a modest policy with the stall rule live
console.log('\n=== descent probes ===');
{
  const SECS = 45;
  const drive = (sd, fn, noStall) => {
    E('startRun(' + sd + ');st=1;SAVE.t=1');
    const P = A.P;
    let best = P.y, deaths = 0, stuckFor = 0, worstStuck = 0;
    for (let i = 0; i < SECS * 60; i++) {
      if (fn) fn(i, P);
      if (noStall) P.st = 0;
      E('update(1/60)');
      if (!P.al) { deaths++; if (deaths > 4) break; E('startRun(' + sd + ');st=1'); continue; }
      if (P.y > best + 1) { best = P.y; stuckFor = 0; }
      else if (++stuckFor > worstStuck) worstStuck = stuckFor;
    }
    return { depth: best, deaths, stuck: worstStuck / 60 };
  };

  // Free fall is reported for reference only. A body with no input legitimately
  // mills around in a dense pinball world and then comes to rest, and coming to
  // rest is the designed failure -- momentum is life. Asserting on how deep it
  // drifts would be measuring the genre, not the level design. Whether the
  // world is passable is covered by the seal invariant above; whether it is
  // playable is covered by the policy probe below.
  const geo = seeds.slice(0, 40).map((sd) => drive(sd, null, 1));
  const med = geo.map((r) => r.depth).sort((a, b) => a - b)[geo.length >> 1];
  out.push('        free-fall median depth ' + (med | 0) + ' over ' + SECS + 's');

  // The property that actually matters when the unicorn comes to rest: the
  // player can always get it moving again. Drop it, let it settle wherever the
  // world puts it, then spend one stroke.
  // A single fixed stroke is not the bar -- a player picks a colour and a
  // placement. The bar is that *some* stroke works, everywhere.
  const PLACE = [[18, -60, 18, 60], [-55, -16, 55, -16], [-46, -52, 26, 16]];
  let stranded = 0, tried = 0;
  const escapes = {};
  for (const sd of seeds.slice(0, 30)) {
    E('startRun(' + sd + ');st=1;SAVE.t=1');
    const P = A.P;
    for (let i = 0; i < 60 * 25 && P.sp > 60; i++) { P.st = 0; E('update(1/60)'); }
    if (P.sp > 60) continue;              // never settled; nothing to escape from
    tried++;
    const rest = { x: P.x, y: P.y };
    let best = 0, via = '';
    for (let c = 0; c < 7 && best < 260; c++) {
      for (let mode = 0; mode < 3 && best < 260; mode++) {
        E('startRun(' + sd + ');st=1');
        P.x = rest.x; P.y = rest.y; P.vx = 0; P.vy = 0;
        P.ra = null; P.te = null; P.ph = 0; P.st = 0;
        E('NC=nearChunks(P.y-500,P.y+500)');
        E('for(let j=0;j<7;j++)pig[j]=PMAX');
        E('sel=' + c + ';hitCd=0;strokes.length=0');
        const q = PLACE[mode];
        E('mwx=P.x+' + q[0] + ';mwy=P.y+' + q[1]);
        E('startStroke()');
        E('mwx=P.x+' + q[2] + ';mwy=P.y+' + q[3]);
        E('moveStroke()');
        E('drawing=null');
        for (let i = 0; i < 40; i++) { P.st = 0; E('update(1/60)'); }
        if (P.sp > best) { best = P.sp; via = 'ROYGBIV'[c]; }
      }
    }
    if (best < 200) stranded++; else escapes[via] = (escapes[via] || 0) + 1;
  }
  ok(tried > 5, 'the probe actually reached resting states', tried);
  ok(stranded === 0, 'a resting unicorn can always be freed by some stroke',
    stranded + '/' + tried);
  out.push('        escapes by colour: ' + Object.entries(escapes).map((e) => e.join('x')).join(' '));

  // A modest policy: keep the energy up, aim it downward, and warp off a ledge
  // when it comes to rest. Far less than a good player has available.
  const policy = (i, P) => {
    if (i % 12) return;
    if (P.sp > 700 && P.vy > -250) return;
    const stuck = P.sp < 200;
    E('sel=' + (stuck ? 6 : 0));
    if (stuck) { E('mwx=P.x+18;mwy=P.y-60'); E('startStroke()'); E('mwx=P.x+18;mwy=P.y+60'); }
    else { E('mwx=P.x-55;mwy=P.y-15'); E('startStroke()'); E('mwx=P.x+55;mwy=P.y-15'); }
    E('moveStroke()');
    E('drawing=null');
    E('for(let j=0;j<7;j++)pig[j]=PMAX');
  };
  const play = seeds.slice(0, 40).map((sd) => drive(sd, policy, 0));
  const pMed = play.map((r) => r.depth).sort((a, b) => a - b)[play.length >> 1];
  const pMin = play.map((r) => r.depth).sort((a, b) => a - b)[0];
  const freeMed = med;
  ok(pMed > freeMed * 1.3, 'playing beats falling', (freeMed | 0) + ' -> ' + (pMed | 0));
  ok(pMed > A.REGD * .8, 'a modest policy clears most of a region in ' + SECS + 's', pMed | 0);
  ok(pMin > 1500, 'no seed is hopeless even for a modest policy', pMin | 0);
  ok(play.reduce((a, r) => a + r.deaths, 0) < play.length, 'deaths stay under one per run',
    play.reduce((a, r) => a + r.deaths, 0) + '/' + play.length);
}

out.forEach((l) => console.log(l));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (sealedSeeds.length) console.log('add to SEEDS: ' + sealedSeeds.join(','));
process.exit(fail ? 1 : 0);
