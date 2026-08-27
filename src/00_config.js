// ---------------------------------------------------------------------------
// PRISMFALL — tuning constants.
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
const SMAX = 150;      // max stroke length
const SREACH = 305;    // max distance from the unicorn a stroke may start
const SLIFE = 1.8;     // stroke lifetime in seconds
const SLIM = 3;        // simultaneous live strokes
const ST = 5;          // stroke half-thickness for collision

// -- pigment ----------------------------------------------------------------
const PMAX = 100;                                  // per-reservoir capacity
const PC = [.088, .055, .062, .07, .05, .076, .095]; // cost per world unit drawn

// -- stall ------------------------------------------------------------------
const STALLV = 118;    // simulation speed below which the stall clock runs
const STALLT = 2.4;    // seconds of stall before the run ends
const STALLW = 0.9;    // stall seconds before the warning kicks in

// -- colours ----------------------------------------------------------------
// Red Orange Yellow Green Blue Indigo Violet — order never changes.
const HUE = [0, 32, 54, 140, 200, 258, 296];
const CBIT = [1, 2, 4, 8, 16, 32, 64];
const ALL7 = 127;

// -- material bits ----------------------------------------------------------
const M_BUMP = 1;    // high restitution
const M_DAMP = 2;    // void / dampener, eats speed — the main stall threat
const M_BREAK = 4;   // shatters above an impact-energy threshold
const M_PHASE = 8;   // solid unless the unicorn is phased (Violet)
const M_ANCH = 16;   // drawn as a Green tether anchor
const M_RAIL = 32;   // drawn as a Blue guide rail

// -- world ------------------------------------------------------------------
const CHUNKS = 26;       // retained chunk ring size
const REGD = 15000;      // depth of one region
const BRK_E = 1180;      // impact speed needed to break a panel
const BRK_R = 400;       // ... while Red-charged

// -- items ------------------------------------------------------------------
const I_COIN = 0, I_CROWN = 1, I_PIG = 2, I_WELL = 3, I_BOOST = 4;

// -- boosters: [allCostMul, redMul, duration] -------------------------------
const BOOST = [
  [1, 1.45, 10],    // 0 Red Overdrive - bigger kick, cheaper destruction
  [.4, 1, 12],      // 1 White Efficiency - every colour costs less
];

// -- localStorage namespace -------------------------------------------------
const LS = 'pf26_save';
