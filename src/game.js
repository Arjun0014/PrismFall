// ---------------------------------------------------------------------------
// Game flow: persistence, run lifecycle, per-frame update and the main loop.
// ---------------------------------------------------------------------------

let acc = 0, last = 0, deadT = 0, stallSnd = 0;
const HSTEP = 1 / 120;

// --- persistence -----------------------------------------------------------
// One namespaced key, comma separated, clamped on read. Never clears storage.
// The four fields both builds need come first, so the competition build reads
// and writes a four-field record and the Wavedash build appends the store's
// six on the end. A record from either build loads in either build.
function load() {
  try {
    const a = (localStorage[LS] || '').split(',').map(Number);
    if (a.length < 3 || a.some(isNaN)) return;
    SAVE.b = clamp(a[0] | 0, 0, 1e12);
    SAVE.d = clamp(a[1] | 0, 0, 1e12);
    SAVE.m = a[2] ? 1 : 0;
    if (WDX && a.length > 8) {
      SAVE.c = clamp(a[3] | 0, 0, 1e9);
      SAVE.o = a[4] | 0;
      for (let i = 0; i < CATS; i++) {
        const v = a[5 + i] | 0;
        SAVE.e[i] = v > 0 && v < 3 && owned(i, v) ? v : 0;
      }
    }
  } catch (err) { /* storage unavailable - play anyway */ }
}
function save() {
  try {
    const a = [SAVE.b, SAVE.d, SAVE.m];
    if (WDX) a.push(SAVE.c, SAVE.o, ...SAVE.e);
    localStorage[LS] = a.join();
  } catch (err) { /* ignore */ }
}

// --- run lifecycle ---------------------------------------------------------
function startRun(sd) {
  audioInit();
  st = 1; score = 0; coins = 0; mult = 1; depth = 0; reg = 0; regShow = 3.2;
  chain = 0; chainN = 0; chainT = 0; fullSpec = 0; combo = 0; comboT = 0;
  deadT = 0; shake = 0; flash = 0; hstop = 0;
  pig = [PMAX, PMAX, PMAX, PMAX, PMAX, PMAX, PMAX];
  boostT = [0, 0, 0, 0, 0, 0, 0];
  strokes = []; parts = []; trail = []; pops = []; nodes = []; shocks = [];
  drawing = 0;
  P.x = 0; P.y = -320; P.vy = 300; P.a = PI / 2;
  P.ra = 0; P.te = 0; P.ph = 0; P.rp = 0; P.st = 0; P.gt = 0; P.al = 1; P.sp = 300; P.rw = 0;
  Gx = 0; Gy = GRAV;
  C.x = P.x; C.y = P.y; C.z = 1;
  pal = regPal(0);
  worldReset(sd);
  // After the seed is set, never before: otherwise the opening drift is drawn
  // from whatever PRNG state the previous run happened to leave behind and a
  // seeded replay is not actually reproducible.
  P.vx = rf(-70, 70);
  mStep = 0; if (AC) mNext = AC.currentTime + .05;
  sndRail(0);
}

function endRun() {
  if (WDX) SAVE.c += coins;
  SAVE.b = mx(SAVE.b, score | 0);
  SAVE.d = mx(SAVE.d, depth | 0);
  save();
  sndRail(0);
  if (WD) wdSubmit(score | 0, depth | 0);
}

function die() {
  P.al = 0; deadT = 1.3;
  for (let i = 0; i < 7; i++) burst(P.x, P.y, 16, 0, 520, HUE[i]);
  pt(P.x, P.y, 0, 0, .7, -1, 2, 22);
  shake = 30; flash = .7; flashH = -1;
  sndDeath();
  if (P.ra) detachRail(0);
  if (P.te) releaseTether();
  if (st != 0) endRun();
}

// --- per-frame -------------------------------------------------------------
function update(dt) {
  worldUpdate();

  if (P.al) physicsFrame(dt);

  fuseStep(dt);

  // Past the Rainbow Engine the shaft simply begins again, harder: regAt wraps
  // and difAt keeps climbing with the loop count, so the cycle boundary needs no
  // code of its own. It still announces itself, because a loop boundary is also
  // a region change and those already flash, name themselves and sound a gate.

  // region progression
  const r = regAt(P.y);
  if (r != reg) {
    reg = r; regShow = 3.2;
    flash = mx(flash, .35); flashH = REG[reg][1];
    sndGate();
    score += 500 * mult | 0;
  }

  // score + multiplier
  if (P.y > depth) { score += (P.y - depth) * .05 * mult; depth = P.y; }
  mult = clamp(1 + P.sp / 950 + chainN * .2 + (fullSpec > 0 ? 2 : 0), 1, 12);

  // Stall is the only failure state: too slow for too long and the run ends.
  if (P.al) {
    const stallT = STALLT;
    if (P.sp < STALLV) {
      P.st += dt;
      const u = clamp((P.st - STALLW) / (stallT - STALLW), 0, 1);
      if ((stallSnd -= dt) <= 0 && u > 0) { stallSnd = mx(.16, .55 - u * .4); sndStall(u); }
      if (P.st > stallT) die();
    } else if (P.st > 0) {
      if (P.st > STALLW) burst(P.x, P.y, 8, 0, 260, HUE[0]);
      P.st = mx(0, P.st - dt * 2.6);
    }
  } else {
    deadT -= dt;
    if (deadT <= 0) { if (st == 0) { startRun(); st = 0; } else st = 3; }
  }

  // timers
  regShow -= dt; dryT -= dt; fullSpec -= dt;
  for (let i = 0; i < 7; i++) boostT[i] -= dt;
  if (comboT > 0 && (comboT -= dt) <= 0) combo = 0;
  if (chainT > 0 && (chainT -= dt) <= 0) { chain = 0; chainN = 0; }
  flash = mx(0, flash - dt * 2.4);

  // Strokes are permanent. Only a *spent* one runs a timer, and that timer is
  // purely the fade that shows it was consumed. The single other way a drawing
  // leaves the field is scrolling out of reach behind you, which the player
  // never sees happen.
  for (let i = strokes.length; i--;) {
    const s = strokes[i];
    if (s.u) s.l -= dt;
    if ((s.u && s.l <= 0) || s.y2 < P.y - 2600) {
      if (P.ra == s) detachRail(1);
      if (s == drawing) drawing = 0;
      strokes.splice(i, 1);
    }
  }

  partStep(dt);
  if (P.al) pushTrail();
}

function physicsFrame(dt) {
  acc += dt;
  let n = 0;
  while (acc >= HSTEP && n < 8) { physics(HSTEP); acc -= HSTEP; n++; }
  if (n >= 8) acc = 0;
}

// --- draw ------------------------------------------------------------------
function draw() {
  btns = [];
  U = mn(W / 1280, H / 720);
  background();
  drawWorld();
  drawStrokes();
  drawTrail();
  drawParts();
  if (P.al) drawUnicorn();
  if (st == 1 || st == 2) hud();
  if (flash > .01) {
    X.fillStyle = flashH < 0
      ? hsl((T * 500) % 360 | 0, 100, 75, flash * .5)
      : hsl(flashH | 0, 100, 72, flash * .45);
    X.fillRect(0, 0, W, H);
  }
  // WDX && screenStore folds to 0 in the competition build, which is what
  // drops the store screen, buyEquip and the cosmetic tables entirely.
  if (st > 1) [0, 0, screenPause, screenResults, WDX && screenStore][st]();
  else if (!st) screenTitle();
  cursor();
  if (DEBUG) {
    txt('seed ' + seed + '  v ' + (P.sp | 0) + '  chunks ' + chunks.length + '  parts ' + parts.length +
      '  reg ' + reg + '  st ' + P.st.toFixed(1), 8, H - 10, 12, '#0f0', 0, 'left');
  }
}

// --- main loop -------------------------------------------------------------
function frame(ts) {
  requestAnimationFrame(frame);
  const raw = clamp((ts - last) / 1000, 0, .05);
  last = ts;
  // Hit-stop: a shatter or a hard bumper freezes the simulation for a few
  // frames while the particles keep moving. It costs four lines and it is the
  // single largest contributor to a hit feeling like it landed.
  let dt = raw;
  if (hstop > 0) { hstop -= raw; dt *= .12; }
  T += dt;
  if (st == 1 || st == 0) update(dt);
  else if (st == 3) partStep(dt);
  camUpdate(raw);
  palUpdate(raw);
  audioFrame();
  draw();
}

// --- boot ------------------------------------------------------------------
load();
resize();
// The title screen shows a live world behind it.
startRun();
st = 0;
P.al = 1;
requestAnimationFrame(frame);
