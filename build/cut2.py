import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:60])); return s
    return s.replace(a, b, 1)

# =========================== RENDER =========================================
r = load('src/70_render.js')

# motif families collapse to three primitives
old = r[r.index('// Background motif families'):r.index('// --- world ---')]
new = """// Background motif families, one per region.
// [prim, a, b] — prim 0 blobs, 1 polygon(a sides, b/10 inner radius, b<0 rough),
// 2 rings(a) + spokes(|b|), b<0 draws partial arcs instead of full rings.
const MOT = [[0, 3, 0], [2, 1, 8], [2, 2, -3], [1, 5, 4], [1, 7, -1], [2, 3, 6], [2, 1, 4]];

function motifShape(x, y, r, v) {
  const k = MOT[reg], a1 = k[1], a2 = k[2];
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
    const span = a2 < 0 ? 2.4 : TAU;
    for (let i = 1; i <= a1; i++) { BP(); AR(x, y, r * (1 - i * .22), v * TAU, v * TAU + span); X.stroke(); }
    BP();
    for (let i = 0; i < abs(a2); i++) {
      const a = i / abs(a2) * TAU + T * .06 * (v > .7 ? -1 : 1);
      MT(x + cos(a) * r * .5, y + sin(a) * r * .5);
      LT(x + cos(a) * r, y + sin(a) * r);
    }
    X.stroke();
  }
}

"""
r = r.replace(old, new)

# material styling from a compact table instead of seven literal pairs
old = r[r.index('function obStyle('):r.index('function drawWorld(')]
new = """// [hue, sat, fillLight, edgeSat, edgeLight] per material; -1 hue = region hue.
const MSTY = [
  [276, 40, 7, 60, 26],      // damp / void
  [18, 74, 42, 100, 66],     // breakable
  [292, 80, 46, 100, 74],    // phase wall
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
  const s = MSTY[i], a = i === 2 ? ' / .3' : '';
  return [hsl(s[0], s[1], s[2]) , hsl(s[0], s[3], s[4])];
}

"""
r = r.replace(old, new)

# Prism Well: one rainbow ring instead of seven orbiting discs
r = sub(r, """  if (it.t === I_WELL) {
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + T * .6;
      CIR(x + cos(a) * 26 * s, y + sin(a) * 26 * s, 7 * s * b, chsl(i, 62));
    }
    CIR(x, y, 15 * s * b, '#fff');
    return;
  }""",
"""  if (it.t === I_WELL) {
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + T * .6;
      BP(); AR(x, y, 24 * s * b, a, a + .8);
      SK(7 * s, chsl(i, 62));
    }
    CIR(x, y, 13 * s * b, '#fff');
    return;
  }""", 'well')

# one stroke pass fewer
r = sub(r, "    SK(mx(1, 2.4 * SC), 'hsl(0 0% 100% / ' + a * .85 + ')');\n", "", 'strokecore')
store('src/70_render.js', r)

# =========================== WORLD ==========================================
w = load('src/30_world.js')

# vaults and wells share one room builder
old = w[w.index('function buildVault('):w.index('function buildGate(')]
new = """// Focus Vault — a slow, enclosed prize room. Some of them hold a Prism Well
// instead of a Crown Coin, which is the game's only full pigment refill.
function buildVault(c, L, Rr, rg) {
  const cx = (L + Rr) / 2, cy = c.y + c.h * .5, r = mn((Rr - L) * .38, 250);
  c.cx = cx; c.cy = cy;
  arcSegs(c, cx, cy, r, .78 * PI, 2.16 * PI, M_BUMP);   // bowl with a top-left mouth
  const well = rp(.4);
  for (let a = 0; a < 3; a++) c.o.push(sg(cx, cy, r * .46, a * PI / 3, M_BUMP, { w: rs() * .55 }));
  c.i.push(item(well ? I_WELL : I_CROWN, cx, cy - r * .72));
  c.i.push(item(I_PIG, cx - r * .6, cy + r * .3, pick(REG[rg][11])));
  c.i.push(item(I_PIG, cx + r * .6, cy + r * .3, ri(0, 6)));
  for (let i = 0; i < 6; i++)
    c.i.push(item(I_COIN, cx + cos(i / 6 * TAU) * r * .78, cy + sin(i / 6 * TAU) * r * .78));
}

"""
w = w.replace(old, new)
w = sub(w, "  else if (cIdx > 2 && rp(.075)) { c.v = 1; buildVault(c, L, Rr, rg, dif); }\n  else if (cIdx > 4 && rp(.05)) buildWell(c, L, Rr, rg, dif);",
        "  else if (cIdx > 2 && rp(.1)) { c.v = 1; buildVault(c, L, Rr, rg); }", 'vaultcall')

# a leaner opening room
old = w[w.index('function worldReset('):w.index('function worldUpdate(')]
new = """function worldReset(sd) {
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

"""
w = w.replace(old, new)
store('src/30_world.js', w)

# =========================== AUDIO ==========================================
a = load('src/60_audio.js')
a = sub(a, """  // continuous wind
  const ws = AC.createBufferSource(); ws.buffer = nzBuf; ws.loop = true;
  windF = AC.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 300; windF.Q.value = .7;
  windG = AC.createGain(); windG.gain.value = 0;
  ws.connect(windF).connect(windG).connect(sfxG); ws.start();

  // continuous rail grind
  railO = AC.createOscillator(); railO.type = 'sawtooth'; railO.frequency.value = 220;
  railF = AC.createBiquadFilter(); railF.type = 'bandpass'; railF.frequency.value = 1400; railF.Q.value = 6;
  railG = AC.createGain(); railG.gain.value = 0;
  railO.connect(railF).connect(railG).connect(sfxG); railO.start();
""",
"""  // Two always-on voices: wind (speed) and rail grind (Blue). Built once, then
  // only their gain/frequency is modulated, so long runs never leak nodes.
  const voice = (src, f, q) => {
    const b = AC.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
    const g = AC.createGain(); g.gain.value = 0;
    src.connect(b).connect(g).connect(sfxG); src.start();
    return [b, g];
  };
  const ws = AC.createBufferSource(); ws.buffer = nzBuf; ws.loop = true;
  [windF, windG] = voice(ws, 300, .7);
  railO = AC.createOscillator(); railO.type = 'sawtooth'; railO.frequency.value = 220;
  [railF, railG] = voice(railO, 1400, 6);
""", 'voices')
store('src/60_audio.js', a)

# =========================== GAME ===========================================
g = load('src/90_game.js')
g = sub(g, """  if (regShow > 0) regShow -= dt;
  if (msgT > 0) msgT -= dt;
  if (dryT > 0) dryT -= dt;
  if (fullSpec > 0) fullSpec -= dt;
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
  if (chainT > 0) { chainT -= dt; if (chainT <= 0) { chain = 0; chainN = 0; } }
  for (let i = 0; i < 2; i++) if (boostT[i] > 0) boostT[i] -= dt;
  flash = mx(0, flash - dt * 2.4);""",
"""  regShow -= dt; msgT -= dt; dryT -= dt; fullSpec -= dt;
  boostT[0] -= dt; boostT[1] -= dt;
  if (comboT > 0 && (comboT -= dt) <= 0) combo = 0;
  if (chainT > 0 && (chainT -= dt) <= 0) { chain = 0; chainN = 0; }
  flash = mx(0, flash - dt * 2.4);""", 'timers')
store('src/90_game.js', g)

# =========================== HUD ============================================
h = load('src/80_hud.js')
h = sub(h, """  [
    'DRAG draw a short rail    1-7 / SCROLL / RMB  pick colour',
    'R push · O aim · Y spring · G tether · B rail · I gravity · V warp',
    'cross two live strokes to fuse them · all seven = FULL SPECTRUM',
    'pigment is finite — stop moving for too long and the run ends',
  ].forEach((l, i) => txt(l, W / 2, H - 118 * U + i * 20 * U, 13, i ? W6 : W9, 'center', !i));""",
"""  [
    'DRAG a short rail near the unicorn · 1-7 or SCROLL picks a colour',
    'R push · O aim · Y spring · G tether · B rail · I gravity · V warp',
    'cross live strokes to fuse them · all seven = FULL SPECTRUM',
  ].forEach((l, i) => txt(l, W / 2, H - 110 * U + i * 20 * U, 13, i ? W6 : W9, 'center', !i));""", 'legend')
store('src/80_hud.js', h)
print('done')
