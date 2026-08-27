import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:70])); return s
    return s.replace(a, b, 1)

# ---- Archetype grammar renumbered to seven situations from six builders ----
# 0 PEG  1 FUNNEL(barrier, converging)  2 BOWL  3 SHAFT
# 4 ROTOR  5 SIEVE(barrier, flat, multi-gap)  6 CHAMBER
w = load('src/30_world.js')
w = sub(w, """// Archetype ids used inside the weight strings.
// 0 PEG  1 FUNNEL  2 BOWL  3 SLALOM  4 SHAFT  5 ROTOR  6 SIEVE  7 CHAMBER""",
"""// Archetype ids used inside the region weight strings. Funnel and Sieve are
// the same builder with different parameters, so seven situations cost six.
// 0 PEG  1 FUNNEL  2 BOWL  3 SHAFT  4 ROTOR  5 SIEVE  6 CHAMBER""", 'hdr')
for a, b in [("['CLOUDBREAK', 232, 90, 80, '0016601366']", "['CLOUDBREAK', 232, 90, 80, '0015501566']"),
             ("['SUNFORGE', 14, 20, 64, '5357753517']", "['SUNFORGE', 14, 20, 64, '4464464146']"),
             ("['VERDANT COIL', 172, -64, 62, '2722723072']", "['VERDANT COIL', 172, -64, 62, '2622622062']"),
             ("['CRYSTAL CURRENT', 236, -46, 70, '4344634643']", "['CRYSTAL CURRENT', 236, -46, 70, '3353531335']"),
             ("['PRISM MINE', 272, 30, 58, '7171776107']", "['PRISM MINE', 272, 30, 58, '6161665106']"),
             ("['INVERSION TEMPLE', 282, -34, 74, '7474547465']", "['INVERSION TEMPLE', 282, -34, 74, '6363436365']"),
             ("['RAINBOW ENGINE', 300, -28, 84, '0123456757']", "['RAINBOW ENGINE', 300, -28, 84, '0123456546']")]:
    w = sub(w, a, b, 'reg')
w = sub(w, """    if (k === 1 || k === 6)
      barrier(c, L, Rr, wdt, b, dif, k === 1 ? 1 : ri(2, 3), k === 1 ? rf(120, 210) : rf(0, 26),
        c.y + c.h * rf(.34, .6), 0);
    else [pegField, 0, bowl, slalom, shaft, rotor, 0, chamber][k](c, L, Rr, wdt, cx, b, dif);""",
"""    if (k === 1 || k === 5)
      barrier(c, L, Rr, wdt, b, dif, k > 1 ? ri(2, 3) : 1, k > 1 ? rf(0, 26) : rf(120, 210),
        c.y + c.h * rf(.34, .6), 0);
    else [pegField, 0, bowl, shaft, rotor, 0, chamber][k](c, L, Rr, wdt, cx, b, dif);""", 'dispatch')
old = w[w.index('function slalom('):w.index('function shaft(')]
w = w.replace(old, '')
# rails now come from shafts and the occasional chamber bar
w = sub(w, "    else c.o.push(sg(ix, iy, rf(50, 110), rf(0, PI), mat(b, 1), moving(b, 70)));",
        "    else c.o.push(sg(ix, iy, rf(50, 110), rf(0, PI), mat(b, 1) | (rp(.3) ? M_RAIL : 0), moving(b, 70)));", 'rail')
store('src/30_world.js', w)

# ---- Store: a compact list, still with a live preview ---------------------
h = load('src/80_hud.js')
old = h[h.index('function screenStore()'):h.index('function buyEquip')]
new = """function screenStore() {
  modal(560, 430, 'PRISM STORE', [SAVE.c + ' COINS  ·  cosmetics only, never power'],
    [[0, 178, 150, 'BACK', back]], 14);
  prevCat = -1;
  const x0 = W / 2 - 240 * U;
  for (let n = 0; n < 9; n++) {
    const c = n / 3 | 0, i = n % 3;
    const x = x0 + i * 150 * U, y = H / 2 - 108 * U + c * 52 * U;
    const own = owned(c, i), eq = SAVE.e[c] === i, o = hot(x + 66 * U, y, 140 * U, 42 * U);
    if (o) { prevCat = c; prevIt = i; }
    RR(x, y - 21 * U, 140 * U, 42 * U, 7 * U);
    FL(eq ? UE : own ? UB : 'hsl(275 25% 10%)');
    SK((eq ? 2.4 : 1) * U, eq || o ? W9 : W3);
    txt(COSN[n], x + 66 * U, y - 6 * U, 11, own ? W9 : W6, 'center', 1);
    txt(own ? (eq ? 'EQUIPPED' : 'EQUIP') : COSP[i] + 'c', x + 66 * U, y + 9 * U, 10,
      own ? W3 : SAVE.c < COSP[i] ? 'hsl(0 60% 60%)' : UG);
    btns.push({ hot: o, fn: () => buyEquip(c, i) });
  }
  // Live preview through the real unicorn renderer.
  X.save();
  X.translate(W / 2, H / 2 + 112 * U);
  X.scale(2.2 * U, 2.2 * U);
  unicornBody(prevCat ? SAVE.e[0] : prevIt, flr(T * 3) % 7);
  X.restore();
}

"""
h = h.replace(old, new)
store('src/80_hud.js', h)
print('done')
