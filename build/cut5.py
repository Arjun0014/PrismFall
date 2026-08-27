import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:70])); return s
    return s.replace(a, b, 1)

# ============================== COLORS ======================================
c = load('src/50_colors.js')
c = sub(c, """function hitStroke(s) {
  if (s.u || s === P.ra || hyp(s.x2 - s.x1, s.y2 - s.y1) < 26) return 0;
  const t = segT(s.x1, s.y1, s.x2, s.y2, P.x, P.y);
  const px = s.x1 + (s.x2 - s.x1) * t, py = s.y1 + (s.y2 - s.y1) * t;
  let nx = P.x - px, ny = P.y - py, d = hyp(nx, ny);
  if (d > R + ST) return 0;
  const ux = (s.x2 - s.x1) / (hyp(s.x2 - s.x1, s.y2 - s.y1) || 1),
        uy = (s.y2 - s.y1) / (hyp(s.x2 - s.x1, s.y2 - s.y1) || 1);
  if (d < 1e-3) { nx = -uy; ny = ux; d = 1e-3; } else { nx /= d; ny /= d; }
  applyStroke(s, nx, ny, px, py, t, ux, uy);
  hitCd = .05;
  return 1;
}""",
"""// A stroke fires once, on the first contact after it is long enough to matter.
function hitStroke(s) {
  const ax = s.x2 - s.x1, ay = s.y2 - s.y1, L = hyp(ax, ay);
  if (s.u || s === P.ra || L < 26) return 0;
  const t = segT(s.x1, s.y1, s.x2, s.y2, P.x, P.y);
  const px = s.x1 + ax * t, py = s.y1 + ay * t;
  let nx = P.x - px, ny = P.y - py;
  const d = hyp(nx, ny);
  if (d > R + ST) return 0;
  const ux = ax / L, uy = ay / L;
  if (d < 1e-3) { nx = -uy; ny = ux; } else { nx /= d; ny /= d; }
  applyStroke(s, nx, ny, px, py, t, ux, uy);
  hitCd = .05;
  return 1;
}""", 'hitStroke')
c = sub(c, """function startStroke() {
  if (st !== 1 || !P.al) return;
  let sx = mwx, sy = mwy;
  const dx = sx - P.x, dy = sy - P.y, d = hyp(dx, dy);
  if (d > SREACH) { sx = P.x + dx / d * SREACH; sy = P.y + dy / d * SREACH; }
  if (pig[sel] <= .5) { dryC = sel; dryT = .5; sndEmpty(); return; }
  drawing = { x1: sx, y1: sy, x2: sx, y2: sy, e: CBIT[sel], c: sel, l: SLIFE, u: 0, paid: 0 };
  strokes.push(drawing);
  while (strokes.length > SLIM) {
    const old = strokes.shift();
    if (P.ra === old) detachRail(0);
  }
  if (P.te) releaseTether();
}""",
"""// A stroke may only begin within SREACH of the unicorn; further clicks clamp
// back onto that circle so the player is never silently ignored.
function startStroke() {
  if (st !== 1 || !P.al) return;
  if (pig[sel] <= .5) { dryC = sel; dryT = .5; sndEmpty(); return; }
  const dx = mwx - P.x, dy = mwy - P.y, k = mn(1, SREACH / (hyp(dx, dy) || 1));
  const sx = P.x + dx * k, sy = P.y + dy * k;
  drawing = { x1: sx, y1: sy, x2: sx, y2: sy, e: CBIT[sel], c: sel, l: SLIFE, u: 0, paid: 0 };
  strokes.push(drawing);
  while (strokes.length > SLIM) if (P.ra === strokes.shift()) detachRail(0);
  if (P.te) releaseTether();
}""", 'startStroke')
c = sub(c, """function moveStroke() {
  const s = drawing;
  if (!s) return;
  let dx = mwx - s.x1, dy = mwy - s.y1;
  let L = hyp(dx, dy);
  if (L < 1) return;
  const ux = dx / L, uy = dy / L;
  L = mn(L, SMAX);
  if (L > s.paid) {
    const unit = PC[s.c] * costMul();
    const want = (L - s.paid) * unit;
    if (pig[s.c] >= want) { pig[s.c] -= want; s.paid = L; }
    else {
      s.paid += pig[s.c] / unit; pig[s.c] = 0; L = s.paid;
      if (dryT <= 0) { dryC = s.c; dryT = .6; sndEmpty(); }
    }
  }
  s.x2 = s.x1 + ux * L; s.y2 = s.y1 + uy * L;
  fuse(s);
}""",
"""// Growing a stroke spends pigment; shrinking it back is free but refunds
// nothing, so length is a real decision.
function moveStroke() {
  const s = drawing;
  if (!s) return;
  const dx = mwx - s.x1, dy = mwy - s.y1, d = hyp(dx, dy);
  if (d < 1) return;
  let L = mn(d, SMAX);
  if (L > s.paid) {
    const unit = PC[s.c] * costMul(), want = (L - s.paid) * unit;
    if (pig[s.c] >= want) { pig[s.c] -= want; s.paid = L; }
    else {
      L = s.paid += pig[s.c] / unit;
      pig[s.c] = 0;
      if (dryT <= 0) { dryC = s.c; dryT = .6; sndEmpty(); }
    }
  }
  s.x2 = s.x1 + dx / d * L; s.y2 = s.y1 + dy / d * L;
  fuse(s);
}""", 'moveStroke')
c = sub(c, """function chainAdd(b) {
  const before = chain;
  chain |= b & ALL7;
  chainT = 7;
  if (chain === before) return;
  let n = 0;
  for (let i = 0; i < 7; i++) if (chain & CBIT[i]) n++;
  if (n > chainN) {
    chainN = n;
    // Partial diversity refunds — never enough to make world pigment pointless.
    if (n === 3 || n === 5) {
      for (let i = 0; i < 7; i++) pig[i] = mn(PMAX, pig[i] + 6);
      pop(P.x, P.y - 30, 'SPECTRUM +' + n, HUE[n % 7]);
      sndRefund();
    }
    if (n === 7) fullSpectrum();
  }
}""",
"""// Successfully landing a new colour extends the spectrum chain. Refunds are
// deliberately partial: a perfect seven-colour loop never pays for itself.
function chainAdd(b) {
  const before = chain;
  chainT = 7;
  chain |= b & ALL7;
  if (chain === before) return;
  let n = 0;
  for (let i = 0; i < 7; i++) if (chain & CBIT[i]) n++;
  if (n <= chainN) return;
  chainN = n;
  if (n === 7) return fullSpectrum();
  if (n === 3 || n === 5) {
    for (let i = 0; i < 7; i++) pig[i] = mn(PMAX, pig[i] + 6);
    pop(P.x, P.y - 30, 'SPECTRUM ' + n + '/7', HUE[n]);
    sndRefund();
  }
}""", 'chainAdd')
c = sub(c, """function grab(it) {
  it.g = 1; it.p = 1;
  if (it.t === I_COIN) {
    combo++; comboT = 1.4; coins++;
    const v = (10 * mult * (1 + combo * .05)) | 0;
    score += v;
    sndCoin(combo);
  } else if (it.t === I_CROWN) {""",
"""function grab(it) {
  it.g = 1;
  if (it.t === I_COIN) {
    combo++; comboT = 1.4; coins++;
    score += 10 * mult * (1 + combo * .05) | 0;
    sndCoin(combo);
  } else if (it.t === I_CROWN) {""", 'grab')
store('src/50_colors.js', c)

# ============================== PHYSICS =====================================
p = load('src/40_physics.js')
p = sub(p, """function clampV() {
  const s = hyp(P.vx, P.vy);
  if (s > VMAX) { P.vx = P.vx / s * VMAX; P.vy = P.vy / s * VMAX; }
  if (!isFinite(P.vx) || !isFinite(P.vy)) { P.vx = 0; P.vy = 200; }
  if (!isFinite(P.x) || !isFinite(P.y)) { P.x = 0; P.y = depth; }
}""",
"""// Velocity clamp plus a NaN guard: no combination of effects may destabilise
// the simulation.
function clampV() {
  const s = hyp(P.vx, P.vy);
  if (s > VMAX) { P.vx = P.vx / s * VMAX; P.vy = P.vy / s * VMAX; }
  if (!isFinite(s)) { P.vx = 0; P.vy = 200; }
  if (!isFinite(P.x + P.y)) { P.x = 0; P.y = depth; }
}""", 'clampV')
p = sub(p, """function releaseTether() {
  const t = P.te;
  if (!t) return;
  P.te = null;
  const s = hyp(P.vx, P.vy) || 1;
  const k = 1.34, add = 150;
  P.vx = P.vx / s * (s * k + add); P.vy = P.vy / s * (s * k + add);
  clampV();
  burst(P.x, P.y, 10, 3, 260);
  sndTether(0);
}""",
"""// Releasing a tether converts the orbit into a launch.
function releaseTether() {
  if (!P.te) return;
  P.te = null;
  const s = hyp(P.vx, P.vy) || 1, k = 1.34 + 150 / s;
  P.vx *= k; P.vy *= k;
  clampV();
  burst(P.x, P.y, 10, 0, 260);
  sndTether(0);
}""", 'tether')
p = sub(p, """function tetherConstrain() {
  const t = P.te;
  let dx = P.x - t.x, dy = P.y - t.y, d = hyp(dx, dy);
  if (d < 1) return;
  if (d > t.l) {
    dx /= d; dy /= d;
    P.x = t.x + dx * t.l; P.y = t.y + dy * t.l;
    const vr = P.vx * dx + P.vy * dy;
    if (vr > 0) { P.vx -= vr * dx; P.vy -= vr * dy; }
    // Orbits should build energy, not bleed it.
    const s = hyp(P.vx, P.vy);
    if (s > 1 && s < 1500) { const k = mx(1.004, 320 / s > 1 ? 320 / s : 1.004); P.vx *= k; P.vy *= k; }
  }
}""",
"""// Inextensible rope: pull the body back onto the circle and drop the radial
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
}""", 'tetherC')
p = sub(p, """function items(h) {
  for (const c of NC) for (const it of c.i) {
    if (it.g) continue;
    if (hyp(P.x - it.x, P.y - it.y) < R + 26) { grab(it); }
  }
}""",
"""function items() {
  for (const c of NC) for (const it of c.i)
    if (!it.g && hyp(P.x - it.x, P.y - it.y) < R + 26) grab(it);
}""", 'items')
p = p.replace("    items(hh);", "    items();")
store('src/40_physics.js', p)

# ============================== INPUT =======================================
i = load('src/85_input.js')
i = sub(i, """function setSel(i) {
  i = (i + 7) % 7;
  if (i === sel) return;
  sel = i;
  sndUI(1);
  burst(P.x, P.y, 6, 0, 130, HUE[sel]);
  if (hint === 1) { hint = 2; hintT = 0; }
}""",
"""// Colour selection is instant and free; only drawing costs pigment.
function setSel(i) {
  i = (i + 7) % 7;
  if (i === sel) return;
  sel = i;
  sndUI(1);
  burst(P.x, P.y, 6, 0, 130, HUE[i]);
  if (hint === 1) { hint = 2; hintT = 0; }
}""", 'setSel')
i = sub(i, """addEventListener('keydown', (e) => {
  audioInit();
  const k = e.key;
  if (k >= '1' && k <= '7') { setSel(+k - 1); return; }
  if (k === 'Escape' || k === 'p' || k === 'P') {
    if (st === 1) st = 2; else if (st === 2) st = 1;
    else if (st === 4) back();
  }
  if (k === 'r' || k === 'R') { if (st === 3 || st === 2) startRun(); }
  if (k === 'm' || k === 'M') { SAVE.m ^= 1; if (mg) mg.gain.value = SAVE.m ? 0 : .8; save(); }
  if (k === ' ' || k === 'Enter') { if (st === 2) st = 1; else if (st < 4) startRun(); }""",
"""addEventListener('keydown', (e) => {
  audioInit();
  const k = e.key, l = k.toLowerCase();
  if (k > '0' && k < '8') { setSel(+k - 1); return; }
  if (k === 'Escape' || l === 'p') st = st === 1 ? 2 : st === 2 ? 1 : st === 4 ? (back(), st) : st;
  if (l === 'r' && st > 1) startRun();
  if (l === 'm') mute();
  if (k === ' ' || k === 'Enter') { if (st === 2) st = 1; else if (st < 4) startRun(); }""", 'keydown')
store('src/85_input.js', i)
print('done')
