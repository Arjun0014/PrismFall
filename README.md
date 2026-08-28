# PRISMFALL

A procedural vertical pinball adventure for **js13kGames 2026** (theme: *Unicorns
and Rainbows*). You never steer the unicorn. You draw the physics.

A unicorn falls through seven procedurally generated worlds. You draw coloured
strokes near it, and each of the seven rainbow colours changes a different
fundamental of motion. Keeping useful motion alive *is* survival: there is no
health bar, only a stall clock.

```
R  Red      impulse    injects energy along a sensible outgoing direction,
                       and detonates every breakable panel within its blast
O  Orange   vector     re-aims velocity toward the far end of the stroke
Y  Yellow   spring     amplified rebound, scaled by the impact
G  Green    tether     pins a rope at the START of your drag, as long as the
                       line you drew — swing, orbit, release into a launch
B  Blue     rail       lock onto the stroke and grind along it
I  Indigo   gravity    rewrite the gravity vector for a few seconds
V  Violet   space      phase dash, or a portal between two Violet strokes
```

Two rules make the seven a toolkit rather than seven buttons:

**Drawings are permanent.** A stroke stays on the field until something uses it.
You can lay out a Blue rail, a Yellow spring at the end of it and a Green pin
above them, then fall through the arrangement you built. Only a *spent* stroke
fades, and that fade is the only thing that tells you it was consumed. Five may
live at once (seven with the Wide Palette boon); drawing past the cap retires
the oldest.

**Length is power.** Every colour reads the same curve: a longer line is a
stronger effect. A long Red kicks harder and blasts wider, a long Indigo holds
gravity longer, a long Green gives a wider orbit. Pigment already bills per unit
drawn, so the cost side needs no separate economy — you are always spending
exactly what the effect is worth.

Strokes that cross **fuse into a Prism Node** and share their effect bits, so
mixing is composition rather than a table of special cases: Orange+Yellow is a
spring that aims, Red+Indigo kicks you and flips gravity at once, Violet+Blue
phases a whole rail. Because drawings are permanent you can build the crossing
first and fall into it afterwards, which is what turns mixing from a trick into
a plan. The title screen says so on a line painted through all seven hues.

Each colour draws from its own finite pigment reservoir. Red cannot be spammed
forever; you refill from coloured shards, partial spectrum-diversity refunds and
rare Prism Wells.

## Play

```bash
npm install
npm run build
npm run serve
```

Then open <http://localhost:8013>. `dist/prismfall.zip` is the competition
archive — unzip it anywhere and open `index.html`; it needs no server and works
offline.

### Controls

| Input | Action |
|---|---|
| Left-drag | Draw a stroke in the current colour |
| `1`–`7` | Pick a colour instantly |
| Mouse wheel | Cycle colours |
| Right-hold, flick, release | Radial Prism Wheel |
| Click the bottom bar | Pick a colour |
| `X` | Let go of a rail or tether |
| `1` / `2` at the Ascension | Take that boon |
| `Esc` / `P` | Pause |
| `R` | Restart |
| `M` | Mute |

## Worlds

A region is a **mechanic** first and a palette second. Each of the six themed
regions owns a force field no other region has, and its archetypes, material
bias, reward density, palette, background motif and musical mode are all chosen
to make that field matter. No two regions play the same, however differently
they are painted.

| Region | Field | Grammar | Affinity |
|---|---|---|---|
| Cloudbreak | updraft columns hold you up | peg fields, bumpers, gentle funnels | Orange + Yellow |
| Sunforge | crosswind | crusher lanes, target banks, rotors — three quarters breakable | Red + Orange |
| Verdant Coil | a coil that rotates you about the room | chambers, tether anchors, spring pods | Green + Yellow |
| Crystal Current | a meandering current that carries you down it | long guide rails, narrow shafts | Blue + Orange |
| Prism Mine | gravity wells drag you into its pockets | phase barriers, hidden rooms, the richest rewards | Red + Violet |
| Inversion Temple | the shaft is upside down | gravity chambers, phase walls, looping routes | Indigo + Violet |
| Rainbow Engine | every field, mixed | compound rooms built from every prior geometry | all |

### Pinball, not scenery

Geometry is there to be hit. Bumpers score, feed the same chain the coins do and
kick a shockwave; a hard one stops time for a few frames. **Drop-target banks**
light one panel at a time and pay the whole bank out when the last one lights,
then re-arm. **Breakable panels chain**: shattering one lights the fuse on its
neighbours, which light theirs, so one good hit unzips a structure instead of
punching a hole in it. Everything you touch flashes and recoils, and everything
that breaks throws real spinning debris.

The visual language is fixed across every palette: **bright and filled** is
interactive, **dark with a bright rim** is inert, gold pips above a bank are how
far through it you are. Your own drawings carry a dark casing and a white core
so they can never be mistaken for scenery, whatever hue the region is wearing.

### The Ascension

Reaching the bottom of the Rainbow Engine is not the end. The shaft loops,
harder — and before it does you take one of two **boons**, permanent for the
rest of the run: bigger reservoirs, cheaper strokes, less drag at speed, halved
break thresholds, a permanent coin magnet, a longer stall clock, bumpers that
pay double, two more stroke slots, strokes that fire twice, or triple-value
coins. Ten boons, two offered, one taken per descent — the second descent is a
different run, not a lap.

## Build

There are **two products from one source tree**, and they share every feature
and every tuning constant:

| Command | What it does |
|---|---|
| `npm run build` | Competition build: Terser → Roadroller → Zopfli/ECT zip |
| `npm run pack` | Deep pack: full Roadroller parameter search, strongest zip |
| `npm run size` | Prints `<zip bytes> <bytes remaining>` and nothing else |
| `npm run build:wavedash` | Wavedash platform build into `dist-wavedash/` |
| `npm run build -- --dev` | Unminified debug build with `DEBUG=1` in `build/dev.html` |
| `npm run serve` | Static server over `dist/` |

The competition build emits `dist/index.html` + `dist/prismfall.zip` and appends
a row to [reports/size-history.md](reports/size-history.md). It fails with a
non-zero exit code if the archive exceeds 13,312 bytes.

### The Wavedash build

`src/95_wavedash.js` holds all platform glue — SDK init, player identity and
leaderboards — and is compiled into the Wavedash build **only**. Every call site
in the shared code is behind `if (WD)`, which is a compile-time constant, so
Terser removes those too: the competition archive carries not one byte of it.

```bash
npm run build:wavedash     # -> dist-wavedash/index.html + wavedash.toml
npx wavedash dev           # local sandbox with test leaderboards
npx wavedash push          # upload the build
```

`wavedash.toml` is written on first build with `upload_dir = "./dist-wavedash"`;
fill in `game_id` from the developer portal (or run `wavedash init`).

What the platform build adds:

- `Wavedash.init()`, `readyForEvents()` and `loadComplete()` on boot. The game
  is procedural, so load progress goes straight to 1 — it is interactive on the
  first frame.
- **Player identity** on the title screen: username, avatar (falling back to an
  initial disc), and your global rank.
- **Two leaderboards**, `prismfall-score` and `prismfall-depth`, resolved once at
  startup and cached by id. A finished run uploads to both with `keepBest`, and
  attaches metadata that lets a board entry be read back as a story: which
  region ended it, how deep, how many descents, which boons you drafted.
- A live **global top 8** panel beside the title, with your own row picked out.
- Presence updates.

None of it may break the game. The SDK is injected by the platform at runtime,
so `dist-wavedash/index.html` opened directly — no sandbox, no SDK — has to play
perfectly; every entry point checks for the global first and every promise has a
catch that shrugs. `npm run test:wavedash` asserts exactly that, twice: once
against a stubbed SDK and once with no SDK at all.

The debug build adds a stats line, `g` to jump a region, `f` to refill pigment
and a few `window.*` probes the screenshot and feel harnesses reach through.
`DEBUG` is a compile-time constant, so Terser strips all of it from both
production bundles.

## Tests

```bash
npm test               # build, then every suite including browsers
npm run test:sim       # 181 gameplay/feature assertions, headless
npm run test:gen       # generator invariants across many seeds
npm run test:audio     # cue coverage, synthesis identity, node hygiene
npm run test:browser   # packed artifact in Chromium and Firefox
npm run test:wavedash  # platform build, with a stubbed SDK and with none
npm run test:feel      # live probes: tether, cascades, banks, permanent strokes
npm run test:gallery   # one screenshot per region (needs the --dev build)
```

`tests/harness.mjs` boots the **real** game bundle inside Node behind stubbed
DOM, Canvas2D and Web Audio, then hands the suites its internals. Nothing is
re-implemented for testing, so a passing assertion is a statement about the
shipped code.

What the suites actually check:

- **sim** — each colour's physics signature, mixing, the pigment economy, stall
  and recovery, tunnelling at max speed, constraint cleanup, persistence
  including corrupt storage, boosters, the Prism Wheel, and that cosmetics leave
  the simulation bit-identical.
- **gen** — no chunk seals the column at any phase of its machinery, nothing
  spawns inside a wall, every region supplies at least five pigment colours, and
  a body dropped into each seed keeps making progress.
- **audio** — every cue fires during real play, no two cues share a synthesis
  signature, the arrangement thickens with intensity, and restarts leak nothing.
- **browser** — the packed zip only, in Chromium and Firefox: no console errors,
  no external requests, only `pf26_` storage keys, a resize matrix, and a live
  purchase-and-equip round trip. An engine that cannot *launch* on the host is
  reported as a loud SKIP rather than a failure; one that launches and then
  fails still fails.
- **wavedash** — the platform build boots, plays and submits against a stubbed
  SDK, and boots and plays with no SDK present at all.

Beyond the suites, the new systems have their own assertions: that an unused
drawing survives ten seconds and that the cap retires the oldest rather than the
youngest; that the tether pins at the drag's start and matches the line's length
at 30, 90 and 200 units; that all six of Red, Orange, Yellow, Green, Indigo and
Violet scale with how long you drew them while a line under the minimum stays
inert; that a bank pays out and re-arms; that a shatter propagates; that each of
the six themed regions owns a different field; and that every one of the ten
boons measurably changes the thing it names.

## Layout

```
src/            readable source, concatenated in filename order
src/95_*.js     platform glue — Wavedash build only, never in the zip
tools/          build pipeline, zip writer, packer search, static server
tests/          harness + suites
reports/        size history, screenshots
dist/           index.html + prismfall.zip (the submission)
dist-wavedash/  index.html for the platform build
```

`src/` is plain top-level declarations with no module system — the build simply
concatenates the files, which is what lets both Terser and the test harness
treat the whole game as one scope.

## Rules compliance

- `index.html` sits at the archive root; the archive contains nothing else.
- No external runtime resources; the page is fully self-contained and offline.
- One namespaced storage key, `pf26_save`. `localStorage.clear()` is never called.
- Storage failures are caught: the game plays fine with storage unavailable.
- Cosmetics are render-only and never touch collision, pigment or scoring.
