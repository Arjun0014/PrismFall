// ---------------------------------------------------------------------------
// Input: pointer drawing, colour selection (keys 1-7, scroll, prism bar),
// pause/restart/mute.
// ---------------------------------------------------------------------------

// Colour selection is instant and free; only drawing costs pigment.
function setSel(i) {
  i = (i + 7) % 7;
  if (i === sel) return;
  sel = i;
  sndUI(1);
  burst(P.x, P.y, 6, 0, 130, HUE[i]);
}

document.body.style.cssText = 'margin:0;overflow:hidden;background:#05030c';
CV.style.cssText = 'position:fixed;width:100%;height:100%';

function resize() {
  const d = mn(devicePixelRatio || 1, 2);
  W = CV.width = innerWidth * d | 0;
  H = CV.height = innerHeight * d | 0;
  U = mn(W / 1280, H / 720);
}

function ptr(e) {
  const d = W / innerWidth;
  pmx = e.clientX * d; pmy = e.clientY * d;
  mwx = s2wx(pmx); mwy = s2wy(pmy);
}

addEventListener('resize', resize);
addEventListener('contextmenu', (e) => e.preventDefault());

addEventListener('pointermove', (e) => { ptr(e); if (drawing) moveStroke(); });

addEventListener('pointerdown', (e) => {
  audioInit();
  ptr(e);
  if (e.button) return;
  if (!uiClick() && st === 1) startStroke();
});

addEventListener('pointerup', () => { drawing = null; });
addEventListener('blur', () => { drawing = null; if (st === 1) st = 2; });

addEventListener('wheel', (e) => {
  if (st !== 1) return;
  e.preventDefault();
  setSel(sel + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });

addEventListener('keydown', (e) => {
  audioInit();
  const k = e.key, l = k.toLowerCase();
  if (k > '0' && k < '8') { setSel(+k - 1); return; }
  if (k === 'Escape' || l === 'p') st = st === 1 ? 2 : st === 2 ? 1 : WD && st === 4 ? (back(), st) : st;
  if (l === 'r' && st > 1) startRun();
  if (l === 'm') mute();
  // Let go of whatever is holding you. With permanent strokes a rail lasts as
  // long as its line does, so there has to be a way off it that is not a crash.
  if (l === 'x') { if (P.ra) detachRail(1); else if (P.te) releaseTether(); }
  if (k === ' ' || k === 'Enter') { if (st === 2) st = 1; else if (st < 4) startRun(); }
  if (DEBUG) {
    if (k === 'g') { jumpReg(regAt(P.y) + 1); }
    if (k === 'f') for (let i = 0; i < 7; i++) pig[i] = PMAX;
  }
});
// Absolute region jump, exposed for the screenshot gallery so a capture always
// lands in the region it claims to be capturing. DEBUG-only: Terser drops the
// whole block from the release build.
if (DEBUG) window.jumpReg = (r) => {
  P.y = r * REGD + 600; P.x = 0; P.vx = 0; P.vy = 500;
  P.ra = null; P.te = null; P.st = 0; P.al = 1;
  reg = regAt(P.y); pal = regPal(reg);
  chunks = []; nextY = P.y - 900; prevL = -COL; prevR = COL;
  while (nextY < P.y + 3200) genChunk();
};
// A couple more DEBUG-only probes for the live feel harness, which needs to
// reach inside the IIFE to light a target or sample speed over time.
if (DEBUG) {
  window.__chunks = () => chunks;
  window.__light = (o) => light(o, o.x, o.y);
  window.__te = () => (P.te ? { l: P.te.l, t: P.te.t } : null);
  window.__pos = () => [w2sx(P.x), w2sy(P.y)];
  window.__speeds = () => ({ sp: P.sp | 0, mult: +mult.toFixed(1), combo, score: score | 0, strokes: strokes.length });
}
document.addEventListener('visibilitychange', () => { if (document.hidden && st === 1) st = 2; });
