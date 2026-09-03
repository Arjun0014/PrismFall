// ---------------------------------------------------------------------------
// Math helpers + the deterministic PRNG used by every generator.
// ---------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential approach.
const approach = (a, b, r, h) => lerp(a, b, 1 - M.exp(-r * h));

// mulberry32 - 3 lines, good enough, fully seedable for regression replays.
let _rs = 1;
function srnd(s) { _rs = s >>> 0; }
// mulberry32's output stage, on its own so hsh() can hash through it too.
function mix(s) {
  let t = M.imul(s ^ (s >>> 15), 1 | s);
  t = (t + M.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rr() { return mix(_rs = (_rs + 0x6d2b79f5) | 0); }
const rf = (a, b) => a + rr() * (b - a);
const ri = (a, b) => flr(a + rr() * (b - a + 1));
const rp = (p) => rr() < p;
const pick = (a) => a[flr(rr() * a.length)];
// Random sign.
const rs = () => (rr() < .5 ? -1 : 1);

// Stateless hash for background motifs - infinite scenery with zero storage.
function hsh(x, y) { return mix(x * 1000003 + y | 0); }

// Closest point on segment (ax,ay)-(bx,by) to (px,py). Returns param 0..1.
function segT(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  return l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
}

// Segment/segment intersection point, or null. Used for Prism Node fusion.
function segX(ax, ay, bx, by, cx, cy, dx, dy) {
  const r1 = bx - ax, r2 = by - ay, s1 = dx - cx, s2 = dy - cy;
  const d = r1 * s2 - r2 * s1;
  if (!d) return 0;
  const t = ((cx - ax) * s2 - (cy - ay) * s1) / d;
  const u = ((cx - ax) * r2 - (cy - ay) * r1) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [ax + r1 * t, ay + r2 * t] : 0;
}

// hsl helpers - every colour in the game comes from these two.
const hsl = (h, s, l, a = 1) => 'hsl(' + h + ' ' + s + '% ' + l + '% / ' + a + ')';
const chsl = (c, l, a) => hsl(HUE[c], 100, l, a);
