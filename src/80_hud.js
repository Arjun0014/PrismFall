// ---------------------------------------------------------------------------
// HUD, prism selector, radial wheel, menus, results and the cosmetic store.
// All immediate-mode on the same canvas — no DOM.
//
// The UI deliberately reuses a tiny fixed palette and a single modal helper:
// every distinct colour string and layout number costs compressed bytes.
// ---------------------------------------------------------------------------

// Four cosmetic categories of three variants; variant 0 is always owned.
// Cosmetics are render-only: they never touch collision, pigment or scoring.
const COSN = ('CLOUD SHADOW NEON SPIRAL LANCE STARTIP ' +
  'RAINBOW DASHED COMET SPARKS SHARDS RINGS').split(' ');
const COSP = [0, 180, 420];
const CATS = 4;
const owned = (c, i) => !i || (SAVE.o >> (c * 3 + i)) & 1;

// fixed UI palette
const W9 = '#fff';
const W6 = 'hsl(0 0% 100% / .62)';
const W3 = 'hsl(0 0% 100% / .34)';
const UB = 'hsl(282 40% 15% / .88)';   // button
const UE = 'hsl(290 55% 50%)';         // edge / accent
const UG = 'hsl(48 100% 66%)';         // gold

let U = 1;              // UI scale
let btns = [];          // immediate-mode buttons for this frame

function txt(s, x, y, sz, col, al, bold) {
  X.font = (bold ? 'bold ' : '') + (sz * U | 0) + 'px monospace';
  X.textAlign = al || 'center';
  X.textBaseline = 'middle';
  X.fillStyle = col;
  X.fillText(s, x, y);
}
const RR = (x, y, w, h, r) => { BP(); X.roundRect(x, y, w, h, r); };
const hot = (x, y, w, h) => pmx > x - w / 2 && pmx < x + w / 2 && pmy > y - h / 2 && pmy < y + h / 2;

function btn(x, y, w, h, label, fn, accent) {
  const o = hot(x, y, w, h);
  btns.push({ hot: o, fn });
  RR(x - w / 2, y - h / 2, w, h, 8 * U);
  FL(o ? accent || UE : UB);
  SK(2 * U, o ? W9 : UE);
  txt(label, x, y + U, 15, o ? W9 : W6, 'center', 1);
}

function uiClick() {
  for (const b of btns) if (b.hot) { sndUI(1); b.fn(); return 1; }
  return 0;
}

// --- in-run HUD ------------------------------------------------------------
function hud() {
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

  let brow = 0;
  for (let i = 0; i < 7; i++) if (boostT[i] > 0)
    txt(BNAME[i] + ' ' + boostT[i].toFixed(1), W - p, p + (30 + brow++ * 16) * U, 12,
      BOOST[i][0] > 6 ? W9 : chsl(BOOST[i][0], 70), 'right', 1);

  if (regShow > 0)
    txt(REG[reg][0], W / 2, H * .3, 42,
      'hsl(0 0% 100% / ' + clamp(regShow, 0, 1) * clamp(3.2 - regShow, 0, 1) + ')', 'center', 1);
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
}

// Seven reservoirs: fill = pigment left, ring = selection, dot = chain state.
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
}

// --- radial Prism Wheel ----------------------------------------------------
// Held on the right mouse button, anchored where the pointer already is, so the
// player never looks away from the unicorn. Flick toward a wedge, release to
// commit. The game keeps running underneath it.
function prismWheel() {
  const r = 84 * U, cx = wheel[0], cy = wheel[1];
  const dx = pmx - cx, dy = pmy - cy, d = hyp(dx, dy);
  // Inside the dead zone the current colour stays selected.
  wsel = d < 22 * U ? sel : flr(((at2(dy, dx) + PI * 2.5 + PI / 7) % TAU) / TAU * 7) % 7;
  CIR(cx, cy, r * 1.06, 'hsl(272 45% 6% / .72)');
  for (let i = 0; i < 7; i++) {
    const a0 = i / 7 * TAU - PI / 2 - PI / 7, a1 = a0 + TAU / 7, on = i === wsel;
    BP();
    MT(cx, cy);
    AR(cx, cy, on ? r * 1.1 : r, a0 + .02, a1 - .02);
    X.closePath();
    FL(chsl(i, on ? 58 : 30, on ? 1 : .8));
    SK(on ? 2.6 * U : 1 * U, on ? W9 : chsl(i, 46, .7));
    const am = (a0 + a1) / 2, tr = r * (on ? .8 : .72);
    txt('ROYGBIV'[i], cx + cos(am) * tr, cy + sin(am) * tr, on ? 17 : 13, on ? W9 : W6, 'center', 1);
    // Pigment left in this reservoir, as a ring arc — the wheel doubles as a gauge.
    BP();
    AR(cx, cy, r * .34, a0 + .04, lerp(a0 + .04, a1 - .04, pig[i] / PMAX));
    SK(5 * U, chsl(i, 62));
  }
  CIR(cx, cy, 20 * U, 'hsl(272 45% 8% / .9)', W3, 1.5 * U);
  txt(pig[wsel] | 0, cx, cy, 12, W6, 'center', 1);
}

// --- cursor ----------------------------------------------------------------
function cursor() {
  if (st !== 1) { CIR(pmx, pmy, 7 * U, 0, W9, 2 * U); return; }
  CIR(pmx, pmy, 9 * U, 0, chsl(sel, 70), 2.4 * U);
  CIR(pmx, pmy, 2 * U, chsl(sel, 85));
  if (!drawing && P.al) {
    const dx = mwx - P.x, dy = mwy - P.y, d = hyp(dx, dy);
    if (d > SREACH) CIR(w2sx(P.x + dx / d * SREACH), w2sy(P.y + dy / d * SREACH), 4 * U, chsl(sel, 60, .8));
  }
}

// --- modal framework -------------------------------------------------------
// bs = [dx, dy, w, label, fn, accent] offsets from the screen centre.
function modal(w, h, title, lines, bs, sz) {
  X.fillStyle = 'hsl(275 45% 5% / .8)';
  X.fillRect(0, 0, W, H);
  if (w) {
    RR(W / 2 - w * U / 2, H / 2 - h * U / 2, w * U, h * U, 14 * U);
    FL('hsl(272 40% 9% / .96)');
    SK(2 * U, UE);
    txt(title, W / 2, H / 2 - (h / 2 - 34) * U, 27, W9, 'center', 1);
  }
  for (let i = 0; i < lines.length; i++)
    txt(lines[i], W / 2, H / 2 - (h / 2 - 78) * U + i * 22 * U, sz || 13.5, W6, 'center', sz ? 1 : 0);
  for (const b of bs) btn(W / 2 + b[0] * U, H / 2 + b[1] * U, b[2] * U, 40 * U, b[3], b[4], b[5]);
}

const back = () => { st = SAVE.b || score ? 3 : 0; };
function mute() { SAVE.m ^= 1; if (mg) mg.gain.value = SAVE.m ? 0 : .8; save(); }

function screenTitle() {
  modal(0, 0, 0, [], [
    [0, -30, 190, 'PLAY', startRun, 'hsl(300 80% 55%)'],
    [-105, 26, 130, 'STORE', () => { st = 4; }],
    [105, 26, 130, SAVE.m ? 'UNMUTE' : 'MUTE', mute],
  ]);
  const cy = H * .3;
  for (let i = 0; i < 7; i++) {
    X.font = 'bold ' + (66 * U | 0) + 'px monospace';
    X.textAlign = 'center';
    X.fillStyle = chsl(i, 60, .5);
    X.fillText('PRISMFALL', W / 2 + sin(T * 1.2 + i * .5) * 5 * U, cy + (i - 3) * 2.4 * U);
  }
  txt('PRISMFALL', W / 2, cy, 66, W9, 'center', 1);
  txt('you never steer the unicorn — you draw the physics', W / 2, cy + 46 * U, 15, W6);
  [
    'DRAG a short rail near the unicorn · 1-7 or SCROLL picks a colour',
    'R push · O aim · Y spring · G tether · B rail · I gravity · V warp',
  ].forEach((l, i) => txt(l, W / 2, H - 100 * U + i * 20 * U, 13, i ? W6 : W9, 'center', !i));
  // Below the buttons, not at a fixed offset from the title: at 16:9 heights
  // the old position landed straight on top of PLAY.
  if (SAVE.b) txt('BEST ' + SAVE.b + '   DEPTH ' + (SAVE.d / 10 | 0) + 'm   COINS ' + SAVE.c,
    W / 2, H / 2 + 82 * U, 14, W3);
}

function screenResults() {
  modal(470, 330, 'RUN OVER', [
    'SCORE   ' + (score | 0),
    'DEPTH   ' + (depth / 10 | 0) + 'm',
    'REGION  ' + REG[reg][0],
    'COINS   +' + coins,
    'BEST    ' + SAVE.b,
    score >= SAVE.b && score ? 'NEW BEST!' : '',
  ], [
    [0, 62, 210, 'RETRY  (R)', startRun, 'hsl(300 80% 55%)'],
    [-105, 114, 130, 'STORE', () => { st = 4; }],
    [105, 114, 130, 'MENU', () => { st = 0; }],
  ], 16);
}

function screenPause() {
  modal(340, 296, 'PAUSED', [], [
    [0, -40, 200, 'RESUME', () => { st = 1; }],
    [0, 8, 200, 'RESTART  (R)', startRun],
    [0, 56, 200, SAVE.m ? 'UNMUTE' : 'MUTE', mute],
    [0, 104, 200, 'QUIT RUN', () => { endRun(); st = 3; }],
  ]);
}

// --- store -----------------------------------------------------------------
let prevCat = -1, prevIt = -1;
function screenStore() {
  modal(560, 470, 'PRISM STORE', [SAVE.c + ' COINS  ·  cosmetics only, never power'],
    [[0, 200, 150, 'BACK', back]], 14);
  prevCat = -1;
  const x0 = W / 2 - 240 * U;
  for (let n = 0; n < CATS * 3; n++) {
    const c = n / 3 | 0, i = n % 3;
    const x = x0 + i * 150 * U, y = H / 2 - 118 * U + c * 48 * U;
    const own = owned(c, i), eq = SAVE.e[c] === i, o = hot(x + 66 * U, y, 140 * U, 38 * U);
    if (o) { prevCat = c; prevIt = i; }
    RR(x, y - 19 * U, 140 * U, 38 * U, 7 * U);
    FL(eq ? UE : own ? UB : 'hsl(275 25% 10%)');
    SK((eq ? 2.4 : 1) * U, eq || o ? W9 : W3);
    txt(COSN[n], x + 66 * U, y - 5 * U, 11, own ? W9 : W6, 'center', 1);
    txt(own ? (eq ? 'EQUIPPED' : 'EQUIP') : COSP[i] + 'c', x + 66 * U, y + 9 * U, 10,
      own ? W3 : SAVE.c < COSP[i] ? 'hsl(0 60% 60%)' : UG);
    btns.push({ hot: o, fn: () => buyEquip(c, i) });
  }
  // Live preview through the real unicorn renderer.
  X.save();
  X.translate(W / 2, H / 2 + 122 * U);
  X.scale(1.9 * U, 1.9 * U);
  // Preview the hovered variant in place, everything else as equipped.
  unicornBody(prevCat === 0 ? prevIt : SAVE.e[0], flr(T * 3) % 7, 0,
    prevCat === 1 ? prevIt : SAVE.e[1]);
  X.restore();
}

function buyEquip(c, i) {
  if (owned(c, i)) { SAVE.e[c] = i; save(); return; }
  if (SAVE.c >= COSP[i]) {
    SAVE.c -= COSP[i];
    SAVE.o |= 1 << (c * 3 + i);
    SAVE.e[c] = i;
    save(); sndPower();
  } else sndEmpty();
}
