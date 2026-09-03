// ---------------------------------------------------------------------------
// Procedural Web Audio. Everything is synthesised from two primitives:
//   O() - an oscillator with a pitch sweep and an AD envelope
//   N() - a slice of the shared noise buffer through a swept filter
// The rail grind is a single continuous voice created once and only modulated,
// so long runs never accumulate nodes.
// ---------------------------------------------------------------------------

let AC = null, mg, sfxG, musG, lpF, nzBuf, railG, railO, railF;
let voices = 0;                   // per-frame voice budget
let mNext = 0, mStep = 0;         // music scheduler

const NOTE = (n) => 420 * M.pow(2, (n - 70) / 12);
const SCALE = [[0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 5, 7, 9, 11], [0, 3, 5, 7, 10, 12], [0, 1, 5, 6, 8, 11]];
const WAVE = ['triangle', 'sawtooth', 'square'];

function audioInit() {
  if (AC) { if (AC.state == 'suspended') AC.resume(); return; }
  const AX = window.AudioContext || window.webkitAudioContext;
  if (!AX) return;
  AC = new AX();

  lpF = AC.createBiquadFilter(); lpF.type = 'lowpass'; lpF.frequency.value = 20000;
  mg = AC.createGain(); mg.gain.value = SAVE.m ? 0 : .8;
  lpF.connect(mg).connect(AC.destination);
  sfxG = AC.createGain(); sfxG.gain.value = .8; sfxG.connect(lpF);
  musG = AC.createGain(); musG.gain.value = .5; musG.connect(lpF);

  const n = AC.sampleRate * 2;
  nzBuf = AC.createBuffer(1, n, AC.sampleRate);
  const d = nzBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;

  // One always-on voice: the Blue rail grind. Built once, then only its gain
  // and frequency are modulated, so long runs never leak nodes.
  //
  // There was a second continuous voice here -- a speed-driven wind bed. Even
  // heavily damped it was fatiguing over a run, because it is on whenever you
  // are moving and you are almost always moving. Speed already reads through
  // the camera, the trail, the impacts and the music intensity, so the noise
  // bed was carrying no information anyone needed.
  railO = AC.createOscillator(); railO.type = 'sawtooth'; railO.frequency.value = 200;
  railF = AC.createBiquadFilter(); railF.type = 'bandpass';
  railF.frequency.value = 1400; railF.Q.value = 6;
  railG = AC.createGain(); railG.gain.value = 0;
  railO.connect(railF).connect(railG).connect(sfxG);
  railO.start();

  mNext = AC.currentTime + .1;
}

// Guards every synthesised voice: no context, muted, or over the frame budget.
const ok = () => AC && !SAVE.m && voices < 26;
const now = () => AC.currentTime;

// Oscillator with an optional pitch sweep and an attack/decay envelope.
// f1 of 0 (or equal to f0) means "hold the pitch".
function O(w, f0, f1, dur, pk, dest, t0) {
  if (!ok()) return;
  const t = t0 || now();
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = w;
  o.frequency.setValueAtTime(mx(8, f0), t);
  if (f1 && f1 != f0) o.frequency.exponentialRampToValueAtTime(mx(8, f1), t + dur);
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(mx(1e-4, pk), t + .008);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  o.connect(g).connect(dest || sfxG);
  o.start(t); o.stop(t + dur + .02);
  voices++;
}

function N(dur, pk, ft, f0, f1, q, dest, t0) {
  if (!ok()) return;
  const t = t0 || now();
  const s = AC.createBufferSource();
  s.buffer = nzBuf; s.loop = true;
  s.playbackRate.value = .7 + rnd() * .6;
  const f = AC.createBiquadFilter(); f.type = ft;
  f.frequency.setValueAtTime(mx(20, f0), t);
  if (f1 != f0) f.frequency.exponentialRampToValueAtTime(mx(20, f1), t + dur);
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
function sndHit(imp, kind, tune) {
  if (imp < 60) return;
  const v = clamp(imp / 2400, .04, .5);
  N(.03 + v * .12, v * .7, 'lowpass', 300 + imp * 1.6, 150, 1);
  if (imp > 420) O('triangle', 120 + imp * .05, 40, .1 + v * .12, v * .8);
  if (kind > 1) {
    // The Organ: every bumper is tuned by its own position, in the current
    // region's mode, so a column of them plays a phrase as you fall through it.
    const sc = SCALE[reg % 4], q = abs(tune | 0);
    const n = 64 + sc[(q >> 5) % sc.length] + 12 * (q >> 9 & 1);
    O('sine', NOTE(n), NOTE(n) * 1.6, .16, v * .5);
    O('triangle', NOTE(n + 12), 0, .1, v * .3);
  } else if (kind) O('sine', 90, 40, .22, v * .5);
}

// Depth is the cascade generation: each ring of a chain reaction rings a
// little higher and a little thinner, so a collapse sounds like one event
// spreading outward instead of six identical crashes on the same frame.
function sndBreak(d) {
  const k = 1 / (1 + d * .5);
  N(.3 * k, .5 * k, 'bandpass', 2600 * (1 + d * .3), 300, 1.4);
  O('triangle', 150 * (1 + d * .2), 40, .3 * k, .5 * k);
  N(.1, .3 * k, 'highpass', 4369, 9000, 1);
}

// A scoring target: pitch climbs with how much of the bank is already lit, so
// you can hear how close a bank is without reading the pips.
// --- cues that borrow -------------------------------------------------------
// Seven rare events reuse a sound that already exists rather than carrying one
// of their own. Every one still fires, still lands on the right beat, and still
// carries its information in PITCH -- the part a player actually reads. A
// target still climbs as its bank fills and pigment still pitches by colour,
// because the sound they borrow is itself pitch-driven.
//
// What they give up is a timbre of their own, and they are the seven nobody
// could describe from memory. The signature sounds -- impact, destruction, the
// seven colour verbs, the coin, the crown, the bank, death, Full Spectrum --
// are untouched.
function sndTarget(f) { sndCoin(f * 8); }
function sndBank() {
  ARP(70, [0, 4, 7, 12, 16, 19], .5, .12, 'square', .04, 12);
  N(.7, .22, 'bandpass', 700, 6000, .8);
  O('sine', 90, 300, .4, .3);
}

// --- the seven colours -----------------------------------------------------
function sndBoost(ns) {                       // Red - rocket
  const v = clamp(ns / 2600, .16, .5);
  O('sawtooth', 150, 700 + ns * .2, .2, v * .5);
  N(.3, v * .7, 'bandpass', 700, 4369, 1.2);
  O('sine', 70, 30, .3, v * .8);
}
function sndVector(sup) {                     // Orange - directional snap
  O('square', sup ? 700 : 900, sup ? 1800 : 1500, .07, .16);
  N(.05, .12, 'highpass', 2600, 5200, 1);
  if (sup) O('sine', 300, 900, .16, .2);
}
function sndSpring(imp) {                     // Yellow - elastic boing
  const v = clamp(imp / 1400, .12, .4);
  O('sine', 180 + imp * .1, 700 + imp * .3, .1, v);
  O('sine', 700 + imp * .3, 200, .2, v * .8);
}
function sndTether(on) {                      // Green - tension / thwip
  if (on) { O('triangle', 240, 700, 1.2, .12); N(.06, .1, 'bandpass', 900, 2600, 3); }
  else { O('sawtooth', 900, 200, .12, .25); N(.1, .2, 'bandpass', 1800, 500, 2); }
}
function sndRail(on) {                        // Blue - continuous grind
  if (!AC) return;
  if (railG) railG.gain.setTargetAtTime(on && !SAVE.m ? .12 : 0, now(), .03);
  if (on) O('square', 1200, 2600, .05, .1);
}
function sndGrav(ny) {                        // Indigo - gravity whoop
  const up = ny < 0;
  O('sine', up ? 120 : 420, up ? 420 : 100, .5, .3);
  O('triangle', up ? 240 : 700, up ? 700 : 200, .4, .12);
  N(.4, .1, 'lowpass', 900, 200, 1);
}
function sndWarp() {                          // Violet - space
  O('sawtooth', 2600, 240, .1, .2);
  N(.085, .16, 'highpass', 7000, 1400, 2);
  O('sine', 90, 240, .2, .25);
}

// --- rewards / systems -----------------------------------------------------
function sndCoin(cmb) {
  const n = 70 + mn(cmb, 14) * 2;
  O('square', NOTE(n), 0, .06, .1);
  O('sine', NOTE(n + 12), 0, .1, .12);
}
// One arpeggio/chord engine drives every musical reward cue.
// offs = semitone offsets, gap = seconds between notes (0 = chord), up = glide.
function ARP(root, offs, dur, pk, w, gap, up) {
  if (!AC) return;
  const t = now();
  offs.forEach((o, i) => O(w, NOTE(root + o), up ? NOTE(root + o + up) : 0, dur, pk, 0, t + i * gap));
}
const MAJ = [0, 4, 7, 12];
function sndCrown() { ARP(70, MAJ, .5, .12, 'triangle', .05); }
function sndPig(c) { sndCoin(c); }
function sndWell() { sndCrown(); }
function sndSpectrum() {
  ARP(60, SCALE[1], .7, .12, 'sawtooth', .05, 12);
  ARP(90, MAJ, 1.6, .1, 'sine', 0);
  if (AC) N(1.2, .2, 'bandpass', 420, 8000, .7, 0, now() + .3);
}
function sndFuse() { sndUI(1); }
function sndRefund() { sndCoin(0); }
function sndPower() { ARP(60, [0, 5, 10], .12, .1, 'square', .06, 2); }
function sndEmpty() { sndUI(0); }
function sndStall(u) { O('sine', 70 + u * 40, 48, .16, .12 + u * .16); }
function sndDeath() {
  ARP(70, [0, -3, -6, -9, -12, -15, -18], .8, .1, 'sawtooth', .04, -30);
  N(1, .3, 'lowpass', 3000, 90, 1);
  O('sine', 120, 30, 1.2, .3);
}
function sndUI(up) { O('square', up ? 900 : 620, up ? 1200 : 500, .04, .07); }
function sndGate() { sndBank(); }

// --- per-frame continuous layers ------------------------------------------
// Continuous layers, updated once a frame:
//  - the rail grind tracks rail speed
//  - one master low-pass ducks everything inside a Focus Vault or a pause
function audioFrame() {
  voices = 0;
  if (!AC) return;
  const t = now(), n = clamp(P.sp / VMAX, 0, 1), play = st == 1 && P.al;
  const set = (p, v, k) => p.setTargetAtTime(v, t, k);
  set(railG.gain, P.ra && !SAVE.m && play ? .1 + n * .12 : 0, .04);
  set(railF.frequency, 700 + P.sp * 1.4, .04);
  set(railO.frequency, 90 + P.sp * .2, .04);
  set(lpF.frequency, st == 2 ? 700 : 20000, .1);
  set(musG.gain, SAVE.m ? 0 : st == 1 ? .5 : .3, .2);
  if (play) musicTick();
  else mNext = t + .1;
}

// A 16th-note scheduler that plays a real, if small, arrangement: kick, bass,
// a sustained chord pad, hats and a lead. Region identity is a formula rather
// than seven hand-written tracks -- root, mode, timbre, tempo and the bass
// rhythm all key off the region index -- and density follows how fast you are
// going, so the music reacts to the run instead of looping underneath it.
// Rhythm masks: one bit per 16th note of the bar, LSB first.
//   Cloudbreak four-on-the-floor - Sunforge driving - Verdant loose -
//   Crystal clean - Mine sparse and heavy - Temple off-kilter - Engine eighths
const KICK = [0x1111, 0x1155, 0x1013, 0x1111, 0x1001, 0x0512, 0x5555];
const BASSR = [0x8889, 0xa4a5, 0x9192, 0xcccd, 0x8484, 0xa8a9, 0xaaab];

function musicTick() {
  const root = 40 + reg * 5 % 11, sc = SCALE[reg % 4], w = WAVE[reg % 3];
  const inten = clamp(P.sp / VFAST, 0, 1.6) + (fullSpec > 0 ? .6 : 0);
  const spb = 15 / (90 + reg * 7);
  const kick = KICK[reg], bassr = BASSR[reg];
  const t0 = now();
  for (let guard = 8; mNext < t0 + .16 && guard--;) {
    const t = mx(mNext, t0), i = mStep, b = i & 15, bar = i >> 4;
    const deg = (bar * 2 + (b > 7 ? 1 : 0)) % sc.length;
    const bass = root - 12 + sc[deg];

    if (kick >> b & 1) { O('sine', 120, 40, .16, .5, musG, t); N(.03, .12, 'lowpass', 900, 200, 1, musG, t); }
    if (bassr >> b & 1) O(w, NOTE(bass), 0, .2, .3, musG, t);
    // Pad: a held triad at the top of every bar, which is what actually makes
    // a region sound like a place rather than a drum loop.
    if (!b) for (const o of [0, 3 + (sc[2] > 3 ? 1 : 0), 7])
      O('triangle', NOTE(root + sc[deg] + o), 0, spb * 15, .1, musG, t);
    if (inten > .22 && (b & 1)) N(.03, .04 + inten * .03, 'highpass', 7000, 6000, 1, musG, t);
    if (inten > .5 && b % 4 == 2) N(.1, .12, 'bandpass', 1800, 900, 1.2, musG, t);
    if (inten > .8 && !(b & 1)) {
      const n = NOTE(root + 12 + sc[(i * 3 + bar) % sc.length]);
      O(w, n, n, .1, .1, musG, t);
    }
    mStep++; mNext = t + spb;
  }
}
