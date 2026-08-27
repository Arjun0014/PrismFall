import re, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def load(p): return open(p, encoding='utf-8').read()
def store(p, s): open(p, 'w', encoding='utf-8', newline='\n').write(s); print(p, 'ok')
def sub(s, a, b, tag=''):
    if a not in s:
        print('  !! MISS', tag, repr(a[:70])); return s
    return s.replace(a, b, 1)

# ============================== AUDIO =======================================
a = load('src/60_audio.js')
a = sub(a, """function audioFrame(h) {
  voices = 0;
  if (!AC) return;
  const t = now();
  const n = clamp(P.sp / VMAX, 0, 1);
  const play = st === 1 && P.al;
  windG.gain.setTargetAtTime(play && !SAVE.m ? mn(.3, n * n * 1.9 + .015) : 0, t, .08);
  windF.frequency.setTargetAtTime(240 + n * 3200, t, .08);
  windF.Q.setTargetAtTime(.6 + n * 2, t, .1);
  if (P.ra) {
    railG.gain.setTargetAtTime(SAVE.m ? 0 : .1 + n * .12, t, .03);
    railF.frequency.setTargetAtTime(700 + P.sp * 1.4, t, .04);
    railO.frequency.setTargetAtTime(90 + P.sp * .22, t, .04);
  } else railG.gain.setTargetAtTime(0, t, .05);
  lpF.frequency.setTargetAtTime(slow > .05 ? 480 : st === 2 ? 700 : 20000, t, .1);
  musG.gain.setTargetAtTime(SAVE.m ? 0 : st === 1 ? .38 : .26, t, .2);
  if (play) musicTick();
  else mNext = t + .1;
}""",
"""// Continuous layers, updated once a frame:
//  - wind gets louder and brighter with speed (you can hear acceleration)
//  - the rail grind tracks rail speed
//  - one master low-pass ducks everything inside a Focus Vault or a pause
function audioFrame() {
  voices = 0;
  if (!AC) return;
  const t = now(), n = clamp(P.sp / VMAX, 0, 1), play = st === 1 && P.al;
  const set = (p, v, k) => p.setTargetAtTime(v, t, k);
  set(windG.gain, play && !SAVE.m ? mn(.3, n * n * 1.9 + .015) : 0, .08);
  set(windF.frequency, 240 + n * 3200, .08);
  set(windF.Q, .6 + n * 2, .1);
  set(railG.gain, P.ra && !SAVE.m ? .1 + n * .12 : 0, .04);
  set(railF.frequency, 700 + P.sp * 1.4, .04);
  set(railO.frequency, 90 + P.sp * .22, .04);
  set(lpF.frequency, slow > .05 ? 480 : st === 2 ? 700 : 20000, .1);
  set(musG.gain, SAVE.m ? 0 : st === 1 ? .38 : .26, .2);
  if (play) musicTick();
  else mNext = t + .1;
}""", 'frame')
a = sub(a, """function musicTick() {
  // Region identity from formulas: a different root, mode, wave and a tempo
  // that escalates as the journey deepens.
  const root = 44 + (reg * 5) % 11, sc = SCALE[reg % 4], w = WAVE[reg % 3], bpm = 92 + reg * 8;
  const inten = clamp(P.sp / VFAST, 0, 1.5) + (fullSpec > 0 ? .6 : 0);
  const spb = 60 / (bpm * (slow > .5 ? .5 : 1)) / 4;
  const t0 = now();
  let guard = 0;
  while (mNext < t0 + .16 && guard++ < 8) {
    const t = mx(mNext, t0), i = mStep, b = i & 15;
    if (!SAVE.m) {
      if (!(b & 3)) O('sine', 120, 44, .16, .34, musG, t);
      if (inten > .3 && b & 1) N(.028, .05 + inten * .03, 'highpass', 7000, 6000, 1, musG, t);
      if (!(b & 3) || (inten > .5 && b === 6)) {
        const n = root - 12 + sc[(i >> 2) % sc.length];
        O(w, NOTE(n), NOTE(n), .22, .2, musG, t);
      }
      if (inten > .65 && !(b & 1)) {
        const n = root + 12 + sc[(i * 3 + (i >> 4)) % sc.length];
        O(w, NOTE(n), NOTE(n), .1, .07 + inten * .03, musG, t);
      }
    }
    mStep++; mNext = t + spb;
  }
}""",
"""// A 16th-note scheduler. Region identity comes from formulas — a different
// root, mode and wave per region, with a tempo that escalates as you descend.
// Arrangement density follows speed, so the music reacts to how you are doing.
function musicTick() {
  const root = 44 + reg * 5 % 11, sc = SCALE[reg % 4], w = WAVE[reg % 3];
  const inten = clamp(P.sp / VFAST, 0, 1.5) + (fullSpec > 0 ? .6 : 0);
  const spb = 15 / ((92 + reg * 8) * (slow > .5 ? .5 : 1));
  const t0 = now();
  for (let guard = 8; mNext < t0 + .16 && guard--;) {
    const t = mx(mNext, t0), i = mStep, b = i & 15;
    if (!SAVE.m) {
      const bass = root - 12 + sc[(i >> 2) % sc.length];
      if (!(b & 3)) { O('sine', 120, 44, .16, .34, musG, t); O(w, NOTE(bass), 0, .22, .2, musG, t); }
      else if (inten > .5 && b === 6) O(w, NOTE(bass), 0, .22, .2, musG, t);
      if (inten > .3 && b & 1) N(.028, .05 + inten * .03, 'highpass', 7000, 6000, 1, musG, t);
      if (inten > .65 && !(b & 1)) {
        const n = NOTE(root + 12 + sc[(i * 3 + (i >> 4)) % sc.length]);
        O(w, n, n, .1, .07 + inten * .03, musG, t);
      }
    }
    mStep++; mNext = t + spb;
  }
}""", 'music')
a = sub(a, """function O(w, f0, f1, dur, pk, dest, t0) {
  const t = t0 || now();
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = w;
  o.frequency.setValueAtTime(mx(8, f0), t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(mx(8, f1), t + dur);""",
"""// Oscillator with an optional pitch sweep and an attack/decay envelope.
// f1 of 0 (or equal to f0) means "hold the pitch".
function O(w, f0, f1, dur, pk, dest, t0) {
  const t = t0 || now();
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = w;
  o.frequency.setValueAtTime(mx(8, f0), t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(mx(8, f1), t + dur);""", 'O')
a = sub(a, "  const t = t0 || now();\n  const s = AC.createBufferSource(); s.buffer = nzBuf; s.loop = true;",
        "  const t = t0 || now();\n  const s = AC.createBufferSource();\n  s.buffer = nzBuf; s.loop = true;", 'N')
a = sub(a, """function ARP(root, offs, dur, pk, w, gap, up) {
  if (!AC || SAVE.m) return;
  const t = now();
  for (let i = 0; i < offs.length; i++)
    O(w, NOTE(root + offs[i]), NOTE(root + offs[i] + (up || 0)), dur, pk, 0, t + i * gap);
}""",
"""function ARP(root, offs, dur, pk, w, gap, up) {
  if (!AC || SAVE.m) return;
  const t = now();
  offs.forEach((o, i) => O(w, NOTE(root + o), up ? NOTE(root + o + up) : 0, dur, pk, 0, t + i * gap));
}""", 'ARP')
a = a.replace("O('square', NOTE(n), NOTE(n), .06, .1);\n  O('sine', NOTE(n + 12), NOTE(n + 12), .1, .12);",
              "O('square', NOTE(n), 0, .06, .1);\n  O('sine', NOTE(n + 12), 0, .1, .12);")
store('src/60_audio.js', a)
g = load('src/90_game.js')
g = sub(g, "  audioFrame(raw);", "  audioFrame();", 'af')
store('src/90_game.js', g)

# ============================== COLORS: violet block =======================
c = load('src/50_colors.js')
c = sub(c, """  // 1 --- SPACE (Violet) ----------------------------------------------------
  if (b & 64) {
    if (b & 16) { P.ph = .8; }                       // phase rail
    else {
      let other = null;
      for (const o of strokes) if (o !== s && !o.u && (o.e & 64)) { other = o; break; }
      if (other) {
        const a1 = at2(uy, ux), a2 = at2(other.y2 - other.y1, other.x2 - other.x1);
        const da = a2 - a1, ca = cos(da), sa = sin(da);
        const vx = P.vx * ca - P.vy * sa, vy = P.vx * sa + P.vy * ca;
        P.vx = vx; P.vy = vy;
        const sp = hyp(vx, vy) || 1;
        P.x = (other.x1 + other.x2) / 2 + vx / sp * (R + ST + 8);
        P.y = (other.y1 + other.y2) / 2 + vy / sp * (R + ST + 8);
        other.u = 1; other.l = .12;
        warpFX(px, py);
      } else {
        const sp = hyp(P.vx, P.vy) || 1;
        warpFX(P.x, P.y);
        P.x += P.vx / sp * 300; P.y += P.vy / sp * 300;
      }
      P.x = clamp(P.x, -WMAX + R, WMAX - R);
      P.ph = .34; P.vx *= 1.07; P.vy *= 1.07;
      warpFX(P.x, P.y);
    }
    sndWarp();
  }""",
"""  // 1 --- SPACE (Violet) ----------------------------------------------------
  // With a second live Violet stroke on screen the pair becomes a portal and
  // the exit angle rotates your velocity; alone it is a phase dash that passes
  // straight through the next obstacle. Fused with Blue it phases a whole rail.
  if (b & 64) {
    if (b & 16) P.ph = .8;
    else {
      let o2 = 0;
      for (const o of strokes) if (o !== s && !o.u && o.e & 64) { o2 = o; break; }
      warpFX(P.x, P.y);
      if (o2) {
        const da = at2(o2.y2 - o2.y1, o2.x2 - o2.x1) - at2(uy, ux), ca = cos(da), sa = sin(da);
        const vx = P.vx * ca - P.vy * sa, vy = P.vx * sa + P.vy * ca;
        const k = (R + ST + 8) / (hyp(vx, vy) || 1);
        P.vx = vx; P.vy = vy;
        P.x = (o2.x1 + o2.x2) / 2 + vx * k;
        P.y = (o2.y1 + o2.y2) / 2 + vy * k;
        o2.u = 1; o2.l = .12;
      } else {
        const k = 300 / (hyp(P.vx, P.vy) || 1);
        P.x += P.vx * k; P.y += P.vy * k;
      }
      P.x = clamp(P.x, -WMAX + R, WMAX - R);
      P.ph = .34; P.vx *= 1.07; P.vy *= 1.07;
      warpFX(P.x, P.y);
    }
    sndWarp();
  }""", 'violet')
store('src/50_colors.js', c)

# ============================== WORLD =======================================
w = load('src/30_world.js')
w = sub(w, """function barrier(c, L, Rr, wdt, b, dif, n, drop, yy, quiet) {
  const m = mat(b, 1), cuts = [];
  for (let i = 0; i < n; i++) cuts.push(L + (i + rf(.25, .75)) * (wdt / n));
  let px = L - 20, py = yy - drop;
  for (let i = 0; i <= n; i++) {
    const gw = mx(100, rf(125, 195) - dif * 16);
    const nx = i < n ? cuts[i] - gw / 2 : Rr + 20;
    const ny = i < n ? yy + drop : yy - drop;
    if (nx - px > 24) c.o.push(sgAB(px, py, nx, ny, m));
    if (i < n && drop > 40 && rp(.6)) c.o.push(ci(nx, ny, 15, M_BUMP));
    px = i < n ? cuts[i] + gw / 2 : nx;
    py = yy + drop;
  }
  if (quiet) return;
  for (let i = 0; i < 4; i++) c.i.push(item(I_COIN, cuts[0] + rf(-26, 26), yy + drop + 70 + i * 46));
  c.i.push(item(rp(.35) ? I_PIG : I_CROWN, cuts[n - 1], yy - drop - 70, pick(aff(c.rg))));
}""",
"""function barrier(c, L, Rr, wdt, b, dif, n, drop, yy, quiet) {
  const m = mat(b, 1), cuts = [];
  for (let i = 0; i < n; i++) cuts.push(L + (i + rf(.25, .75)) * wdt / n);
  let px = L - 20, py = yy - drop;
  for (let i = 0; i <= n; i++) {
    const last = i === n;
    const gw = mx(100, rf(125, 195) - dif * 16);
    const nx = last ? Rr + 20 : cuts[i] - gw / 2, ny = last ? yy - drop : yy + drop;
    if (nx - px > 24) c.o.push(sgAB(px, py, nx, ny, m));
    if (!last && drop > 40 && rp(.6)) c.o.push(ci(nx, ny, 15, M_BUMP));
    px = last ? nx : cuts[i] + gw / 2;
    py = yy + drop;
  }
  if (quiet) return;
  // Coins below the easiest gap, the prize above the least convenient one.
  for (let i = 0; i < 4; i++) c.i.push(item(I_COIN, cuts[0] + rf(-26, 26), yy + drop + 70 + i * 46));
  c.i.push(item(rp(.35) ? I_PIG : I_CROWN, cuts[n - 1], yy - drop - 70, pick(aff(c.rg))));
}""", 'barrier')
w = sub(w, """  // Wall profile: side pockets widen the column, shafts narrow it.
  let wide = rp(.26);
  let l = clamp(-COL + rf(-90, 70) - (wide ? 120 : 0), -WMAX, -300);
  let r = clamp(COL + rf(-70, 90) + (wide ? 120 : 0), 300, WMAX);
  const h = boundary ? 1240 : ri(760, 1080);""",
"""  // Wall profile: side pockets widen the column, shafts narrow it.
  const wide = rp(.26) ? 120 : 0;
  const l = clamp(-COL + rf(-90, 70) - wide, -WMAX, -300);
  const r = clamp(COL + rf(-70, 90) + wide, 300, WMAX);
  const h = boundary ? 1240 : ri(760, 1080);""", 'walls')
store('src/30_world.js', w)

# ============================== HUD: store labels ===========================
h = load('src/80_hud.js')
h = sub(h, "    txt(CATN[c], x0, y, 12, W3, 'left', 1);\n", "", 'catn')
h = sub(h, "const CATN = ['BODY', 'TRAIL', 'IMPACT'];\n", "", 'catnv')
h = sub(h, "  modal(700, 450, 'PRISM STORE', [SAVE.c + ' COINS'], [[260, 190, 130, 'BACK', back]], 15);",
        "  modal(680, 430, 'PRISM STORE', [SAVE.c + ' COINS  ·  cosmetics only, never power'],\n    [[250, 180, 130, 'BACK', back]], 14);", 'modal')
h = sub(h, "  const x0 = W / 2 - 310 * U;", "  const x0 = W / 2 - 210 * U;", 'x0')
h = sub(h, "      const x = x0 + (120 + i * 140) * U;", "      const x = x0 + i * 140 * U;", 'x')
store('src/80_hud.js', h)
print('done')
