// Fast semantic validator for a compiled bundle.
//
// The sim/gen/audio suites all boot the *source* through tests/harness.mjs, so
// they prove the game is correct but say nothing about whether a given
// minifier mangled it. This boots an arbitrary compiled JS string in the same
// stubbed DOM, drives real input, and reports whether it survived.
//
// It is deliberately cheap (~0.3 s) so every row of a compressor tournament can
// be validated rather than only the winner.
import { makeCtx, makeAudio } from '../tests/harness.mjs';

export function smoke(js, opts = {}) {
  const counter = { calls: 0 };
  const audioStats = { created: 0, live: 0, stopped: 0, contexts: 0, sources: 0 };
  const ctx = makeCtx(counter);
  const canvas = {
    id: 'a', width: 1920, height: 1080,
    style: { cssText: '' },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
  };
  ctx.canvas = canvas;
  const listeners = {};
  const store = Object.create(null);
  const g = globalThis;
  g.document = {
    body: { style: { cssText: '' } },
    hidden: false,
    getElementById: () => canvas,
    querySelector: () => canvas,
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
  };
  g.window = g;
  g.innerWidth = 1920; g.innerHeight = 1080; g.devicePixelRatio = 1;
  g.addEventListener = (t, f) => { (listeners[t] ||= []).push(f); };
  g.removeEventListener = () => {};
  g.AudioContext = makeAudio(audioStats);
  g.webkitAudioContext = undefined;
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => {},
  };
  g.localStorage = new Proxy(ls, {
    get: (t, k) => (k in t ? t[k] : store[k]),
    set: (t, k, v) => { store[k] = String(v); return true; },
    has: (t, k) => k in t || k in store,
    ownKeys: () => Object.keys(store),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
  let rafQ = [];
  g.requestAnimationFrame = (f) => { rafQ.push(f); return rafQ.length; };
  g.cancelAnimationFrame = () => {};
  g.performance = g.performance || { now: () => Date.now() };

  const fire = (type, ev) => { for (const f of listeners[type] || []) f(ev); };
  let t = 0;
  const step = (ms = 16.7) => { const q = rafQ; rafQ = []; t += ms; for (const f of q) f(t); };

  try {
    // eslint-disable-next-line no-new-func
    new Function(js)();
  } catch (e) { return { ok: 0, where: 'load', err: String(e && e.message || e) }; }

  const before = counter.calls;
  try {
    const frames = opts.frames || 240;
    step();
    // Title screen -> start a run: a click near the centre hits the START button.
    fire('pointerdown', { clientX: 960, clientY: 620, pointerId: 1, button: 0, preventDefault() {} });
    fire('pointerup', { clientX: 960, clientY: 620, pointerId: 1, button: 0, preventDefault() {} });
    for (let i = 0; i < frames; i++) {
      // Draw a stroke every 20 frames, cycling colours, so the colour verbs,
      // pigment economy, audio and particle systems all get exercised.
      if (i % 20 === 0) {
        fire('keydown', { key: String(1 + (i / 20) % 7 | 0), preventDefault() {} });
        fire('pointerdown', { clientX: 900 + (i % 5) * 30, clientY: 500, pointerId: 1, button: 0, preventDefault() {} });
        fire('pointermove', { clientX: 1020 + (i % 5) * 30, clientY: 430, pointerId: 1, preventDefault() {} });
        fire('pointerup', { clientX: 1020 + (i % 5) * 30, clientY: 430, pointerId: 1, button: 0, preventDefault() {} });
      }
      step();
    }
  } catch (e) { return { ok: 0, where: 'run', err: String(e && e.message || e) }; }

  const drew = counter.calls - before;
  if (drew < 500) return { ok: 0, where: 'draw', err: 'only ' + drew + ' canvas calls' };
  if (!audioStats.contexts) return { ok: 0, where: 'audio', err: 'no AudioContext created' };
  if (!audioStats.sources) return { ok: 0, where: 'audio', err: 'no sound sources started' };
  return { ok: 1, draws: drew, sources: audioStats.sources, nodes: audioStats.created };
}

if (process.argv[1] && process.argv[1].endsWith('smoke.mjs')) {
  const { readFileSync } = await import('node:fs');
  const r = smoke(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
