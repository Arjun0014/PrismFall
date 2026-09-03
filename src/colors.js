// ---------------------------------------------------------------------------
// The seven colours, pigment economy, stroke drawing and effect composition.
//
// Effects are applied in a fixed order so that any combination of live bits is
// deterministic:  space -> constraint -> gravity -> direction -> bounce -> energy.
// Mixing is therefore free: two overlapping strokes simply OR their bitmasks.
// ---------------------------------------------------------------------------

let chainT = 0;     // seconds left before the colour chain lapses
let dryC = -1, dryT = 0;   // "out of pigment" HUD flash

// Booster lookup: the strength multiplier currently applied to colour c, or 1.
// Colour 7 is the pigment-cost booster.
function bst(c) {
  for (let i = 0; i < 7; i++) if (boostT[i] > 0 && BOOST[i][0] == c) return BOOST[i][1];
  return 1;
}
// How strong a stroke of length L is. Every colour reads this one curve, so
// "draw longer for more of it" is a single rule the player learns once, and
// pigment already bills per unit length so the cost side needs no new economy.
const pw = (L) => .45 + mn(L, SMAX) / SNOM * .55;

// --- drawing ---------------------------------------------------------------
// A stroke may only begin within SREACH of the unicorn; further clicks clamp
// back onto that circle so the player is never silently ignored.
function startStroke() {
  if (st != 1 || !P.al) return;
  if (pig[sel] <= .5) { dryC = sel; dryT = .5; sndEmpty(); return; }
  const dx = mwx - P.x, dy = mwy - P.y, k = mn(1, SREACH / (hyp(dx, dy) || 1));
  const sx = P.x + dx * k, sy = P.y + dy * k;
  // n is the number of times the stroke may fire before it is spent; l is only
  // a fade timer, and only ticks once it has been. A drawing you never use
  // stays on the field for the whole run.
  drawing = { x1: sx, y1: sy, x2: sx, y2: sy, e: CBIT[sel], c: sel, l: 0, u: 0, paid: 0 };
  strokes.push(drawing);
  while (strokes.length > SLIM) if (P.ra == strokes.shift()) detachRail(0);
  if (P.te) releaseTether();
}

// Growing a stroke spends pigment; shrinking it back is free but refunds
// nothing, so length is a real decision.
function moveStroke() {
  const s = drawing;
  if (!s) return;
  const dx = mwx - s.x1, dy = mwy - s.y1, d = hyp(dx, dy);
  if (d < 1) return;
  let L = mn(d, SMAX);
  if (L > s.paid) {
    const unit = PC[s.c] * bst(7), want = (L - s.paid) * unit;
    if (pig[s.c] >= want) { pig[s.c] -= want; s.paid = L; }
    else {
      L = s.paid += pig[s.c] / unit;
      pig[s.c] = 0;
      if (dryT <= 0) { dryC = s.c; dryT = .6; sndEmpty(); }
    }
  }
  s.x2 = s.x1 + dx / d * L; s.y2 = s.y1 + dy / d * L;
  fuse(s);
}

// Overlapping live strokes fuse into a Prism Node and share effect bits.
function fuse(s) {
  for (const o of strokes) {
    if (o == s || o.u || o.e == s.e) continue;
    const p = segX(s.x1, s.y1, s.x2, s.y2, o.x1, o.y1, o.x2, o.y2);
    if (p) {
      s.e = o.e = s.e | o.e;
      nodes.push({ x: p[0], y: p[1], t: .55 });
      sndFuse();
    }
  }
}

// --- collision with a live stroke ------------------------------------------
// A stroke fires once, on the first contact after it is long enough to matter.
function hitStroke(s) {
  const ax = s.x2 - s.x1, ay = s.y2 - s.y1, L = hyp(ax, ay);
  if (s.u || s == drawing || s == P.ra || L < SMIN) return 0;
  const t = segT(s.x1, s.y1, s.x2, s.y2, P.x, P.y);
  const px = s.x1 + ax * t, py = s.y1 + ay * t;
  let nx = P.x - px, ny = P.y - py;
  const d = hyp(nx, ny);
  if (d > R + ST) return 0;
  const ux = ax / L, uy = ay / L;
  if (d < 1e-3) { nx = -uy; ny = ux; } else { nx /= d; ny /= d; }
  applyStroke(s, nx, ny, px, py, t, ux, uy, L);
  hitCd = .05;
  return 1;
}

function applyStroke(s, nx, ny, px, py, t, ux, uy, L) {
  const b = s.e;
  const q = pw(L);          // length -> strength, the rule shared by all seven
  let consume = 1;

  // 1 --- SPACE (Violet) ----------------------------------------------------
  // With a second live Violet stroke on screen the pair becomes a portal and
  // the exit angle rotates your velocity; alone it is a phase dash that passes
  // straight through the next obstacle. Fused with Blue it phases a whole rail.
  if (b & 64) {
    const vb = bst(6);
    if (b & 16) P.ph = .8 * vb;
    else {
      let o2 = 0;
      for (const o of strokes) if (o != s && !o.u && o.e & 64) { o2 = o; break; }
      warpFX(P.x, P.y);
      if (o2) {
        const da = at2(o2.y2 - o2.y1, o2.x2 - o2.x1) - at2(uy, ux), ca = cos(da), sa = sin(da);
        const vx = P.vx * ca - P.vy * sa, vy = P.vx * sa + P.vy * ca;
        const k = (R + ST + 8) / (hyp(vx, vy) || 1);
        P.vx = vx; P.vy = vy;
        P.x = (o2.x1 + o2.x2) / 2 + vx * k;
        P.y = (o2.y1 + o2.y2) / 2 + vy * k;
        o2.u = 1; o2.l = .12;
      } else {
        // A lone Violet stroke is a dash along the current heading - or, from a
        // standstill, straight off the face of the stroke, so Violet is also an
        // escape tool rather than a no-op when you need it most.
        const sp = hyp(P.vx, P.vy);
        const reach = 300 * vb * q;
        if (sp < 60) { P.x += nx * reach; P.y += ny * reach; P.vx = nx * 460; P.vy = ny * 460; }
        else { const k = reach / sp; P.x += P.vx * k; P.y += P.vy * k; }
      }
      // Land inside the shaft, whatever the exit geometry said.
      wallsAt(P.y);
      P.x = clamp(P.x, _wl + R, _wr - R);
      P.ph = .34 * vb * q; P.vx *= 1.07; P.vy *= 1.07;
      warpFX(P.x, P.y);
    }
    sndWarp();
  }

  // 2 --- CONSTRAINT (Blue rail, Green tether) ------------------------------
  if (b & 16) {
    if (P.te) releaseTether();
    P.ra = s; P.rt = t;
    // Superrail does not extend a timer -- the rail already lasts as long as
    // the line does. It makes the rail reflect at its ends instead of dropping
    // you, so a short line becomes a shuttle you can ride.
    P.rw = bst(4) > 1 ? 4 : 0;
    P.rs = nx * -uy + ny * ux >= 0 ? 1 : -1;
    const sp = mx(hyp(P.vx, P.vy), 340 + 180 * q);
    const dir = P.vx * ux + P.vy * uy >= 0 ? 1 : -1;
    P.vx = ux * sp * dir; P.vy = uy * sp * dir;
    consume = 0;
    sndRail(1);
  } else if (b & 8) {
    if (P.ra) detachRail(0);
    const gb = bst(3);
    // The pin is where you began the drag and the rope is as long as the line
    // you drew -- so the swing you get is the swing you can see before you
    // commit, at any size you like. Nothing is clamped away.
    P.te = { x: s.x1, y: s.y1, l: mx(L * gb, 30), t: (1.4 + q) * gb };
    sndTether(1);
  }

  // 3 --- GRAVITY (Indigo) --------------------------------------------------
  if (b & 32) {
    Gx = nx * GRAV; Gy = ny * GRAV; P.gt = 2.9 * bst(5) * q;
    sndGrav(ny);
    burst(px, py, 10, 3, 150, HUE[5]);
  }

  // 4/5 --- DIRECTION (Orange) / BOUNCE (Yellow) ----------------------------
  const dirB = b & 2, sprB = b & 4;
  if (dirB) {
    const sp = hyp(P.vx, P.vy);
    const ns = sprB ? mx(sp * 1.34, 560 + 320 * q) : mx(sp * .99, 250 + 250 * q);
    P.vx = ux * ns; P.vy = uy * ns;
    sndVector(sprB);
  } else if (sprB) {
    const vn = P.vx * nx + P.vy * ny, e = (1.25 + .6 * q) * bst(2);
    P.vx -= (1 + e) * vn * nx; P.vy -= (1 + e) * vn * ny;
    // The floor scales with the impact so a spring stays impact-driven: it pops
    // you off on a glancing hit, but it can never rescue a dead-stopped unicorn.
    // That job belongs to Red.
    const on = P.vx * nx + P.vy * ny, fl = mn(300 + 300 * q, abs(vn) * 1.6);
    if (on < fl) { P.vx += (fl - on) * nx; P.vy += (fl - on) * ny; }
    sndSpring(abs(vn));
  } else if (!(b & 89)) {              // 89 = red|tether|rail|violet
    const vn = P.vx * nx + P.vy * ny;
    if (vn < 0) { P.vx -= 1.55 * vn * nx; P.vy -= 1.55 * vn * ny; }
  }

  // 6 --- ENERGY (Red) ------------------------------------------------------
  // Red never rebounds the way Yellow does: it mirrors the *aim* off the line so
  // it can't fire the unicorn back into it, then injects a fixed amount of
  // energy. That is why Red still works from a dead stop and Yellow does not.
  if (b & 1) {
    const rk = bst(0);
    let sp = hyp(P.vx, P.vy), dxn, dyn;
    if (sp < 50) { dxn = nx; dyn = ny; sp = 0; }
    else {
      dxn = P.vx / sp; dyn = P.vy / sp;
      const vn = dxn * nx + dyn * ny;
      if (vn < 0) { dxn -= 2 * vn * nx; dyn -= 2 * vn * ny; }
    }
    const ns = sp * 1.5 + 440 * rk * q;
    P.vx = dxn * ns; P.vy = dyn * ns;
    P.rp = .85;
    shake = mn(26, shake + 7);
    shock(px, py, 120 + 160 * q, HUE[0]);
    burst(px, py, 26, 0, 220, HUE[0], -dxn * 420, -dyn * 420);
    // Red is the destruction verb: the blast shatters every panel it reaches,
    // which then chains through its own neighbours.
    const bl = (90 + 110 * q) * rk;
    for (const c of NC) for (const o of c.o)
      if (!o.k && !o.kt && o.m & M_BREAK && hyp(o.x - px, o.y - py) < bl + o.r) { o.kt = .02; o.kd = 0; }
    sndBoost(ns);
  }

  clampV();
  if (consume) { s.u = 1; s.l = SPENT; }
  strokeFX(s, px, py);
  chainAdd(b);
}

// --- spectrum chain --------------------------------------------------------
// Successfully landing a new colour extends the spectrum chain. Refunds are
// deliberately partial: a perfect seven-colour loop never pays for itself.
function chainAdd(b) {
  const before = chain;
  chainT = 7;
  chain |= b & ALL7;
  if (chain == before) return;
  let n = 0;
  for (let i = 0; i < 7; i++) if (chain & CBIT[i]) n++;
  if (n <= chainN) return;
  chainN = n;
  if (n == 7) return fullSpectrum();
  if (n == 3 || n == 5) {
    for (let i = 0; i < 7; i++) pig[i] = mn(PMAX, pig[i] + 6);
    pop(P.x, P.y - 30, 'SPECTRUM ' + n + '/7', HUE[n]);
    sndRefund();
  }
}

function fullSpectrum() {
  fullSpec = 3.2;
  for (let i = 0; i < 7; i++) pig[i] = mn(PMAX, pig[i] + 26);
  mult = mn(12, mult + 1.5);
  score += 1200 * mult | 0;
  flash = 1; flashH = -1;
  shake = mn(32, shake + 14);
  pop(P.x, P.y - 46, 'FULL SPECTRUM', -1);
  sndSpectrum();
  chain = 0; chainN = 0;
}

// --- pickups ---------------------------------------------------------------
function grab(it) {
  it.g = 1;
  if (it.t == I_COIN) {
    combo++; comboT = 1.4; coins += 1;
    score += 10 * mult * (1 + combo * .05) | 0;
    sndCoin(combo);
  } else if (it.t == I_CROWN) {
    coins += 15; score += (500 * mult) | 0;
    pop(it.x, it.y, 'CROWN +15', 48);
    flash = mx(flash, .45); flashH = 48;
    sndCrown();
  } else if (it.t == I_PIG) {
    pig[it.c] = mn(PMAX, pig[it.c] + 40);
    sndPig(it.c);
    burst(it.x, it.y, 12, 3, 190, HUE[it.c]);
  } else if (it.t == I_WELL) {
    for (let i = 0; i < 7; i++) pig[i] = PMAX;
    flash = 1; flashH = -1;
    pop(it.x, it.y, 'PRISM WELL', -1);
    sndWell();
  } else {
    boostT[it.c] = BOOST[it.c][2];
    pop(it.x, it.y, BNAME[it.c], BOOST[it.c][0] > 6 ? -1 : HUE[BOOST[it.c][0]]);
    sndPower();
  }
}
