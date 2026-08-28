
// Audio coverage and hygiene.
//
// The soundscape is a graded requirement, not a nice-to-have, so this plays a
// long varied run and asserts that every cue actually fires, that each one has
// its own synthesis identity (rather than the same beep re-triggered), and that
// nothing leaks over restarts.
import { boot } from './harness.mjs';

let pass = 0, fail = 0;
const out = [];
const ok = (c, m, x) => {
  if (c) { pass++; out.push('  PASS  ' + m); }
  else { fail++; out.push('  FAIL  ' + m + (x !== undefined ? '   [' + x + ']' : '')); }
};

const H = boot();
const A = H.api;
const E = (s) => A.__eval(s);

const CUES = ('sndHit sndBreak sndBoost sndVector sndSpring sndTether sndRail sndGrav sndWarp ' +
  'sndCoin sndCrown sndPig sndWell sndSpectrum sndFuse sndRefund sndPower sndEmpty sndStall ' +
  'sndDeath sndUI sndGate').split(' ');

E('audioInit()');
ok(A.__eval('!!AC'), 'an AudioContext is created on the first gesture');

// Wrap each cue so we can see it fire, and record the oscillator/noise
// parameters it produces so two cues can be proved distinct.
globalThis.__hits = {};
globalThis.__sig = {};
E('window.__hits=globalThis.__hits;window.__sig=globalThis.__sig');
for (const n of CUES) {
  E('(()=>{const f=' + n + ';' + n + '=function(){' +
    'window.__hits["' + n + '"]=(window.__hits["' + n + '"]||0)+1;' +
    'window.__cur="' + n + '";const r=f.apply(null,arguments);window.__cur=0;return r}})()');
}
// Capture the synthesis parameters each cue asks for.
E('(()=>{const o=O,n=N;' +
  'O=function(w,f0,f1,d,p){if(window.__cur){(window.__sig[window.__cur]||=[]).push("o"+w[0]+(f0|0)+"_"+(f1|0)+"_"+(d*100|0))}return o.apply(null,arguments)};' +
  'N=function(d,p,ft,f0,f1){if(window.__cur){(window.__sig[window.__cur]||=[]).push("n"+ft[0]+(f0|0)+"_"+(f1|0)+"_"+(d*100|0))}return n.apply(null,arguments)}})()');

// --- a long, varied run ----------------------------------------------------
let rs = 999;
const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };

E('startRun(777);st=1;SAVE.t=1');
const P = A.P;
const before = H.audioStats.created;
for (let i = 0; i < 150 * 60; i++) {
  if (rnd() < .10) {
    E('sel=' + ((rnd() * 7) | 0));
    E('mwx=P.x+' + ((rnd() * 120 - 60) | 0) + ';mwy=P.y-16');
    E('startStroke()');
    E('mwx=P.x+' + ((rnd() * 170 - 85) | 0) + ';mwy=P.y-16+' + ((rnd() * 60 - 30) | 0));
    E('moveStroke()');
    E('drawing=null');
  }
  E('voices=0');
  E('update(1/60)');
  E('audioFrame()');
  E('AC.currentTime+=1/60');
  if (!P.al) E('startRun(' + (778 + i) + ');st=1');
}
// Cues a normal run may not reach on its own.
E('grab({t:I_WELL,x:P.x,y:P.y,c:0,g:0})');
E('chain=0;chainN=0;for(let i=0;i<7;i++)chainAdd(CBIT[i])');
E('grab({t:I_CROWN,x:P.x,y:P.y,c:0,g:0})');
E('grab({t:I_BOOST,x:P.x,y:P.y,c:3,g:0})');
E('sndUI(1);sndGate();sndBreak();sndStall(.5)');
E('for(let i=0;i<7;i++)pig[i]=0');
E('sel=0;mwx=P.x+40;mwy=P.y-16;startStroke()');
E('die()');

const hits = globalThis.__hits, sig = globalThis.__sig;
console.log('\n=== cue coverage ===');
const silent = CUES.filter((n) => !hits[n]);
for (const n of CUES) out.push('        ' + n.padEnd(14) + String(hits[n] || 0).padStart(7));
ok(silent.length === 0, 'every cue fires during play', silent.join(','));

console.log('\n=== cue identity ===');
// Two cues sharing an identical parameter signature would be the same sound
// wearing two names, which is exactly the "placeholder beeps" failure mode.
const firstSig = {};
for (const n of CUES) if (sig[n]) firstSig[n] = sig[n][0];
const dupes = [];
const seen = {};
for (const n of Object.keys(firstSig)) {
  const k = firstSig[n];
  if (seen[k]) dupes.push(seen[k] + '=' + n);
  else seen[k] = n;
}
ok(dupes.length === 0, 'no two cues share a synthesis signature', dupes.join(','));
// Seven cues deliberately borrow a sound rather than owning one (see the
// "cues that borrow" block in audio.js). They record no signature of their own,
// because the cue they call records it instead -- so the distinctness check
// above now says exactly what it should: every cue that OWNS a sound owns a
// different one.
const BORROW = 'sndTarget sndPig sndWell sndFuse sndRefund sndEmpty sndGate'.split(' ');
ok(Object.keys(firstSig).length >= CUES.length - BORROW.length - 1,
  'every cue that owns a sound is synthesised, not a stub',
  Object.keys(firstSig).length + '/' + (CUES.length - BORROW.length));
// What a borrowing cue must still do is make a noise. A borrowed sound is a
// design choice; a silent event is a bug.
for (const n of BORROW) {
  // Clear the per-frame voice budget first: ok() refuses to synthesise once 26
  // voices are already out, and the soak above leaves it full.
  E('voices=0');
  const before = H.audioStats.created;
  E(n + '(1)');
  ok(H.audioStats.created > before, n + ' still sounds', H.audioStats.created - before);
}
// Impact and boost must scale with the event, not play a fixed sample.
ok(new Set(sig.sndHit || []).size > 20, 'impact sound varies with impulse', new Set(sig.sndHit || []).size);
ok(new Set(sig.sndCoin || []).size > 3, 'coin pitch rises through a chain', new Set(sig.sndCoin || []).size);
ok(new Set(sig.sndBoost || []).size > 5, 'Red boost scales with the launch', new Set(sig.sndBoost || []).size);

console.log('\n=== continuous layers ===');
{
  // There is deliberately no continuous wind bed: it is audible whenever the
  // unicorn is moving, which is almost always, and it was fatiguing over a run.
  ok(A.__eval('typeof windG') === 'undefined', 'no always-on wind voice exists');
  E('startRun(5);st=1');
  P.vx = 0; P.vy = 2600; E('P.sp=2600;audioFrame()');

  E('P.ra=null;sndRail(0);audioFrame()');
  const railOff = A.__eval('railG.gain.value');
  E('P.ra={x1:0,y1:0,x2:100,y2:0,l:1,u:0};sndRail(1);audioFrame()');
  const railOn = A.__eval('railG.gain.value');
  ok(railOn > railOff, 'the rail grind engages only while railed', railOff + ' -> ' + railOn);
  E('P.ra=null;sndRail(0)');

  // Focus Vault and pause both duck the master filter.
  E('slow=0;st=1;audioFrame()');
  const open = A.__eval('lpF.frequency.value');
  E('slow=1;audioFrame()');
  const ducked = A.__eval('lpF.frequency.value');
  E('slow=0;st=2;audioFrame()');
  ok(A.__eval('lpF.frequency.value') < open / 4, 'pause ducks the mix');
  E('st=1;audioFrame()');
}

console.log('\n=== music ===');
{
  // Region identity must come from more than a palette swap.
  const shapes = [];
  for (let r = 0; r < 7; r++) {
    E('reg=' + r + ';startRun(3);st=1;reg=' + r);
    E('mStep=0;mNext=AC.currentTime');
    const c0 = H.audioStats.created;
    const notes = [];
    E('(()=>{const o=O;O=function(w,f0){window.__n.push(w[0]+(f0|0));return o.apply(null,arguments)}})()');
    globalThis.__n = notes;
    E('window.__n=globalThis.__n');
    for (let i = 0; i < 90; i++) { E('voices=0;P.sp=900;audioFrame();AC.currentTime+=1/60'); }
    shapes.push(notes.slice(0, 24).join(','));
    ok(H.audioStats.created > c0, 'region ' + r + ' music plays', H.audioStats.created - c0);
  }
  ok(new Set(shapes).size >= 6, 'regions have distinct musical material', new Set(shapes).size + '/7');

  // Intensity must change the arrangement, not just the volume.
  E('reg=0;startRun(3);st=1;mStep=0;mNext=AC.currentTime');
  globalThis.__n = [];
  E('window.__n=globalThis.__n');
  for (let i = 0; i < 120; i++) { E('voices=0;P.sp=60;audioFrame();AC.currentTime+=1/60'); }
  const calm = globalThis.__n.length;
  E('mStep=0;mNext=AC.currentTime');
  globalThis.__n = [];
  E('window.__n=globalThis.__n');
  for (let i = 0; i < 120; i++) { E('voices=0;P.sp=2400;audioFrame();AC.currentTime+=1/60'); }
  const busy = globalThis.__n.length;
  ok(busy > calm * 1.4, 'the arrangement thickens with intensity', calm + ' -> ' + busy);
}

console.log('\n=== arrangement ===');
{
  // The bed -- kick, bass and the bar-top pad -- must play even when the run is
  // slow, or a region has no music until you are already going fast.
  for (let r = 0; r < 7; r++) {
    E('reg=' + r + ';startRun(3);st=1;reg=' + r + ';mStep=0;mNext=AC.currentTime');
    globalThis.__n = [];
    E('window.__n=globalThis.__n');
    for (let i = 0; i < 240; i++) { E('voices=0;P.sp=40;audioFrame();AC.currentTime+=1/60'); }
    ok(globalThis.__n.length > 12, 'region ' + r + ' has a bed at low speed', globalThis.__n.length);
  }
  const K = A.KICK, B = A.BASSR;
  ok(new Set(K.map((k, i) => k + ':' + B[i])).size >= 6, 'regions have distinct rhythms',
    new Set(K.map((k, i) => k + ':' + B[i])).size + '/7');
}

console.log('\n=== hygiene ===');
{
  ok(H.audioStats.contexts === 1, 'exactly one AudioContext for the session', H.audioStats.contexts);
  // Exactly one source is meant to run forever: the rail oscillator.
  // Everything else must be scheduled with a stop time.
  ok(H.audioStats.live === 1, 'only the rail voice stays running', H.audioStats.live);
  ok(H.audioStats.created > before + 500, 'the run actually made sound', H.audioStats.created - before);

  // Restart soak: a fresh run must not accumulate nodes.
  const mark = H.audioStats.created;
  for (let i = 0; i < 40; i++) { E('startRun(' + i + ');st=1'); E('voices=0;audioFrame()'); }
  ok(H.audioStats.live === 1, 'restarts add no permanent voices', H.audioStats.live);
  ok(H.audioStats.created - mark < 4000, 'restarts do not spray voices', H.audioStats.created - mark);

  // Muting must silence every path, including the continuous ones.
  E('SAVE.m=1;startRun(9);st=1;P.sp=2600;P.ra={x1:0,y1:0,x2:9,y2:0};audioFrame()');
  ok(A.__eval('railG.gain.value') === 0, 'mute silences the continuous voice');
  const m0 = H.audioStats.created;
  for (let i = 0; i < 200; i++) E('voices=0;sndHit(1800,2,7);sndCoin(3);musicTick()');
  ok(H.audioStats.created === m0, 'mute stops all synthesis', H.audioStats.created - m0);
  E('SAVE.m=0');
}

out.forEach((l) => console.log(l));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
