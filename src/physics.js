// ---------------------------------------------------------------------------
// Simulation: semi-fixed timestep, adaptive substeps, circle-vs-{circle,
// segment, arc} collision, plus the Blue rail and Green tether constraints.
// ---------------------------------------------------------------------------

let NC = [];        // chunks near the unicorn this step
let hitCd = 0;      // global stroke retrigger cooldown

// Velocity clamp plus a NaN guard: no combination of effects may destabilise
// the simulation.
function clampV() {
  const s = hyp(P.vx, P.vy);
  if (s > VMAX) { P.vx = P.vx / s * VMAX; P.vy = P.vy / s * VMAX; }
  if (!isFinite(s)) { P.vx = 0; P.vy = 200; }
  if (!isFinite(P.x + P.y)) { P.x = 0; P.y = depth; }
}

// --- constraints -----------------------------------------------------------
function detachRail(boost) {
  const s = P.ra;
  if (s) { s.u = 1; s.l = mn(s.l, .12); }
  P.ra = 0;
  if (boost) { P.vx *= 1.06; P.vy *= 1.06; }
  sndRail(0);
}

function railStep(h) {
  const s = P.ra;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = hyp(dx, dy);
  // A rail lasts as long as its line does, and its line is permanent. You come
  // off it by reaching an end, by hitting something, or by pressing X.
  if (s.u || L < 8) { detachRail(1); return 0; }
  const ux = dx / L, uy = dy / L;
  let sp = P.vx * ux + P.vy * uy;
  sp = sp * .998 + (Gx * ux + Gy * uy) * h;
  const floor_ = 370;
  if (abs(sp) < floor_) {
    const gd = Gx * ux + Gy * uy;
    sp = (gd ? (gd > 0 ? 1 : -1) : sp >= 0 ? 1 : -1) * floor_;
  }
  P.rt += sp * h / L;
  P.vx = ux * sp; P.vy = uy * sp;
  if (P.rt < 0 || P.rt > 1) {
    P.rt = clamp(P.rt, 0, 1);
    // Superrail reflects at the ends instead of dropping you, turning even a
    // short line into a shuttle.
    if (P.rw > 0) { P.rw -= h; P.vx = -P.vx; P.vy = -P.vy; P.rt = clamp(P.rt, .02, .98); sndSpring(400); }
    else { detachRail(1); return 0; }
  }
  const nx = -uy * P.rs, ny = ux * P.rs;
  P.x = s.x1 + dx * P.rt + nx * (R + ST);
  P.y = s.y1 + dy * P.rt + ny * (R + ST);
  if (rnd() < .5) burst(P.x, P.y, 3, 0, 60, HUE[4], -P.vx * .1, -P.vy * .1);
  return 1;
}

// Releasing a tether converts the orbit into a launch.
function releaseTether() {
  if (!P.te) return;
  P.te = 0;
  const s = hyp(P.vx, P.vy) || 1, k = 1.34 + 150 / s;
  P.vx *= k; P.vy *= k;
  clampV();
  burst(P.x, P.y, 10, 0, 260);
  sndTether(0);
}

// Inextensible rope: pull the body back onto the circle and drop the radial
// velocity. Orbits gain a hair of energy so a swing never quietly dies.
function tetherConstrain() {
  const t = P.te;
  let dx = P.x - t.x, dy = P.y - t.y;
  const d = hyp(dx, dy);
  if (d < 1 || d <= t.l) return;
  dx /= d; dy /= d;
  P.x = t.x + dx * t.l; P.y = t.y + dy * t.l;
  const vr = P.vx * dx + P.vy * dy;
  if (vr > 0) { P.vx -= vr * dx; P.vy -= vr * dy; }
  const s = hyp(P.vx, P.vy);
  if (s > 1 && s < 1500) { const k = mx(1.004, 320 / s); P.vx *= k; P.vy *= k; }
}

// --- item pickup -----------------------------------------------------------
// At a high style multiplier loose coins arc toward the unicorn. It is a
// reward for keeping a chain alive, never a substitute for aim: the radius
// only opens up once the multiplier is already high, and it pulls coins only.
function items(h) {
  const mag = mult > 4 ? 60 + mult * 24 : 0;
  for (const c of NC) for (const it of c.i) {
    if (it.g) continue;
    const dx = P.x - it.x, dy = P.y - it.y, d = hyp(dx, dy);
    if (d < R + 26) { grab(it); continue; }
    if (mag && !it.t && d < mag) {
      const k = mn(1, 700 * h / d);
      it.x += dx * k; it.y += dy * k;
    }
  }
}

// --- obstacle collision ----------------------------------------------------
function collideAll(h) {
  for (const c of NC) for (const o of c.o) { if (!o.k) hitOb(o); }
  if (hitCd > 0) hitCd -= h;
  else for (let i = 0; i < strokes.length; i++) { if (hitStroke(strokes[i])) break; }
}

function hitOb(o) {
  obT(o);
  const rr2 = near(o, P.x, P.y) + R;
  if (_pd > rr2) return;
  const nx = _nx, ny = _ny, px = _px, py = _py, pen = rr2 - _pd;
  if (o.m & M_PHASE) { if (P.ph > 0) return; }
  obVel(o, px, py);
  let rvx = P.vx - _cvx, rvy = P.vy - _cvy;
  const vn = rvx * nx + rvy * ny;

  if (o.m & M_BREAK) {
    const imp = -vn;
    if (imp > (P.rp > 0 ? BRK_R : BRK_E)) { shatter(o, px, py, imp, 0); return; }
  }

  P.x += nx * pen; P.y += ny * pen;
  if (P.ra) detachRail(0);
  if (vn >= 0) return;

  const bump = o.m & M_BUMP, damp = o.m & M_DAMP;
  o.f = 1;                                   // contact flash, read by the renderer
  if (o.m & M_TGT) light(o, px, py);
  // A bumper's restitution falls off with speed: it kicks hard when you are
  // slow (a genuine rescue) and bleeds energy when you are already flying.
  // Without this the world is a closed energy pump and every run saturates at
  // VMAX, which reads as noise rather than pinball.
  const e = bump ? 1.32 - clamp(P.sp / VMAX, 0, 1) * .72 : damp ? .12 : .44;
  const j = (1 + e) * -vn;                 // normal impulse magnitude
  rvx += j * nx; rvy += j * ny;

  // Coulomb friction: the tangential loss is capped by the normal impulse, not
  // taken as a flat fraction of sliding speed. Resting contact therefore barely
  // scrubs speed, so surfaces stop behaving like glue and a grazing skim keeps
  // its momentum. The flat-fraction version stopped a 440-unit launch in three
  // frames and made every ledge an unescapable trap.
  const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty;
  const dv = mn(abs(vt), (damp ? 1.15 : .3) * j) * (vt < 0 ? -1 : 1);
  rvx -= dv * tx; rvy -= dv * ty;
  P.vx = rvx + _cvx; P.vy = rvy + _cvy;
  clampV();

  const imp = -vn;
  sndHit(imp, damp ? 1 : bump ? 2 : 0, o.x + o.y);
  shake = mn(26, shake + imp * (bump ? .008 : .0035));
  const n = clamp(imp * .012, 1, 14) | 0;
  burst(px, py, n, 1, mn(imp * .35, 420), geoHue(o));

  // A bumper is a scoring event, not just a wall. It pays, it feeds the same
  // combo the coins do, and above a real impact it stops time for a frame and
  // throws a ring -- which is the whole difference between hitting geometry
  // and playing a pinball table.
  if (bump && imp > 150) {
    combo++; comboT = 1.6;
    const v = (18 + imp * .05) * mult | 0;
    score += v;
    if (imp > 620) {
      pop(px, py, '+' + v, HUE[2]);
      shock(px, py, 60 + mn(imp * .2, 190), pal[6] + 30);
      hstop = mx(hstop, .045);
    }
  }
}

// A scoring target lights on contact; lighting the last one in its bank pays
// the whole bank out and re-arms it.
function light(o, px, py) {
  if (o.lt) return;
  const k = o.bk;
  o.lt = 1;
  if (!k) return;
  k.l++;
  const v = 60 * mult | 0;
  score += v;
  sndTarget(k.l / k.n);
  burst(px, py, 10, 0, 260, 48);
  if (k.l < k.n) return;
  // Bank cleared: pay out, refill a little pigment, re-arm.
  k.l = 0;
  for (const q of k.m) q.lt = 0;
  const big = 420 * k.n * mult | 0;
  score += big;
  coins += k.n * 2;
  for (let i = 0; i < 7; i++) pig[i] = mn(PMAX, pig[i] + 5);
  pop(k.x, k.y, 'BANK +' + big, 48);
  shock(k.x, k.y, 320, 48);
  flash = mx(flash, .4); flashH = 48;
  shake = mn(30, shake + 12);
  hstop = mx(hstop, .07);
  sndBank();
}

// Breaking a panel throws real debris and lights the fuse on its neighbours,
// so one good hit unzips a whole structure instead of punching a single hole.
// `d` is the cascade depth, purely so the chain reads as a wave outward.
function shatter(o, px, py, imp, d) {
  o.k = 1;
  const h = geoHue(o);
  shake = mn(32, shake + 10 - d);
  burst(px, py, 18, 2, 460, h);
  shards(px, py, o, h);
  shock(px, py, 150, h);
  sndBreak(d);
  const v = 60 * mult * (1 + d * .5) | 0;
  score += v;
  combo++; comboT = 1.6;
  if (!d) { pop(px, py, '+' + v, 45); hstop = mx(hstop, .05); }

  // Light the fuse on every breakable neighbour. Staggering by distance turns
  // a cluster into a chain rather than a single silent frame.
  if (d > 3) return;
  const rad = BRK_CH;
  for (const c of NC) for (const q of c.o) {
    if (q == o || q.k || q.kt || !(q.m & M_BREAK)) continue;
    const dd = hyp(q.x - px, q.y - py);
    if (dd < rad + q.r) { q.kt = .04 + dd / rad * .1; q.kd = d + 1; }
  }
  P.vx *= .9; P.vy *= .9;
}

// Fuses lit by a cascade, ticked once per frame from the game loop.
function fuseStep(h) {
  for (const c of chunks) for (const o of c.o) {
    if (!o.kt || o.k) continue;
    if ((o.kt -= h) > 0) continue;
    obT(o);
    shatter(o, _cx, _cy, 0, o.kd);
  }
}

// Debris: spinning shards that carry the colour of what they came from.
function shards(x, y, o, h) {
  for (let i = 0; i < 7; i++) {
    const a = rf(0, TAU), v = rf(90, 420);
    pt(x, y, cos(a) * v, sin(a) * v, rf(.5, 1.1), h, 4, rf(3, 8) * (o.t ? 1 : 1.4));
  }
}

const geoHue = (o) => o.m & M_DAMP ? 280 : o.m & M_BREAK ? 20 : o.m & M_PHASE ? 285 : pal[6];

// --- main step -------------------------------------------------------------
function physics(h) {
  const sp0 = hyp(P.vx, P.vy);
  NC = nearChunks(P.y - 420 - sp0 * h, P.y + 420 + sp0 * h);

  // The region's force field, sampled at the body's own position.
  let fx = Gx, fy = Gy;
  for (const c of NC) if (c.z && P.y >= c.y && P.y < c.y + c.h) {
    zoneF(c, P.x, P.y);
    fx += _zx; fy += _zy;
    break;
  }

  if (P.te) {
    P.te.t -= h;
    // No reel-in: the radius stays exactly the length you drew, which is the
    // whole contract of this verb. The orbit is topped up in tetherConstrain
    // instead, so a swing still never quietly dies.

    P.vx += fx * h; P.vy += fy * h;
    if (P.te.t <= 0) releaseTether();
  } else if (P.ra) {
    // rail supplies its own motion
  } else {
    P.vx += fx * h; P.vy += fy * h;
  }
  clampV();

  // Drag above the "fast" reference speed. Bumpers, rotors and Red together
  // form an open energy pump, and without this the run spends half its life
  // pinned to VMAX -- the hard clamp ends up setting the pace of the game
  // instead of the player. Below VFAST there is no drag at all, so recovering
  // from a stall is never taxed.
  let sp = hyp(P.vx, P.vy);
  const vf = VFAST;
  if (sp > vf) {
    const d = mx(0, 1 - (sp / vf - 1) * 1.5 * h);
    P.vx *= d; P.vy *= d;
    sp *= d;
  }

  const k = clamp(M.ceil(sp * h / (R * .55)), 1, 8);
  const hh = h / k;
  for (let i = 0; i < k; i++) {
    if (P.ra) { if (!railStep(hh)) { P.x += P.vx * hh; P.y += P.vy * hh; } }
    else { P.x += P.vx * hh; P.y += P.vy * hh; }
    if (P.te) tetherConstrain();
    collideAll(hh);
    items(hh);
  }

  // Absolute containment: no effect (warp included) may leave the shaft. This
  // is measured against the real wall line at the unicorn's height, not a fixed
  // bound, because the walls taper and a warp could otherwise strand it in the
  // rock outside them.
  wallsAt(P.y);
  if (P.x < _wl + R) { P.x = _wl + R; if (P.vx < 0) P.vx = -P.vx * .55 + 60; }
  if (P.x > _wr - R) { P.x = _wr - R; if (P.vx > 0) P.vx = -P.vx * .55 - 60; }

  // timers
  if (P.ph > 0) P.ph -= h;
  if (P.rp > 0) P.rp -= h;
  if (P.gt > 0) {
    P.gt -= h;
    if (P.gt <= 0) { Gx = 0; Gy = GRAV; }
  }
  P.sp = hyp(P.vx, P.vy);
  if (P.sp > 30) P.a = at2(P.vy, P.vx);
}
