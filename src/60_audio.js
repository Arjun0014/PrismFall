// ---------------------------------------------------------------------------
// Procedural Web Audio. Everything is synthesised from two primitives:
//   O() — an oscillator with a pitch sweep and an AD envelope
//   N() — a slice of the shared noise buffer through a swept filter
// Two continuous voices (wind, rail grind) are created once and only have
// their gain/frequency modulated, so long runs never accumulate nodes.
// ---------------------------------------------------------------------------

let AC = null, mg, sfxG, musG, lpF, nzBuf, windG, windF, railG, railO, railF;
let voices = 0;                   // per-frame voice budget
let mNext = 0, mStep = 0;         // music scheduler

const NOTE = (n) => 440 * M.pow(2, (n - 69) / 12);
const SCALE = [[0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 5, 7, 9, 11], [0, 3, 5, 7, 10, 12], [0, 1, 5, 6, 8, 11]];
const WAVE = ['triangle', 'sawtooth', 'square'];

function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  const AX = window.AudioContext || window.webkitAudioContext;
  if (!AX) return;
  AC = new AX();

  lpF = AC.createBiquadFilter(); lpF.type = 'lowpass'; lpF.frequency.value = 20000;
  mg = AC.createGain(); mg.gain.value = SAVE.m ? 0 : .8;
  lpF.connect(mg).connect(AC.destination);
  sfxG = AC.createGain(); sfxG.gain.value = .85; sfxG.connect(lpF);
  musG = AC.createGain(); musG.gain.value = .38; musG.connect(lpF);

  const n = AC.sampleRate * 2;
  nzBuf = AC.createBuffer(1, n, AC.sampleRate);
  const d = nzBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;

  // Two always-on voices: wind (speed) and rail grind (Blue). Built once, then
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

  mNext = AC.currentTime + .1;
}

const ok = () => AC && !SAVE.m && voices < 26;
const now = () => AC.currentTime;

// Oscillator with an optional pitch sweep and an attack/decay envelope.
// f1 of 0 (or equal to f0) means "hold the pitch".
function O(w, f0, f1, dur, pk, dest, t0) {
  const t = t0 || now();
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = w;
  o.frequency.setValueAtTime(mx(8, f0), t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(mx(8, f1), t + dur);
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(mx(1e-4, pk), t + .008);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  o.connect(g).connect(dest || sfxG);
  o.start(t); o.stop(t + dur + .02);
  voices++;
}

function N(dur, pk, ft, f0, f1, q, dest, t0) {
  const t = t0 || now();
  const s = AC.createBufferSource();
  s.buffer = nzBuf; s.loop = true;
  s.playbackRate.value = .7 + rnd() * .6;
  const f = AC.createBiquadFilter(); f.type = ft;
  f.frequency.setValueAtTime(mx(20, f0), t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(mx(20, f1), t + dur);
  f.Q.value = q || 1;
  const g = AC.createGain();
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(mx(1e-4, pk), t + .005);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  s.connect(f).connect(g).connect(dest || sfxG);
  s.start(t); s.stop(t + dur + .02);
  voices++;
}

// --- collision / material --------------------------------------------------
// Impact: one noise transient scaled by impulse, plus a body tone. kind 1 is a
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
}

// --- the seven colours -----------------------------------------------------
function sndBoost(ns) {                       // Red — rocket
  if (!ok()) return;
  const v = clamp(ns / 2600, .16, .5);
  O('sawtooth', 150, 780 + ns * .2, .22, v * .5);
  N(.34, v * .7, 'bandpass', 700, 4200, 1.1);
  O('sine', 70, 34, .3, v * .8);
}
function sndVector(sup) {                     // Orange — directional snap
  if (!ok()) return;
  O('square', sup ? 700 : 940, sup ? 2000 : 1680, .07, .16);
  N(.05, .12, 'highpass', 2600, 5200, 1);
  if (sup) O('sine', 320, 900, .16, .2);
}
function sndSpring(imp) {                     // Yellow — elastic boing
  if (!ok()) return;
  const v = clamp(imp / 1400, .12, .4);
  O('sine', 180 + imp * .1, 700 + imp * .3, .1, v);
  O('sine', 700 + imp * .3, 210, .22, v * .8);
}
function sndTether(on) {                      // Green — tension / thwip
  if (!ok()) return;
  if (on) { O('triangle', 240, 720, 1.1, .13); N(.06, .1, 'bandpass', 900, 2400, 3); }
  else { O('sawtooth', 900, 190, .13, .26); N(.1, .22, 'bandpass', 1800, 500, 2); }
}
function sndRail(on) {                        // Blue — continuous grind
  if (!AC) return;
  if (railG) railG.gain.setTargetAtTime(on && !SAVE.m ? .12 : 0, now(), .03);
  if (on && ok()) O('square', 1200, 2400, .05, .1);
}
function sndGrav(ny) {                        // Indigo — gravity whoop
  if (!ok()) return;
  const up = ny < 0;
  O('sine', up ? 120 : 460, up ? 460 : 110, .5, .3);
  O('triangle', up ? 240 : 700, up ? 700 : 200, .38, .12);
  N(.4, .1, 'lowpass', 900, 200, 1);
}
function sndWarp() {                          // Violet — space
  if (!ok()) return;
  O('sawtooth', 2600, 260, .1, .2);
  N(.08, .18, 'highpass', 7000, 1400, 2);
  O('sine', 90, 240, .22, .26);
}

// --- rewards / systems -----------------------------------------------------
function sndCoin(cmb) {
  if (!ok()) return;
  const n = 74 + mn(cmb, 14) * 2;
  O('square', NOTE(n), 0, .06, .1);
  O('sine', NOTE(n + 12), 0, .1, .12);
}
// One arpeggio/chord engine drives every musical reward cue.
// offs = semitone offsets, gap = seconds between notes (0 = chord), up = glide.
function ARP(root, offs, dur, pk, w, gap, up) {
  if (!AC || SAVE.m) return;
  const t = now();
  offs.forEach((o, i) => O(w, NOTE(root + o), up ? NOTE(root + o + up) : 0, dur, pk, 0, t + i * gap));
}
const MAJ = [0, 4, 7, 12];
function sndCrown() { ARP(72, MAJ, .5, .12, 'triangle', .045); }
function sndPig(c) { if (ok()) O('triangle', NOTE(64 + c * 2), NOTE(76 + c * 2), .16, .16); }
function sndWell() {
  ARP(60, SCALE[1], .5, .13, 'sine', .06, 12);
  if (ok()) N(.9, .16, 'bandpass', 800, 6000, .8);
}
function sndSpectrum() {
  ARP(60, SCALE[1], .7, .12, 'sawtooth', .05, 12);
  ARP(84, MAJ, 1.5, .1, 'sine', 0);
  if (AC && !SAVE.m) N(1.2, .2, 'bandpass', 400, 8000, .7, 0, now() + .3);
}
function sndFuse() { if (ok()) { O('square', 1500, 2600, .05, .09); O('sine', 900, 1800, .1, .09); } }
function sndRefund() { if (ok()) O('triangle', NOTE(76), NOTE(83), .18, .12); }
function sndPower() { ARP(62, [0, 5, 10], .12, .1, 'square', .06, 2); }
function sndEmpty() { if (ok()) { O('sine', 150, 70, .12, .18); N(.06, .07, 'lowpass', 500, 200, 1); } }
function sndStall(u) { if (ok()) O('sine', 70 + u * 40, 50, .18, .12 + u * .18); }
function sndDeath() {
  ARP(72, [0, -3, -6, -9, -12, -15, -18], .8, .1, 'sawtooth', .04, -30);
  if (AC && !SAVE.m) { N(1, .3, 'lowpass', 3000, 90, 1); O('sine', 120, 30, 1.1, .3); }
}
function sndUI(up) { if (ok()) O('square', up ? 900 : 620, up ? 1200 : 500, .04, .07); }
function sndGate() {
  ARP(48, [0, 7, 12, 16, 19], 1.6, .1, 'triangle', 0);
  if (AC && !SAVE.m) N(1.4, .22, 'bandpass', 300, 5000, .6);
}

// --- per-frame continuous layers ------------------------------------------
// Continuous layers, updated once a frame:
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
}

// A 16th-note scheduler. Region identity comes from formulas — a different
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
}
