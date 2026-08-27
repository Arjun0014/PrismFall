import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:70])); return s
    return s.replace(a, b, 1)

# --- Cosmetics: three categories of three (spec trimming policy item 1) -----
h = load('src/80_hud.js')
h = sub(h, """// Four categories x three variants; variant 0 is always owned.
const COSN = 'CLOUD SHADOW GOLD CLASSIC CURVED LONGHORN RAINBOW DASHED COMET SPARKS SHARDS RINGS'.split(' ');
const COSP = [0, 180, 420];
const CATN = ['BODY', 'HORN', 'TRAIL', 'IMPACT'];""",
"""// Three cosmetic categories of three variants; variant 0 is always owned.
// Cosmetics are render-only: they never touch collision, pigment or scoring.
const COSN = 'CLOUD SHADOW NEON RAINBOW DASHED COMET SPARKS SHARDS RINGS'.split(' ');
const COSP = [0, 180, 420];
const CATN = ['BODY', 'TRAIL', 'IMPACT'];""", 'cosn')
h = sub(h, "  for (let c = 0; c < 4; c++) {\n    const y = H / 2 - 120 * U + c * 60 * U;",
        "  for (let c = 0; c < 3; c++) {\n    const y = H / 2 - 110 * U + c * 62 * U;", 'grid')
h = sub(h, """  // live preview through the real unicorn renderer
  const pv = (c) => prevCat === c ? prevIt : SAVE.e[c];
  X.save();
  X.translate(W / 2 + 40 * U, H / 2 + 150 * U);
  X.scale(2 * U, 2 * U);
  unicornBody(pv(0), pv(1), 0, flr(T * 3) % 7);
  X.restore();""",
"""  // Live preview through the real unicorn renderer.
  X.save();
  X.translate(W / 2 + 40 * U, H / 2 + 140 * U);
  X.scale(2.2 * U, 2.2 * U);
  unicornBody(prevCat ? SAVE.e[0] : prevIt, flr(T * 3) % 7);
  X.restore();""", 'preview')
h = sub(h, """  [
    'DRAG a short rail near the unicorn · 1-7 or SCROLL picks a colour',
    'R push · O aim · Y spring · G tether · B rail · I gravity · V warp',
    'cross live strokes to fuse them · all seven = FULL SPECTRUM',
  ].forEach((l, i) => txt(l, W / 2, H - 110 * U + i * 20 * U, 13, i ? W6 : W9, 'center', !i));""",
"""  [
    'DRAG a short rail near the unicorn · 1-7 or SCROLL picks a colour',
    'R push · O aim · Y spring · G tether · B rail · I gravity · V warp',
  ].forEach((l, i) => txt(l, W / 2, H - 100 * U + i * 20 * U, 13, i ? W6 : W9, 'center', !i));""", 'legend')
store('src/80_hud.js', h)

# body/trail/impact only: the unicorn no longer takes a horn style
r = load('src/70_render.js')
r = sub(r, "function unicornBody(body, horn, white, tint) {", "function unicornBody(body, tint, white) {", 'sig')
r = sub(r, "  const main = white ? '#fff' : body === 1 ? 'hsl(268 40% 12%)' : body === 2 ? 'hsl(190 100% 72%)' : 'hsl(300 40% 96%)';",
        "  const main = white ? '#fff' : body === 1 ? 'hsl(268 40% 12%)' : body === 2 ? 'hsl(190 100% 72%)' : 'hsl(300 40% 96%)';", 'main')
r = sub(r, """  X.save(); X.translate(26, -12); X.rotate(-.62 + (horn === 1 ? sin(T * 2) * .12 : 0));
  const hl = horn === 2 ? 22 : 14;
  const hg = X.createLinearGradient(0, 0, 0, -hl);""",
"""  X.save(); X.translate(26, -12); X.rotate(-.62);
  const hl = 15;
  const hg = X.createLinearGradient(0, 0, 0, -hl);""", 'horn')
r = sub(r, "  unicornBody(SAVE.e[0], SAVE.e[1], fullSpec > 0 || P.ph > 0, sel);",
        "  unicornBody(SAVE.e[0], sel, fullSpec > 0 || P.ph > 0);", 'call')
r = sub(r, "function drawTrail() {\n  const n = trail.length, style = SAVE.e[2];",
        "function drawTrail() {\n  const n = trail.length, style = SAVE.e[1];", 'trailstyle')
r = sub(r, "  const kk = k === 1 ? SAVE.e[3] : k;", "  const kk = k === 1 ? SAVE.e[2] : k;", 'impact')
store('src/70_render.js', r)

g = load('src/90_game.js')
g = sub(g, """    for (let i = 0; i < 4; i++) {
      const v = a[6 + i] | 0;
      SAVE.e[i] = v > 0 && v < 4 && owned(i, v) ? v : 0;
    }""",
"""    for (let i = 0; i < 3; i++) {
      const v = a[6 + i] | 0;
      SAVE.e[i] = v > 0 && v < 3 && owned(i, v) ? v : 0;
    }""", 'load')
store('src/90_game.js', g)

s = load('src/20_state.js')
s = sub(s, "const SAVE = { c: 0, b: 0, d: 0, o: 1, e: [0, 0, 0, 0], m: 0, t: 0 };\n// c total coins, b best score, d best depth, o owned bitmask,\n// e equipped [body,horn,trail,impact], m muted, t tutorial seen",
        "const SAVE = { c: 0, b: 0, d: 0, o: 0, e: [0, 0, 0], m: 0, t: 0 };\n// c total coins, b best score, d best depth, o owned cosmetics bitmask,\n// e equipped [body, trail, impact], m muted, t tutorial seen", 'save')
store('src/20_state.js', s)

# --- flavour text: the region banner already announces arrivals -------------
h = load('src/80_hud.js')
h = sub(h, "function say(m) { msg = m; msgT = 2.6; }\n", "", 'say')
h = sub(h, "  if (msgT > 0) txt(msg, W / 2, H - 96 * U, 15, 'hsl(0 0% 100% / ' + clamp(msgT, 0, 1) + ')', 'center', 1);\n", "", 'msg')
h = sub(h, "let U = 1;              // UI scale\nlet btns = [];          // immediate-mode buttons for this frame\nlet msg = '', msgT = 0;",
        "let U = 1;              // UI scale\nlet btns = [];          // immediate-mode buttons for this frame", 'msgvar')
h = sub(h, "    txt(CATN[c], x0, y, 13, W3, 'left', 1);\n", "    txt(CATN[c], x0, y, 12, W3, 'left', 1);\n", 'catn')
store('src/80_hud.js', h)
g = load('src/90_game.js')
g = sub(g, "    score += 500 * mult | 0;\n    say(REG[reg][0]);", "    score += 500 * mult | 0;", 'sayc')
g = sub(g, "  regShow -= dt; msgT -= dt; dryT -= dt; fullSpec -= dt;", "  regShow -= dt; dryT -= dt; fullSpec -= dt;", 'timer')
store('src/90_game.js', g)
print('done')
