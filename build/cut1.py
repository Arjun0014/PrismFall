import re, io, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:60])); return s
    return s.replace(a, b, 1)

# ---------------- HUD: drop the radial wheel, 3 cosmetics per category ------
h = load('src/80_hud.js')
h = h[:h.index('// --- radial prism wheel')] + h[h.index('// --- cursor ---'):]
h = sub(h, """const COSN = [
  ['CLOUD', 'SHADOW', 'GOLD', 'NEON'],
  ['CLASSIC', 'CURVED', 'LONGHORN', 'STARTIP'],
  ['RAINBOW', 'DASHED', 'COMET', 'BOLT'],
  ['SPARKS', 'SHARDS', 'RINGS', 'STARS'],
];
const COSP = [0, 150, 340, 620];
const CATN = ['BODY', 'HORN', 'TRAIL', 'IMPACT'];
const BN = ['RED OVERDRIVE', 'EFFICIENCY', 'SUPERCOIL', 'SUPERRAIL'];
const BH = [0, -1, HUE[2], HUE[4]];
const owned = (c, i) => i === 0 || (SAVE.o >> (c * 4 + i)) & 1;""",
"""// Four categories x three variants; variant 0 is always owned.
const COSN = 'CLOUD SHADOW GOLD CLASSIC CURVED LONGHORN RAINBOW DASHED COMET SPARKS SHARDS RINGS'.split(' ');
const COSP = [0, 180, 420];
const CATN = ['BODY', 'HORN', 'TRAIL', 'IMPACT'];
const BN = ['RED OVERDRIVE', 'EFFICIENCY'];
const BH = [0, -1];
const owned = (c, i) => !i || (SAVE.o >> (c * 3 + i)) & 1;""", 'cos')
h = sub(h, "  for (let i = 0; i < 4; i++) if (boostT[i] > 0) {", "  for (let i = 0; i < 2; i++) if (boostT[i] > 0) {", 'boostHud')
h = sub(h, """    for (let i = 0; i < 4; i++) {
      const x = x0 + (96 + i * 116) * U;
      const own = owned(c, i), eq = SAVE.e[c] === i, o = hot(x, y, 108 * U, 40 * U);""",
"""    for (let i = 0; i < 3; i++) {
      const x = x0 + (120 + i * 140) * U;
      const own = owned(c, i), eq = SAVE.e[c] === i, o = hot(x, y, 130 * U, 40 * U);""", 'grid')
h = sub(h, "      RR(x - 54 * U, y - 20 * U, 108 * U, 40 * U, 7 * U);", "      RR(x - 65 * U, y - 20 * U, 130 * U, 40 * U, 7 * U);", 'rr')
h = sub(h, "      txt(COSN[c][i], x, y - 5 * U, 11, own ? W9 : W6, 'center', 1);",
        "      txt(COSN[c * 3 + i], x, y - 5 * U, 11, own ? W9 : W6, 'center', 1);", 'name')
h = sub(h, "    SAVE.o |= 1 << (c * 4 + i);", "    SAVE.o |= 1 << (c * 3 + i);", 'bit')
h = sub(h, "    [105, 26, 130, 'MUTE  ' + (SAVE.m ? 'OFF' : 'ON'), mute],", "    [105, 26, 130, SAVE.m ? 'UNMUTE' : 'MUTE', mute],", 'm1')
h = sub(h, "    [0, 32, 200, 'MUTE  ' + (SAVE.m ? 'OFF' : 'ON'), mute],", "    [0, 32, 200, SAVE.m ? 'UNMUTE' : 'MUTE', mute],", 'm2')
h = sub(h, "    'DRAG  draw a short rail    1-7 / SCROLL / RMB  colour',",
        "    'DRAG draw a short rail    1-7 / SCROLL / RMB  pick colour',", 'legend')
old = h[h.index('  // live preview through the real unicorn renderer'):h.index('function buyEquip')]
h = h.replace(old, """  // live preview through the real unicorn renderer
  const pv = (c) => prevCat === c ? prevIt : SAVE.e[c];
  X.save();
  X.translate(W / 2 + 40 * U, H / 2 + 150 * U);
  X.scale(2 * U, 2 * U);
  unicornBody(pv(0), pv(1), 0, flr(T * 3) % 7);
  X.restore();
}

""")
store('src/80_hud.js', h)

# ---------------- state / input: no wheel -----------------------------------
s = load('src/20_state.js')
s = sub(s, "let wheel = 0;                // radial prism wheel open (0/1)\nlet wx = 0, wy = 0;           // wheel centre\nlet wsel = -1;                // wheel hover index\n", "", 'wheelstate')
s = sub(s, "let boostT = [0, 0, 0, 0]; // booster timers", "let boostT = [0, 0];       // booster timers", 'bt')
store('src/20_state.js', s)

i = load('src/85_input.js')
i = sub(i, """addEventListener('pointermove', (e) => {
  ptr(e);
  if (wheel) {
    const dx = pmx - wx, dy = pmy - wy;
    wsel = hyp(dx, dy) > 26 * U ? ((flr((at2(dy, dx) + PI / 2 + PI / 7 + TAU) / TAU * 7) % 7) + 7) % 7 : -1;
  }
  if (drawing) moveStroke();
});""",
"""addEventListener('pointermove', (e) => { ptr(e); if (drawing) moveStroke(); });""", 'pm')
i = sub(i, """addEventListener('pointerdown', (e) => {
  audioInit();
  ptr(e);
  if (e.button === 2) {
    if (st === 1) { wheel = 1; wx = pmx; wy = pmy; wsel = -1; }
    return;
  }
  if (e.button) return;
  if (uiClick()) return;
  if (st === 1) startStroke();
});

addEventListener('pointerup', (e) => {
  if (e.button === 2 && wheel) { if (wsel >= 0) setSel(wsel); wheel = 0; }
  else drawing = null;
});
addEventListener('blur', () => { drawing = null; wheel = 0; if (st === 1) st = 2; });""",
"""addEventListener('pointerdown', (e) => {
  audioInit();
  ptr(e);
  // Right button steps backwards through the prism; left draws / clicks UI.
  if (e.button === 2) { if (st === 1) setSel(sel - 1); return; }
  if (e.button) return;
  if (!uiClick() && st === 1) startStroke();
});

addEventListener('pointerup', () => { drawing = null; });
addEventListener('blur', () => { drawing = null; if (st === 1) st = 2; });""", 'pd')
store('src/85_input.js', i)

g = load('src/90_game.js')
g = sub(g, "  if (wheel) drawWheel();\n", "", 'dw')
g = sub(g, "  drawing = null; wheel = 0;\n", "  drawing = null;\n", 'dn')
g = sub(g, "  boostT = [0, 0, 0, 0];", "  boostT = [0, 0];", 'bt2')
g = sub(g, "  for (let i = 0; i < 4; i++) if (boostT[i] > 0) boostT[i] -= dt;",
        "  for (let i = 0; i < 2; i++) if (boostT[i] > 0) boostT[i] -= dt;", 'bt3')
store('src/90_game.js', g)

# ---------------- boosters: four -> two -------------------------------------
c = load('src/00_config.js')
c = sub(c, """// -- boosters: [allCostMul, redMul, yellowMul, railMul, dur] -----------------
const BOOST = [
  [1, 1.4, 1, 1, 9],      // 0 Red Overdrive
  [.4, 1, 1, 1, 11],      // 1 White Efficiency
  [1, 1, 1.45, 1, 9],     // 2 Yellow Supercoil
  [1, 1, 1, 1.5, 10],     // 3 Blue Superrail
];""",
"""// -- boosters: [allCostMul, redMul, duration] -------------------------------
const BOOST = [
  [1, 1.45, 10],    // 0 Red Overdrive - bigger kick, cheaper destruction
  [.4, 1, 12],      // 1 White Efficiency - every colour costs less
];""", 'boost')
store('src/00_config.js', c)

cl = load('src/50_colors.js')
cl = sub(cl, "  const yk = boostT[2] > 0 ? BOOST[2][2] : 1;\n", "", 'yk')
cl = cl.replace(" * yk", "").replace("yk, 800 * yk", "1.34, 800").replace("1.85 * yk", "1.85").replace("540 * yk", "540")
cl = sub(cl, "const ns = sprB ? mx(sp * 1.34, 800) : mx(sp * .99, 440);", "const ns = sprB ? mx(sp * 1.34, 800) : mx(sp * .99, 440);", 'ns')
cl = sub(cl, """    boostT[it.c] = BOOST[it.c][4];
    pop(it.x, it.y, ['RED OVERDRIVE', 'EFFICIENCY', 'SUPERCOIL', 'SUPERRAIL'][it.c],
      [0, -1, HUE[2], HUE[4]][it.c]);""",
"""    boostT[it.c] = BOOST[it.c][2];
    pop(it.x, it.y, BN[it.c], BH[it.c]);""", 'grabboost')
store('src/50_colors.js', cl)

p = load('src/40_physics.js')
p = sub(p, "  const sr = boostT[3] > 0 ? BOOST[3][3] : 1;\n", "", 'sr')
p = sub(p, "  sp = sp * (boostT[3] > 0 ? 1 : .998) + (Gx * ux + Gy * uy) * h;", "  sp = sp * .998 + (Gx * ux + Gy * uy) * h;", 'sp')
p = sub(p, "  const floor_ = 370 * sr;", "  const floor_ = 370;", 'fl')
store('src/40_physics.js', p)

w = load('src/30_world.js')
w = w.replace("ri(0, 3)", "ri(0, 1)")
store('src/30_world.js', w)

r = load('src/70_render.js')
r = sub(r, "  const kk = k === 1 ? [0, 1, 2, 0][SAVE.e[3]] : k;\n  const big = k === 1 && SAVE.e[3] === 3 ? 2.2 : 1;",
        "  const kk = k === 1 ? SAVE.e[3] : k;\n  const big = 1;", 'impact')
store('src/70_render.js', r)
print('done')
