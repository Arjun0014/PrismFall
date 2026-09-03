// Behavioural equivalence of two compiled bundles, call for call.
//
// The sim, gen and audio suites boot the SOURCE, and the browser suite only
// asserts that the shipped page runs; nothing checked that a post-Terser
// rewrite (tools/canon.mjs, relabel, globals) produces the same program. One
// did not: the first literal-right pass dropped the parentheses around a
// compound operand and turned `12 * (y >> 9 & 1)` into `y >> 9 & 1 * 12`, and
// every suite stayed green. This runs two bundles through the same stubbed
// DOM with the same seeded Math.random and the same input script, records
// every Canvas2D call, every context property set and every Web Audio node,
// connection and parameter write with full-precision arguments, and reports
// the first frame and the first call where the two traces differ.
//
//   node tools/equiv.mjs                 Terser output vs the shipped bundle
//   node tools/equiv.mjs a.js b.js       any two bundles
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES = 900;

function run(js, captureFrame = -1) {
  const frames = [];
  let cur = [];
  const rec = (...a) => { cur.push(a.map((x) => typeof x === 'number' ? (Object.is(x, -0) ? '-0' : String(x)) : typeof x === 'string' ? JSON.stringify(x) : String(x)).join(' ')); };
  const METHODS = 'beginPath closePath moveTo lineTo arc ellipse quadraticCurveTo roundRect rect fill stroke fillRect clearRect fillText strokeText save restore translate rotate scale clip setLineDash setTransform'.split(' ');
  const grad = (kind, args) => { rec(kind, ...args); return { addColorStop: (...a) => rec('addColorStop', ...a) }; };
  const store = {};
  const ctx = new Proxy({}, {
    get: (t, p) => {
      if (p === 'canvas') return canvas;
      if (METHODS.includes(p)) return (...a) => rec(p, ...a);
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return (...a) => grad(p, a);
      if (p === 'measureText') return () => ({ width: 10 });
      return store[p];
    },
    set: (t, p, v) => { store[p] = v; rec('=' + String(p), v); return true; },
  });
  const canvas = { width: 1920, height: 1080, style: { cssText: '' }, getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) };
  let nid = 0;
  class Param { constructor(n, v) { this.n = n; this.value = v; } }
  const paramProxy = (name, v) => new Proxy(new Param(name, v), {
    get: (t, p) => {
      if (p === 'value') return t.value;
      if (['setValueAtTime', 'exponentialRampToValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime'].includes(p))
        return (...a) => { rec(name + '.' + p, ...a); t.value = a[0]; return t; };
      return t[p];
    },
    set: (t, p, v) => { if (p === 'value') rec(name + '.value', v); t[p] = v; return true; },
  });
  const node = (type) => {
    const id = ++nid; rec('new', type, id);
    const n = { id, type, frequency: paramProxy('n' + id + '.frequency', 440), Q: paramProxy('n' + id + '.Q', 1),
      gain: paramProxy('n' + id + '.gain', 1), detune: paramProxy('n' + id + '.detune', 0), playbackRate: paramProxy('n' + id + '.playbackRate', 1),
      connect: (d) => { rec('connect', id, d.id); return d; }, disconnect: () => rec('disconnect', id),
      start: (t) => rec('start', id, t), stop: (t) => rec('stop', id, t) };
    return new Proxy(n, { set: (t, p, v) => { if (typeof v !== 'object' && typeof v !== 'function') rec('n' + id + '.' + String(p), v); t[p] = v; return true; } });
  };
  class FakeAC {
    constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = { id: 0, connect: (d) => d }; rec('AudioContext'); }
    resume() { rec('resume'); }
    createGain() { return node('gain'); }
    createOscillator() { return node('osc'); }
    createBiquadFilter() { return node('biquad'); }
    createBufferSource() { return node('bufsrc'); }
    createBuffer(ch, len, rate) { rec('createBuffer', ch, len, rate); return { length: len, getChannelData: () => new Float32Array(len) }; }
  }
  const listeners = {};
  const ls = Object.create(null);
  const g = globalThis;
  g.document = { body: { style: { cssText: '' } }, hidden: false, querySelector: () => canvas, getElementById: () => canvas,
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); } };
  g.window = g; g.innerWidth = 1920; g.innerHeight = 1080; g.devicePixelRatio = 1;
  g.addEventListener = (t, f) => { (listeners[t] ||= []).push(f); };
  g.removeEventListener = () => {};
  g.AudioContext = FakeAC;
  g.localStorage = new Proxy({ getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
    { get: (t, k) => (k in t ? t[k] : ls[k]), set: (t, k, v) => { ls[k] = String(v); return true; }, has: (t, k) => k in t || k in ls });
  let rafQ = [];
  g.requestAnimationFrame = (f) => { rafQ.push(f); return rafQ.length; };
  g.cancelAnimationFrame = () => {};
  // Seeded Math.random, installed before the bundle binds it.
  let seed = 0x9e3779b9;
  const realRandom = Math.random;
  Math.random = () => { seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0; let t = seed ^ (seed >>> 7); t = Math.imul(t, 0x2c1b3c6d) ^ (t >>> 13); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
  const realNow = Date.now;
  let clock = 1e12;
  Date.now = () => clock;
  g.performance = { now: () => clock - 1e12 };
  const fire = (type, ev) => { for (const f of listeners[type] || []) f(ev); };
  let t = 0;
  const step = () => { const q = rafQ; rafQ = []; t += 16.7; clock += 16.7; for (const f of q) f(t); };
  const ev = (x, y, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {}, ...extra });
  let err = null;
  try {
    new Function(js)();
    step();
    fire('pointerdown', ev(960, 620)); fire('pointerup', ev(960, 620));
    for (let i = 0; i < FRAMES; i++) {
      if (i % 20 === 0) {
        fire('keydown', { key: String(1 + (i / 20) % 7 | 0), preventDefault() {} });
        const dx = (i * 37) % 160 - 80, dy = (i * 53) % 120 - 60;
        fire('pointerdown', ev(900 + dx, 500 + dy));
        for (let k = 1; k <= 4; k++) fire('pointermove', ev(900 + dx + k * 30, 500 + dy - k * 18));
        fire('pointerup', ev(1020 + dx, 430 + dy));
      }
      if (i % 20 === 10) fire('pointermove', ev(700 + i % 300, 300 + i % 200));
      if (i === 150) fire('wheel', { deltaY: 3, preventDefault() {} });
      if (i === 151) fire('wheel', { deltaY: -3, preventDefault() {} });
      if (i === 300) fire('keydown', { key: 'p', preventDefault() {} });
      if (i === 320) fire('keydown', { key: ' ', preventDefault() {} });
      if (i === 400) fire('keydown', { key: 'x', preventDefault() {} });
      if (i === 500) fire('blur', {});
      if (i === 520) fire('keydown', { key: 'Enter', preventDefault() {} });
      if (i === 600) fire('keydown', { key: 'm', preventDefault() {} });
      if (i === 640) fire('keydown', { key: 'm', preventDefault() {} });
      if (i === 700) fire('keydown', { key: 'r', preventDefault() {} });
      if (i === 800) fire('keydown', { key: 'Escape', preventDefault() {} });
      if (i === 820) fire('keydown', { key: 'Escape', preventDefault() {} });
      step();
      const h = hash(cur.join('\n'));
      frames.push(captureFrame === i ? cur.join('\n') : h);
      cur = [];
    }
  } catch (e) { err = String(e && e.stack || e); }
  Math.random = realRandom; Date.now = realNow;
  return { frames, err, save: JSON.stringify(ls) };
}
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16) + ':' + s.length; }

async function main() {
  let [a, b] = process.argv.slice(2);
  let A, B;
  if (!a) {
    const { minify } = await import('terser');
    const { competitionTerser } = await import('./measure.mjs');
    const { bundle } = await import('./src.mjs');
    const r = await minify(bundle(false), competitionTerser());
    if (r.error) throw r.error;
    A = r.code; a = 'terser output (no canon)';
    writeFileSync(join(ROOT, 'build', 'terser-only.js'), A);
    B = readFileSync(join(ROOT, 'build', 'bundle.min.js'), 'utf8'); b = 'build/bundle.min.js';
  } else { A = readFileSync(a, 'utf8'); B = readFileSync(b, 'utf8'); }
  const ra = run(A), rb = run(B);
  if (ra.err) { console.log('A threw: ' + ra.err); process.exitCode = 1; }
  if (rb.err) { console.log('B threw: ' + rb.err); process.exitCode = 1; }
  const n = Math.min(ra.frames.length, rb.frames.length);
  let diverge = -1;
  for (let i = 0; i < n; i++) if (ra.frames[i] !== rb.frames[i]) { diverge = i; break; }
  const calls = ra.frames.reduce((s, h) => s + (+h.split(':')[1] || 0), 0);
  if (diverge < 0 && ra.frames.length === rb.frames.length && ra.save === rb.save && !ra.err && !rb.err) {
    console.log('EQUIVALENT: ' + ra.frames.length + ' frames, ' + calls + ' trace chars, identical save record');
    console.log('  A: ' + a + '\n  B: ' + b);
    return;
  }
  process.exitCode = 1;
  if (diverge < 0) { console.log('traces match but ' + (ra.save !== rb.save ? 'save records differ:\n  A ' + ra.save + '\n  B ' + rb.save : 'frame counts differ')); return; }
  const fa = run(A, diverge).frames[diverge].split('\n'), fb = run(B, diverge).frames[diverge].split('\n');
  let k = 0; while (k < fa.length && k < fb.length && fa[k] === fb[k]) k++;
  console.log('DIVERGE at frame ' + diverge + ', call ' + k + ' of ' + fa.length + '/' + fb.length);
  for (let i = Math.max(0, k - 3); i < Math.min(fa.length, fb.length, k + 4); i++) console.log((i === k ? '>> ' : '   ') + 'A ' + fa[i] + '\n' + (i === k ? '>> ' : '   ') + 'B ' + fb[i]);
}
main().catch((e) => { console.error(e); process.exit(1); });
