# PRISMFALL

A procedural vertical pinball adventure for **js13kGames 2026** (theme: *Unicorns
and Rainbows*). You never steer the unicorn. You draw the physics.

A unicorn falls through seven procedurally generated worlds. You draw short,
short-lived coloured strokes near it, and each of the seven rainbow colours
changes a different fundamental of motion. Keeping useful motion alive *is*
survival: there is no health bar, only a stall clock.

```
R  Red      impulse    injects energy along a sensible outgoing direction
O  Orange   vector     re-aims velocity along the stroke, keeping speed
Y  Yellow   spring     amplified rebound, scaled by the impact
G  Green    tether     swing, orbit, then release into a launch
B  Blue     rail       lock onto the stroke and grind along it
I  Indigo   gravity    rewrite the gravity vector for a few seconds
V  Violet   space      phase dash, or a portal between two Violet strokes
```

Strokes that cross **fuse into a Prism Node** and share their effect bits, so
mixing is composition rather than a table of special cases: Orange+Yellow is a
spring that aims, Red+Indigo kicks you and flips gravity at once, Violet+Blue
phases a whole rail.

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
| `Esc` / `P` | Pause |
| `R` | Restart |
| `M` | Mute |

## Worlds

Seven regions, each with its own chunk grammar, material bias, palette,
background motif and musical mode. After the seventh the cycle loops into
Overdrive with escalating difficulty.

| Region | Grammar | Affinity |
|---|---|---|
| Cloudbreak | peg fields, wide gaps, gentle funnels | Orange + Yellow |
| Sunforge | rotors, breakable panels, moving gates | Red + Orange |
| Verdant Coil | circular chambers, tether anchors, spring pods | Green + Yellow |
| Crystal Current | long guide rails, narrow shafts, S-curves | Blue + Orange |
| Prism Mine | breakable shortcuts, phase barriers, hidden rooms | Red + Violet |
| Inversion Temple | gravity chambers, phase walls, looping routes | Indigo + Violet |
| Rainbow Engine | compound rooms built from every prior geometry | all |

## Build

| Command | What it does |
|---|---|
| `npm run build` | Fast size build: Terser → Roadroller → Zopfli/ECT zip |
| `npm run pack` | Deep pack: full Roadroller parameter search, strongest zip |
| `npm run size` | Prints `<zip bytes> <bytes remaining>` and nothing else |
| `npm run build -- --dev` | Unminified debug build with `DEBUG=1` in `build/dev.html` |
| `npm run serve` | Static server over `dist/` |

Both paths emit `dist/index.html` and `dist/prismfall.zip`, and append a row to
[reports/size-history.md](reports/size-history.md). The build fails with a
non-zero exit code if the archive exceeds 13,312 bytes.

The debug build adds a stats line, `g` to jump a region and `f` to refill
pigment. `DEBUG` is a compile-time constant, so Terser strips all of it from the
production bundle.

## Tests

```bash
npm test              # build, then every suite including browsers
npm run test:sim      # 113 gameplay/feature assertions, headless
npm run test:gen      # generator invariants across many seeds
npm run test:audio    # cue coverage, synthesis identity, node hygiene
npm run test:browser  # packed artifact in Chromium and Firefox
npm run test:shots    # screenshots into reports/shots
npm run test:gallery  # one screenshot per region (needs the --dev build)
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
  purchase-and-equip round trip.

## Layout

```
src/        readable source, concatenated in filename order
tools/      build pipeline, zip writer, packer search, static server
tests/      harness + suites
reports/    size history, screenshots
dist/       index.html + prismfall.zip (the submission)
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
