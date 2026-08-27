// Headless harness: runs the real game bundle inside Node with stubbed DOM,
// Canvas2D and Web Audio, then hands back its internals so tests can drive the
// simulation directly. This is the same code the browser runs — no re-implementation.
import { bundle } from '../tools/src.mjs';

// --- stubs -----------------------------------------------------------------
// Every Canvas2D method the renderer touches, as no-ops. Draw calls are counted
// so tests can assert "the frame actually drew something".
export function makeCtx(counter) {
  const noop = () => { counter.calls++; };
  const ctx = {
    canvas: null,
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', font: '',
    textAlign: '', textBaseline: '', lineDashOffset: 0, globalAlpha: 1,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    ellipse: noop, quadraticCurveTo: noop, roundRect: noop, rect: noop,
    fill: noop, stroke: noop, fillRect: noop, clearRect: noop, fillText: noop,
    strokeText: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    scale: noop, clip: noop, setLineDash: noop, setTransform: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }),
  };
  return ctx;
}

class FakeParam {
  constructor(v) { this.value = v; }
  setValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  setTargetAtTime(v) { this.value = v; return this; }
}

// Counts live nodes so the soak tests can prove audio does not leak.
export function makeAudio(stats) {
  const node = (type) => {
    stats.created++;
    const src = type === 'osc' || type === 'bufsrc';
    if (src) { stats.live++; stats.sources++; }
    const n = {
      type, frequency: new FakeParam(440), Q: new FakeParam(1),
      gain: new FakeParam(1), detune: new FakeParam(0),
      playbackRate: new FakeParam(1), buffer: null, loop: false,
      connect: (d) => d, disconnect: () => {},
      start(t) { this._s = t || 0; }, stop(t) { this._e = t || 0; if (src) { stats.live--; stats.stopped++; } },
      onended: null, _kind: type,
    };
    return n;
  };
  return class FakeAC {
    constructor() {
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.state = 'running';
      this.destination = { connect: (d) => d };
      stats.contexts++;
    }
    resume() { this.state = 'running'; }
    createGain() { return node('gain'); }
    createOscillator() { return node('osc'); }
    createBiquadFilter() { return node('biquad'); }
    createBufferSource() { return node('bufsrc'); }
    createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
  };
}

// --- boot ------------------------------------------------------------------
export function boot(opts = {}) {
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
  g.innerWidth = opts.w || 1920;
  g.innerHeight = opts.h || 1080;
  g.devicePixelRatio = 1;
  g.addEventListener = (t, f) => { (listeners[t] ||= []).push(f); };
  g.removeEventListener = () => {};
  g.AudioContext = makeAudio(audioStats);
  g.webkitAudioContext = undefined;
  g.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { throw new Error('localStorage.clear() must never be called'); },
  };
  // The game uses bracket access (localStorage[LS]); make that work too.
  g.localStorage = new Proxy(g.localStorage, {
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

  // Wrap the bundle in a function body and return its internals. Because the
  // sources are plain top-level declarations, this exposes everything by name.
  const src = bundle(true);
  const names = ('P C X CV st T slow shake flash pig sel chain chainN fullSpec coins score mult depth reg ' +
    'chunks strokes parts trail pops nodes SAVE Gx Gy W H SC U drawing pmx pmy mwx mwy hint boostT combo ' +
    'seed nextY vault NC wheel wsel chainT hitCd AC mg sfxG musG lpF windG windF railG railF railO voices mStep mNext').split(' ');
  const fns = ('physics update draw frame startRun endRun die worldReset worldUpdate genChunk nearChunks ' +
    'startStroke moveStroke fuse hitStroke applyStroke chainAdd fullSpectrum grab setSel resize ptr ' +
    'audioInit audioFrame load save camUpdate palUpdate partStep pushTrail solidNear regAt difAt loopAt ' +
    'burst pop clampV detachRail railStep releaseTether tetherConstrain items collideAll hitOb shatter ' +
    'buyEquip owned uiClick btn modal hud prismBar cursor screenTitle screenResults screenStore screenPause prismWheel bst decorate ' +
    'srnd rr rf ri rp pick clamp lerp approach hyp hsl chsl segT segX regPal aff bias mat rewards ' +
    'sndHit sndBreak sndBoost sndVector sndSpring sndTether sndRail sndGrav sndWarp sndCoin sndCrown '+
    'sndPig sndWell sndSpectrum sndFuse sndRefund sndPower sndEmpty sndStall sndDeath sndUI sndGate '+
    'musicTick audioFrame O N ARP NOTE KICK BASSR wallsAt unicornBody drawWorld drawItem drawStrokes drawParts drawTrail ' +
    'drawUnicorn background motif obStyle obT obVel strokeColor railStep').split(' ');
  const consts = ('R GRAV VMAX VFAST VH COL WMAX SMAX SREACH SLIFE SLIM ST PMAX PC STALLV STALLT STALLW ' +
    'HUE CBIT ALL7 M_BUMP M_DAMP M_BREAK M_PHASE M_ANCH M_RAIL CHUNKS REGD BRK_E BRK_R ' +
    'I_COIN I_CROWN I_PIG I_WELL I_BOOST BOOST BNAME LS REG BIAS AFF MOT COSN COSP MSTY').split(' ');

  const uniq = [...new Set([...names, ...fns, ...consts])];
  const body = src + '\nreturn {' + uniq.map((n) => 'get ' + n + '(){return typeof ' + n + '=="undefined"?undefined:' + n + '}').join(',') +
    ',__set(k,v){eval(k+"=v")}' +
    ',__eval(s){return eval(s)}};';
  // eslint-disable-next-line no-new-func
  const api = new Function(body)();

  return {
    api,
    ctx,
    counter,
    audioStats,
    store,
    listeners,
    fire(type, ev) { (listeners[type] || []).forEach((f) => f(ev)); },
    // Drive one animation frame at a fixed wall-clock delta.
    step(ms) {
      const q = rafQ; rafQ = [];
      this.t = (this.t || 0) + (ms === undefined ? 16.7 : ms);
      q.forEach((f) => f(this.t));
      return this.t;
    },
    // Advance n frames.
    run(n, ms) { for (let i = 0; i < n; i++) this.step(ms); },
    reset() { rafQ = []; },
  };
}
