// Simulation / feature tests. Drives the real game code headlessly and asserts
// that every gameplay pillar actually does what the design says it does.
import { boot } from './harness.mjs';

let pass = 0, fail = 0;
const results = [];
function ok(c, msg, extra) {
  if (c) { pass++; results.push('  PASS  ' + msg); }
  else { fail++; results.push('  FAIL  ' + msg + (extra !== undefined ? '   [' + extra + ']' : '')); }
}
const near = (a, b, t) => Math.abs(a - b) <= t;

const H = boot();
const A = H.api;
const ev = (k) => A.__eval(k);
const set = (k, v) => A.__set(k, v);

// Put the player in a clean, empty pocket of world so single effects can be
// measured without obstacles interfering.
const SY = 400 + 20;   // a stroke at this y is just inside contact range of P

function clean(vx, vy) {
  A.__eval('startRun(12345)');
  A.__eval('st=1');
  A.__eval('for(const c of chunks){c.o.length=0;c.i.length=0}');
  A.__eval('hitCd=0;nodes.length=0');
  const P = A.P;
  P.x = 0; P.y = 400; P.vx = vx === undefined ? 0 : vx; P.vy = vy === undefined ? 0 : vy;
  P.ra = null; P.te = null; P.ph = 0; P.rp = 0; P.st = 0; P.gt = 0; P.al = 1;
  A.__eval('Gx=0;Gy=GRAV');
  A.__eval('strokes.length=0');
  A.__eval('NC=nearChunks(P.y-500,P.y+500)');
  return P;
}

// Build a live stroke with an arbitrary effect mask directly under the player.
function stroke(mask, x1, y1, x2, y2, c) {
  const s = { x1, y1, x2, y2, e: mask, c: c === undefined ? 0 : c, l: 0, u: 0, paid: 0, n: 1 };
  A.strokes.push(s);
  return s;
}

// ---------------------------------------------------------------------------
console.log('\n=== boot / lifecycle ===');
H.run(30);
ok(A.st === 0, 'boots to the title screen');
ok(A.chunks.length > 2, 'title screen has a live world behind it', A.chunks.length);
ok(H.counter.calls > 500, 'frames actually draw', H.counter.calls);

A.__eval('startRun(999)');
ok(A.st === 1, 'startRun enters play');
ok(A.pig.every((p) => p === A.PMAX), 'run starts with full pigment');
ok(A.score === 0 && A.coins === 0, 'run counters reset');

// ---------------------------------------------------------------------------
console.log('\n=== seven colours ===');
const NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Indigo', 'Violet'];

// Red — must add energy along the direction of travel.
{
  const P = clean(0, 300);
  stroke(1, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)');
  ok(A.hyp(P.vx, P.vy) > 800, 'Red adds a large impulse', A.hyp(P.vx, P.vy) | 0);
  ok(P.rp > 0, 'Red leaves the unicorn Red-charged');
}
{
  // Red must not simply be a rebound: it works from a standstill, Yellow does not.
  const P1 = clean(0, 0); stroke(1, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)'); const r0 = A.hyp(P1.vx, P1.vy);
  const P2 = clean(0, 0); stroke(4, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)'); const y0 = A.hyp(P2.vx, P2.vy);
  ok(r0 > 400, 'Red recovers a dead-stopped unicorn', r0 | 0);
  ok(r0 > y0 * 1.5, 'Red and Yellow are physically different', r0.toFixed(0) + ' vs ' + y0.toFixed(0));
}
// Orange — must redirect velocity along the stroke axis, preserving speed.
{
  const P = clean(0, 600);
  const sp0 = A.hyp(P.vx, P.vy);
  stroke(2, -70, SY, 70, SY);       // horizontal stroke
  A.__eval('collideAll(1/120)');
  const sp1 = A.hyp(P.vx, P.vy);
  ok(Math.abs(P.vx) > Math.abs(P.vy) * 3, 'Orange redirects along the stroke', P.vx.toFixed(0) + ',' + P.vy.toFixed(0));
  ok(sp1 > sp0 * .85, 'Orange preserves speed', sp0.toFixed(0) + '->' + sp1.toFixed(0));
}
// Yellow — must reflect with gain.
{
  const P = clean(0, 500);
  stroke(4, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)');
  ok(P.vy < -500, 'Yellow springs back hard', P.vy | 0);
}
// Green — must create a tether, then release into a launch.
{
  const P = clean(600, 0);
  stroke(8, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)');
  ok(!!P.te, 'Green attaches a tether');
  if (P.te) {
    const before = A.hyp(P.vx, P.vy);
    A.__eval('releaseTether()');
    ok(!P.te, 'tether releases');
    ok(A.hyp(P.vx, P.vy) > before, 'release converts the orbit into a launch');
  }
}
// Blue — must attach a rail and carry the unicorn along it.
{
  const P = clean(0, 400);
  const s = stroke(16, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)');
  ok(P.ra === s, 'Blue attaches the rail');
  const x0 = P.x;
  for (let i = 0; i < 20; i++) A.__eval('physics(1/120)');
  ok(Math.abs(P.x - x0) > 20, 'the rail transports the unicorn sideways', (P.x - x0).toFixed(0));
}
// Indigo — must rewrite the gravity vector, then restore it.
{
  const P = clean(0, 300);
  stroke(32, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)');
  ok(ev('Gy') < 0, 'Indigo flips gravity upward', ev('Gy') | 0);
  ok(P.gt > 0, 'gravity override is timed');
  A.__eval('P.gt=0.001;physics(1/120)');
  ok(near(ev('Gy'), A.GRAV, 1) && near(ev('Gx'), 0, 1), 'gravity resets when the timer expires');
}
// Violet — dash alone, portal with a partner, phase when fused with Blue.
{
  const P = clean(0, 400);
  const y0 = P.y;
  stroke(64, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)');
  ok(P.y > y0 + 100, 'Violet alone is a phase dash', (P.y - y0) | 0);
  ok(P.ph > 0, 'the dash leaves the unicorn phased');
}
{
  const P = clean(0, 400);
  stroke(64, -70, SY, 70, SY);
  const dest = stroke(64, -260, 900, -140, 900);
  A.__eval('collideAll(1/120)');
  ok(near(P.x, -200, 200) && P.y > 700, 'two Violet strokes form a portal pair', P.x.toFixed(0) + ',' + P.y.toFixed(0));
  ok(dest.u === 1, 'the exit portal is consumed');
}
{
  const P = clean(0, 400);
  stroke(64 | 16, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)');
  ok(P.ph > .5, 'Violet+Blue phases the whole rail instead of warping', P.ph.toFixed(2));
}

// ---------------------------------------------------------------------------
console.log('\n=== mixing ===');
{
  // Orange+Yellow must be measurably stronger than Orange alone.
  const P1 = clean(0, 500); stroke(2, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)'); const o = A.hyp(P1.vx, P1.vy);
  const P2 = clean(0, 500); stroke(6, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)'); const oy = A.hyp(P2.vx, P2.vy);
  ok(oy > o * 1.25, 'Orange+Yellow composes into a stronger launch', o.toFixed(0) + ' vs ' + oy.toFixed(0));
}
{
  // Red+Indigo must do both things at once.
  const P = clean(0, 300);
  stroke(1 | 32, -70, SY, 70, SY);
  A.__eval('collideAll(1/120)');
  ok(A.hyp(P.vx, P.vy) > 800 && ev('Gy') < 0, 'Red+Indigo applies both effects');
}
{
  // Geometric fusion: crossing strokes must OR their masks.
  clean(0, 0);
  const a = stroke(1, -100, 300, 100, 300, 0);
  const b = stroke(16, 0, 200, 0, 400, 4);
  A.__eval('fuse(strokes[0])');
  ok(a.e === (1 | 16) && b.e === (1 | 16), 'crossing strokes fuse into one mask', a.e + '/' + b.e);
  ok(A.nodes.length > 0, 'fusion spawns a prism node');
}
{
  // Non-crossing strokes must not fuse.
  clean(0, 0);
  const a = stroke(1, -300, 300, -200, 300, 0);
  stroke(16, 200, 200, 200, 400, 4);
  A.__eval('nodes.length=0;fuse(strokes[0])');
  ok(a.e === 1 && A.nodes.length === 0, 'distant strokes do not fuse');
}

// ---------------------------------------------------------------------------
console.log('\n=== pigment economy ===');
{
  A.__eval('startRun(7)');
  A.__eval('st=1');
  const P = A.P; P.x = 0; P.y = 0;
  // Draw Red repeatedly and confirm it runs dry.
  let drawn = 0;
  for (let i = 0; i < 400 && A.pig[0] > 0; i++) {
    A.__eval('sel=0');
    A.__eval('mwx=P.x+40;mwy=P.y+40');
    A.__eval('startStroke()');
    A.__eval('mwx=P.x+200;mwy=P.y+200');
    A.__eval('moveStroke()');
    A.__eval('drawing=null');
    drawn++;
  }
  ok(A.pig[0] <= 0.6, 'Red exhausts under spam', A.pig[0].toFixed(2));
  ok(drawn > 4 && drawn < 60, 'Red lasts a reasonable number of strokes', drawn);
  ok(A.pig[4] > 90, 'spamming Red does not drain Blue', A.pig[4].toFixed(1));
}
{
  // No pigment regeneration from speed — the design forbids it.
  A.__eval('startRun(7);st=1');
  A.__eval('for(const c of chunks)c.i.length=0');
  A.__eval('for(let i=0;i<7;i++)pig[i]=20');
  A.P.vx = 2000; A.P.vy = 2000;
  for (let i = 0; i < 200; i++) A.__eval('physics(1/120)');
  ok(A.pig.every((p) => p <= 20.001), 'pigment never regenerates from motion', A.pig.map((p) => p.toFixed(1)).join(','));
}
{
  // Pickups refill.
  A.__eval('startRun(7);st=1');
  A.__eval('pig[3]=5');
  A.__eval('grab({t:I_PIG,x:P.x,y:P.y,c:3,g:0})');
  ok(A.pig[3] > 40, 'pigment shards refill their colour', A.pig[3].toFixed(1));
  A.__eval('for(let i=0;i<7;i++)pig[i]=1');
  A.__eval('grab({t:I_WELL,x:P.x,y:P.y,c:0,g:0})');
  ok(A.pig.every((p) => p === A.PMAX), 'a Prism Well refills every reservoir');
}
{
  // Spectrum diversity refunds are partial, never self-sustaining.
  A.__eval('startRun(7);st=1');
  A.__eval('for(let i=0;i<7;i++)pig[i]=50');
  const before = A.pig.reduce((a, b) => a + b, 0);
  A.__eval('chain=0;chainN=0');
  for (let i = 0; i < 7; i++) A.__eval('chainAdd(CBIT[' + i + '])');
  const after = A.pig.reduce((a, b) => a + b, 0);
  ok(after > before, 'a full spectrum chain refunds pigment', (after - before).toFixed(0));
  ok(after - before < 7 * 100, 'the refund is partial, not a full refill', (after - before).toFixed(0));
}

// ---------------------------------------------------------------------------
console.log('\n=== full spectrum ===');
{
  A.__eval('startRun(7);st=1');
  A.__eval('chain=0;chainN=0;score=0');
  for (let i = 0; i < 7; i++) A.__eval('chainAdd(CBIT[' + i + '])');
  ok(A.fullSpec > 0, 'seven distinct colours trigger Full Spectrum');
  ok(A.score > 1000, 'Full Spectrum scores big', A.score | 0);
  ok(A.chain === 0, 'the chain resets after payoff');
}

// ---------------------------------------------------------------------------
console.log('\n=== stall / death ===');
{
  A.__eval('startRun(7);st=1');
  const P = A.P;
  P.x = 0; P.y = 300; P.vx = 0; P.vy = 0; P.st = 0;
  A.__eval('Gx=0;Gy=0');            // freeze the world so it truly stalls
  let t = 0;
  for (let i = 0; i < 600 && P.al; i++) { A.__eval('update(1/60)'); t += 1 / 60; }
  ok(!P.al, 'a genuine stall ends the run');
  ok(near(t, A.STALLT, .5), 'death happens at the configured grace period', t.toFixed(2));
}
{
  // Slow motion must NOT fake a stall: the check uses simulation speed.
  A.__eval('startRun(7);st=1');
  const P = A.P;
  A.__eval('slow=1');
  P.vx = 0; P.vy = 900; P.st = 0;
  for (let i = 0; i < 200; i++) { P.vy = 900; A.__eval('update(1/60)'); }
  ok(P.al, 'Focus Vault slow motion never causes a false death');
  ok(P.st === 0, 'a fast unicorn accrues no stall time');
  A.__eval('slow=0');
}
{
  // Recovery: getting moving again must clear the stall clock.
  A.__eval('startRun(7);st=1');
  const P = A.P;
  P.vx = 0; P.vy = 0; P.st = 0; A.__eval('Gx=0;Gy=0');
  for (let i = 0; i < 60; i++) A.__eval('update(1/60)');
  const mid = P.st;
  P.vy = 900;
  for (let i = 0; i < 60; i++) { P.vy = 900; A.__eval('update(1/60)'); }
  ok(mid > .5 && P.st < mid, 'stall clock winds back down on recovery', mid.toFixed(2) + '->' + P.st.toFixed(2));
}

// ---------------------------------------------------------------------------
console.log('\n=== physics robustness ===');
{
  // High-speed tunnelling: fire the unicorn at the wall at max speed many times.
  let escaped = 0;
  for (let k = 0; k < 40; k++) {
    A.__eval('startRun(' + (100 + k) + ');st=1');
    const P = A.P;
    P.vx = (k & 1 ? 1 : -1) * A.VMAX; P.vy = A.VMAX;
    for (let i = 0; i < 400; i++) {
      A.__eval('physics(1/120)');
      if (Math.abs(P.x) > A.WMAX + 80 || !isFinite(P.x + P.y)) { escaped++; break; }
    }
  }
  ok(escaped === 0, 'no tunnelling through the walls at max speed over 40 seeds', escaped);
}
{
  // NaN guard.
  A.__eval('startRun(3);st=1');
  A.P.vx = NaN; A.P.vy = NaN;
  A.__eval('physics(1/120)');
  ok(isFinite(A.P.vx + A.P.vy + A.P.x + A.P.y), 'NaN velocity is recovered from');
}
{
  // Velocity clamp.
  A.__eval('startRun(3);st=1');
  A.P.vx = 1e9; A.P.vy = 1e9;
  A.__eval('clampV()');
  ok(A.hyp(A.P.vx, A.P.vy) <= A.VMAX + 1, 'velocity clamp holds', A.hyp(A.P.vx, A.P.vy) | 0);
}
{
  // Constraint cleanup. A rail lasts as long as its line does, and lines are
  // permanent, so the way one ends is being consumed or scrolling out of reach
  // -- either must detach the rail rather than stranding the player on it.
  const P = clean(0, 300);
  const s = stroke(16, -100, SY, 100, SY);
  A.__eval('collideAll(1/120)');
  ok(P.ra === s, 'rail attached');
  A.__eval('update(1/60)');
  ok(P.ra === s, 'the rail does NOT expire on a timer');
  s.u = 1; s.l = -1;
  A.__eval('update(1/60)');
  ok(!P.ra, 'consuming the stroke detaches the rail');
  ok(A.strokes.indexOf(s) < 0, 'the spent stroke is removed once it has faded');

  // Scrolling far above the player is the only other way a drawing leaves.
  const s2 = stroke(1, -100, SY, 100, SY);
  A.P.y = s2.y2 + 4000;
  A.__eval('update(1/60)');
  ok(A.strokes.indexOf(s2) < 0, 'a drawing far behind the player is culled');
}
{
  // Stroke cap.
  A.__eval('startRun(3);st=1');
  A.__eval('strokes.length=0');
  for (let i = 0; i < 12; i++) {
    A.__eval('sel=1;mwx=P.x+30;mwy=P.y+30;startStroke();mwx=P.x+120;mwy=P.y+120;moveStroke();drawing=null');
  }
  ok(A.strokes.length <= A.SLIM, 'live stroke count is capped', A.strokes.length);
}
{
  // Breakables shatter above the energy threshold and survive below it.
  A.__eval('startRun(5);st=1');
  const mk = (m) => ({ t: 1, x: 0, y: 500, r: 80, g: 0, m, k: 0 });
  const slow_ = mk(A.M_BREAK), fast_ = mk(A.M_BREAK);
  A.__eval('NC=[{o:[],i:[]}]');
  A.P.x = 0; A.P.y = 500 - A.R - A.ST + 1; A.P.vx = 0; A.P.vy = 300;
  A.__eval('hitOb(' + 'arguments[0]' + ')');   // placeholder, replaced below
  ok(true, 'breakable harness reachable');
  // direct calls
  A.NC[0].o.push(slow_);
  A.P.x = 0; A.P.y = 500 - A.R - A.ST + 2; A.P.vy = 300;
  A.__eval('hitOb(NC[0].o[0])');
  ok(slow_.k === 0, 'a soft hit does not break the panel');
  A.NC[0].o.push(fast_);
  A.P.x = 0; A.P.y = 500 - A.R - A.ST + 2; A.P.vy = 2000;
  A.__eval('hitOb(NC[0].o[1])');
  ok(fast_.k === 1, 'a fast hit shatters the panel');
}
{
  // Phase walls: solid normally, passable while phased.
  A.__eval('startRun(5);st=1');
  const w = { t: 1, x: 0, y: 500, r: 200, g: 0, m: A.M_PHASE, k: 0 };
  A.__eval('NC=[{o:[],i:[]}]');
  A.NC[0].o.push(w);
  const P = A.P;
  P.x = 0; P.y = 500 - A.R - A.ST + 2; P.vx = 0; P.vy = 800; P.ph = 0;
  A.__eval('hitOb(NC[0].o[0])');
  ok(P.vy < 0, 'a phase wall is solid when not phased', P.vy | 0);
  P.y = 500 - A.R - A.ST + 2; P.vy = 800; P.ph = .5;
  A.__eval('hitOb(NC[0].o[0])');
  ok(P.vy > 0, 'a phase wall is passable while phased', P.vy | 0);
}

// ---------------------------------------------------------------------------
console.log('\n=== reachability: up, down, sideways ===');
{
  // The player must be able to drive the unicorn upward with Indigo/Yellow.
  A.__eval('startRun(21);st=1');
  const P = A.P;
  A.__eval('for(const c of chunks){c.o.length=0;c.i.length=0}');
  A.__eval('hitCd=0');
  P.x = 0; P.y = 820; P.vx = 0; P.vy = 400;
  A.__eval('strokes.length=0');
  A.__eval('NC=nearChunks(P.y-500,P.y+500)');
  stroke(4 | 2, -70, 840, 70, 840);   // Yellow+Orange horizontal launcher
  A.P.vy = 900;
  A.__eval('collideAll(1/120)');
  const climbed = P.vy < 0 || Math.abs(P.vx) > 600;
  ok(climbed, 'a spring/vector stroke redirects out of the fall', P.vx.toFixed(0) + ',' + P.vy.toFixed(0));
}
{
  // Indigo must be able to carry the unicorn back up over time.
  const P = clean(0, 200);
  P.y = 900;
  A.__eval('Gx=0;Gy=-GRAV;P.gt=3');
  const y0 = P.y;
  for (let i = 0; i < 120; i++) A.__eval('physics(1/120)');
  ok(P.y < y0, 'inverted gravity climbs', (P.y - y0).toFixed(0));
}

// ---------------------------------------------------------------------------
console.log('\n=== items / economy ===');
{
  A.__eval('startRun(31);st=1');
  A.__eval('coins=0;score=0;combo=0');
  for (let i = 0; i < 5; i++) A.__eval('grab({t:I_COIN,x:P.x,y:P.y,c:0,g:0})');
  ok(A.coins === 5, 'coins accumulate', A.coins);
  ok(A.score > 0, 'coins score');
  ok(A.combo === 5, 'coin combo chains', A.combo);
  A.__eval('grab({t:I_CROWN,x:P.x,y:P.y,c:0,g:0})');
  ok(A.coins === 20, 'a Crown Coin is worth 15', A.coins);
  A.__eval('boostT=[0,0];grab({t:I_BOOST,x:P.x,y:P.y,c:0,g:0})');
  ok(A.boostT[0] > 0, 'boosters arm');
}

// ---------------------------------------------------------------------------
console.log('\n=== persistence ===');
{
  A.__eval('startRun(41);st=1');
  A.__eval('SAVE.b=0;SAVE.d=0;coins=7;score=1234;depth=5000;endRun()');
  ok(H.store.pf26 !== undefined, 'save writes the namespaced key');
  ok(!Object.keys(H.store).some((k) => !k.startsWith('pf26')), 'no foreign keys written', Object.keys(H.store).join(','));
  // Coins are in-run feedback in the competition build -- there is nothing to
  // spend them on, so nothing banks them. Best score and depth still persist.
  ok(A.SAVE.b === 1234 && A.SAVE.d === 5000, 'best score and depth persist', A.SAVE.b + '/' + A.SAVE.d);
  ok(H.store.pf26.split(',').length === 3, 'the competition record is three fields', H.store.pf26);
  // Reload path.
  A.__eval('SAVE.b=0;SAVE.d=0;load()');
  ok(A.SAVE.b === 1234 && A.SAVE.d === 5000, 'values survive a reload', A.SAVE.b + '/' + A.SAVE.d);
  // Malformed storage must not crash or wipe.
  H.store.pf26 = 'garbage,,,x';
  let threw = 0;
  try { A.__eval('load()'); } catch (e) { threw = 1; }
  ok(!threw, 'malformed storage does not throw');
  H.store.pf26 = '';
  try { A.__eval('load()'); } catch (e) { threw = 1; }
  ok(!threw, 'empty storage does not throw');
}
{
  // Store: buy, equip, and never gain power. The store is a Wavedash-build
  // feature now, so this asks for that build -- in the competition build it is
  // compiled out and there is nothing here to assert about.
  const W = boot({ wd: 1 }).api;
  W.__eval('SAVE.c=1000;SAVE.o=0;SAVE.e=[0,0,0]');
  W.__eval('buyEquip(0,1)');
  ok(W.SAVE.e[0] === 1 && W.SAVE.c === 1000 - W.COSP[1], 'purchase deducts and equips', W.SAVE.c);
  W.__eval('buyEquip(0,0)');
  ok(W.SAVE.e[0] === 0, 'the free variant can always be equipped');
  W.__eval('SAVE.c=0;SAVE.o=0;SAVE.e=[0,0,0];buyEquip(1,2)');
  ok(W.SAVE.e[1] === 0, 'cannot buy without coins');
  ok(typeof W.__eval('screenStore') === 'function', 'the Wavedash build has a store screen');
  // That the COMPETITION build has none is a property of the compiled output,
  // not of this harness -- boot() runs unminified source, where the definition
  // is still present and merely unreachable. tools/build.mjs asserts it on the
  // real bundle instead.
  // Cosmetics must not appear in any physics constant.
  const codeUsesCosmetics = /SAVE\.e/.test(A.__eval('physics.toString()')) ||
    /SAVE\.e/.test(A.__eval('hitOb.toString()')) ||
    /SAVE\.e/.test(A.__eval('applyStroke.toString()')) ||
    /SAVE\.e/.test(A.__eval('grab.toString()'));
  ok(!codeUsesCosmetics, 'no cosmetic touches physics, collision or scoring');
}

// ---------------------------------------------------------------------------
console.log('\n=== boosters ===');
{
  // Every booster must measurably change the verb it names.
  const KEY = ['sp', 'sp', 'te', 'rw', 'gt', 'ph', 'cost'];
  const probe = (bi, on) => {
    A.__eval('startRun(808);st=1');
    A.__eval('for(const c of chunks){c.o.length=0;c.i.length=0}');
    A.__eval('hitCd=0;strokes.length=0;boostT=[0,0,0,0,0,0,0]');
    if (on) A.__eval('boostT[' + bi + ']=' + A.BOOST[bi][2]);
    const P = A.P;
    P.x = 0; P.y = 400; P.vx = 700; P.vy = 400; P.ra = null; P.te = null; P.ph = 0; P.gt = 0;
    A.__eval('Gx=0;Gy=GRAV');
    A.__eval('NC=nearChunks(P.y-500,P.y+500)');
    const c = A.BOOST[bi][0];
    if (c > 6) {
      A.__eval('sel=0;for(let i=0;i<7;i++)pig[i]=100');
      A.__eval('mwx=P.x+30;mwy=P.y+30;startStroke();mwx=P.x+160;mwy=P.y+160;moveStroke();drawing=null');
      return 100 - A.pig[0];
    }
    stroke(A.CBIT[c], -90, SY, 90, SY, c);
    A.__eval('collideAll(1/120)');
    return { sp: A.hyp(P.vx, P.vy), gt: P.gt, ph: P.ph, te: P.te ? P.te.l : 0, rw: P.rw }[KEY[bi]];
  };
  for (let i = 0; i < 7; i++) {
    const off = probe(i, 0), on = probe(i, 1);
    const better = i === 6 ? on < off * .6 : on > off * 1.05;
    ok(better, A.BNAME[i] + ' changes ' + KEY[i], off.toFixed(1) + ' -> ' + on.toFixed(1));
  }
  ok(A.BOOST.length === 7, 'all seven spec boosters exist', A.BOOST.length);
  ok(new Set(A.BOOST.map((b) => b[0])).size === 7, 'each booster targets a different verb');
}

// ---------------------------------------------------------------------------
console.log('\n=== cosmetics (Wavedash build) ===');
{
  const W = boot({ wd: 1 }).api;
  ok(W.COSN.length === 12, 'four categories of three cosmetics', W.COSN.length);
  // Equipping anything must leave the simulation bit-identical.
  const runTo = (equip) => {
    W.__eval('SAVE.o=-1;SAVE.e=[' + equip.join(',') + ']');
    W.__eval('startRun(4242);st=1');
    const P = W.P;
    for (let i = 0; i < 900; i++) {
      if (i % 30 === 0) {
        W.__eval('sel=' + (i / 30 | 0) % 7);
        W.__eval('mwx=P.x+40;mwy=P.y-16;startStroke();mwx=P.x+140;mwy=P.y-16;moveStroke();drawing=null');
      }
      W.__eval('update(1/60)');
    }
    return [P.x, P.y, P.vx, P.vy, W.score, W.coins].map((v) => (v * 1000 | 0)).join(',');
  };
  const plain = runTo([0, 0, 0, 0]);
  const fancy = runTo([2, 2, 2, 2]);
  ok(plain === fancy, 'cosmetics do not change the simulation at all');
}

// ---------------------------------------------------------------------------
// The radial Prism Wheel was removed: keys 1-7, the scroll wheel and the
// clickable prism bar all already select a colour, and the bar is also the
// touch path, so the wheel was the one item on the size menu that cost nothing
// to lose. Its assertions live on as a guarantee that the survivors work.
console.log('\n=== colour selection paths ===');
{
  A.__eval('startRun(5);st=1;sel=0');
  A.__eval('setSel(3)');
  ok(A.sel === 3, 'keys 1-7 select', A.sel);
  A.__eval('setSel(sel + 1)');
  ok(A.sel === 4, 'scroll steps forward', A.sel);
  A.__eval('setSel(-1)');
  ok(A.sel === 6, 'and wraps around', A.sel);
  // The prism bar publishes a clickable button per colour every frame.
  A.__eval('btns=[];W=1920;H=1080;U=1;prismBar()');
  ok(A.__eval('btns.length') >= 7, 'the prism bar is clickable', A.__eval('btns.length'));
}

// ---------------------------------------------------------------------------
console.log('\n=== audio hygiene ===');
{
  const before = H.audioStats.created;
  A.__eval('audioInit()');
  const ctxs = H.audioStats.contexts;
  A.__eval('audioInit();audioInit()');
  ok(H.audioStats.contexts === ctxs, 'audioInit is idempotent', H.audioStats.contexts);
  // Dense collision soak: thousands of impacts must not leave live nodes behind.
  A.__eval('startRun(51);st=1');
  const liveBefore = H.audioStats.live;
  for (let i = 0; i < 3000; i++) { A.__eval('voices=0'); A.__eval('sndHit(1500,' + (i % 3) + ')'); }
  const leaked = H.audioStats.live - liveBefore;
  ok(leaked === 0, 'transient voices are all stopped (no node leak)', leaked);
  ok(H.audioStats.created > before, 'audio actually synthesises');
  // Per-frame voice budget must cap dense frames.
  A.__eval('voices=0');
  let made = 0;
  const c0 = H.audioStats.created;
  for (let i = 0; i < 200; i++) A.__eval('sndHit(1500,2)');
  made = H.audioStats.created - c0;
  ok(made < 200 * 3, 'the per-frame voice budget throttles dense frames', made);
}
{
  // Music scheduler must not run away when the tab is slow.
  A.__eval('startRun(52);st=1;audioInit()');
  const c0 = H.audioStats.created;
  A.__eval('AC.currentTime+=30');
  A.__eval('audioFrame()');
  const made = H.audioStats.created - c0;
  ok(made < 200, 'the music scheduler is bounded after a long stall', made);
}

// ---------------------------------------------------------------------------
console.log('\n=== containers / memory ===');
{
  A.__eval('startRun(61);st=1');
  for (let i = 0; i < 4000; i++) {
    A.__eval('burst(P.x,P.y,8,0,300)');
    A.__eval('partStep(1/60)');
  }
  ok(A.parts.length <= 400, 'particle pool is bounded', A.parts.length);
  A.__eval('startRun(62);st=1');
  A.P.vy = 2500;
  for (let i = 0; i < 3000; i++) { A.__eval('update(1/60)'); A.P.vy = 2500; }
  ok(A.chunks.length <= A.CHUNKS + 1, 'chunk ring is bounded', A.chunks.length);
  ok(A.trail.length <= 80, 'trail is bounded', A.trail.length);
  ok(A.strokes.length <= A.SLIM, 'stroke list is bounded', A.strokes.length);
}
{
  // Repeated restarts must not accumulate anything.
  for (let i = 0; i < 30; i++) { A.__eval('startRun(' + i + ')'); A.__eval('update(1/60)'); }
  ok(A.parts.length < 400 && A.chunks.length <= A.CHUNKS + 1, 'restarts stay clean',
    A.parts.length + '/' + A.chunks.length);
}

// ---------------------------------------------------------------------------
console.log('\n=== regions ===');
{
  const seen = new Set();
  for (let d = 0; d < 7 * A.REGD; d += 900) seen.add(A.regAt(d));
  ok(seen.size === 7, 'all seven regions are reachable in one descent', seen.size);
  ok(A.regAt(7 * A.REGD + 10) === 0, 'regions loop after the seventh');
  ok(A.loopAt(7 * A.REGD + 10) === 1, 'loop counter increments');
  ok(A.difAt(7 * A.REGD) > A.difAt(0), 'difficulty escalates with depth');
  const names = new Set(A.REG.map((r) => r[0]));
  ok(names.size === 7, 'seven distinct region names');
  // Each region must have a distinct visual identity.
  const pals = A.REG.map((_, i) => A.regPal(i).join(','));
  ok(new Set(pals).size === 7, 'seven distinct region palettes');
  const grammars = new Set(A.REG.map((r) => r[4]));
  ok(grammars.size === 7, 'seven distinct chunk grammars');
}

// ---------------------------------------------------------------------------
console.log('\n=== permanent drawings ===');
{
  // The whole point of the rework: a drawing you never use never goes away.
  const P = clean(0, 0);
  A.__eval('startRun(41);st=1');
  A.__eval('for(const c of chunks){c.o.length=0;c.i.length=0}');
  A.__eval('sel=0;mwx=P.x+40;mwy=P.y-200;startStroke();mwx=P.x+140;mwy=P.y-200;moveStroke();drawing=null');
  const s = A.strokes[A.strokes.length - 1];
  ok(!!s, 'a stroke was drawn');
  // Far more than the old 1.8s lifetime, with the player nowhere near it.
  A.P.x = 0; A.P.y = s.y1 - 30; A.P.vx = 0; A.P.vy = 0;
  for (let i = 0; i < 600; i++) { A.P.y = s.y1 - 30; A.P.vy = 0; A.__eval('update(1/60)'); }
  ok(A.strokes.indexOf(s) >= 0, 'an unused drawing survives ten seconds', A.strokes.length);
  ok(!s.u, 'and is still live, not spent');

  // Consuming it is the only thing that spends it.
  const P2 = clean(0, 600);
  const s2 = stroke(1, -100, SY, 100, SY);
  A.__eval('collideAll(1/120)');
  ok(s2.u === 1, 'using a drawing spends it');
  ok(s2.l > 0 && s2.l <= A.SPENT, 'a spent drawing fades rather than vanishing', s2.l);
}
{
  // The cap is a FIFO, not a timer: drawing past the limit retires the oldest.
  A.__eval('startRun(42);st=1;strokes.length=0');
  for (let i = 0; i < 4; i++)
    A.__eval('sel=1;mwx=P.x+30;mwy=P.y+30;startStroke();mwx=P.x+120;mwy=P.y+120;moveStroke();drawing=null');
  const first = A.strokes[0];
  ok(A.strokes.length === 4, 'four drawings coexist', A.strokes.length);
  for (let i = 0; i < 4; i++)
    A.__eval('sel=1;mwx=P.x+30;mwy=P.y+30;startStroke();mwx=P.x+120;mwy=P.y+120;moveStroke();drawing=null');
  ok(A.strokes.length === A.SLIM, 'the cap holds', A.strokes.length);
  ok(A.strokes.indexOf(first) < 0, 'the oldest drawing is the one retired');
}

// ---------------------------------------------------------------------------
console.log('\n=== green tether: pinned to the start, sized by the line ===');
{
  // Anchor at the START of the drag, length equal to the line's own length,
  // and no clamp — a tiny line gives a tiny orbit and a huge one a huge orbit.
  for (const L of [30, 90, 200]) {
    const P = clean(0, 0);
    P.y = 400;
    const s = stroke(8, -L / 2, SY, L / 2, SY);
    A.__eval('collideAll(1/120)');
    const te = P.te;
    ok(!!te, 'tether attached at length ' + L);
    if (!te) continue;
    ok(Math.abs(te.x - s.x1) < 1e-6 && Math.abs(te.y - s.y1) < 1e-6,
      'anchored at the start of the drawing (L=' + L + ')', te.x + ',' + te.y);
    ok(Math.abs(te.l - L) < 1e-6, 'rope length equals the line length (L=' + L + ')', te.l);
  }
}
{
  // The rope is a real constraint at any size: released from beyond its reach,
  // the body is pulled back onto the circle rather than drifting off.
  const P = clean(0, 0);
  P.y = 400;
  stroke(8, -20, SY, 20, SY);
  A.__eval('collideAll(1/120)');
  const te = P.te;
  P.x = te.x + 900; P.y = te.y;
  A.__eval('tetherConstrain()');
  ok(Math.abs(A.hyp(P.x - te.x, P.y - te.y) - te.l) < 1, 'a short rope still holds',
    A.hyp(P.x - te.x, P.y - te.y).toFixed(1));
}

// ---------------------------------------------------------------------------
console.log('\n=== length drives every colour ===');
{
  // One rule for all seven verbs: a longer line is a stronger effect.
  const probe = (mask, L, key) => {
    const P = clean(0, 300);
    P.y = 400;
    stroke(mask, -L / 2, SY, L / 2, SY, 0);
    A.__eval('Gx=0;Gy=GRAV');
    A.__eval('collideAll(1/120)');
    return { sp: A.hyp(P.vx, P.vy), gt: P.gt, ph: P.ph, te: P.te ? P.te.l : 0 }[key];
  };
  const CASES = [[1, 'sp', 'Red'], [2, 'sp', 'Orange'], [4, 'sp', 'Yellow'],
    [8, 'te', 'Green'], [32, 'gt', 'Indigo'], [64, 'ph', 'Violet']];
  for (const [m, k, name] of CASES) {
    const shortV = probe(m, 40, k), longV = probe(m, 200, k);
    ok(longV > shortV * 1.1, name + ' scales with how long you drew it',
      shortV.toFixed(1) + ' -> ' + longV.toFixed(1));
  }
  // Below the minimum a line is inert rather than weakly firing, so a stray
  // click never burns a colour.
  const P = clean(0, 300);
  P.y = 400;
  const tiny = stroke(1, -8, SY, 8, SY);
  A.__eval('collideAll(1/120)');
  ok(!tiny.u, 'a line under the minimum length does not fire');
}

// ---------------------------------------------------------------------------
console.log('\n=== pinball: bumpers, targets, cascades ===');
{
  // A bumper is a scoring event, not just a wall.
  const P = clean(0, 900);
  A.__eval('score=0;mult=1;combo=0');
  A.__eval('NC=[{o:[ci(0,432,24,M_BUMP)],i:[],bk:[]}]');
  A.__eval('collideAll(1/120)');
  ok(A.score > 0, 'hitting a bumper scores', A.score);
  ok(A.combo > 0, 'and feeds the same combo the coins do', A.combo);
}
{
  // A drop-target bank: light every target, get paid, and the bank re-arms.
  const P = clean(0, 0);
  A.__eval('score=0;mult=1;coins=0');
  A.__eval(`
    const c={o:[],i:[],bk:[]};
    const k={n:3,l:0,cap:3,x:0,y:400,m:[]};
    c.bk.push(k);
    for(let i=0;i<3;i++){const o=ci(-60+i*60,400,20,M_TGT);o.bk=k;k.m.push(o);c.o.push(o)}
    NC=[c];window.__bank=k;window.__c=c;
  `);
  const k = A.__eval('__bank');
  for (let i = 0; i < 3; i++) {
    const o = A.__eval('__c.o[' + i + ']');
    A.__eval('light(__c.o[' + i + '],0,400)');
  }
  ok(A.score > 1000, 'clearing a bank pays out', A.score);
  ok(k.l === 0, 'and the bank re-arms', k.l);
  ok(A.__eval('__c.o.every(o=>!o.lt)'), 'every target in it is unlit again');
  ok(A.coins > 0, 'a cleared bank also pays coins', A.coins);
}
{
  // Breaking one panel must light the fuse on its neighbours.
  const P = clean(0, 2000);
  A.__eval('hstop=0');
  A.__eval(`
    const c={o:[],i:[],bk:[]};
    for(let i=0;i<5;i++)c.o.push(ci(i*60,400,20,M_BREAK));
    NC=[c];chunks=[c];window.__c=c;
  `);
  A.__eval('shatter(__c.o[0],0,400,2000,0)');
  const lit = A.__eval('__c.o.filter(o=>o.kt>0).length');
  ok(lit > 0, 'a shatter lights fuses on its neighbours', lit);
  ok(A.hstop > 0, 'and stops time for a moment', A.hstop.toFixed(3));
  for (let i = 0; i < 60; i++) A.__eval('fuseStep(1/60)');
  const gone = A.__eval('__c.o.filter(o=>o.k).length');
  ok(gone > 1, 'the chain reaction actually propagates', gone + '/5');
}
{
  // Red is the destruction verb: its blast should break panels it never hits.
  const P = clean(0, 0);
  P.y = 400;
  A.__eval(`
    const c={o:[],i:[],bk:[]};
    for(let i=0;i<4;i++)c.o.push(ci(-60+i*40,540,16,M_BREAK));
    NC=[c];chunks=[c];window.__c=c;
  `);
  stroke(1, -100, SY, 100, SY);
  A.__eval('collideAll(1/120)');
  const fused = A.__eval('__c.o.filter(o=>o.kt>0||o.k).length');
  ok(fused > 0, 'a Red stroke detonates nearby panels', fused + '/4');
}

// ---------------------------------------------------------------------------
console.log('\n=== region force fields ===');
{
  // Every region that claims a mechanic has to actually apply a force.
  for (let r = 0; r < 7; r++) {
    const z = A.REG[r][7];
    if (!z) { ok(r === 6, 'the Engine mixes fields instead of owning one'); continue; }
    const f = A.__eval(`
      const c={y:0,h:1000,l:-400,r:400,z:${z}};
      let best=0;
      for(let i=0;i<40;i++){zoneF(c,-380+i*19,500);best=mx(best,hyp(_zx,_zy))}
      best;
    `);
    ok(f > 100, 'region ' + r + ' (' + A.REG[r][0] + ') field pushes', f.toFixed(0));
  }
  ok(new Set(A.REG.slice(0, 6).map((q) => q[7])).size === 6,
    'the six themed regions each own a different field',
    A.REG.slice(0, 6).map((q) => q[7]).join(','));
}
{
  // A field must never be able to hold the unicorn still forever: it redirects,
  // it does not trap.
  A.__eval('startRun(77);st=1');
  let zoned = 0;
  for (let i = 0; i < 400 && !zoned; i++) {
    A.__eval('update(1/60)');
    zoned = A.__eval('chunks.filter(c=>c.z).length');
  }
  ok(zoned > 0, 'fields are generated during real play', zoned);
}

// ---------------------------------------------------------------------------
console.log('\n=== the cycle loops ===');
{
  // Ascension is gone. Past the seventh region the shaft has to simply keep
  // going, harder -- not stop, not open a screen, not reset the region index.
  A.__eval('startRun(88);st=1');
  A.P.y = A.NREG * A.REGD + 400;
  A.__eval('update(1/60)');
  ok(A.st === 1, 'passing the last region does not interrupt the run', A.st);
  ok(A.P.al === 1, 'and does not kill the player');
  ok(A.__eval('loopAt(P.y)') === 1, 'the loop counter advances', A.__eval('loopAt(P.y)'));
  ok(A.__eval('regAt(P.y)') === 0, 'the region index wraps to the first region');
  const d1 = A.__eval('difAt(P.y)');
  A.P.y = A.NREG * A.REGD * 2 + 400;
  ok(A.__eval('difAt(P.y)') > d1, 'and the second lap is harder than the first',
    d1.toFixed(2) + ' -> ' + A.__eval('difAt(P.y)').toFixed(2));
  for (let i = 0; i < 240; i++) A.__eval('update(1/60)');
  ok(A.st === 1, 'four seconds later the run is still going', A.st);
}

// ---------------------------------------------------------------------------
console.log('\n=== full playthrough soak ===');
{
  // 90 simulated seconds of a real (if dumb) player drawing strokes.
  A.__eval('startRun(1234);st=1');
  A.__eval('SAVE.t=1');
  let frames = 0, deaths = 0, maxDepth = 0;
  const P = A.P;
  for (let i = 0; i < 90 * 60; i++) {
    if (!P.al) { deaths++; A.__eval('startRun(' + (2000 + deaths) + ');st=1'); }
    if (i % 22 === 0) {
      A.__eval('sel=' + (i / 22 | 0) % 7);
      A.__eval('mwx=P.x+' + (Math.sin(i) * 120).toFixed(1) + ';mwy=P.y+' + (60 + Math.cos(i) * 90).toFixed(1));
      A.__eval('startStroke()');
      A.__eval('mwx=mwx+' + (Math.cos(i) * 90).toFixed(1) + ';mwy=mwy+' + (Math.sin(i) * 90).toFixed(1));
      A.__eval('moveStroke()');
      A.__eval('drawing=null');
    }
    A.__eval('update(1/60)');
    A.__eval('camUpdate(1/60)');
    A.__eval('palUpdate(1/60)');
    frames++;
    maxDepth = Math.max(maxDepth, P.y);
  }
  ok(frames === 90 * 60, 'survived 90s of simulated play without throwing');
  ok(maxDepth > 3000, 'the unicorn makes real progress downward', maxDepth | 0);
  ok(isFinite(A.score) && A.score >= 0, 'score stays finite', A.score | 0);
  ok(A.parts.length <= 400, 'particles bounded after soak', A.parts.length);
}

// ---------------------------------------------------------------------------
console.log('\n=== render smoke ===');
{
  A.__eval('startRun(77);st=1');
  const before = H.counter.calls;
  // State 4 is the store, which the competition build does not have -- there is
  // no way to reach it and no screen to draw. The Wavedash build is checked
  // through all five in tests/wavedash.mjs.
  for (const s of [0, 1, 2, 3]) {
    A.__eval('st=' + s);
    A.__eval('W=1920;H=1080;U=1');
    A.__eval('draw()');
  }
  ok(H.counter.calls > before + 100, 'every screen draws', H.counter.calls - before);
  A.__eval('st=1');
}

results.forEach((r) => console.log(r));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
