import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:70])); return s
    return s.replace(a, b, 1)

# ===================== REG: hand-tuned tables -> formulas ===================
w = load('src/30_world.js')
old = w[w.index('// region row:'):w.index('let nextY = 0')]
new = """// Region row — deliberately tiny. Everything a region needs beyond these four
// numbers is derived, which costs far fewer compressed bytes than a table:
//   0 name
//   1 base hue        background gradient starts here
//   2 hue spread      gradient end + geometry hue are offsets from the base
//   3 geometry light
//   4 archetype weights (one char per draw)
//   5 material bias, packed as five hex nibbles [break,phase,damp,bump,move]/16
// Affinity colours come from AFF, music from formulas in 60_audio.js.
const REG = [
  ['CLOUDBREAK', 232, 90, 80, '0016601366'],
  ['SUNFORGE', 14, 20, 64, '5357753517'],
  ['VERDANT COIL', 172, -64, 62, '2722723072'],
  ['CRYSTAL CURRENT', 236, -46, 70, '4344634643'],
  ['PRISM MINE', 272, 30, 58, '7171776107'],
  ['INVERSION TEMPLE', 282, -34, 74, '7474547465'],
  ['RAINBOW ENGINE', 300, -28, 84, '0123456757'],
];
// [break, phase, damp, bump, move] as hex nibbles / 16
const BIAS = [0x00184, 0x60149, 0x10254, 0x11132, 0x75232, 0x26345, 0x53225];
// two affinity colours per region, one digit each
const AFF = '12011932144656';

// Live palette pieces for the current region.
const regHue = (r) => REG[r][1];
const bias = (r) => { const v = BIAS[r]; return [0, 1, 2, 3, 4].map((i) => (v >> (16 - i * 4) & 15) / 16); };
const aff = (r) => [+AFF[r * 2], +AFF[r * 2 + 1]];

"""
w = w.replace(old, new)
w = w.replace('REG[rg][9]', 'REG[rg][4]').replace('REG[c.rg][11]', 'aff(c.rg)').replace('REG[rg][11]', 'aff(rg)')
w = sub(w, "  const rg = regAt(y), dif = difAt(y), b = REG[rg][10];", "  const rg = regAt(y), dif = difAt(y), b = bias(rg);", 'bias')
w = sub(w, "  const aff = REG[rg][11];\n", "  const af = aff(rg);\n", 'affv')
w = w.replace('pick(aff)', 'pick(af)')
w = sub(w, "  rotor(c, L, Rr, Rr - L, (L + Rr) / 2, REG[rg][10], dif);", "", 'x')
store('src/30_world.js', w)

# gate: build the exit machine from the existing rotor + barrier builders
w = load('src/30_world.js')
old = w[w.index('function buildGate('):w.index('// --- rewards')]
new = """// Region exit machine: a spinning prism above a closing throat, then a full
// spectrum of pigment as a reward for getting through it.
function buildGate(c, L, Rr, rg, dif) {
  const cx = (L + Rr) / 2, w = Rr - L, cy = c.y + c.h * .4;
  rotor(c, L, Rr, w, cx, bias(rg), dif);
  barrier(c, L, Rr, w, bias(rg), dif, 1, 0, cy + 300, 1);
  c.o.push(ci(cx, cy, 26, M_BUMP));
  for (let i = 0; i < 7; i++) c.i.push(item(I_PIG, cx + (i - 3) * 74, cy + 420, i));
  c.i.push(item(I_CROWN, cx, c.y + 150));
}

"""
w = w.replace(old, new)
store('src/30_world.js', w)

# ===================== RENDER: palette from the region formula =============
r = load('src/70_render.js')
r = sub(r, """function palUpdate(h) {
  const r = REG[reg];
  for (let i = 0; i < 8; i++)
    pal[i] = i % 3 === 0 && i < 7 ? alerp(pal[i], r[i + 1], 1.6, h) : approach(pal[i], r[i + 1], 1.6, h);
}""",
"""// Target palette derived from the region's three numbers:
// [bgTopH, bgTopS, bgTopL, bgBotH, bgBotS, bgBotL, geoH, geoL]
function regPal(r) {
  const hu = REG[r][1], sp = REG[r][2];
  return [hu, r > 5 ? 0 : 62, 12 - r * 1.4, hu + sp, 55, 27 - r * 1.6, hu + sp * .62, REG[r][3]];
}
function palUpdate(h) {
  const t = regPal(reg);
  for (let i = 0; i < 8; i++)
    pal[i] = i % 3 === 0 && i < 7 ? alerp(pal[i], t[i], 1.6, h) : approach(pal[i], t[i], 1.6, h);
}""", 'pal')
store('src/70_render.js', r)

g = load('src/90_game.js')
g = sub(g, "  const r = REG[0];\n  for (let i = 0; i < 8; i++) pal[i] = r[i + 1];", "  pal = regPal(0);", 'palinit')
g = sub(g, "    flash = mx(flash, .35); flashH = REG[reg][7];", "    flash = mx(flash, .35); flashH = regHue(reg);", 'flashh')
store('src/90_game.js', g)

p = load('src/40_physics.js')
p = sub(p, "const geoHue = (o) => o.m & M_DAMP ? 280 : o.m & M_BREAK ? 20 : o.m & M_PHASE ? 285 : REG[reg][7];",
        "const geoHue = (o) => o.m & M_DAMP ? 280 : o.m & M_BREAK ? 20 : o.m & M_PHASE ? 285 : pal[6];", 'geohue')
store('src/40_physics.js', p)

# ===================== AUDIO: music parameters from the region index =======
a = load('src/60_audio.js')
a = sub(a, """function musicTick() {
  const r = REG[reg][12], sc = SCALE[r[1]], w = WAVE[r[3]];""",
"""function musicTick() {
  // Region identity from formulas: a different root, mode, wave and a tempo
  // that escalates as the journey deepens.
  const root = 44 + (reg * 5) % 11, sc = SCALE[reg % 4], w = WAVE[reg % 3], bpm = 92 + reg * 8;""", 'mt')
a = sub(a, "  const spb = 60 / (r[2] * (slow > .5 ? .5 : 1)) / 4;", "  const spb = 60 / (bpm * (slow > .5 ? .5 : 1)) / 4;", 'spb')
a = a.replace("r[0] - 12 + sc", "root - 12 + sc").replace("r[0] + 12 + sc", "root + 12 + sc").replace("r[0] + 19 + sc", "root + 19 + sc")
store('src/60_audio.js', a)
print('done')
