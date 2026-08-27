import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:70])); return s
    return s.replace(a, b, 1)

# ============================== WORLD =======================================
w = load('src/30_world.js')
w = sub(w, """// [break, phase, damp, bump, move] as hex nibbles / 16
const BIAS = [0x00184, 0x60149, 0x10254, 0x11132, 0x75232, 0x26345, 0x53225];
// two affinity colours per region, one digit each
const AFF = '12011932144656';

// Live palette pieces for the current region.
const regHue = (r) => REG[r][1];
const bias = (r) => { const v = BIAS[r]; return [0, 1, 2, 3, 4].map((i) => (v >> (16 - i * 4) & 15) / 16); };
const aff = (r) => [+AFF[r * 2], +AFF[r * 2 + 1]];""",
"""// Material bias per region: [break, phase, damp, bump, move] as hex nibbles/16.
const BIAS = [0x00182, 0x60149, 0x10254, 0x11233, 0x75323, 0x26335, 0x53258];
// Two affinity colours per region, one digit each.
const AFF = '12011932144656';
const regHue = (r) => REG[r][1];
const bias = (r) => BIAS[r];
const bit = (b, i) => (b >> (16 - i * 4) & 15) / 16;
const aff = (r) => [+AFF[r * 2], +AFF[r * 2 + 1]];""", 'bias')
w = sub(w, """function mat(b, allowBreak) {
  if (rp(b[2])) return M_DAMP;
  if (allowBreak && rp(b[0])) return M_BREAK;
  if (rp(b[1])) return M_PHASE;
  if (rp(b[3])) return M_BUMP;
  return 0;
}
// Optional motion decoration.
function moving(b, amp) {
  if (!rp(b[4])) return null;
  const a = at2(rr() - .5, rr() - .5);
  return { ox: cos(a) * amp, oy: sin(a) * amp * .6, os: rf(.7, 2.1), op: rf(0, TAU) };
}""",
"""function mat(b, allowBreak) {
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
}""", 'mat')
w = sub(w, """function solidNear(c, x, y, rad) {
  for (const o of c.o) {
    obT(o);
    if (o.t === 0) { if (hyp(x - _cx, y - _cy) < o.r + rad) return 1; }
    else if (o.t === 1) {
      const ax = _cx - cos(_cg) * o.L, ay = _cy - sin(_cg) * o.L;
      const bx = _cx + cos(_cg) * o.L, by = _cy + sin(_cg) * o.L;
      const t = segT(ax, ay, bx, by, x, y);
      if (hyp(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)) < ST + rad) return 1;
    }
  }
  return 0;
}""",
"""function solidNear(c, x, y, rad) {
  for (const o of c.o) {
    obT(o);
    if (!o.t) { if (hyp(x - _cx, y - _cy) < o.r + rad) return 1; continue; }
    const cg = cos(_cg) * o.L, sg2 = sin(_cg) * o.L;
    const ax = _cx - cg, ay = _cy - sg2;
    const t = segT(ax, ay, _cx + cg, _cy + sg2, x, y);
    if (hyp(x - (ax + cg * 2 * t), y - (ay + sg2 * 2 * t)) < ST + rad) return 1;
  }
  return 0;
}""", 'solid')
w = sub(w, "  const c = { y, h, l, r, pl: prevL, pr: prevR, o: [], i: [], rg, k: 0, v: 0, gt: 0 };",
        "  const c = { y, h, l, r, pl: prevL, pr: prevR, o: [], i: [], rg, k: 0, v: 0 };", 'gt')
w = sub(w, "  if (boundary) { c.gt = 1; buildGate(c, L, Rr, rg, dif); }", "  if (boundary) buildGate(c, L, Rr, rg, dif);", 'gt2')
w = sub(w, """  const r = mn(wdt * .42, 280), bx = cx + rf(-.2, .2) * wdt, by = c.y + c.h * .58;
  arcSegs(c, bx, by, r, .12 * PI, .88 * PI, rp(.35) ? M_DAMP : 0);
  c.o.push(ci(bx - r * cos(.12 * PI), by, 15, M_BUMP), ci(bx + r * cos(.12 * PI), by, 15, M_BUMP));""",
"""  const r = mn(wdt * .42, 280), bx = cx + rf(-.2, .2) * wdt, by = c.y + c.h * .58;
  const rim = r * cos(.12 * PI);
  arcSegs(c, bx, by, r, .12 * PI, .88 * PI, rp(.35) ? M_DAMP : 0);
  c.o.push(ci(bx - rim, by, 15, M_BUMP), ci(bx + rim, by, 15, M_BUMP));""", 'bowl')
w = sub(w, """function buildGate(c, L, Rr, rg, dif) {
  const cx = (L + Rr) / 2, w = Rr - L, cy = c.y + c.h * .4;
  rotor(c, L, Rr, w, cx, bias(rg), dif);
  barrier(c, L, Rr, w, bias(rg), dif, 1, 0, cy + 300, 1);""",
"""function buildGate(c, L, Rr, rg, dif) {
  const cx = (L + Rr) / 2, w = Rr - L, cy = c.y + c.h * .4, b = bias(rg);
  rotor(c, L, Rr, w, cx, b, dif);
  barrier(c, L, Rr, w, b, dif, 1, 0, cy + 300, 1);""", 'gate')
store('src/30_world.js', w)

# ============================== HUD =========================================
h = load('src/80_hud.js')
h = sub(h, """function hud() {
  const p1 = 18 * U, p2 = 30 * U;
  CIR(p2, p2, 9 * U, UG);
  txt(coins + (SAVE.c ? ' (' + (SAVE.c + coins) + ')' : ''), p2 + 16 * U, p2, 16, UG, 'left', 1);
  txt(score | 0, W - p1, p2, 19, W9, 'right', 1);
  if (mult > 1.05) txt('x' + mult.toFixed(1), W - p1, p2 + 22 * U, 15, chsl(2, 70), 'right', 1);

  const bw = 240 * U;
  X.fillStyle = W3;
  X.fillRect(W / 2 - bw / 2, p2 + 12 * U, bw, 4 * U);
  X.fillStyle = hsl(pal[6] | 0, 90, 70);
  X.fillRect(W / 2 - bw / 2, p2 + 12 * U, bw * clamp((mx(P.y, 0) % REGD) / REGD, 0, 1), 4 * U);
  txt(REG[reg][0] + (loopAt(P.y) ? ' +' + loopAt(P.y) : ''), W / 2, p1, 14, W6, 'center', 1);
  txt((mx(P.y, 0) / 10 | 0) + 'm', W / 2 + bw / 2 + 24 * U, p2 + 14 * U, 13, W3, 'left');

  prismBar();

  let by = p2 + 30 * U;
  for (let i = 0; i < 2; i++) if (boostT[i] > 0) {
    txt(BN[i] + ' ' + boostT[i].toFixed(1), W - p1, by, 12, BH[i] < 0 ? W9 : hsl(BH[i], 100, 70), 'right', 1);
    by += 16 * U;
  }

  if (regShow > 0) {
    const a = clamp(regShow, 0, 1) * clamp(3.2 - regShow, 0, 1);
    txt(REG[reg][0], W / 2, H * .3, 42, 'hsl(0 0% 100% / ' + a + ')', 'center', 1);
  }
  if (msgT > 0) txt(msg, W / 2, H - 96 * U, 15, 'hsl(0 0% 100% / ' + clamp(msgT, 0, 1) + ')', 'center', 1);
  if (!SAVE.t) {
    const t = ['DRAG TO DRAW A RAINBOW RAIL', 'PRESS 1-7 OR SCROLL TO CHANGE COLOUR',
      'PIGMENT IS FINITE — GRAB SHARDS TO REFILL'][hint];
    if (t) txt(t, W / 2, H - 118 * U, 15, W6, 'center', 1);
  }
  if (slow > .05) {
    X.fillStyle = 'hsl(275 60% 60% / ' + slow * .1 + ')';
    X.fillRect(0, 0, W, H);
    txt('FOCUS VAULT', W / 2, 70 * U, 16, W6, 'center', 1);
  }
}""",
"""function hud() {
  const p = 30 * U, bw = 240 * U, dep = mx(P.y, 0);
  CIR(p, p, 9 * U, UG);
  txt(coins + (SAVE.c ? ' (' + (SAVE.c + coins) + ')' : ''), p + 16 * U, p, 16, UG, 'left', 1);
  txt(score | 0, W - p, p, 19, W9, 'right', 1);
  if (mult > 1.05) txt('x' + mult.toFixed(1), W - p, p + 22 * U, 15, chsl(2, 70), 'right', 1);

  // region name, progress bar and depth
  X.fillStyle = W3;
  X.fillRect(W / 2 - bw / 2, p + 12 * U, bw, 4 * U);
  X.fillStyle = hsl(pal[6] | 0, 90, 70);
  X.fillRect(W / 2 - bw / 2, p + 12 * U, bw * clamp((dep % REGD) / REGD, 0, 1), 4 * U);
  txt(REG[reg][0] + (loopAt(P.y) ? ' +' + loopAt(P.y) : ''), W / 2, 18 * U, 14, W6, 'center', 1);
  txt((dep / 10 | 0) + 'm', W / 2 + bw / 2 + 24 * U, p + 14 * U, 13, W3, 'left');

  prismBar();

  for (let i = 0; i < 2; i++) if (boostT[i] > 0)
    txt(BN[i] + ' ' + boostT[i].toFixed(1), W - p, p + (30 + i * 16) * U, 12,
      BH[i] < 0 ? W9 : hsl(BH[i], 100, 70), 'right', 1);

  if (regShow > 0)
    txt(REG[reg][0], W / 2, H * .3, 42,
      'hsl(0 0% 100% / ' + clamp(regShow, 0, 1) * clamp(3.2 - regShow, 0, 1) + ')', 'center', 1);
  if (msgT > 0) txt(msg, W / 2, H - 96 * U, 15, 'hsl(0 0% 100% / ' + clamp(msgT, 0, 1) + ')', 'center', 1);
  if (!SAVE.t) {
    const t = ['DRAG TO DRAW A RAINBOW RAIL', 'PRESS 1-7 OR SCROLL TO CHANGE COLOUR',
      'PIGMENT IS FINITE - GRAB SHARDS TO REFILL'][hint];
    if (t) txt(t, W / 2, H - 118 * U, 15, W6, 'center', 1);
  }
  if (slow > .05) {
    X.fillStyle = 'hsl(275 60% 60% / ' + slow * .1 + ')';
    X.fillRect(0, 0, W, H);
    txt('FOCUS VAULT', W / 2, 70 * U, 16, W6, 'center', 1);
  }
}""", 'hud')
h = sub(h, """function prismBar() {
  const w = 44 * U, x0 = W / 2 - 25 * w / 7, y = H - 40 * U, h = 26 * U;
  for (let i = 0; i < 7; i++) {
    const x = x0 + i * w * 50 / 44, on = i === sel, f = pig[i] / PMAX;
    RR(x, y - h / 2, w, h, 5 * U);
    FL('hsl(270 30% 8% / .8)');
    X.save(); X.clip();
    X.fillStyle = chsl(i, on ? 60 : 42, dryC === i && dryT > 0 ? .4 + sin(T * 40) * .3 : 1);
    X.fillRect(x, y + h / 2 - h * f, w, h * f);
    X.restore();
    RR(x, y - h / 2, w, h, 5 * U);
    SK((on ? 2.6 : 1.2) * U, on ? W9 : chsl(i, 55, .8));
    txt('ROYGBIV'[i], x + w / 2, y, on ? 15 : 12, on ? W9 : W6, 'center', 1);
    txt(i + 1, x + w / 2, y - h / 2 - 9 * U, 10, on ? W9 : W3);
    if (chain & CBIT[i]) CIR(x + w / 2, y + h / 2 + 8 * U, 2.6 * U, chsl(i, 75));
    btns.push({ hot: hot(x + w / 2, y, w, h), fn: () => setSel(i) });
  }
  if (chainN > 2) txt(chainN + '/7', x0 - 18 * U, y, 13, W9, 'center', 1);
}""",
"""// Seven reservoirs: fill = pigment left, ring = selection, dot = chain state.
// The segments are clickable, so the game is playable with the mouse alone.
function prismBar() {
  const w = 44 * U, x0 = W / 2 - 25 * w / 7, y = H - 40 * U, h = 26 * U;
  for (let i = 0; i < 7; i++) {
    const x = x0 + i * w * 50 / 44, on = i === sel, f = pig[i] / PMAX, cx = x + w / 2;
    RR(x, y - h / 2, w, h, 5 * U);
    FL('hsl(270 30% 8% / .8)');
    X.save(); X.clip();
    X.fillStyle = chsl(i, on ? 60 : 42, dryC === i && dryT > 0 ? .4 + sin(T * 40) * .3 : 1);
    X.fillRect(x, y + h / 2 - h * f, w, h * f);
    X.restore();
    RR(x, y - h / 2, w, h, 5 * U);
    SK((on ? 2.6 : 1.2) * U, on ? W9 : chsl(i, 55, .8));
    txt('ROYGBIV'[i], cx, y, on ? 15 : 12, on ? W9 : W6, 'center', 1);
    txt(i + 1, cx, y - h / 2 - 9 * U, 10, on ? W9 : W3);
    if (chain & CBIT[i]) CIR(cx, y + h / 2 + 8 * U, 2.6 * U, chsl(i, 75));
    btns.push({ hot: hot(cx, y, w, h), fn: () => setSel(i) });
  }
  if (chainN > 2) txt(chainN + '/7', x0 - 18 * U, y, 13, W9, 'center', 1);
}""", 'prism')
h = sub(h, """      const own = owned(c, i), eq = SAVE.e[c] === i, o = hot(x, y, 130 * U, 40 * U);
      if (o) { prevCat = c; prevIt = i; }
      RR(x - 65 * U, y - 20 * U, 130 * U, 40 * U, 7 * U);
      FL(eq ? UE : own ? UB : 'hsl(275 25% 10%)');
      SK((eq ? 2.4 : 1) * U, eq || o ? W9 : W3);
      txt(COSN[c * 3 + i], x, y - 5 * U, 11, own ? W9 : W6, 'center', 1);
      txt(own ? (eq ? 'EQUIPPED' : 'EQUIP') : COSP[i] + 'c', x, y + 10 * U, 10,
        own ? W3 : SAVE.c >= COSP[i] ? UG : 'hsl(0 60% 60%)');
      btns.push({ hot: o, fn: () => buyEquip(c, i) });""",
"""      const own = owned(c, i), eq = SAVE.e[c] === i, o = hot(x, y, 130 * U, 40 * U);
      if (o) { prevCat = c; prevIt = i; }
      RR(x - 65 * U, y - 20 * U, 130 * U, 40 * U, 7 * U);
      FL(eq ? UE : own ? UB : 'hsl(275 25% 10%)');
      SK((eq ? 2.4 : 1) * U, eq || o ? W9 : W3);
      txt(COSN[c * 3 + i], x, y - 5 * U, 11, own ? W9 : W6, 'center', 1);
      txt(own ? (eq ? 'EQUIPPED' : 'EQUIP') : COSP[i] + 'c', x, y + 10 * U, 10,
        own ? W3 : SAVE.c < COSP[i] ? 'hsl(0 60% 60%)' : UG);
      btns.push({ hot: o, fn: () => buyEquip(c, i) });""", 'store')
store('src/80_hud.js', h)

# ============================== AUDIO =======================================
a = load('src/60_audio.js')
a = sub(a, """function sndHit(imp, kind) {
  if (!ok() || imp < 60) return;
  const v = clamp(imp / 2200, .04, .55);
  N(.03 + v * .12, v * .7, 'lowpass', 300 + imp * 1.6, 140, 1);
  if (imp > 380) O('triangle', 120 + imp * .05, 44, .1 + v * .12, v * .8);
  if (kind === 2) O('sine', 520 + imp * .18, 260, .12, v * .5);
  if (kind === 1) O('sine', 90, 42, .25, v * .5);
}

function sndBreak(imp) {
  if (!ok()) return;
  N(.3, .45, 'bandpass', 2600, 300, 1.4);
  O('triangle', 160, 38, .34, .5);
  N(.09, .3, 'highpass', 4000, 9000, 1);
}""",
"""// Impact: one noise transient scaled by impulse, plus a body tone. kind 1 is a
// dampener (dull thud), kind 2 a bumper (bright ping).
function sndHit(imp, kind) {
  if (!ok() || imp < 60) return;
  const v = clamp(imp / 2200, .04, .55);
  N(.03 + v * .12, v * .7, 'lowpass', 300 + imp * 1.6, 140, 1);
  if (imp > 380) O('triangle', 120 + imp * .05, 44, .1 + v * .12, v * .8);
  if (kind) O('sine', kind > 1 ? 520 + imp * .18 : 90, kind > 1 ? 260 : 42, kind > 1 ? .12 : .25, v * .5);
}

function sndBreak() {
  if (!ok()) return;
  N(.3, .45, 'bandpass', 2600, 300, 1.4);
  O('triangle', 160, 38, .34, .5);
  N(.09, .3, 'highpass', 4000, 9000, 1);
}""", 'hit')
a = sub(a, """      if (inten > 1.05 && b === 12) {
        const n = root + 19 + sc[(i * 5) % sc.length];
        O('square', NOTE(n), NOTE(n + 5), .18, .06, musG, t);
      }
""", '')
store('src/60_audio.js', a)

p = load('src/40_physics.js')
p = sub(p, "  sndBreak(imp);", "  sndBreak();", 'break')
store('src/40_physics.js', p)

# ============================== GAME ========================================
g = load('src/90_game.js')
g = sub(g, """  // focus vaults: presentation-only time dilation
  let inV = null;
  for (const c of chunks) if (c.v && P.y > c.y + 120 && P.y < c.y + c.h - 120) inV = c;
  vault = inV;
  const wasSlow = slow;
  slow = approach(slow, inV ? 1 : 0, 3.5, dt);
  if (wasSlow > .5 && slow <= .5) { burst(P.x, P.y, 14, 0, 420, HUE[6]); sndVector(1); }""",
"""  // Focus Vaults dilate presentation time only; the stall check below uses
  // simulation speed, so slow motion can never fake a death.
  vault = null;
  for (const c of chunks) if (c.v && P.y > c.y + 120 && P.y < c.y + c.h - 120) vault = c;
  const was = slow;
  slow = approach(slow, vault ? 1 : 0, 3.5, dt);
  if (was > .5 && slow <= .5) { burst(P.x, P.y, 14, 0, 420, HUE[6]); sndVector(1); }""", 'vault')
g = sub(g, """  // stall / death
  if (P.al) {
    if (P.sp < STALLV) {
      P.st += dt;
      stallSnd -= dt;
      if (stallSnd <= 0 && P.st > STALLW) {
        stallSnd = mx(.16, .55 - (P.st - STALLW) * .18);
        sndStall(clamp((P.st - STALLW) / (STALLT - STALLW), 0, 1));
      }
      if (P.st > STALLT) die();
    } else if (P.st > 0) {
      if (P.st > STALLW) burst(P.x, P.y, 8, 0, 260, HUE[0]);
      P.st = mx(0, P.st - dt * 2.6);
    }
  } else {""",
"""  // Stall is the only failure state: too slow for too long and the run ends.
  if (P.al) {
    if (P.sp < STALLV) {
      P.st += dt;
      const u = clamp((P.st - STALLW) / (STALLT - STALLW), 0, 1);
      if ((stallSnd -= dt) <= 0 && u > 0) { stallSnd = mx(.16, .55 - u * .4); sndStall(u); }
      if (P.st > STALLT) die();
    } else if (P.st > 0) {
      if (P.st > STALLW) burst(P.x, P.y, 8, 0, 260, HUE[0]);
      P.st = mx(0, P.st - dt * 2.6);
    }
  } else {""", 'stall')
g = sub(g, """  // strokes
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s !== drawing && s !== P.ra) s.l -= dt;
    if (s.l <= 0) {
      if (P.ra === s) detachRail(1);
      if (s === drawing) drawing = null;
      strokes.splice(i, 1);
    }
  }""",
"""  // Strokes age out unless they are being drawn or are the active rail.
  for (let i = strokes.length; i--;) {
    const s = strokes[i];
    if (s !== drawing && s !== P.ra) s.l -= dt;
    if (s.l <= 0) {
      if (P.ra === s) detachRail(1);
      if (s === drawing) drawing = null;
      strokes.splice(i, 1);
    }
  }""", 'strokes')
store('src/90_game.js', g)
print('done')
