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
  P.ra = null;
  if (boost) { P.vx *= 1.06; P.vy *= 1.06; }
  sndRail(0);
}

function railStep(h) {
  const s = P.ra;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = hyp(dx, dy);
  if (s.l <= 0 || L < 8) { detachRail(1); return 0; }
  s.l = mx(s.l, .1);
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
  if (P.rt < 0 || P.rt > 1) { P.rt = clamp(P.rt, 0, 1); detachRail(1); return 0; }
  const nx = -uy * P.rs, ny = ux * P.rs;
  P.x = s.x1 + dx * P.rt + nx * (R + ST);
  P.y = s.y1 + dy * P.rt + ny * (R + ST);
  if (rnd() < .5) burst(P.x, P.y, 3, 0, 60, HUE[4], -P.vx * .1, -P.vy * .1);
  return 1;
}

// Releasing a tether converts the orbit into a launch.
function releaseTether() {
  if (!P.te) return;
  P.te = null;
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
  let nx, ny, d, px, py, pen;
  if (!o.t) {
    nx = P.x - _cx; ny = P.y - _cy; d = hyp(nx, ny);
    const rr2 = o.r + R;
    if (d > rr2) return;
    if (d < 1e-4) { nx = 0; ny = -1; d = 1e-4; } else { nx /= d; ny /= d; }
    pen = rr2 - d; px = _cx + nx * o.r; py = _cy + ny * o.r;
  } else {
    const cg = cos(_cg) * o.L, sg2 = sin(_cg) * o.L;
    const ax = _cx - cg, ay = _cy - sg2, bx = _cx + cg, by = _cy + sg2;
    const t = segT(ax, ay, bx, by, P.x, P.y);
    px = ax + (bx - ax) * t; py = ay + (by - ay) * t;
    nx = P.x - px; ny = P.y - py; d = hyp(nx, ny);
    const rr2 = R + ST;
    if (d > rr2) return;
    if (d < 1e-4) { nx = -sin(_cg); ny = cos(_cg); d = 1e-4; } else { nx /= d; ny /= d; }
    pen = rr2 - d;
  }
  if (o.m & M_PHASE) { if (P.ph > 0) return; }
  obVel(o, px, py);
  let rvx = P.vx - _cvx, rvy = P.vy - _cvy;
  const vn = rvx * nx + rvy * ny;

  if (o.m & M_BREAK) {
    const imp = -vn;
    if (imp > (P.rp > 0 ? BRK_R : BRK_E)) { shatter(o, px, py, imp); return; }
  }

  P.x += nx * pen; P.y += ny * pen;
  if (P.ra) detachRail(0);
  if (vn >= 0) return;

  const bump = o.m & M_BUMP, damp = o.m & M_DAMP;
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
  shake = mn(26, shake + imp * (bump ? .006 : .0035));
  const n = clamp(imp * .012, 1, 14) | 0;
  burst(px, py, n, 1, mn(imp * .35, 420), geoHue(o));
}

function shatter(o, px, py, imp) {
  o.k = 1;
  shake = mn(30, shake + 10);
  burst(px, py, 22, 2, 460, geoHue(o));
  sndBreak();
  score += 45 * mult | 0;
  pop(px, py, '+' + (45 * mult | 0), 45);
  P.vx *= .84; P.vy *= .84;
}

const geoHue = (o) => o.m & M_DAMP ? 280 : o.m & M_BREAK ? 20 : o.m & M_PHASE ? 285 : pal[6];

// --- main step -------------------------------------------------------------
function physics(h) {
  const sp0 = hyp(P.vx, P.vy);
  NC = nearChunks(P.y - 420 - sp0 * h, P.y + 420 + sp0 * h);

  if (P.te) {
    P.te.t -= h;
    P.te.l = mx(48, P.te.l - 62 * h);
    P.vx += Gx * h; P.vy += Gy * h;
    if (P.te.t <= 0) releaseTether();
  } else if (P.ra) {
    // rail supplies its own motion
  } else {
    P.vx += Gx * h; P.vy += Gy * h;
  }
  clampV();

  // Drag above the "fast" reference speed. Bumpers, rotors and Red together
  // form an open energy pump, and without this the run spends half its life
  // pinned to VMAX -- the hard clamp ends up setting the pace of the game
  // instead of the player. Below VFAST there is no drag at all, so recovering
  // from a stall is never taxed.
  let sp = hyp(P.vx, P.vy);
  if (sp > VFAST) {
    const d = mx(0, 1 - (sp / VFAST - 1) * 1.5 * h);
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

  // Absolute containment: no effect (warp included) may leave the column.
  const bx = WMAX + 46;
  if (P.x < -bx) { P.x = -bx; P.vx = abs(P.vx) * .55 + 110; }
  if (P.x > bx) { P.x = bx; P.vx = -abs(P.vx) * .55 - 110; }

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
