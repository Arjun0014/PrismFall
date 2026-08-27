// ---------------------------------------------------------------------------
// Rendering: camera, region backdrops, world geometry, the procedural unicorn,
// trail and particles. Everything is Canvas2D primitives — no assets.
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
function pt(x, y, vx, vy, l, h, k, s) {
  if (parts.length > 340) parts.shift();
  parts.push({ x, y, vx, vy, l, L: l, h, k, s });
}
function burst(x, y, n, k, spd, hue, vx, vy) {
  const h = hue === undefined ? HUE[sel] : hue;
  // k===1 is a generic world impact — the equipped Impact cosmetic restyles it.
  const kk = k === 1 ? SAVE.e[2] : k;
  for (let i = 0; i < n; i++) {
    const a = rf(0, TAU), v = rf(.3, 1) * spd;
    pt(x, y, (vx || 0) + cos(a) * v, (vy || 0) + sin(a) * v,
      rf(.18, .55), h + rf(-18, 18), kk, rf(1.4, 3.6));
  }
}
function warpFX(x, y) {
  pt(x, y, 0, 0, .4, HUE[6], 2, 8);
  burst(x, y, 12, 0, 320, HUE[6]);
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
    if (p.k !== 2) { p.vy += 400 * h; p.vx *= .985; p.vy *= .985; }
  }
  for (let i = pops.length; i--;) {
    const p = pops[i]; p.y -= 46 * h;
    if ((p.l -= h) <= 0) pops.splice(i, 1);
  }
  for (let i = nodes.length; i--;) if ((nodes[i].t -= h) <= 0) nodes.splice(i, 1);
}

// --- camera ----------------------------------------------------------------
function camUpdate(h) {
  const v = vault;
  C.x = approach(C.x, v ? v.cx : P.x + clamp(P.vx * .16, -240, 240), v ? 3.5 : 7.5, h);
  C.y = approach(C.y, v ? v.cy : P.y + clamp(P.vy * .24, -.19 * VH, .25 * VH), v ? 3.5 : 7.5, h);
  C.z = approach(C.z, v ? .82 : 1 / (1 + P.sp / 5200), 4, h);
  SC = mn(H / VH, W / (COL * 2 + 46)) * C.z;
  shake = mx(0, shake - shake * 7 * h - 4 * h);
  const s = mn(shake, 24);
  shX = rf(-s, s); shY = rf(-s, s);
}
const w2sx = (x) => W / 2 + (x - C.x) * SC + shX;
const w2sy = (y) => H / 2 + (y - C.y) * SC + shY;
const s2wx = (x) => C.x + (x - W / 2 - shX) / SC;
const s2wy = (y) => C.y + (y - H / 2 - shY) / SC;

// Shortest-path hue interpolation so palettes cross-fade instead of spinning.
const alerp = (a, b, r, h) => (a + (((b - a + 540) % 360) - 180) * (1 - M.exp(-r * h)) + 360) % 360;

// Target palette derived from the region's three numbers:
// [bgTopH, bgTopS, bgTopL, bgBotH, bgBotS, bgBotL, geoH, geoL]
const regPal = (r) => {
  const hu = REG[r][1], sp = REG[r][2];
  return [hu, r > 5 ? 0 : 62, 12 - r * 1.4, hu + sp, 55, 27 - r * 1.6, hu + sp * .62, REG[r][3]];
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
  const g = X.createLinearGradient(0, 0, W * .25, H);
  g.addColorStop(0, hsl(pal[0] | 0, pal[1] | 0, pal[2] | 0));
  g.addColorStop(1, hsl(pal[3] | 0, pal[4] | 0, pal[5] | 0));
  X.fillStyle = g; X.fillRect(0, 0, W, H);
  const k = MOT[reg];
  X.lineWidth = mx(1, 2.4 * SC);
  for (let L = 0; L < 2; L++) {
    const par = L ? .4 : .16, size = L ? 300 : 560, al = L ? .13 : .05;
    const cx = C.x * par, cy = C.y * par, hw = W / 2 / SC, hh = H / 2 / SC;
    const x1 = flr((cx + hw) / size), y1 = flr((cy + hh) / size);
    for (let gy = flr((cy - hh) / size); gy <= y1; gy++)
      for (let gx = flr((cx - hw) / size); gx <= x1; gx++) {
        const v = hsh(gx * 31 + k[0], gy * 17);
        if (v < .4) continue;
        const wx = (gx + .15 + hsh(gx, gy) * .7) * size, wy = (gy + .15 + hsh(gy, gx + 9) * .7) * size;
        const hue = pal[6] + (v - .5) * 60 | 0;
        X.fillStyle = hsl(hue, 60, pal[7] | 0, al);
        X.strokeStyle = hsl(hue, 70, pal[7] | 0, al * 2);
        motif(k, W / 2 + (wx - cx) * SC, H / 2 + (wy - cy) * SC, size * (.16 + v * .3) * SC, v);
      }
  }
}

// Motif families: [prim, a, b].
// prim 0 blobs · 1 polygon(a sides, b/10 inner radius, b<0 rough)
// prim 2 rings(a) + spokes(|b|), b<0 = partial arcs instead of full rings.
const MOT = [[0, 3, 0], [2, 1, 8], [2, 2, -3], [1, 5, 4], [1, 7, -1], [2, 3, 6], [2, 1, 4]];

function motif(k, x, y, r, v) {
  const a1 = k[1], a2 = k[2];
  BP();
  if (!k[0]) {
    for (let i = 0; i < 3; i++) AR(x + (i - 1) * r * .5, y + (i & 1 ? r * .16 : 0), r * (.5 - i * .06));
    X.fill();
  } else if (k[0] < 2) {
    for (let i = 0; i < a1; i++) {
      const a = i / a1 * TAU + v * 4;
      const q = r * (a2 < 0 ? .6 + hsh(i, v * 99) * .5 : i & 1 ? a2 / 10 : 1);
      VTX(i, x + cos(a) * q, y + sin(a) * q);
    }
    X.closePath(); X.fill();
  } else {
    const span = a2 < 0 ? 2.4 : TAU, n = abs(a2);
    for (let i = 1; i <= a1; i++) { BP(); AR(x, y, r * (1 - i * .22), v * TAU, v * TAU + span); X.stroke(); }
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
];
function obStyle(o) {
  const m = o.m;
  const i = m & M_DAMP ? 0 : m & M_BREAK ? 1 : m & M_PHASE ? 2 : m & M_RAIL ? 3 : m & M_ANCH ? 4 : -1;
  if (i < 0) {
    const b = m & M_BUMP;
    return [hsl(pal[6] + (b ? 30 : 0) | 0, b ? 90 : 38, b ? 46 : mx(16, pal[7] * .32) | 0),
      hsl(pal[6] + (b ? 40 : 0) | 0, b ? 100 : 55, b ? 78 : pal[7] | 0)];
  }
  const s = MSTY[i];
  return [hsl(s[0], s[1], s[2]), hsl(s[0], s[3], s[4])];
}

function drawWorld() {
  const y0 = s2wy(0) - 200, y1 = s2wy(H) + 200;
  const wide = mx(2, (ST * 2 + 3) * SC), thin = mx(1, ST * SC);
  const mass = hsl(pal[6] | 0, 45, mx(3, pal[7] * .1) | 0);
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
    for (const o of c.o) {
      if (o.k) continue;
      obT(o);
      const s2 = obStyle(o);
      if (!o.t) {
        CIR(w2sx(_cx), w2sy(_cy), o.r * SC, s2[0], s2[1], mx(1, 2.5 * SC));
        if (o.m & M_BUMP) CIR(w2sx(_cx), w2sy(_cy), o.r * SC * .55, 0, s2[1], mx(1, 1.6 * SC));
      } else {
        const cg = cos(_cg) * o.L, sg2 = sin(_cg) * o.L;
        LIN(w2sx(_cx - cg), w2sy(_cy - sg2), w2sx(_cx + cg), w2sy(_cy + sg2), wide, s2[0]);
        SK(thin, s2[1]);
        if (o.m & M_BREAK) {
          X.setLineDash([6 * SC, 7 * SC]);
          SK(mx(1, 2 * SC), 'hsl(48 100% 80% / .85)');
          X.setLineDash([]);
        }
      }
    }
    for (const it of c.i) if (!it.g) drawItem(it);
  }
}

// Coins are circles; everything else is a spinning polygon with its own
// vertex count, radius and spin rate.
function drawItem(it) {
  const x = w2sx(it.x), y = w2sy(it.y), s = SC, b = 1 + sin(T * 3 + it.x * .02) * .12, t = it.t;
  if (!t) { CIR(x, y, 9 * s * b, UG, 'hsl(38 100% 84%)', mx(1, 2.2 * s)); return; }
  if (t === I_WELL) {
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + T * .6;
      BP(); AR(x, y, 24 * s * b, a, a + .8);
      SK(7 * s, chsl(i, 62));
    }
    CIR(x, y, 13 * s * b, '#fff');
    return;
  }
  const cr = t === I_CROWN, pg = t === I_PIG;
  const n = cr ? 10 : pg ? 6 : 3, rad = (cr ? 16 : pg ? 12 : 15) * s * b;
  X.save(); X.translate(x, y);
  X.rotate(T * (cr ? .8 : pg ? 1.4 : -1) + it.c);
  POLY(n, cr ? UG : pg ? chsl(it.c, 58) : it.c ? '#fff' : hsl(0, 100, 60),
    pg ? chsl(it.c, 86) : '#fff', mx(1, 2 * s), (i) => {
      const a = i / n * TAU, q = rad * (cr && i & 1 ? .44 : 1);
      VTX(i, cos(a) * q, sin(a) * q);
    });
  X.restore();
}

// --- player strokes --------------------------------------------------------
// A fused stroke paints a gradient through every colour it carries — that
// gradient is the whole visual language of mixing.
function strokeColor(s, a) {
  const bits = [];
  for (let i = 0; i < 7; i++) if (s.e & CBIT[i]) bits.push(i);
  if (bits.length < 2) return chsl(bits[0] | 0, 62, a);
  const g = X.createLinearGradient(w2sx(s.x1), w2sy(s.y1), w2sx(s.x2), w2sy(s.y2));
  bits.forEach((b, i) => g.addColorStop(i / (bits.length - 1), chsl(b, 64, a)));
  return g;
}

function drawStrokes() {
  X.lineCap = 'round';
  for (const s of strokes) {
    const a = clamp(s.l / SLIFE * 1.6, .12, 1);
    LIN(w2sx(s.x1), w2sy(s.y1), w2sx(s.x2), w2sy(s.y2), mx(3, 16 * SC), strokeColor(s, a * .22));
    SK(mx(2, ST * 2 * SC), strokeColor(s, a));
    if (s === P.ra) {
      X.setLineDash([4 * SC, 9 * SC]); X.lineDashOffset = -T * 90 * SC;
      SK(mx(1, 3 * SC), 'hsl(190 100% 88% / .9)');
      X.setLineDash([]);
    }
  }
  for (const n of nodes) {
    const a = n.t / .55;
    CIR(w2sx(n.x), w2sy(n.y), (6 + (1 - a) * 26) * SC, 0, 'hsl(0 0% 100% / ' + a + ')', mx(1, 3 * SC));
  }
  if (P.te) {
    const ax = w2sx(P.te.x), ay = w2sy(P.te.y);
    LIN(ax, ay, w2sx(P.x), w2sy(P.y), mx(1, 3.4 * SC), chsl(3, 70));
    CIR(ax, ay, 8 * SC, chsl(3, 62));
  }
}

function drawParts() {
  X.lineCap = 'round';
  for (const p of parts) {
    const a = clamp(p.l / p.L, 0, 1), x = w2sx(p.x), y = w2sy(p.y);
    if (p.k === 2) CIR(x, y, (1 - a) * p.s * 9 * SC, 0, hsl(p.h | 0, 100, 75, a), mx(1, 3 * a * SC));
    else LIN(x, y, x - p.vx * (p.k ? .02 : .012) * SC, y - p.vy * (p.k ? .02 : .012) * SC,
      mx(1, p.s * (p.k ? 1 : a) * SC), hsl(p.h | 0, p.k ? 70 : 100, p.k ? 55 : 68, a));
  }
  for (const p of pops) {
    const a = clamp(p.l, 0, 1);
    txt(p.t, w2sx(p.x), w2sy(p.y), 17 * SC / U,
      p.h < 0 ? 'hsl(0 0% 100% / ' + a + ')' : hsl(p.h | 0, 100, 70, a), 'center', 1);
  }
}

// --- the unicorn -----------------------------------------------------------
function pushTrail() {
  const n = trail.length ? trail[trail.length - 1] : 0;
  if (!n || hyp(P.x - n.x, P.y - n.y) > 7) {
    trail.push({ x: P.x, y: P.y, h: fullSpec > 0 ? -1 : HUE[sel] });
    while (trail.length > 26 + clamp(P.sp / 34, 0, 34)) trail.shift();
  }
}

function drawTrail() {
  const n = trail.length, style = SAVE.e[1];
  X.lineCap = 'round';
  for (let i = 1; i < n; i++) {
    if (style === 1 && i % 2) continue;
    const a = i / n, p = trail[i - 1], q = trail[i];
    LIN(w2sx(p.x), w2sy(p.y), w2sx(q.x), w2sy(q.y),
      mx(1, 15 * a * SC * (style === 2 ? .6 + rnd() * .8 : 1)),
      hsl((q.h < 0 ? (T * 400 + i * 26) % 360 : q.h) | 0, 100, 60 + a * 18, a * .8));
  }
}

// The unicorn, drawn in local units under the current transform. Shared by
// gameplay and the store preview so there is exactly one unicorn in the game.
function unicornBody(body, tint, white) {
  const main = white ? '#fff' : body === 1 ? 'hsl(268 40% 12%)' : body === 2 ? 'hsl(190 100% 72%)' : 'hsl(300 40% 96%)';
  const line = white ? chsl(flr(T * 6) % 7, 70) : body === 2 ? 'hsl(300 100% 70%)' : 'hsl(280 45% 62%)';
  const gal = sin(T * 13), rb = flr(T * 5);
  X.lineCap = 'round';

  BP(); MT(-13, 0);
  for (let i = 1; i < 5; i++) LT(-13 - i * 6, sin(T * 9 - i * .8) * (2 + i * 1.6));
  SK(5, chsl((rb + 2) % 7, 65));
  SK(2.4, chsl((rb + 5) % 7, 80));

  for (let i = 0; i < 4; i++) {
    const lx = -8 + (i >> 1) * 15, ph = gal * (i & 1 ? 1 : -1) * (i > 1 ? -1 : 1);
    BP(); MT(lx, 6); LT(lx + ph * 5, 15); LT(lx + ph * 8 + 2, 20);
    SK(3, main);
  }

  BP(); X.ellipse(0, 0, 17, 11, 0, 0, TAU);
  FL(main); SK(2, line);
  BP(); MT(8, -6);
  X.quadraticCurveTo(20, -14, 25, -12);
  X.quadraticCurveTo(31, -11, 30, -5);
  LT(20, -1); X.closePath();
  FL(main); SK(2, line);

  for (let i = 0; i < 4; i++) {
    BP(); MT(6 + i * 4, -7 - i);
    X.quadraticCurveTo(2 + i * 4, -16 - i * 1.5, 9 + i * 4, -18 - i);
    SK(3.4, chsl((rb + i) % 7, 66));
  }

  X.save(); X.translate(26, -12); X.rotate(-.62);
  const hl = 15;
  const hg = X.createLinearGradient(0, 0, 0, -hl);
  hg.addColorStop(0, chsl(0, 65)); hg.addColorStop(1, chsl(tint, 82));
  POLY(3, hg, '#fff', 1.2, (i) => VTX(i, [-3, 3, 0][i], [0, 0, -hl][i]));
  X.restore();

  CIR(26, -8, 1.7, st === 1 && P.st > STALLW ? '#f44' : '#2a1836');
}

function drawUnicorn() {
  const s = SC, x = w2sx(P.x), y = w2sy(P.y);
  X.save();
  X.translate(x, y); X.rotate(P.a); X.scale(s, s);
  unicornBody(SAVE.e[0], sel, fullSpec > 0 || P.ph > 0);
  X.restore();

  // Selected-colour halo, tinted red while Red-charged: world-space feedback
  // so the player never has to glance at the HUD.
  CIR(x, y, (R + 7) * s, 0, P.rp > 0 ? 'hsl(6 100% 62%)' : chsl(sel, 70, .55), mx(1, (P.rp > 0 ? 3 : 2) * s));
  if (P.st > STALLW) {
    const u = (P.st - STALLW) / (STALLT - STALLW);
    BP(); AR(x, y, (R + 16 + sin(T * 22) * 4) * s, -PI / 2, -PI / 2 + TAU * (1 - u));
    SK(mx(2, 4 * s), 'hsl(' + (30 - u * 30) + ' 100% 60%)');
  }
}
