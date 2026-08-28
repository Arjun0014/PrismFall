// ---------------------------------------------------------------------------
// World: region table, chunk grammar, obstacle + reward generation.
//
// The world is a ring of vertical chunks. Every chunk picks an archetype from
// its region's weight string and decorates it with region material bias, so
// world identity is systematic instead of seven separate generators.
// ---------------------------------------------------------------------------

// Archetype ids used inside the region weight strings. Funnel and Sieve are
// the same builder with different parameters, so eight situations cost seven.
// 0 PEG  1 FUNNEL  2 BOWL  3 SHAFT  4 ROTOR  5 SIEVE  6 CHAMBER
// 7 TARGET BANK  8 CRUSHER LANE

// Region row. Everything a region needs beyond these nine numbers is derived,
// which costs far fewer compressed bytes than a table:
//   0 name
//   1 base hue        background gradient starts here
//   2 hue spread      gradient end + geometry hue are offsets from the base
//   3 geometry light
//   4 background light
//   5 archetype weights (one char per draw)
//   6 filler density  extra scattered geometry per chunk
//   7 zone type       the force field that gives the region its mechanic
//   8 zone frequency  0..9, chunks in ten that carry the field
//   9 geometry hue     absolute; -1 means "cycle" (the Rainbow Engine)
// Affinity colours come from AFF, music from formulas in 60_audio.js.
//
// A region is a *mechanic* first and a palette second. Each row below pairs a
// force field with the archetypes and materials that make that field matter,
// so the seven descents ask genuinely different things of the player rather
// than recolouring the same shaft.
const REG = [
  // Sky. Updraft columns hold you up, so descending is something you do on
  // purpose. Round, soft, bumper-heavy: the region that teaches the verbs.
  ['CLOUDBREAK', 206, 74, 88, 26, '0002100210', 5, Z_UP, 5, 40],
  // Furnace. Almost everything is breakable and chains into its neighbours;
  // crusher lanes and rotors do the breaking for you if you build speed.
  ['SUNFORGE', 12, 34, 72, 19, '8574185741', 7, Z_WIND, 4, 196],
  // Overgrown spiral. Anchors and springy pods everywhere, and a slipstream
  // that curls you around them - the region the Green tether was built for.
  ['VERDANT COIL', 152, -74, 74, 17, '2622762262', 8, Z_FLOW, 6, 320],
  // Glass river. Long rails, narrow throats, flow that carries you along them.
  ['CRYSTAL CURRENT', 190, 44, 84, 15, '3303531333', 5, Z_RUSH, 7, 25],
  // Dark mine. Phase walls hide pockets, gravity wells drag you into them, and
  // the reward density is the highest in the game.
  ['PRISM MINE', 276, -28, 62, 10, '6760671666', 9, Z_WELL, 6, 120],
  // Temple. Inversion fields turn the shaft upside down; the geometry is built
  // to be read from both directions.
  ['INVERSION TEMPLE', 264, 52, 80, 13, '6465264636', 7, Z_INV, 7, 75],
  // The Engine. Every archetype, every field, maximum density.
  ['RAINBOW ENGINE', 300, -136, 90, 9, '0123456788', 9, 0, 9, -1],
];
// Material bias per region, as five hex nibbles read left to right:
//   BREAK PHASE DAMP BUMP MOVE, each out of 16.
// This table is most of what a region feels like under the unicorn. Cloudbreak
// is nearly all bumpers and nothing that eats speed; Sunforge is three quarters
// breakable; the Mine is the only place that is genuinely sticky. Dampeners
// stay scarce everywhere because they are the one material that can kill you.
const BIAS = [0x000b4, 0xc016a, 0x201a6, 0x11153, 0xa9332, 0x4a355, 0x6528b];
// Two affinity colours per region, one digit each, straight from the world spec:
// Cloudbreak O+Y, Sunforge R+O, Verdant G+Y, Crystal B+O, Mine R+V, Temple I+V.
const AFF = '120132410656';
const regHue = (r) => REG[r][1];
const bias = (r) => BIAS[r];
const bit = (b, i) => (b >> (16 - i * 4) & 15) / 16;
// The Rainbow Engine's affinity is "all colours", so it rolls fresh each time.
const aff = (r) => r > 5 ? [ri(0, 6), ri(0, 6)] : [+AFF[r * 2], +AFF[r * 2 + 1]];

const regZone = (r) => REG[r][7];
let nextY = 0, prevL = -COL, prevR = COL, cIdx = 0, seed = 1;
// Shared build context for the archetype builders: the playable span, its
// centre and width, the region's material bias and the current difficulty.
// Set once per chunk by genChunk so no builder has to take seven parameters.
let bL = 0, bR = 0, bW = 0, bX = 0, bB = 0, bD = 0;

// --- obstacle constructors -------------------------------------------------
// One shape record covers both primitives: t 0 is a circle of radius r, t 1 is
// a segment of half-length r at angle g. Sharing the field means the collision
// probe, the renderer and the placement test all read the same two numbers.
const ci = (x, y, r, m, e) => Object.assign({ t: 0, x, y, r, g: 0, m: m | 0 }, e);
const sg = (x, y, r, g, m, e) => Object.assign({ t: 1, x, y, r, g, m: m | 0 }, e);
// segment from A to B
const sgAB = (ax, ay, bx, by, m, e) =>
  sg((ax + bx) / 2, (ay + by) / 2, hyp(bx - ax, by - ay) / 2, at2(by - ay, bx - ax), m, e);

const item = (t, x, y, c) => ({ t, x, y, c: c | 0, g: 0 });

// Arcs are built from straight segments, so the collision kernel only ever
// deals with circles and segments - and the facets suit the geometric look.
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
// Closest-point scratch, filled by near().
let _px = 0, _py = 0, _nx = 0, _ny = 0, _pd = 0;
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
  return { ox: cos(a) * amp, oy: sin(a) * amp * .6, os: rf(.7, 1.9), op: rf(0, TAU) };
}

// --- region helpers --------------------------------------------------------
const regAt = (y) => { const i = flr(mx(y, 0) / REGD); return i < 7 ? i : i % 7; };
const loopAt = (y) => flr(flr(mx(y, 0) / REGD) / 7);
const difAt = (y) => clamp(flr(mx(y, 0) / REGD) * .085 + loopAt(y) * .3, 0, 2.4);

// Closest point on obstacle o (in whatever pose the scratch globals hold) to
// (x,y). Leaves the point in _px/_py, the unit normal pointing back at the
// query in _nx/_ny and the distance in _pd, and returns the obstacle's surface
// radius so callers can compare. Shared by collision and by the generator's
// placement probe, which used to carry its own copy of this arithmetic.
function near(o, x, y) {
  if (!o.t) {
    _nx = x - _cx; _ny = y - _cy; _pd = hyp(_nx, _ny);
    if (_pd < 1e-4) { _nx = 0; _ny = -1; _pd = 1e-4; } else { _nx /= _pd; _ny /= _pd; }
    _px = _cx + _nx * o.r; _py = _cy + _ny * o.r;
    return o.r;
  }
  const cg = cos(_cg) * o.r, sg2 = sin(_cg) * o.r;
  const ax = _cx - cg, ay = _cy - sg2, bx = _cx + cg, by = _cy + sg2;
  const t = segT(ax, ay, bx, by, x, y);
  _px = ax + (bx - ax) * t; _py = ay + (by - ay) * t;
  _nx = x - _px; _ny = y - _py; _pd = hyp(_nx, _ny);
  if (_pd < 1e-4) { _nx = -sin(_cg); _ny = cos(_cg); _pd = 1e-4; } else { _nx /= _pd; _ny /= _pd; }
  return ST;
}

// --- solidity probe --------------------------------------------------------
// Deliberately measured against each obstacle's *base* pose, not its animated
// one: placement has to be deterministic for a seed, and a moving arm sweeping
// over a coin is the intended risk rather than a bad spawn.
function solidNear(c, x, y, rad) {
  for (const o of c.o) {
    _cx = o.x; _cy = o.y; _cg = o.g;
    if (near(o, x, y) + rad > _pd) return 1;
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
  const wide = rp(.25) ? 120 : 0;
  const l = clamp(-COL + rf(-90, 70) - wide, -WMAX, -300);
  const r = clamp(COL + rf(-70, 90) + wide, 300, WMAX);
  const h = boundary ? 1200 : ri(700, 1200);

  const c = { y, h, l, r, pl: prevL, pr: prevR, o: [], i: [], rg, k: 0, v: 0, z: 0, bk: [] };

  // Walls, drawn as chunk-to-chunk segments so the column is continuous.
  c.o.push(sgAB(prevL, y, l, y + h, 0), sgAB(prevR, y, r, y + h, 0));

  bL = mx(prevL, l) + 30; bR = mn(prevR, r) - 30;
  bW = bR - bL; bX = (bL + bR) / 2; bB = b; bD = dif;

  if (boundary) buildGate(c);
  else {
    const k = +REG[rg][5][ri(0, 9)];
    c.k = k;
    // The region's force field. It is what makes a descent feel like a place:
    // Cloudbreak holds you up, the Temple turns you over, the Coil and the
    // Current sweep you sideways, the Mine drags you into its pockets.
    if (cIdx > 1 && ri(0, 9) < REG[rg][8]) c.z = regZone(rg) || ri(1, 5);
    if (k === 1 || k === 5)
      barrier(c, k > 1 ? ri(2, 3) : 1, k > 1 ? rf(0, 26) : rf(120, 200), c.y + c.h * rf(.3, .6), 0);
    else [pegField, 0, bowl, shaft, rotor, 0, chamber, targets, crushers][k](c);
    decorate(c, REG[rg][6] + (dif * 1.6 | 0));
    rewards(c, rg);
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
function decorate(c, n) {
  // Keep trying until the quota is met: shaft and rotor chunks reject most
  // candidates, and those are exactly the chunks that read as empty.
  for (let tries = n * 6; n > 0 && tries--;) {
    const x = rf(bL + 40, bR - 40), y = c.y + rf(.07, .93) * c.h;
    const cir = rp(.6), rad = rf(13, 26), hl = rf(30, 70), a = rf(0, PI);
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
    // Half the scatter is live pinball furniture: bumpers that kick, targets
    // that light, panels that shatter. A screen should always contain
    // something worth hitting on purpose.
    c.o.push(cir
      ? ci(x, y, rad, mat(bB, 0) | (rp(.5) ? M_BUMP : rp(.3) ? M_TGT : 0), moving(bB, 70))
      : sg(x, y, hl, a, mat(bB, 1) | (rp(.22) ? M_ANCH : 0), moving(bB, 60)));
    if (c.o[c.o.length - 1].m & M_TGT) tag(c, c.o[c.o.length - 1], 3);
  }
}

// Register an obstacle as a member of a scoring bank. Every target in a bank
// lights independently; lighting the last one pays the whole bank out and
// resets it, so a bank is a repeatable objective rather than a one-off pickup.
function tag(c, o, cap) {
  let k = c.bk[c.bk.length - 1];
  if (!k || k.n >= k.cap) { k = { n: 0, l: 0, cap, x: o.x, y: o.y, m: [] }; c.bk.push(k); }
  k.n++; k.m.push(o);
  o.bk = k;
  o.m |= M_TGT;
}

// --- archetypes ------------------------------------------------------------
function pegField(c) {
  const rows = ri(4, 6), gap = c.h / (rows + 1);
  for (let r = 0; r < rows; r++) {
    const yy = c.y + gap * (r + 1), n = ri(4, 7);
    for (let i = 0; i < n; i++) {
      const t = (i + (r & 1 ? .5 : 0)) / (n - .34);
      c.o.push(ci(bL + 40 + t * (bW - 90), yy, rf(14, 30),
        mat(bB, 0) | (rp(.45) ? M_BUMP : rp(.25) ? M_TGT : 0), moving(bB, 60)));
      if (c.o[c.o.length - 1].m & M_TGT) tag(c, c.o[c.o.length - 1], 3);
    }
  }
}

// One builder covers both the Funnel and the Sieve: a wall across the column
// with n openings. `drop` slopes the outer ends up and the gap edges down,
// which turns a flat sieve into a converging funnel.
function barrier(c, n, drop, yy, quiet) {
  const m = mat(bB, 1), cuts = [];
  for (let i = 0; i < n; i++) cuts.push(bL + (i + rf(.22, .8)) * bW / n);
  let px = bL - 20, py = yy - drop;
  for (let i = 0; i <= n; i++) {
    const last = i === n;
    const gw = mx(100, rf(120, 200) - bD * 16);
    const nx = last ? bR + 20 : cuts[i] - gw / 2, ny = last ? yy - drop : yy + drop;
    if (nx - px > 26) c.o.push(sgAB(px, py, nx, ny, m));
    if (!last && drop > 40 && rp(.6)) c.o.push(ci(nx, ny, 15, M_BUMP));
    px = last ? nx : cuts[i] + gw / 2;
    py = yy + drop;
  }
  if (quiet) return;
  // Coins below the easiest gap, the prize above the least convenient one.
  for (let i = 0; i < 4; i++) c.i.push(item(I_COIN, cuts[0] + rf(-26, 26), yy + drop + 70 + i * 48));
  c.i.push(item(rp(.34) ? I_PIG : I_CROWN, cuts[n - 1], yy - drop - 70, pick(aff(c.rg))));
}

function bowl(c) {
  const r = mn(bW * .4, 300), bx = bX + rf(-.2, .2) * bW, by = c.y + c.h * .6;
  const rim = r * cos(.12 * PI);
  arcSegs(c, bx, by, r, .12 * PI, .8 * PI, rp(.34) ? M_DAMP : 0);
  c.o.push(ci(bx - rim, by, 15, M_BUMP), ci(bx + rim, by, 15, M_BUMP));
  // Something worth the risk of dropping in.
  c.i.push(item(rp(.3) ? I_CROWN : I_PIG, bx, by + r * .5, pick(aff(c.rg))));
  if (rp(.6)) c.o.push(sg(bx, c.y + c.h * .18, rf(60, 120), rf(-.4, .4), M_BUMP, moving(bB, 90)));
}

function shaft(c) {
  const w = mx(150, 240 - bD * 30), sx = bX + rf(-.2, .2) * bW;
  const drift = rf(-90, 90);
  c.o.push(sgAB(sx - w / 2, c.y, sx - w / 2 + drift, c.y + c.h, M_RAIL));
  c.o.push(sgAB(sx + w / 2, c.y, sx + w / 2 + drift, c.y + c.h, M_RAIL));
  for (let i = 0; i < 7; i++) c.i.push(item(I_COIN, sx + drift * (i / 7) + rf(-30, 30), c.y + 80 + i * (c.h - 150) / 6));
  // Outside the shaft: an optional pocket the player has to leave the rail for.
  if (rp(.6)) {
    const ox = sx < bX ? bR - 70 : bL + 70;
    const bp = rp(.5);
    c.i.push(item(bp ? I_PIG : I_BOOST, ox, c.y + c.h * .5, bp ? pick(aff(c.rg)) : ri(0, 6)));
  }
}

function rotor(c) {
  const n = ri(1, 2);
  for (let i = 0; i < n; i++) {
    const rx = bX + rf(-.22, .22) * bW, ry = c.y + c.h * (n === 1 ? .5 : .3 + i * .4);
    const arms = ri(2, 3), len = mn(bW * .3, 200), w = rs() * rf(.9, 1.9 + bD * .3);
    for (let a = 0; a < arms; a++)
      c.o.push(sg(rx, ry, len, a * PI / arms, M_BUMP, { w }));
    c.o.push(ci(rx, ry, 18, 0));
    c.i.push(item(I_COIN, rx, ry - len - 40), item(I_COIN, rx, ry + len + 40));
  }
}

function chamber(c) {
  const top = c.y + c.h * .16, bot = c.y + c.h * .8;
  barrier(c, 1, 0, top, 1);
  barrier(c, 1, 0, bot, 1);
  const n = ri(4, 7);
  for (let i = 0; i < n; i++) {
    const ix = bL + rf(.12, .8) * bW, iy = lerp(top + 60, bot - 60, rr());
    if (solidNear(c, ix, iy, 60)) continue;
    if (rp(.5)) c.o.push(ci(ix, iy, rf(16, 30), rp(.5) ? M_BUMP : M_ANCH, moving(bB, 80)));
    else c.o.push(sg(ix, iy, rf(48, 90), rf(0, PI), mat(bB, 1) | (rp(.3) ? M_RAIL : 0), moving(bB, 70)));
  }
  // A ring of orbit fodder around the middle: this is the archetype the Green
  // tether and the Yellow spring are meant to be used in.
  const mx2 = bX, my = (top + bot) / 2, rr2 = mn(bW * .3, 200);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + rf(0, 1), ix = mx2 + cos(a) * rr2, iy = my + sin(a) * rr2 * .7;
    if (!solidNear(c, ix, iy, 60)) c.o.push(ci(ix, iy, rf(13, 20), M_BUMP, moving(bB, 60)));
  }
  // Side pocket with the good stuff
  c.i.push(item(rp(.22) ? I_CROWN : I_PIG, rp(.5) ? bL + 60 : bR - 60, (top + bot) / 2, pick(aff(c.rg))));
}

// Drop-target banks: rows of lit-on-contact panels flanked by kickers. Clear a
// whole bank and it pays out and re-arms, which is the loop that makes a
// pinball table worth staying on rather than falling through.
function targets(c) {
  const rows = ri(2, 3);
  for (let r = 0; r < rows; r++) {
    const yy = c.y + c.h * (.2 + r * .6 / rows + rf(-.04, .04));
    const n = ri(3, 5), span = mn(bW * .8, 300), x0 = bX - span / 2 + rf(-40, 40);
    const k = { n, l: 0, cap: n, x: bX, y: yy, m: [] };
    c.bk.push(k);
    for (let i = 0; i < n; i++) {
      const o = sg(x0 + (i + .5) * span / n, yy, 30, PI / 2 + rf(-.2, .2), M_TGT);
      o.bk = k; k.m.push(o);
      c.o.push(o);
    }
    // Kickers at both ends of the bank keep the ball in the lane.
    c.o.push(ci(x0 - 40, yy, 20, M_BUMP), ci(x0 + span + 40, yy, 20, M_BUMP));
    for (let i = 0; i < n; i++) c.i.push(item(I_COIN, x0 + (i + .5) * span / n, yy - 60));
  }
  c.i.push(item(rp(.4) ? I_BOOST : I_PIG, bX + rf(-.3, .3) * bW, c.y + c.h * .92, ri(0, 6)));
}

// Crusher lane: a corridor of breakable panels with counter-swinging arms that
// do the demolition for you once you are moving. Sunforge's signature room.
function crushers(c) {
  const w = mn(bW * .8, 420), sx = bX + rf(-.1, .1) * bW;
  const n = ri(3, 4);
  for (let i = 0; i < n; i++) {
    const yy = c.y + c.h * (.15 + i * .8 / n);
    // A full-width breakable curtain with one deliberate gap.
    const gapX = sx + rf(-.3, .3) * w, gw = mx(90, 150 - bD * 20);
    for (const sd of [-1, 1]) {
      const ex = sd < 0 ? sx - w / 2 : sx + w / 2;
      const gx = gapX + sd * gw / 2;
      if (abs(ex - gx) > 30) c.o.push(sgAB(gx, yy, ex, yy + rf(-14, 14), M_BREAK));
    }
    // The crusher itself: a heavy arm sweeping the lane.
    c.o.push(sg(gapX, yy + c.h * .4 / n, mn(w * .3, 150), rf(0, PI), M_BUMP,
      { w: rs() * rf(.8, 1.6 + bD * .4) }));
    c.i.push(item(I_COIN, gapX, yy + 40), item(I_COIN, gapX + rf(-30, 30), yy + 90));
  }
  c.i.push(item(rp(.5) ? I_CROWN : I_BOOST, sx, c.y + c.h * .96, ri(0, 6)));
}

// --- special rooms ---------------------------------------------------------
function buildGate(c) {
  const cx = bX, cy = c.y + c.h * .4;
  rotor(c);
  barrier(c, 1, 0, cy + 300, 1);
  c.o.push(ci(cx, cy, 26, M_BUMP));
  for (let i = 0; i < 7; i++) c.i.push(item(I_PIG, cx + (i - 3) * 70, cy + 420, i));
  c.i.push(item(I_CROWN, cx, c.y + 150));
}

// --- rewards ---------------------------------------------------------------
function rewards(c, rg) {
  const af = aff(rg);
  // Reward density tracks the region's own density number, so the Prism Mine
  // really is worth the risk it asks you to take and Cloudbreak stays airy.
  const rich = REG[rg][6] / 6;
  // Drop something valuable in the first free spot we find.
  const place = (t, cc, lo, hi) => {
    for (let a = 0; a < 10; a++) {
      const x = rf(bL + 40, bR - 40), y = c.y + rf(lo, hi) * c.h;
      if (!solidNear(c, x, y, 30)) { c.i.push(item(t, x, y, cc)); return; }
    }
  };
  // A coin arc that teaches a trajectory.
  if (rp(.8)) {
    const n = ri(5, 9), x0 = bL + rf(.1, .5) * bW, y0 = c.y + rf(.16, .5) * c.h;
    const dir = rs(), spread = rf(150, 300), rise = rf(-200, 240);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = x0 + dir * spread * t, y = y0 + rise * sin(t * PI) + t * 150;
      if (x > bL + 26 && x < bR - 26 && !solidNear(c, x, y, 26)) c.i.push(item(I_COIN, x, y));
    }
  }
  // Pigment biased to the region affinity, but never exclusive to it.
  if (rp(.6 * rich)) place(I_PIG, rp(.7) ? pick(af) : ri(0, 6), .16, .8);
  // Upward temptation, above the entry line.
  if (rp(.3 * rich)) place(rp(.3) ? I_BOOST : I_CROWN, ri(0, 6), .02, .16);
  if (rp(.16 * rich)) place(I_BOOST, ri(0, 6), .3, .8);
  // The Prism Well is the game's only full refill. It used to be locked inside
  // a Focus Vault; with those gone it becomes a rare find in its own right,
  // still rare enough that hitting one feels like luck rather than supply.
  if (rp(.07 * rich)) place(I_WELL, 0, .2, .8);
  // Destruction cache: coins sealed behind breakable panels.
  if (rp(.22 * rich)) {
    const x = rp(.5) ? bL + 90 : bR - 90, y = c.y + rf(.22, .7) * c.h;
    for (let i = 0; i < 4; i++)
      c.o.push(sg(x + (i < 2 ? 0 : i > 2 ? 60 : -60), y + (i < 2 ? (i ? 60 : -60) : 0), 60, i < 2 ? PI / 2 : 0, M_BREAK));
    c.i.push(item(I_COIN, x, y), item(I_COIN, x - 30, y), item(I_COIN, x + 30, y),
      item(rp(.4) ? I_CROWN : I_PIG, x, y - 30, ri(0, 6)));
  }
}

// --- lifecycle -------------------------------------------------------------
function worldReset(sd) {
  seed = sd || (rnd() * 1e9) | 0;
  srnd(seed);
  chunks = []; nextY = -900; prevL = -COL; prevR = COL; cIdx = 0;
  // Opening room: open, gentle, and it demonstrates bouncing within seconds.
  const c = { y: -900, h: 1400, l: -COL, r: COL, pl: -COL, pr: COL, o: [], i: [], rg: 0, k: 0, v: 0, z: 0, bk: [] };
  c.o.push(sgAB(-COL, -900, -COL, 500, 0), sgAB(COL, -900, COL, 500, 0),
    sgAB(-COL, -900, COL, -900, M_BUMP),
    ci(-150, 60, 26, M_BUMP), ci(150, 240, 26, M_BUMP), ci(-60, 420, 20, M_BUMP));
  for (let i = 0; i < 7; i++) c.i.push(item(I_COIN, -200 + i * 70, 150 + sin(i * .9) * 90));
  c.i.push(item(I_PIG, 240, -60, 1), item(I_PIG, -240, 420, 2));
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

// --- column bounds ---------------------------------------------------------
// The shaft walls are chunk-to-chunk segments, so the playable span at a given
// height is an interpolation between the chunk's entry and exit walls. Warps,
// portals and Indigo can all put the unicorn somewhere arbitrary, and relying
// on segment collision alone let it end up behind a wall with nothing to push
// it back. Results land in scratch globals to keep the physics step allocation
// free.
let _wl = -WMAX, _wr = WMAX;
function wallsAt(y) {
  _wl = -WMAX; _wr = WMAX;
  for (const c of chunks) if (y >= c.y && y < c.y + c.h) {
    const t = (y - c.y) / c.h;
    _wl = lerp(c.pl, c.l, t); _wr = lerp(c.pr, c.r, t);
    return;
  }
}

// The force a chunk's field applies at (x,y), into the scratch pair _zx/_zy.
// One switch, five fields, and every region gets a mechanic instead of a
// repaint. Fields never kill: the worst any of them does is redirect you.
let _zx = 0, _zy = 0;
function zoneF(c, x, y) {
  _zx = _zy = 0;
  const z = c.z;
  if (!z) return;
  const t = (y - c.y) / c.h, ph = sin(t * 7 + T * 1.4);
  if (z === Z_UP) {
    // Updraft columns: three lanes of lift you can ride or dodge.
    const lane = cos((x - c.l) / (c.r - c.l) * TAU * 1.6);
    if (lane > .1) _zy = -GRAV * 1.2 * lane;
  } else if (z === Z_WELL) {
    // A gravity well at the chunk's heart, falling off with distance.
    const dx = (c.l + c.r) / 2 - x, dy = c.y + c.h * .5 - y, d = hyp(dx, dy) + 60;
    const k = mn(1, 300 / d) * GRAV * .8;
    _zx = dx / d * k; _zy = dy / d * k;
  } else if (z === Z_WIND) {
    _zx = ph * GRAV * .6;
  } else if (z === Z_INV) {
    // Inversion: the shaft is upside down here, and the transition is soft
    // enough at the edges that you always see it coming.
    _zy = -GRAV * 2 * clamp(mn(t, 1 - t) * 6, 0, 1);
  } else if (z === Z_FLOW) {
    // The Coil: a rotation about the chunk's heart. Everything in Verdant is
    // built to be swung around, and the field swings you too.
    const cx = (c.l + c.r) / 2, cy = c.y + c.h * .5;
    const dx = x - cx, dy = y - cy, d = hyp(dx, dy) + 80;
    const k = GRAV * .7 * mn(1, 300 / d);
    _zx = -dy / d * k; _zy = dx / d * k;
  } else {
    // The Current: a meandering channel that carries you down it. Unlike the
    // Coil this one has a direction, which is what makes the Crystal region a
    // race rather than a playground.
    const cx = (c.l + c.r) / 2 + sin(y * .0016 + c.y * .01) * (c.r - c.l) * .3;
    _zx = clamp((cx - x) * 5, -GRAV, GRAV);
    _zy = GRAV * .5;
  }
}

// Chunks overlapping a vertical span (used by physics + render).
function nearChunks(y0, y1) {
  const out = [];
  for (const c of chunks) if (c.y + c.h > y0 && c.y < y1) out.push(c);
  return out;
}
