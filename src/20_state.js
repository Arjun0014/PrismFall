// ---------------------------------------------------------------------------
// Global mutable state. Short property names are deliberate: they survive
// minification (Terser will not rename properties) and compress well.
// ---------------------------------------------------------------------------

const CV = document.getElementById('a');
const X = CV.getContext('2d');
let W = 0, H = 0, SC = 1;      // canvas pixel size, world->screen scale

// -- game / scene state -----------------------------------------------------
// 0 title  1 playing  2 paused  3 results  4 store  5 how-to
let st = 0;
let T = 0;        // wall-clock seconds since load (drives animation)
let slow = 0;     // 0..1 focus-vault time dilation blend
let shake = 0;    // camera shake energy
let flash = 0;    // full-screen flash energy
let flashH = 0;   // flash hue

// -- the unicorn ------------------------------------------------------------
const P = {
  x: 0, y: 0, vx: 0, vy: 0,
  a: 0,          // render heading
  sp: 0,         // cached speed
  ra: null,      // attached Blue rail (stroke)
  rt: 0,         // rail param along the stroke
  rs: 1,         // rail side (+1/-1)
  te: null,      // Green tether {x,y,l,t}
  ph: 0,         // Violet phase timer (ignores solids)
  rp: 0,         // Red power timer (cheap destruction)
  st: 0,         // stall timer
  gt: 0,         // gravity-override timer
  al: 1,         // alive
};

// gravity vector (mutable — Indigo and regions both write here)
let Gx = 0, Gy = GRAV;

// -- camera -----------------------------------------------------------------
const C = { x: 0, y: 0, z: 1, tz: 1 };

// -- run data ---------------------------------------------------------------
let pig = [];              // seven pigment reservoirs
let sel = 1;               // selected colour index
let chain = 0;             // bitmask of colours successfully used in the chain
let chainN = 0;            // popcount of chain
let fullSpec = 0;          // Full Spectrum glow timer
let coins = 0;             // coins earned this run
let score = 0;
let mult = 1;
let depth = 0;             // max depth reached
let reg = 0;               // current region index
let regShow = 0;           // region banner timer
let boostT = [];           // per-booster remaining seconds
let combo = 0, comboT = 0; // coin chain

// -- containers -------------------------------------------------------------
let chunks = [];   // active world chunks
let strokes = [];  // live player strokes
let parts = [];    // particles
let trail = [];    // unicorn trail samples
let pops = [];     // floating score/text pops
let nodes = [];    // prism-node sparkles from stroke fusion

// -- persistent -------------------------------------------------------------
const SAVE = { c: 0, b: 0, d: 0, o: 0, e: [0, 0, 0, 0], m: 0, t: 0 };
// c total coins, b best score, d best depth, o owned cosmetics bitmask,
// e equipped [body, horn, trail, impact], m muted, t tutorial seen

// -- input ------------------------------------------------------------------
let pmx = 0, pmy = 0;           // pointer in screen px
let mwx = 0, mwy = 0;         // pointer in world units
let drawing = null;           // stroke being drawn
let wheel = null;             // radial Prism Wheel anchor [x, y] in screen px
let wsel = 0;                 // wedge the pointer is currently over
let hint = 0;                 // onboarding step
let hintT = 0;
