// ---------------------------------------------------------------------------
// Input: pointer drawing, colour selection (keys 1-7, wheel, HUD, radial),
// pause/restart/mute.
// ---------------------------------------------------------------------------

// Colour selection is instant and free; only drawing costs pigment.
function setSel(i) {
  i = (i + 7) % 7;
  if (i === sel) return;
  sel = i;
  sndUI(1);
  burst(P.x, P.y, 6, 0, 130, HUE[i]);
  if (hint === 1) { hint = 2; hintT = 0; }
}

document.body.style.cssText = 'margin:0;overflow:hidden;background:#05030c';
CV.style.cssText = 'position:fixed;width:100%;height:100%;cursor:none';

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
  // Right button opens the radial Prism Wheel; left draws / clicks UI.
  if (e.button === 2) { if (st === 1) { wheel = [pmx, pmy]; wsel = sel; } return; }
  if (e.button) return;
  if (!uiClick() && st === 1) startStroke();
});

addEventListener('pointerup', (e) => {
  if (e.button === 2) { if (wheel) { setSel(wsel); wheel = null; } return; }
  drawing = null;
});
addEventListener('blur', () => { drawing = null; wheel = null; if (st === 1) st = 2; });

addEventListener('wheel', (e) => {
  if (st !== 1) return;
  e.preventDefault();
  setSel(sel + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });

addEventListener('keydown', (e) => {
  audioInit();
  const k = e.key, l = k.toLowerCase();
  if (k > '0' && k < '8') { setSel(+k - 1); return; }
  if (k === 'Escape' || l === 'p') st = st === 1 ? 2 : st === 2 ? 1 : st === 4 ? (back(), st) : st;
  if (l === 'r' && st > 1) startRun();
  if (l === 'm') mute();
  if (k === ' ' || k === 'Enter') { if (st === 2) st = 1; else if (st < 4) startRun(); }
  if (DEBUG) {
    if (k === 'g') { P.y += REGD; P.vy = 400; }
    if (k === 'f') for (let i = 0; i < 7; i++) pig[i] = PMAX;
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && st === 1) st = 2; });
