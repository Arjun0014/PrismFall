// ---------------------------------------------------------------------------
// Rendering: camera, region backdrops, world geometry, the procedural unicorn,
// trail and particles. Everything is Canvas2D primitives - no assets.
//
// Written for compressed size: one set of drawing shorthands, one particle
// spawner, one polygon helper, and region identity carried by parameters
// rather than by separate code paths.
// ---------------------------------------------------------------------------

const BP = () => X.beginPath();
const SK = (w, c) => { X.lineWidth = w; X.strokeStyle = c; X.stroke(); };
const FL = (c) => { X.fillStyle = c; X.fill(); };
const AR = (x, y, r, a, b) => X.arc(x, y, r, a || 0, b === undefined ? TAU : b);
const MT = (x, y) => X.moveTo(x, y);
const LT = (x, y) => X.lineTo(x, y);
const LIN = (ax, ay, bx, by, w, c) => { BP(); MT(ax, ay); LT(bx, by); SK(w, c); };
const CIR = (x, y, r, f, s, w) => { BP(); AR(x, y, r); if (f) FL(f); if (s) SK(w, s); };
// Closed polygon; fn(i) plots vertex i through VTX.
const POLY = (n, f, s, w, fn) => {
  BP();
  for (let i = 0; i < n; i++) fn(i);
  X.closePath();
  if (f) FL(f);
  if (s) SK(w, s);
};
const VTX = (i, x, y) => (i ? LT : MT)(x, y);

let pal = [232, 62, 12, 322, 52, 27, 288, 80];   // live (interpolated) palette
let shX = 0, shY = 0;

// --- particles -------------------------------------------------------------
// k: 0 spark (streak), 1 debris, 2 ring. hue undefined = current colour.
function shock(x, y, R, h) {
  if (shocks.length > 26) shocks.shift();
  shocks.push({ x, y, r: 0, R, h, t: 1 });
}
function pt(x, y, vx, vy, l, h, k, s) {
  if (parts.length > 420) parts.shift();
  parts.push({ x, y, vx, vy, l, L: l, h, k, s, a: rf(0, TAU), w: rf(-9, 9) });
}
function burst(x, y, n, k, spd, hue, vx, vy) {
  const h = hue === undefined ? HUE[sel] : hue;
  // k===1 is a generic world impact - the equipped Impact cosmetic restyles it.
  const kk = WD && k === 1 ? SAVE.e[3] : k;
  for (let i = 0; i < n; i++) {
    const a = rf(0, TAU), v = rf(.3, 1) * spd;
    pt(x, y, (vx || 0) + cos(a) * v, (vy || 0) + sin(a) * v,
      rf(.16, .5), h + rf(-18, 18), kk, rf(1.4, 3.6));
  }
}
function warpFX(x, y) {
  pt(x, y, 0, 0, .4, HUE[6], 2, 8);
  burst(x, y, 12, 0, 300, HUE[6]);
}
function strokeFX(s, px, py) {
  for (let i = 0; i < 7; i++) if (s.e & CBIT[i]) burst(px, py, 5, 0, 240, HUE[i]);
  pt(px, py, 0, 0, .3, HUE[s.c], 2, 6);
}
function pop(x, y, t, h) { pops.push({ x, y, t, h, l: 1.15 }); }

function partStep(h) {
  for (let i = parts.length; i--;) {
    const p = parts[i];
    if ((p.l -= h) <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * h; p.y += p.vy * h;
    if (p.k !== 2) { p.vy += 420 * h; p.vx *= .985; p.vy *= .985; }
    if (p.k === 4) p.a += p.w * h;
  }
  for (let i = shocks.length; i--;) {
    const w = shocks[i];
    w.r += (w.R - w.r) * mn(1, 9 * h);
    if ((w.t -= h * 2.4) <= 0) shocks.splice(i, 1);
  }
  for (let i = pops.length; i--;) {
    const p = pops[i]; p.y -= 48 * h;
    if ((p.l -= h) <= 0) pops.splice(i, 1);
  }
  for (let i = nodes.length; i--;) if ((nodes[i].t -= h) <= 0) nodes.splice(i, 1);
}

// --- camera ----------------------------------------------------------------
function camUpdate(h) {
  const v = vault;
  C.x = approach(C.x, v ? v.cx : P.x + clamp(P.vx * .12, -180, 180), v ? 3.2 : 7.5, h);
  C.y = approach(C.y, v ? v.cy : P.y + clamp(P.vy * .22, -.2 * VH, .22 * VH), v ? 3.2 : 7.5, h);
  C.z = approach(C.z, v ? .8 : 1 / (1 + P.sp / 5200), 4, h);
  SC = mn(H / VH, W / (COL * 2 + 48)) * C.z;
  // Keep the play column framed. Without this the velocity lead walks the
  // camera off the side of the world and half the screen becomes dead rock.
  const lim = mx(0, WMAX + 60 - W / 2 / SC);
  C.x = clamp(C.x, -lim, lim);
  shake = mx(0, shake - shake * 7 * h - 4 * h);
  const s = mn(shake, 26);
  shX = rf(-s, s); shY = rf(-s, s);
}
const w2sx = (x) => W / 2 + (x - C.x) * SC + shX;
const w2sy = (y) => H / 2 + (y - C.y) * SC + shY;
const s2wx = (x) => C.x + (x - W / 2 - shX) / SC;
const s2wy = (y) => C.y + (y - H / 2 - shY) / SC;

// Shortest-path hue interpolation so palettes cross-fade instead of spinning.
const alerp = (a, b, r, h) => (a + (((b - a + 540) % 360) - 180) * (1 - M.exp(-r * h)) + 360) % 360;

// Target palette: [bgTopH, bgTopS, bgTopL, bgBotH, bgBotS, bgBotL, geoH, geoL]
//
// Geometry carries its own hue rather than a function of the sky's. Deriving it
// as the sky's complement did guarantee contrast, but it also landed four of
// the seven regions inside the same gold band, so half the game's obstacles
// looked alike however different the backdrop was. The table's values are each
// at least 90 degrees from their own background's midpoint and at least 35 from
// every other region's. The Rainbow Engine's is -1, meaning it cycles -- which
// is the one region that ought to.
const regPal = (r) => {
  const q = REG[r], hu = q[1], sp = q[2], bl = q[4], g = q[9];
  return [hu, 56, bl, hu + sp, 64, bl + 23, g < 0 ? (T * 16) % 360 : g, q[3]];
};
function palUpdate(h) {
  const t = regPal(reg);
  for (let i = 0; i < 8; i++)
    pal[i] = i % 3 || i > 6 ? approach(pal[i], t[i], 1.6, h) : alerp(pal[i], t[i], 1.6, h);
}

// --- background ------------------------------------------------------------
// Two parallax layers of a region motif, placed on an infinite hashed grid so
// the scenery is endless and costs no storage.
function background() {
  const g = X.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hsl(pal[0] | 0, pal[1] | 0, pal[2] | 0));
  g.addColorStop(1, hsl(pal[3] | 0, pal[4] | 0, pal[5] | 0));
  X.fillStyle = g; X.fillRect(0, 0, W, H);
  const k = MOT[reg];
  X.lineWidth = mx(1, 2.4 * SC);
  for (let L = 0; L < 2; L++) {
    const par = L ? .4 : .16, size = L ? 300 : 500, al = L ? .09 : .05;
    const cx = C.x * par, cy = C.y * par, hw = W / 2 / SC, hh = H / 2 / SC;
    const x1 = flr((cx + hw) / size), y1 = flr((cy + hh) / size);
    for (let gy = flr((cy - hh) / size); gy <= y1; gy++)
      for (let gx = flr((cx - hw) / size); gx <= x1; gx++) {
        const v = hsh(gx * 30 + k[0], gy * 17);
        if (v < .5) continue;
        const wx = (gx + .16 + hsh(gx, gy) * .7) * size, wy = (gy + .16 + hsh(gy, gx + 9) * .7) * size;
        const hue = pal[6] + (v - .5) * 60 | 0;
        X.fillStyle = hsl(hue, 60, pal[7] | 0, al);
        X.strokeStyle = hsl(hue, 70, pal[7] | 0, al * 2);
        motif(k, W / 2 + (wx - cx) * SC, H / 2 + (wy - cy) * SC, size * (.16 + v * .3) * SC, v);
      }
  }
}

// Motif families: [prim, a, b].
// prim 0 blobs - 1 polygon(a sides, b/10 inner radius, b<0 rough)
// prim 2 rings(a) + spokes(|b|), b<0 = partial arcs instead of full rings.
const MOT = [[0, 3, 0], [2, 1, 8], [2, 2, -3], [1, 5, 4], [1, 7, -1], [2, 3, 6], [2, 1, 4]];

function motif(k, x, y, r, v) {
  const a1 = k[1], a2 = k[2];
  BP();
  if (!k[0]) {
    // A cloud is a union of lobes sitting on a flat base. Every lobe MUST open
    // its own subpath: consecutive arcs in one path are joined by a straight
    // line, and those chords are the hard triangular wedges that were showing
    // up inside every cloud in Cloudbreak.
    // A cloud spans about 3.4x its lobe radius, where every other motif spans
    // 2x, so it is scaled down to occupy the same footprint as its neighbours.
    r *= .6;
    const n = 4 + (v * 4 | 0), base = y + r * .3;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - .5;
      // Fattest in the middle, tapering to the ends; the hash keeps every cloud
      // in the field a different shape for free.
      const lr = r * (.3 + .3 * cos(t * 2.4) + hsh(i * 7, v * 420) * .16);
      const lx = x + t * r * 1.6, ly = base - lr * (.8 + hsh(i, v * 90) * .5);
      MT(lx + lr, ly);
      AR(lx, ly, lr);
    }
    // A slab along the bottom closes the gaps between lobes into one silhouette.
    MT(x - r * .95, base);
    X.roundRect(x - r * .95, base - r * .3, r * 1.9, r * .3, r * .16);
    X.fill();
  } else if (k[0] < 2) {
    for (let i = 0; i < a1; i++) {
      const a = i / a1 * TAU + v * 4;
      const q = r * (a2 < 0 ? .6 + hsh(i, v * 90) * .5 : i & 1 ? a2 / 10 : 1);
      VTX(i, x + cos(a) * q, y + sin(a) * q);
    }
    X.closePath(); X.fill();
  } else {
    const span = a2 < 0 ? 2.4 : TAU, n = abs(a2);
    for (let i = 1; i <= a1; i++) { BP(); AR(x, y, r * (1 - i * .2), v * TAU, v * TAU + span); X.stroke(); }
    BP();
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + T * .06 * (v > .7 ? -1 : 1);
      MT(x + cos(a) * r * .5, y + sin(a) * r * .5);
      LT(x + cos(a) * r, y + sin(a) * r);
    }
    X.stroke();
  }
}

// --- world -----------------------------------------------------------------
// Material styling: [hue, fillSat, fillLight, edgeSat, edgeLight].
const MSTY = [
  [276, 40, 7, 60, 26],      // damp / void
  [18, 74, 42, 100, 66],     // breakable
  [292, 60, 30, 100, 74],    // phase wall
  [200, 80, 40, 100, 76],    // guide rail
  [140, 70, 34, 100, 70],    // tether anchor
  [46, 38, 22, 90, 60],      // scoring target, unlit
  [46, 100, 60, 100, 92],    // scoring target, lit
];
function obStyle(o) {
  const m = o.m;
  const i = m & M_TGT ? (o.lt ? 6 : 5)
    : m & M_DAMP ? 0 : m & M_BREAK ? 1 : m & M_PHASE ? 2 : m & M_RAIL ? 3 : m & M_ANCH ? 4 : -1;
  if (i < 0) {
    return m & M_BUMP
      ? [hsl(pal[6] + 30 | 0, 90, 48), hsl(pal[6] + 40 | 0, 100, 80)]
      : [hsl(pal[6] | 0, 48, 19), hsl(pal[6] | 0, 90, mx(58, pal[7]) | 0)];
  }
  const s = MSTY[i];
  return [hsl(s[0], s[1], s[2]), hsl(s[0], s[3], s[4])];
}

function drawWorld() {
  const y0 = s2wy(0) - 200, y1 = s2wy(H) + 200;
  const wide = mx(2, (ST * 2 + 3) * SC), thin = mx(1, ST * SC);
  const mass = hsl(pal[6] | 0, 30, mx(4, pal[2] * .42) | 0);
  X.lineCap = 'round';
  for (const c of chunks) {
    if (c.y + c.h < y0 || c.y > y1) continue;
    // Rock beyond each wall, so the play column reads as a shaft.
    const ty = w2sy(c.y), by = w2sy(c.y + c.h);
    X.fillStyle = mass;
    for (const sd of [-9e3, 9e3]) {
      BP(); MT(sd, ty);
      LT(w2sx(sd < 0 ? c.pl : c.pr), ty);
      LT(w2sx(sd < 0 ? c.l : c.r), by);
      LT(sd, by); X.fill();
    }
    if (c.z) drawZone(c);
    for (const o of c.o) {
      if (o.k) continue;
      obT(o);
      const s2 = obStyle(o);
      const ox = w2sx(_cx), oy = w2sy(_cy);
      // Contact flash. Everything you touch swells and glows for a moment, so a
      // busy screen still reads as a chain of separate hits rather than a blur.
      const f = o.f > 0 ? (o.f = mx(0, o.f - .05)) : 0;
      // A lit fuse: the panel shudders and whitens in the instant before it goes.
      const fz = o.kt > 0 ? 1 : 0;
      if (f || fz) {
        X.save();
        X.translate(ox, oy); X.scale(1 + f * .3, 1 + f * .3); X.translate(-ox, -oy);
        if (fz) X.globalAlpha = .5 + rnd() * .5;
      }
      if (!o.t) {
        CIR(ox, oy, o.r * SC, s2[0], s2[1], mx(1, (2.4 + f * 4) * SC));
        if (o.m & M_BUMP) CIR(ox, oy, o.r * SC * .5, 0, s2[1], mx(1, 1.6 * SC));
        if (f) CIR(ox, oy, (o.r + 6 + f * 20) * SC, 0, hsl(pal[6] + 30 | 0, 100, 80, f), mx(1, 2 * SC));
      } else {
        const cg = cos(_cg) * o.r, sg2 = sin(_cg) * o.r;
        LIN(w2sx(_cx - cg), w2sy(_cy - sg2), w2sx(_cx + cg), w2sy(_cy + sg2), wide, s2[0]);
        SK(thin, s2[1]);
        if (o.m & M_BREAK) {
          X.setLineDash([6 * SC, 7 * SC]);
          SK(mx(1, 2 * SC), 'hsl(48 100% 80% / .85)');
          X.setLineDash([]);
        }
        if (f) SK(mx(1, (2 + f * 5) * SC), hsl(pal[6] + 30 | 0, 100, 90, f));
      }
      if (f || fz) { X.globalAlpha = 1; X.restore(); }
    }
    // Bank progress, floating above the middle of each partly-lit bank.
    for (const k of c.bk) if (k.l) {
      const bx = w2sx(k.x), by = w2sy(k.y) - 48 * SC;
      for (let i = 0; i < k.n; i++)
        CIR(bx + (i - (k.n - 1) / 2) * 13 * SC, by, 4 * SC,
          i < k.l ? 'hsl(48 100% 68%)' : 'hsl(48 30% 32%)');
    }
    for (const it of c.i) if (!it.g) drawItem(it);
  }
}

// A force field that cannot be seen is just the game cheating, so each one
// draws its own flow: rising streaks for an updraft, converging ones for a
// well, sideways drift for wind, upward fall for an inversion.
function drawZone(c) {
  const y0 = mx(c.y, s2wy(0) - 100), y1 = mn(c.y + c.h, s2wy(H) + 100), sp = y1 - y0;
  if (sp <= 0) return;
  const z = c.z;
  const hue = z === Z_UP ? 190 : z === Z_WELL ? 288 : z === Z_WIND ? 24
    : z === Z_INV ? 262 : z === Z_FLOW ? 150 : 186;
  const drift = T * (z === Z_WIND ? 60 : z === Z_RUSH ? 300 : 200) * (z === Z_UP || z === Z_INV ? -1 : 1);
  X.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const q = hsh(i * 13, c.y | 0);
    const x = lerp(c.l + 30, c.r - 30, hsh(i, 7));
    const yy = y0 + (((q * sp + drift) % sp) + sp) % sp;
    zoneF(c, x, yy);
    const m = hyp(_zx, _zy);
    if (m < 1) continue;
    const ln = mn(64, m * .05);
    LIN(w2sx(x), w2sy(yy), w2sx(x + _zx / m * ln), w2sy(yy + _zy / m * ln),
      mx(1, 2.4 * SC), hsl(hue, 90, 70, .16 + q * .16));
  }
}

// Coins are circles; everything else is a spinning polygon with its own
// vertex count, radius and spin rate.
function drawItem(it) {
  const x = w2sx(it.x), y = w2sy(it.y), s = SC, b = 1 + sin(T * 3 + it.x * .02) * .12, t = it.t;
  if (!t) { CIR(x, y, 9 * s * b, UG, 'hsl(38 100% 84%)', mx(1, 2.4 * s)); return; }
  if (t === I_WELL) {
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + T * .6;
      BP(); AR(x, y, 26 * s * b, a, a + .8);
      SK(7 * s, chsl(i, 60));
    }
    CIR(x, y, 13 * s * b, '#fff');
    return;
  }
  const cr = t === I_CROWN, pg = t === I_PIG;
  // Boosters wear the colour of the verb they amplify; White Efficiency is white.
  const bc = pg ? it.c : BOOST[it.c][0];
  const n = cr ? 10 : pg ? 6 : 3, rad = (cr ? 16 : pg ? 12 : 15) * s * b;
  X.save(); X.translate(x, y);
  X.rotate(T * (cr ? .8 : pg ? 1.4 : -1) + it.c);
  POLY(n, cr ? UG : pg ? chsl(bc, 60) : bc > 6 ? '#fff' : chsl(bc, 60),
    pg ? chsl(bc, 90) : '#fff', mx(1, 2 * s), (i) => {
      const a = i / n * TAU, q = rad * (cr && i & 1 ? .4 : 1);
      VTX(i, cos(a) * q, sin(a) * q);
    });
  X.restore();
}

// --- player strokes --------------------------------------------------------
// A fused stroke paints a gradient through every colour it carries - that
// gradient is the whole visual language of mixing.
function strokeColor(s, a) {
  const bits = [];
  for (let i = 0; i < 7; i++) if (s.e & CBIT[i]) bits.push(i);
  if (bits.length < 2) return chsl(bits[0] | 0, 60, a);
  const g = X.createLinearGradient(w2sx(s.x1), w2sy(s.y1), w2sx(s.x2), w2sy(s.y2));
  bits.forEach((b, i) => g.addColorStop(i / (bits.length - 1), chsl(b, 64, a)));
  return g;
}

function drawStrokes() {
  X.lineCap = 'round';
  for (const s of strokes) {
    // A live stroke is permanent, so it is drawn at full strength. Only a spent
    // one fades, and that fade is the only thing that says it was consumed.
    const a = s.u ? clamp(s.l / SPENT, 0, 1) : 1;
    const x1 = w2sx(s.x1), y1 = w2sy(s.y1), x2 = w2sx(s.x2), y2 = w2sy(s.y2);
    // Four passes, because a drawing must never be mistakable for scenery: a
    // Green line in Cloudbreak sat at almost exactly the hue of that region's
    // bumpers. Glow, dark casing, colour, white core -- the casing and the core
    // are what separate the player's marks from the world at any palette.
    LIN(x1, y1, x2, y2, mx(4, 20 * SC), strokeColor(s, a * .16));
    SK(mx(3, (ST * 2 + 5) * SC), 'hsl(266 55% 5% / ' + a * .8 + ')');
    SK(mx(2, ST * 2 * SC), strokeColor(s, a));
    SK(mx(1, ST * .8 * SC), 'hsl(0 0% 100% / ' + a * .5 + ')');
    if (!s.u) {
      // The pin: where the drag began. Green hangs its rope here, so this ring
      // is not decoration -- it is the fact the tether rule depends on.
      CIR(x1, y1, (4.5 + sin(T * 4 + s.x1) * .8) * SC, 0, chsl(s.c, 80, .9), mx(1, 2 * SC));
      // The aim: Orange fires you toward the far end, so the end gets an arrow.
      const dx = x2 - x1, dy = y2 - y1, L = hyp(dx, dy);
      if (L > 16) {
        const ux = dx / L, uy = dy / L, hd = 9 * SC;
        POLY(3, chsl(s.c, 70, .95), 0, 0, (i) => {
          const b = [0, 2.4, -2.4][i], cb = cos(b) * hd, sb = sin(b) * hd;
          VTX(i, x2 + cb * ux - sb * uy, y2 + sb * ux + cb * uy);
        });
      }
    }
    if (s === P.ra) {
      X.setLineDash([4 * SC, 9 * SC]); X.lineDashOffset = -T * 90 * SC;
      SK(mx(1, 3 * SC), 'hsl(190 100% 88% / .9)');
      X.setLineDash([]);
    }
  }
  for (const n of nodes) {
    const a = n.t / .5;
    CIR(w2sx(n.x), w2sy(n.y), (6 + (1 - a) * 26) * SC, 0, 'hsl(0 0% 100% / ' + a + ')', mx(1, 3 * SC));
  }
  if (P.te) {
    const ax = w2sx(P.te.x), ay = w2sy(P.te.y);
    // The rope, plus the circle it may sweep. The radius is the length of the
    // line you drew, and seeing it is what turns the swing into something you
    // aim rather than something that happens to you.
    CIR(ax, ay, P.te.l * SC, 0, chsl(3, 60, .16), mx(1, 1.4 * SC));
    LIN(ax, ay, w2sx(P.x), w2sy(P.y), mx(1, 3.2 * SC), chsl(3, 70));
    CIR(ax, ay, 8 * SC, chsl(3, 60));
    CIR(ax, ay, (12 + sin(T * 9) * 3) * SC, 0, chsl(3, 80, .8), mx(1, 2 * SC));
  }
}

function drawParts() {
  X.lineCap = 'round';
  // Shockwaves sit under everything else so they read as pressure, not confetti.
  for (const w of shocks) {
    const a = clamp(w.t, 0, 1);
    CIR(w2sx(w.x), w2sy(w.y), w.r * SC, 0, hsl(w.h | 0, 100, 70, a * .7), mx(1, 5 * a * SC));
  }
  for (const p of parts) {
    const a = clamp(p.l / p.L, 0, 1), x = w2sx(p.x), y = w2sy(p.y);
    if (p.k === 4) {
      // Debris: a real spinning fragment of whatever just came apart.
      X.save(); X.translate(x, y); X.rotate(p.a);
      const q = p.s * SC * (.4 + a * .6);
      POLY(4, hsl(p.h | 0, 70, 40 + a * 26, a), hsl(p.h | 0, 90, 70, a), mx(1, 1.2 * SC),
        (i) => VTX(i, [-1, .8, 1.2, -.6][i] * q, [-.7, -1.2, .9, 1][i] * q));
      X.restore();
      continue;
    }
    if (p.k === 2) CIR(x, y, (1 - a) * p.s * 9 * SC, 0, hsl(p.h | 0, 100, 70, a), mx(1, 3 * a * SC));
    else LIN(x, y, x - p.vx * (p.k ? .02 : .012) * SC, y - p.vy * (p.k ? .02 : .012) * SC,
      mx(1, p.s * (p.k ? 1 : a) * SC), hsl(p.h | 0, p.k ? 70 : 100, p.k ? 60 : 60, a));
  }
  for (const p of pops) {
    const a = clamp(p.l, 0, 1);
    txt(p.t, w2sx(p.x), w2sy(p.y), 17 * SC / U,
      p.h < 0 ? 'hsl(0 0% 100% / ' + a + ')' : hsl(p.h | 0, 100, 70, a), 1);
  }
}

// --- the unicorn -----------------------------------------------------------
function pushTrail() {
  const n = trail.length ? trail[trail.length - 1] : 0;
  if (!n || hyp(P.x - n.x, P.y - n.y) > 7) {
    trail.push({ x: P.x, y: P.y, h: fullSpec > 0 ? -1 : HUE[sel] });
    while (trail.length > 26 + clamp(P.sp / 30, 0, 30)) trail.shift();
  }
}

function drawTrail() {
  const n = trail.length, style = WD ? SAVE.e[2] : 0;
  X.lineCap = 'round';
  for (let i = 1; i < n; i++) {
    if (WD && style === 1 && i % 2) continue;
    const a = i / n, p = trail[i - 1], q = trail[i];
    LIN(w2sx(p.x), w2sy(p.y), w2sx(q.x), w2sy(q.y),
      mx(1, 15 * a * SC * (WD && style === 2 ? .6 + rnd() * .8 : 1)),
      hsl((q.h < 0 ? (T * 400 + i * 26) % 360 : q.h) | 0, 100, 60 + a * 18, a * .8));
  }
}

// The unicorn, drawn in local units under the current transform. Shared by
// gameplay and the store preview so there is exactly one unicorn in the game.
function unicornBody(body, tint, white, horn) {
  // Every alternative body, horn and trail is a store cosmetic, so each one
  // is behind WD and none of them exist in the competition build. What is
  // left is the unicorn everyone starts with, unchanged.
  const main = white ? '#fff' : WD && body === 1 ? 'hsl(268 40% 12%)' : WD && body === 2 ? 'hsl(190 100% 72%)' : 'hsl(300 40% 96%)';
  const line = white ? chsl(flr(T * 6) % 7, 70) : WD && body === 2 ? 'hsl(300 100% 70%)' : 'hsl(280 45% 62%)';
  const gal = sin(T * 13), rb = flr(T * 5);
  X.lineCap = 'round';

  BP(); MT(-13, 0);
  for (let i = 1; i < 5; i++) LT(-13 - i * 6, sin(T * 9 - i * .8) * (2 + i * 1.6));
  SK(5, chsl((rb + 2) % 7, 60));
  SK(2.4, chsl((rb + 5) % 7, 80));

  for (let i = 0; i < 4; i++) {
    const lx = -8 + (i >> 1) * 15, ph = gal * (i & 1 ? 1 : -1) * (i > 1 ? -1 : 1);
    BP(); MT(lx, 6); LT(lx + ph * 5, 15); LT(lx + ph * 8 + 2, 20);
    SK(3, main);
  }

  BP(); X.ellipse(0, 0, 17, 11, 0, 0, TAU);
  FL(main); SK(2, line);
  BP(); MT(8, -6);
  X.quadraticCurveTo(20, -14, 26, -12);
  X.quadraticCurveTo(30, -11, 30, -5);
  LT(20, -1); X.closePath();
  FL(main); SK(2, line);

  for (let i = 0; i < 4; i++) {
    BP(); MT(6 + i * 4, -7 - i);
    X.quadraticCurveTo(2 + i * 4, -16 - i * 1.6, 9 + i * 4, -18 - i);
    SK(3.2, chsl((rb + i) % 7, 60));
  }

  // Horn: 0 spiral, 1 long lance, 2 star tip. Purely decorative - the body is
  // a circle of radius R whatever is equipped.
  X.save(); X.translate(26, -12); X.rotate(-.6);
  const hl = WD && horn === 1 ? 26 : 15;
  const hg = X.createLinearGradient(0, 0, 0, -hl);
  hg.addColorStop(0, chsl(0, 60)); hg.addColorStop(1, chsl(tint, 90));
  POLY(3, hg, '#fff', 1.2, (i) => VTX(i, [-3, 3, 0][i], [0, 0, -hl][i]));
  if (!WD || !horn) for (let i = 0; i < 4; i++) {
    const q = i / 4;
    LIN(-3 + q * 6 * .5, -hl * q, 3 - q * 6 * .5, -hl * q - 2, 1.2, chsl((rb + i) % 7, 90));
  }
  if (WD && horn === 2) POLY(10, '#fff', chsl(tint, 90), 1, (i) => {
    const a = i / 10 * TAU + T * 2, q = (i & 1 ? 2.4 : 6);
    VTX(i, cos(a) * q, -hl + sin(a) * q);
  });
  X.restore();

  CIR(26, -8, 1.6, st === 1 && P.st > STALLW ? '#f44' : '#2a1836');
}

function drawUnicorn() {
  const s = SC, x = w2sx(P.x), y = w2sy(P.y);
  X.save();
  X.translate(x, y); X.rotate(P.a); X.scale(s, s);
  unicornBody(WD ? SAVE.e[0] : 0, sel, fullSpec > 0 || P.ph > 0, WD ? SAVE.e[1] : 0);
  X.restore();

  // Selected-colour halo, tinted red while Red-charged: world-space feedback
  // so the player never has to glance at the HUD.
  CIR(x, y, (R + 7) * s, 0, P.rp > 0 ? 'hsl(6 100% 62%)' : chsl(sel, 70, .5), mx(1, (P.rp > 0 ? 3 : 2) * s));
  if (P.st > STALLW) {
    const u = (P.st - STALLW) / (STALLT - STALLW);
    BP(); AR(x, y, (R + 16 + sin(T * 20) * 4) * s, -PI / 2, -PI / 2 + TAU * (1 - u));
    SK(mx(2, 4 * s), 'hsl(' + (30 - u * 30) + ' 100% 60%)');
  }
}
