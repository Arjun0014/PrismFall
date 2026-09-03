// ---------------------------------------------------------------------------
// PRISMFALL - tuning constants.
//
// World units: 1 unit ~= 1 screen pixel at 1280x720 with zoom 1.
// The unicorn is a circle of radius R; everything else is built from
// circles, segments and arcs so the collision kernel stays tiny.
// ---------------------------------------------------------------------------

const PI = Math.PI;
const TAU = PI * 2;
const M = Math;
const abs = M.abs, mn = M.min, mx = M.max, sin = M.sin, cos = M.cos,
      at2 = M.atan2, hyp = M.hypot, flr = M.floor, rnd = M.random;

// -- body / motion ----------------------------------------------------------
const R = 17;          // unicorn collision radius
const GRAV = 1250;     // default gravity magnitude (units/s^2)
const VMAX = 2900;     // hard velocity clamp, keeps the sim sane
const VFAST = 1400;    // "fast" reference speed for camera/audio/score curves

// -- framing ----------------------------------------------------------------
const VH = 620;        // logical view height in world units
const COL = 400;       // standard play-column half width (near-4:3 zone)
const WMAX = 545;      // absolute wall half width (side rooms)

// -- strokes ----------------------------------------------------------------
// Strokes are PERMANENT. A drawing stays on the field until something uses it,
// which is what makes the seven colours a toolkit you can lay out in advance
// and combine, rather than a twitch input that evaporates before you can mix.
// Only a *spent* stroke fades, and only so the consumption reads visually.
const SMAX = 210;      // max stroke length
const SMIN = 22;       // below this a stroke is too short to fire
const SREACH = 305;    // max distance from the unicorn a stroke may start
const SPENT = .22;     // fade-out of a consumed stroke, in seconds
const SLIM = 5;        // simultaneous live strokes (FIFO once exceeded)
const ST = 5;          // stroke half-thickness for collision
// Every colour scales with how long you drew it: pow(L / SNOM, ...) is the one
// rule behind all seven verbs, and pigment already costs per unit length, so
// "bigger effect costs more" needs no extra economy.
const SNOM = 105;      // the length at which a stroke has its nominal strength

// -- pigment ----------------------------------------------------------------
const PMAX = 100;                                  // per-reservoir capacity
const PC = [.088, .055, .062, .07, .05, .076, .095]; // cost per world unit drawn

// -- stall ------------------------------------------------------------------
const STALLV = 118;    // simulation speed below which the stall clock runs
const STALLT = 2.4;    // seconds of stall before the run ends
const STALLW = 0.9;    // stall seconds before the warning kicks in

// -- colours ----------------------------------------------------------------
// Red Orange Yellow Green Blue Indigo Violet - order never changes.
const HUE = [0, 32, 54, 140, 200, 248, 312];
const CBIT = [1, 2, 4, 8, 16, 32, 64];
const ALL7 = 127;

// -- material bits ----------------------------------------------------------
const M_BUMP = 1;    // high restitution
const M_DAMP = 2;    // void / dampener, eats speed - the main stall threat
const M_BREAK = 4;   // shatters above an impact-energy threshold
const M_PHASE = 8;   // solid unless the unicorn is phased (Violet)
const M_ANCH = 16;   // drawn as a Green tether anchor
const M_RAIL = 32;   // drawn as a Blue guide rail
const M_TGT = 64;    // pinball score target: banks light up, a full bank pays out

// -- world ------------------------------------------------------------------
const CHUNKS = 26;       // retained chunk ring size
const REGD = 15000;      // depth of one region
const NREG = 7;          // regions in one descent
const BRK_E = 900;       // impact speed needed to break a panel
const BRK_R = 300;       // ... while Red-charged
const BRK_CH = 150;      // radius a shatter propagates to its neighbours

// -- zones ------------------------------------------------------------------
// A chunk may carry one force field. This is the cheapest way to give a region
// a mechanic of its own rather than only a palette: one number per chunk and
// four lines in the physics step.
// 0 none  1 updraft  2 gravity well  3 crosswind  4 inversion  5 coil  6 current
// Six themed regions, six fields, no two alike -- if two regions shared one
// they would play the same however differently they were painted.
const Z_UP = 1, Z_WELL = 2, Z_WIND = 3, Z_INV = 4, Z_FLOW = 5, Z_RUSH = 6;

// -- items ------------------------------------------------------------------
const I_COIN = 0, I_CROWN = 1, I_PIG = 2, I_WELL = 3, I_BOOST = 4;

// -- boosters ---------------------------------------------------------------
// [colour amplified (7 = every colour's pigment cost), strength, seconds].
// Entirely parameter driven: a booster is a multiplier looked up by the verb
// that cares about it, so adding one is a table row, never a new subsystem.
const BOOST = [
  [0, 1.5, 10],     // Red Overdrive  - bigger kick, cheaper destruction
  [2, 1.5, 11],     // Yellow Supercoil - amplified rebound
  [3, 1.7, 12],     // Green Reach    - longer, stronger tether
  [4, 2, 12],       // Blue Superrail - the rail holds far longer
  [5, 1.9, 11],     // Indigo Flux    - gravity stays bent
  [6, 1.9, 11],     // Violet Echo    - longer phase, longer warp
  [7, .4, 12],      // White Efficiency - every colour costs less
];
const BNAME = 'OVERDRIVE SUPERCOIL REACH SUPERRAIL FLUX ECHO EFFICIENCY'.split(' ');

// -- localStorage namespace -------------------------------------------------
const LS = 'pf26';
