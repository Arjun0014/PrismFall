import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:70])); return s
    return s.replace(a, b, 1)

# ---------------------------------------------------------------------------
# Temporary boosters are cut (spec trimming policy: "rare booster variants").
# Their job — a short window of extra power — is now carried by the Red charge
# window after a Red hit and by Prism Wells, which already exist.
# ---------------------------------------------------------------------------
c = load('src/00_config.js')
c = sub(c, """// -- boosters: [allCostMul, redMul, duration] -------------------------------
const BOOST = [
  [1, 1.45, 10],    // 0 Red Overdrive - bigger kick, cheaper destruction
  [.4, 1, 12],      // 1 White Efficiency - every colour costs less
];

""", "", 'boost')
c = sub(c, "const I_COIN = 0, I_CROWN = 1, I_PIG = 2, I_WELL = 3, I_BOOST = 4;",
        "const I_COIN = 0, I_CROWN = 1, I_PIG = 2, I_WELL = 3;", 'items')
store('src/00_config.js', c)

s = load('src/20_state.js')
s = sub(s, "let boostT = [0, 0];       // booster timers\n", "", 'bt')
store('src/20_state.js', s)

cl = load('src/50_colors.js')
cl = sub(cl, "const costMul = () => boostT[1] > 0 ? BOOST[1][0] : 1;\n\n", "", 'cm')
cl = cl.replace(" * costMul()", "")
cl = sub(cl, "    const rk = boostT[0] > 0 ? BOOST[0][1] : 1;\n", "", 'rk')
cl = sub(cl, "    const ns = sp * 1.5 + 440 * rk;", "    const ns = sp * 1.5 + 440;", 'ns')
cl = sub(cl, """  } else {
    boostT[it.c] = BOOST[it.c][2];
    pop(it.x, it.y, BN[it.c], BH[it.c]);
    sndPower();
  }""", "  }", 'grab')
store('src/50_colors.js', cl)

h = load('src/80_hud.js')
h = sub(h, "const BN = ['RED OVERDRIVE', 'EFFICIENCY'];\nconst BH = [0, -1];\n", "", 'bn')
h = sub(h, """  for (let i = 0; i < 2; i++) if (boostT[i] > 0)
    txt(BN[i] + ' ' + boostT[i].toFixed(1), W - p, p + (30 + i * 16) * U, 12,
      BH[i] < 0 ? W9 : hsl(BH[i], 100, 70), 'right', 1);

""", "", 'hud')
store('src/80_hud.js', h)

g = load('src/90_game.js')
g = sub(g, "  boostT = [0, 0];\n", "", 'reset')
g = sub(g, "  boostT[0] -= dt; boostT[1] -= dt;\n", "", 'tick')
store('src/90_game.js', g)

w = load('src/30_world.js')
w = sub(w, """    const bp = rp(.45);
    c.i.push(item(bp ? I_PIG : I_BOOST, ox, c.y + c.h * .5, bp ? pick(aff(c.rg)) : ri(0, 1)));""",
"""    c.i.push(item(rp(.45) ? I_PIG : I_CROWN, ox, c.y + c.h * .5, pick(aff(c.rg))));""", 'shaft')
w = sub(w, """  // Upward temptation, above the entry line.
  if (rp(.3)) place(rp(.3) ? I_BOOST : I_CROWN, ri(0, 1), .02, .16);
  if (rp(.16)) place(I_BOOST, ri(0, 1), .3, .8);""",
"""  // Upward temptation, above the entry line — going up has to be worth it.
  if (rp(.34)) place(I_CROWN, 0, .02, .16);
  if (rp(.18)) place(I_PIG, ri(0, 6), .28, .8);""", 'rewards')
store('src/30_world.js', w)

r = load('src/70_render.js')
r = sub(r, """  const cr = t === I_CROWN, pg = t === I_PIG;
  const n = cr ? 10 : pg ? 6 : 3, rad = (cr ? 16 : pg ? 12 : 15) * s * b;
  X.save(); X.translate(x, y);
  X.rotate(T * (cr ? .8 : pg ? 1.4 : -1) + it.c);
  POLY(n, cr ? UG : pg ? chsl(it.c, 58) : it.c ? '#fff' : hsl(0, 100, 60),
    pg ? chsl(it.c, 86) : '#fff', mx(1, 2 * s), (i) => {
      const a = i / n * TAU, q = rad * (cr && i & 1 ? .44 : 1);
      VTX(i, cos(a) * q, sin(a) * q);
    });
  X.restore();""",
"""  const cr = t === I_CROWN, n = cr ? 10 : 6, rad = (cr ? 16 : 12) * s * b;
  X.save(); X.translate(x, y);
  X.rotate(T * (cr ? .8 : 1.4) + it.c);
  POLY(n, cr ? UG : chsl(it.c, 58), cr ? '#fff' : chsl(it.c, 86), mx(1, 2 * s), (i) => {
    const a = i / n * TAU, q = rad * (cr && i & 1 ? .44 : 1);
    VTX(i, cos(a) * q, sin(a) * q);
  });
  X.restore();""", 'item')
store('src/70_render.js', r)

a = load('src/60_audio.js')
a = sub(a, "function sndPower() { ARP(62, [0, 5, 10], .12, .1, 'square', .06, 2); }\n", "", 'power')
store('src/60_audio.js', a)
h = load('src/80_hud.js')
h = sub(h, "    save(); sndPower();", "    save(); sndRefund();", 'buy')
store('src/80_hud.js', h)
print('done')
