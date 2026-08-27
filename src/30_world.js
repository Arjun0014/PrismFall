// ---------------------------------------------------------------------------
// World: region table, chunk grammar, obstacle + reward generation.
//
// The world is a ring of vertical chunks. Every chunk picks an archetype from
// its region's weight string and decorates it with region material bias, so
// world identity is systematic instead of seven separate generators.
// ---------------------------------------------------------------------------

// Archetype ids used inside the region weight strings. Funnel and Sieve are
// the same builder with different parameters, so seven situations cost six.
// 0 PEG  1 FUNNEL  2 BOWL  3 SHAFT  4 ROTOR  5 SIEVE  6 CHAMBER

// Region row — deliberately tiny. Everything a region needs beyond these five
// numbers is derived, which costs far fewer compressed bytes than a table:
//   0 name
//   1 base hue        background gradient starts here
//   2 hue spread      gradient end + geometry hue are offsets from the base
//   3 geometry light
//   4 background light
//   5 archetype weights (one char per draw), straight from the world spec
//   6 filler density  extra scattered geometry per chunk
// Affinity colours come from AFF, music from formulas in 60_audio.js.
// 0 PEG  1 FUNNEL  2 BOWL  3 SHAFT  4 ROTOR  5 SIEVE  6 CHAMBER
const REG = [
  // peg fields, wide gaps, bumpers, gentle funnels
  ['CLOUDBREAK', 206, 74, 88, 26, '0001002105', 5],
  // breakable panels, crushers, rotors, moving gates
  ['SUNFORGE', 12, 34, 72, 19, '4414564146', 6],
  // tether anchors, circular chambers, spring pods
  ['VERDANT COIL', 152, -74, 74, 17, '2262262622', 7],
  // long guide rails, narrow shafts, S-curves, precision exits
  ['CRYSTAL CURRENT', 190, 44, 84, 15, '3335331353', 5],
  // breakable shortcuts, hidden rooms, phase barriers, high reward density
  ['PRISM MINE', 276, -28, 62, 10, '6616065166', 8],
  // gravity inversion chambers, phase walls, looping routes
  ['INVERSION TEMPLE', 264, 52, 80, 13, '6462646326', 6],
  // compound rooms built from every prior geometry
  ['RAINBOW ENGINE', 300, -136, 90, 9, '0123456246', 8],
];
// Material bias per region: [break, phase, damp, bump, move] as hex nibbles/16.
const BIAS = [0x00193, 0x80149, 0x10275, 0x01243, 0xa5324, 0x2a336, 0x63359];
// Two affinity colours per region, one digit each, straight from the world spec:
// Cloudbreak O+Y, Sunforge R+O, Verdant G+Y, Crystal B+O, Mine R+V, Temple I+V.
const AFF = '120132410656';
const regHue = (r) => REG[r][1];
const bias = (r) => BIAS[r];
const bit = (b, i) => (b >> (16 - i * 4) & 15) / 16;
// The Rainbow Engine's affinity is "all colours", so it rolls fresh each time.
const aff = (r) => r > 5 ? [ri(0, 6), ri(0, 6)] : [+AFF[r * 2], +AFF[r * 2 + 1]];

let nextY = 0, prevL = -COL, prevR = COL, cIdx = 0, seed = 1;
let vault = null;   // chunk currently focusing the camera

// --- obstacle constructors (t: 0 circle, 1 segment, 2 arc) ------------------
const ci = (x, y, r, m, e) => Object.assign({ t: 0, x, y, r, m: m | 0 }, e);
const sg = (x, y, L, g, m, e) => Object.assign({ t: 1, x, y, L, g, m: m | 0 }, e);
// segment from A to B
const sgAB = (ax, ay, bx, by, m, e) =>
  sg((ax + bx) / 2, (ay + by) / 2, hyp(bx - ax, by - ay) / 2, at2(by - ay, bx - ax), m, e);

const item = (t, x, y, c) => ({ t, x, y, c: c | 0, g: 0 });

// Arcs are built from straight segments, so the collision kernel only ever
// deals with circles and segments — and the facets suit the geometric look.
function arcSegs(c, x, y, r, a0, a1, m) {
  const n = mx(3, (a1 - a0) * r / 80 | 0);
  for (let i = 0; i < n; i++) {
    const b0 = lerp(a0, a1, i / n), b1 = lerp(a0, a1, (i + 1) / n);
    c.o.push(sgAB(x + cos(b0) * r, y + sin(b0) * r, x + cos(b1) * r, y + sin(b1) * r, m));
  }
}

// --- current transform of an obstacle --------------------------------------
// Results land in scratch globals to avoid per-frame allocation.
let _cx = 0, _cy = 0, _cvx = 0, _cvy = 0, _cg = 0;
function obT(o) {
  _cx = o.x; _cy = o.y; _cvx = 0; _cvy = 0; _cg = o.g;
  if (o.os) {
    const p = o.os * T + o.op, s = sin(p), c = cos(p) * o.os;
    _cx += o.ox * s; _cy += o.oy * s;
    _cvx = o.ox * c; _cvy = o.oy * c;
  }
  if (o.w) _cg += o.w * T;
}
// Surface velocity of obstacle o at world point (px,py).
function obVel(o, px, py) {
  if (o.w) { _cvx += -o.w * (py - _cy); _cvy += o.w * (px - _cx); }
}

// --- material roll ---------------------------------------------------------
function mat(b, allowBreak) {
  return rp(bit(b, 2)) ? M_DAMP
    : allowBreak && rp(bit(b, 0)) ? M_BREAK
      : rp(bit(b, 1)) ? M_PHASE
        : rp(bit(b, 3)) ? M_BUMP : 0;
}
// Optional motion decoration: a straight oscillation along a random axis.
function moving(b, amp) {
  if (!rp(bit(b, 4))) return null;
  const a = rf(0, TAU);
  return { ox: cos(a) * amp, oy: sin(a) * amp * .6, os: rf(.7, 2.1), op: rf(0, TAU) };
}

// --- region helpers --------------------------------------------------------
const regAt = (y) => { const i = flr(mx(y, 0) / REGD); return i < 7 ? i : i % 7; };
const loopAt = (y) => flr(flr(mx(y, 0) / REGD) / 7);
const difAt = (y) => clamp(flr(mx(y, 0) / REGD) * .085 + loopAt(y) * .3, 0, 2.4);

// --- solidity probe --------------------------------------------------------
// Deliberately measured against each obstacle's *base* pose, not its animated
// one: placement has to be deterministic for a seed, and a moving arm sweeping
// over a coin is the intended risk rather than a bad spawn.
function solidNear(c, x, y, rad) {
  for (const o of c.o) {
    if (!o.t) { if (hyp(x - o.x, y - o.y) < o.r + rad) return 1; continue; }
    const cg = cos(o.g) * o.L, sg2 = sin(o.g) * o.L;
    const ax = o.x - cg, ay = o.y - sg2;
    const t = segT(ax, ay, o.x + cg, o.y + sg2, x, y);
    if (hyp(x - (ax + cg * 2 * t), y - (ay + sg2 * 2 * t)) < ST + rad) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Chunk generation
// ---------------------------------------------------------------------------
function genChunk() {
  const y = nextY;
  const rg = regAt(y), dif = difAt(y), b = bias(rg);
  const boundary = flr((y + 1400) / REGD) > flr(y / REGD) && y > 200;

  // Wall profile: side pockets widen the column, shafts narrow it.
  const wide = rp(.26) ? 120 : 0;
  const l = clamp(-COL + rf(-90, 70) - wide, -WMAX, -300);
  const r = clamp(COL + rf(-70, 90) + wide, 300, WMAX);
  const h = boundary ? 1240 : ri(760, 1080);

  const c = { y, h, l, r, pl: prevL, pr: prevR, o: [], i: [], rg, k: 0, v: 0 };

  // Walls, drawn as chunk-to-chunk segments so the column is continuous.
  c.o.push(sgAB(prevL, y, l, y + h, 0), sgAB(prevR, y, r, y + h, 0));

  const L = mx(prevL, l) + 30, Rr = mn(prevR, r) - 30, wdt = Rr - L, cx = (L + Rr) / 2;

  if (boundary) buildGate(c, L, Rr, rg, dif);
  else if (cIdx > 2 && rp(.1)) { c.v = 1; buildVault(c, L, Rr, rg); }
  else {
    const k = +REG[rg][5][ri(0, 9)];
    c.k = k;
    if (k === 1 || k === 5)
      barrier(c, L, Rr, wdt, b, dif, k > 1 ? ri(2, 3) : 1, k > 1 ? rf(0, 26) : rf(120, 210),
        c.y + c.h * rf(.34, .6), 0);
    else [pegField, 0, bowl, shaft, rotor, 0, chamber][k](c, L, Rr, wdt, cx, b, dif);
    decorate(c, L, Rr, b, REG[rg][6] + (dif * 1.6 | 0));
    rewards(c, L, Rr, rg, dif);
  }

  // Nothing is allowed to spawn inside solid geometry, whichever builder placed it.
  c.i = c.i.filter((it) => !solidNear(c, it.x, it.y, R * .6));

  prevL = l; prevR = r; nextY = y + h; cIdx++;
  chunks.push(c);
  if (chunks.length > CHUNKS) chunks.shift();
  return c;
}

// Region-flavoured filler. Every archetype leaves gaps; this scatters small
// interactive geometry into them so a screen always has something to hit,
// which is what makes the game read as pinball rather than as empty shafts.
// It refuses any spot that would crowd existing geometry, so it can never seal
// a route it did not create.
function decorate(c, L, Rr, b, n) {
  // Keep trying until the quota is met: shaft and rotor chunks reject most
  // candidates, and those are exactly the chunks that read as empty.
  for (let tries = n * 6; n > 0 && tries--;) {
    const x = rf(L + 44, Rr - 44), y = c.y + rf(.07, .93) * c.h;
    const cir = rp(.58), rad = rf(13, 25), hl = rf(30, 76), a = rf(0, PI);
    // Every extremity must clear existing geometry by more than the unicorn's
    // diameter. That keeps the filler from ever closing a route: splitting a
    // wide gap in two still leaves both halves passable.
    const need = 48 + (cir ? rad : ST);
    if (solidNear(c, x, y, need)) continue;
    if (!cir) {
      const dx = cos(a) * hl, dy = sin(a) * hl;
      if (solidNear(c, x + dx, y + dy, need) || solidNear(c, x - dx, y - dy, need)) continue;
    }
    n--;
    c.o.push(cir
      ? ci(x, y, rad, mat(b, 0) | (rp(.42) ? M_BUMP : 0), moving(b, 74))
      : sg(x, y, hl, a, mat(b, 1) | (rp(.2) ? M_ANCH : 0), moving(b, 62)));
  }
}

// --- archetypes ------------------------------------------------------------
function pegField(c, L, Rr, wdt, cx, b, dif) {
  const rows = ri(4, 6), gap = c.h / (rows + 1);
  for (let r = 0; r < rows; r++) {
    const yy = c.y + gap * (r + 1), n = ri(4, 7);
    for (let i = 0; i < n; i++) {
      const t = (i + (r & 1 ? .5 : 0)) / (n - .35);
      c.o.push(ci(L + 44 + t * (wdt - 88), yy, rf(14, 27),
        mat(b, 0) | (rp(.3) ? M_BUMP : 0), moving(b, 60)));
    }
  }
}

// One builder covers both the Funnel and the Sieve: a wall across the column
// with n openings. `drop` slopes the outer ends up and the gap edges down,
// which turns a flat sieve into a converging funnel.
function barrier(c, L, Rr, wdt, b, dif, n, drop, yy, quiet) {
  const m = mat(b, 1), cuts = [];
  for (let i = 0; i < n; i++) cuts.push(L + (i + rf(.25, .75)) * wdt / n);
  let px = L - 20, py = yy - drop;
  for (let i = 0; i <= n; i++) {
    const last = i === n;
    const gw = mx(100, rf(125, 195) - dif * 16);
    const nx = last ? Rr + 20 : cuts[i] - gw / 2, ny = last ? yy - drop : yy + drop;
    if (nx - px > 24) c.o.push(sgAB(px, py, nx, ny, m));
    if (!last && drop > 40 && rp(.6)) c.o.push(ci(nx, ny, 15, M_BUMP));
    px = last ? nx : cuts[i] + gw / 2;
    py = yy + drop;
  }
  if (quiet) return;
  // Coins below the easiest gap, the prize above the least convenient one.
  for (let i = 0; i < 4; i++) c.i.push(item(I_COIN, cuts[0] + rf(-26, 26), yy + drop + 70 + i * 46));
  c.i.push(item(rp(.35) ? I_PIG : I_CROWN, cuts[n - 1], yy - drop - 70, pick(aff(c.rg))));
}

function bowl(c, L, Rr, wdt, cx, b, dif) {
  const r = mn(wdt * .42, 280), bx = cx + rf(-.2, .2) * wdt, by = c.y + c.h * .58;
  const rim = r * cos(.12 * PI);
  arcSegs(c, bx, by, r, .12 * PI, .88 * PI, rp(.35) ? M_DAMP : 0);
  c.o.push(ci(bx - rim, by, 15, M_BUMP), ci(bx + rim, by, 15, M_BUMP));
  // Something worth the risk of dropping in.
  c.i.push(item(rp(.3) ? I_CROWN : I_PIG, bx, by + r * .55, pick(aff(c.rg))));
  if (rp(.6)) c.o.push(sg(bx, c.y + c.h * .18, rf(60, 120), rf(-.4, .4), M_BUMP, moving(b, 90)));
}

function shaft(c, L, Rr, wdt, cx, b, dif) {
  const w = mx(135, 250 - dif * 30), sx = cx + rf(-.22, .22) * wdt;
  const drift = rf(-90, 90);
  c.o.push(sgAB(sx - w / 2, c.y, sx - w / 2 + drift, c.y + c.h, M_RAIL));
  c.o.push(sgAB(sx + w / 2, c.y, sx + w / 2 + drift, c.y + c.h, M_RAIL));
  for (let i = 0; i < 7; i++) c.i.push(item(I_COIN, sx + drift * (i / 7) + rf(-30, 30), c.y + 80 + i * (c.h - 160) / 6));
  // Outside the shaft: an optional pocket the player has to leave the rail for.
  if (rp(.6)) {
    const ox = sx < cx ? Rr - 70 : L + 70;
    const bp = rp(.45);
    c.i.push(item(bp ? I_PIG : I_BOOST, ox, c.y + c.h * .5, bp ? pick(aff(c.rg)) : ri(0, 1)));
  }
}

function rotor(c, L, Rr, wdt, cx, b, dif) {
  const n = ri(1, 2);
  for (let i = 0; i < n; i++) {
    const rx = cx + rf(-.25, .25) * wdt, ry = c.y + c.h * (n === 1 ? .5 : .3 + i * .42);
    const arms = ri(2, 3), len = mn(wdt * .34, 210), w = rs() * rf(.9, 1.9 + dif * .3);
    for (let a = 0; a < arms; a++)
      c.o.push(sg(rx, ry, len, a * PI / arms, M_BUMP, { w }));
    c.o.push(ci(rx, ry, 18, 0));
    c.i.push(item(I_COIN, rx, ry - len - 40), item(I_COIN, rx, ry + len + 40));
  }
}

function chamber(c, L, Rr, wdt, cx, b, dif) {
  const top = c.y + c.h * .16, bot = c.y + c.h * .86;
  barrier(c, L, Rr, wdt, b, dif, 1, 0, top, 1);
  barrier(c, L, Rr, wdt, b, dif, 1, 0, bot, 1);
  const n = ri(4, 7);
  for (let i = 0; i < n; i++) {
    const ix = L + rf(.12, .88) * wdt, iy = lerp(top + 60, bot - 60, rr());
    if (solidNear(c, ix, iy, 66)) continue;
    if (rp(.45)) c.o.push(ci(ix, iy, rf(16, 30), rp(.5) ? M_BUMP : M_ANCH, moving(b, 80)));
    else c.o.push(sg(ix, iy, rf(46, 96), rf(0, PI), mat(b, 1) | (rp(.3) ? M_RAIL : 0), moving(b, 70)));
  }
  // A ring of orbit fodder around the middle: this is the archetype the Green
  // tether and the Yellow spring are meant to be used in.
  const mx2 = (L + Rr) / 2, my = (top + bot) / 2, rr2 = mn(wdt * .3, 190);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + rf(0, 1), ix = mx2 + cos(a) * rr2, iy = my + sin(a) * rr2 * .7;
    if (!solidNear(c, ix, iy, 62)) c.o.push(ci(ix, iy, rf(13, 21), M_BUMP, moving(b, 56)));
  }
  // Side pocket with the good stuff
  c.i.push(item(rp(.25) ? I_CROWN : I_PIG, rp(.5) ? L + 55 : Rr - 55, (top + bot) / 2, pick(aff(c.rg))));
}

// --- special rooms ---------------------------------------------------------
// Focus Vault — a slow, enclosed prize room. Some of them hold a Prism Well
// instead of a Crown Coin, which is the game's only full pigment refill.
function buildVault(c, L, Rr, rg) {
  const cx = (L + Rr) / 2, cy = c.y + c.h * .5, r = mn((Rr - L) * .38, 250);
  c.cx = cx; c.cy = cy;
  arcSegs(c, cx, cy, r, .78 * PI, 2.16 * PI, M_BUMP);   // bowl with a top-left mouth
  const well = rp(.4);
  for (let a = 0; a < 3; a++) c.o.push(sg(cx, cy, r * .46, a * PI / 3, M_BUMP, { w: rs() * .55 }));
  c.i.push(item(well ? I_WELL : I_CROWN, cx, cy - r * .72));
  c.i.push(item(I_PIG, cx - r * .6, cy + r * .3, pick(aff(rg))));
  c.i.push(item(I_PIG, cx + r * .6, cy + r * .3, ri(0, 6)));
  for (let i = 0; i < 6; i++)
    c.i.push(item(I_COIN, cx + cos(i / 6 * TAU) * r * .78, cy + sin(i / 6 * TAU) * r * .78));
}

// Region exit machine: a spinning prism above a closing throat, then a full
// spectrum of pigment as a reward for getting through it.
function buildGate(c, L, Rr, rg, dif) {
  const cx = (L + Rr) / 2, w = Rr - L, cy = c.y + c.h * .4, b = bias(rg);
  rotor(c, L, Rr, w, cx, b, dif);
  barrier(c, L, Rr, w, b, dif, 1, 0, cy + 300, 1);
  c.o.push(ci(cx, cy, 26, M_BUMP));
  for (let i = 0; i < 7; i++) c.i.push(item(I_PIG, cx + (i - 3) * 74, cy + 420, i));
  c.i.push(item(I_CROWN, cx, c.y + 150));
}

// --- rewards ---------------------------------------------------------------
function rewards(c, L, Rr, rg, dif) {
  const af = aff(rg);
  // Drop something valuable in the first free spot we find.
  const place = (t, cc, lo, hi) => {
    for (let a = 0; a < 10; a++) {
      const x = rf(L + 45, Rr - 45), y = c.y + rf(lo, hi) * c.h;
      if (!solidNear(c, x, y, 34)) { c.i.push(item(t, x, y, cc)); return; }
    }
  };
  // A coin arc that teaches a trajectory.
  if (rp(.75)) {
    const n = ri(5, 9), x0 = L + rf(.1, .5) * (Rr - L), y0 = c.y + rf(.15, .5) * c.h;
    const dir = rs(), spread = rf(150, 330), rise = rf(-190, 240);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = x0 + dir * spread * t, y = y0 + rise * sin(t * PI) + t * 150;
      if (x > L + 25 && x < Rr - 25 && !solidNear(c, x, y, 26)) c.i.push(item(I_COIN, x, y));
    }
  }
  // Pigment biased to the region affinity, but never exclusive to it.
  if (rp(.62)) place(I_PIG, rp(.7) ? pick(af) : ri(0, 6), .15, .85);
  // Upward temptation, above the entry line.
  if (rp(.3)) place(rp(.3) ? I_BOOST : I_CROWN, ri(0, 1), .02, .16);
  if (rp(.16)) place(I_BOOST, ri(0, 1), .3, .8);
  // Destruction cache: coins sealed behind breakable panels.
  if (rp(.24)) {
    const x = rp(.5) ? L + 90 : Rr - 90, y = c.y + rf(.25, .7) * c.h;
    for (let i = 0; i < 4; i++)
      c.o.push(sg(x + (i < 2 ? 0 : i > 2 ? 62 : -62), y + (i < 2 ? (i ? 62 : -62) : 0), 62, i < 2 ? PI / 2 : 0, M_BREAK));
    c.i.push(item(I_COIN, x, y), item(I_COIN, x - 34, y), item(I_COIN, x + 34, y),
      item(rp(.4) ? I_CROWN : I_PIG, x, y - 34, ri(0, 6)));
  }
}

// --- lifecycle -------------------------------------------------------------
function worldReset(sd) {
  seed = sd || (rnd() * 1e9) | 0;
  srnd(seed);
  chunks = []; nextY = -900; prevL = -COL; prevR = COL; cIdx = 0; vault = null;
  // Opening room: open, gentle, and it demonstrates bouncing within seconds.
  const c = { y: -900, h: 1400, l: -COL, r: COL, pl: -COL, pr: COL, o: [], i: [], rg: 0, k: 0, v: 0 };
  c.o.push(sgAB(-COL, -900, -COL, 500, 0), sgAB(COL, -900, COL, 500, 0),
    sgAB(-COL, -900, COL, -900, M_BUMP),
    ci(-140, 60, 26, M_BUMP), ci(150, 250, 26, M_BUMP), ci(-60, 420, 22, M_BUMP));
  for (let i = 0; i < 7; i++) c.i.push(item(I_COIN, -220 + i * 74, 150 + sin(i * .9) * 90));
  c.i.push(item(I_PIG, 250, -60, 1), item(I_PIG, -260, 380, 2));
  chunks.push(c);
  nextY = 500;
  while (nextY < 3000) genChunk();
}

function worldUpdate() {
  while (nextY < P.y + 3200) genChunk();
  // Ceiling guard: never let the unicorn leave the retained world upward.
  const top = chunks[0];
  if (P.y < top.y + 40) { P.y = top.y + 40; if (P.vy < 0) P.vy = abs(P.vy) * .6; }
}

// Chunks overlapping a vertical span (used by physics + render).
function nearChunks(y0, y1) {
  const out = [];
  for (const c of chunks) if (c.y + c.h > y0 && c.y < y1) out.push(c);
  return out;
}
