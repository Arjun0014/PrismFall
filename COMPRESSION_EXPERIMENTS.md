# PRISMFALL — compression experiment log

Every row is a **real competition ZIP**, built end to end (Terser → Roadroller →
Zopfli/ECT) and measured in bytes. Source size is not the fitness function; the
archive is. Failures are recorded so they are not repeated.

Hard limit **13,312 B**. Rule: no feature, sound, effect, world, system,
cosmetic or piece of feel is removed to hit it.

## Standing measurements

These govern which experiments are worth running at all.

| Fact | Value | How it was measured |
|---|---|---|
| Repeated tokens | **~8.5 minified chars per archive byte** | shortening repeated wave/filter strings |
| Unique content | **~1.6–2.1 chars per archive byte** | float-precision and string-squash probes |
| Numeric literals | 3,501 uses of only **326 distinct values** | histogram of the minified bundle |
| Roadroller output | 22,012 chars → 16,692 B | that 24% is its printable-charset overhead, which deflate recovers in full |
| ZIP methods allowed | Deflate and Store only | js13k servers cannot extract anything else |

**The consequence, and the reason most "make it smaller" ideas fail here:** a
context-mixing coder already predicts repetition almost for free, so removing
duplication saves nothing, while any *new* dense data it has never seen costs
full price. Deduplication and packing are not automatically wins — several
measured as losses.

## Experiments

| # | Experiment | Before | After | Delta | Tests | Decision |
|---|---|---:|---:|---:|---|---|
| 0 | *(baseline at start of this phase)* | — | 16,812 | — | PASS | — |
| 1 | **Audio patch VM** — 19 runtime-invariant cues as a 260-char packed string + one interpreter | 16,812 | 16,829 | **+17** | PASS | **REVERT** |
| 2 | **HTML shell trim** — drop `<title>` and `<meta charset>`, make the source ASCII-only | 16,812 | 16,748 | **−64** | PASS | **KEEP** |
| 3 | **Stronger deflate** — Zopfli 200 → 4,000 → 15,000 → 50,000 iterations, ECT -9 on each | 16,748 | 16,748 | **0** | PASS | n/a — saturated |
| 4 | **Top-level function reordering** — hill-climb over declaration order, deflate-scored | 16,748 | 16,711* | −37* | **FAIL** | **ABANDON** |
| 5 | **Constant lattice 0.005** — snap decimals to a shared grid | 16,758 | 16,750 | −8 | PASS | **REJECT** — not worth the churn |
| 6 | **Constant lattice 0.02 / 0.05** | 16,758 | 16,712 / 16,627 | −46 / −131 | PASS | **REJECT** — destroys the pigment economy |
| 7 | **Anti-inlining Terser block** — `reduce_funcs`, `sequences`, `inline`, and the whole `unsafe` family switched OFF; IIFE dropped for the packed build | 16,748 | 16,596 | **−152** | PASS | **KEEP** |
| 8 | **Deep packer re-search** on the new payload | 16,596 | 16,551 | **−45** | PASS | **KEEP** |
| 9 | **Model count re-check** — 14/16/18/24, each given its own `optimize(2)` | 16,551 | 16,634 best | +83 | PASS | **REJECT** — 20 stays optimal |

\* measured by proxy; the resulting bundle hangs, see notes.

## Previously settled (do not re-run)

| Avenue | Result |
|---|---|
| Roadroller model count 12→20 (the axis its optimizer never searches) | −78 B, **kept** |
| `allowFreeVars` | −21 B, **kept** |
| Decoder memory 700→150 MB | +52 B, **kept anyway** — 700 MB cannot be allocated on a phone and risks Firefox |
| `dynamicModels` 0/1/2/3, precision, learning rate, context bits, abbreviations | at optimum, 0 B |
| Terser: 15 variants incl. dropping the IIFE, property mangling, passes 8/12 | best 32 B |
| Property-name aliasing (`.fillStyle` → `[$p[i]]`) | **+68 to +107 B — worse** |
| Source-file reordering (5 permutations) | current order already optimal; others up to +177 B |
| Non-deflate ZIP containers | impossible, rules |
| Splitting Roadroller's two output lines into separate streams | +117 B |
| Constant lattice snapping (0.05) | −124 B available, not yet applied (tuning shift) |


## Experiment notes

### 1 — Audio patch VM (reverted)

All 19 cues whose sound does not depend on a runtime value were encoded as one
packed string (one character per quantised parameter, 260 chars total) driven by
a single interpreter. Frequencies quantised to 13.5% steps; pitched material
stayed exact because arpeggios encode MIDI roots and semitone offsets. The
codec used charCodes 40..91 specifically so the literal never needed an escape.

It came out **17 bytes larger**, and the reason is the standing measurement at
the top of this file. The JS it replaced was *cheap*: `O('sine',90,240,.22,.26)`
is repeated syntax the model predicts almost for free, and its numbers were
drawn from the 326 values the game already reuses everywhere. What replaced it
was 260 characters of dense, never-seen-before string — the most expensive kind
of content there is — plus an interpreter.

**The general lesson, which applies to every "pack it into data" idea:** packing
only wins when the data being packed is *unique*. Here it was already shared, so
packing converted cheap repetition into expensive novelty.

Two attempts were made. The first used an escape-skipping codec over 0..89 and
measured +44 B. Tightening the value range to 0..51 so decoding collapsed to
`charCodeAt(i) - 40` recovered 27 B of that, which was still not enough.

### 2 — HTML shell trim (kept)

The shell sits outside the Roadroller payload, so it is deflated with the packed
script rather than modelled by it, and every character costs close to full price.

| Trim | Bytes | Taken |
|---|---:|---|
| drop `<title>PRISMFALL</title>` | −22 | yes — the tab shows the filename |
| drop `<meta charset=utf-8>` | −24 | yes — the source is now ASCII-only, so there is nothing to decode |
| source `·` and `—` → ASCII `-` | −18 | yes — they were two bytes each in UTF-8 |
| drop `<!doctype html>` | −14 | **no** — that is quirks mode, and the canvas is sized from CSS percentages |
| omit `</canvas>` | −15 | **no** — see below |
| omit `</script>` | −15 | **no** — see below |

**Two of those trims silently kill the game while still loading cleanly**, which
is worth recording because both look free and neither reports an error:

- Omitting `</canvas>` puts the `<script>` inside the canvas as *fallback
  content*, which a browser that supports canvas never executes.
- Omitting `</script>` leaves a script terminated by end-of-file rather than a
  closing tag, which is also not executed.

In both cases the page loads, the console stays empty, and the canvas sits at
its default 300×150 doing nothing. They were caught by the viewport assertions
in the browser suite, not by any error.


### 3 — Stronger deflate (saturated)

Zopfli at 200, 4,000, 15,000 and 50,000 iterations, each followed by ECT -9,
all produce **exactly 16,748 B**. The 50,000-iteration run takes 153 seconds to
arrive at the same number as the 0.9-second run. ECT 0.8.3 has no level above
-9, and `--mt-deflate` only adds threads. No `advzip`, `7z` or system `zopfli`
is present, and none would beat this. **The deflate layer is at its floor.**

### 4 — Function reordering (abandoned)

Reordering top-level function declarations is one of the very few provably safe
source mutations — declarations hoist, so moving one cannot change when it
exists or what it closes over — and file-order was already worth up to 177 B, so
the finer-grained version looked promising.

A hill-climb over 46,858 candidate moves, scored with raw deflate as a fast
proxy, found **−37 B** (13 of it from simply grouping all functions ahead of the
non-function code, 24 from the search).

**It was abandoned because the result does not run.** The splitter that carves
the minified bundle into declarations never handles regex literals, so it
mis-tracks brace depth and emits a program that parses but hangs the page on
load. Doing this safely needs a real JS parser rather than a scanner, and the
78 minified functions have no clean mapping back to the 139 in source (Terser
inlines 55 of them), so the win could not be expressed as a source change
either — it would have to live as a cached permutation keyed to a hash of the
minified output. Thirty-seven bytes does not justify that machinery.

### 5/6 — Constant lattice (rejected)

Snapping every decimal onto a shared grid reduces the number of *distinct*
values, which is the one thing that has reliably paid here. It works, and the
coarser the grid the more it pays — but what it is spending is design.

| Grid | Zip | Delta | Pigment costs left distinct |
|---|---:|---:|---|
| 0.005 | 16,750 | −8 | 7 of 7 |
| 0.01 | 16,742 | −16 | 6 of 7 |
| 0.02 | 16,712 | −46 | 3 of 7 |
| 0.05 | 16,627 | −131 | 2 of 7 |

`PC` is the canary: seven deliberately different per-colour pigment costs, with
Red the most expensive and Blue the cheapest. At 0.05 they collapse to two
values and the economy stops meaning anything. Only the 0.005 grid preserves all
seven, and −8 B does not justify rewriting every numeric literal in the source
past a regex that cannot tell code from strings and comments.

## Ruled out by the same mechanism as experiment 1

These were on the list. All are the same shape as the audio VM — replace cheap
repetitive JS with an interpreter plus dense packed data — and the measurement
that sank it applies unchanged, so none were built:

| Idea | Why it cannot win here |
|---|---|
| One shared packed-data decoder across systems | The data it would pack is already shared: 3,501 numeric uses draw on only 326 distinct values. Packing converts cheap repetition into expensive novelty; sharing one decoder reduces the interpreter cost but not the data cost, which is the larger half. |
| World/archetype mini-DSL | Same trade, plus the archetypes are genuinely different logic rather than the same logic with different constants. |
| Boons as a generic modifier table | Already data: each boon is one bit read by exactly one system. There is no duplicated logic left to collapse. |
| Cosmetics from parameters | Already parameters — `SAVE.e` is four small indices, and the renderer branches on them. |
| One VFX emitter | Already one emitter: `pt` / `burst` / `shock` are shared by every effect in the game. |
| WASM for the physics core | The module, its embedding and its JS glue start around a kilobyte; the physics core is a few hundred characters of JS. |
| RegPack / JS-crush after the rewrites | Roadroller beats Terser+deflate alone by ~3.3 KB on this payload, and the standard advice is not to LZ-pack before deflate. |


### 7 — The anti-inlining block (kept, and the most useful finding so far)

Every option in this block is set to the value that makes Terser's output
**longer**, and every one of them makes the archive **smaller**:

```
reduce_funcs: false     keep single-use functions as functions
sequences: false        do not comma-fold statements together
inline: false           do not inline function bodies at all
unsafe*: false          the unsafe rewrites all shorten and specialise
+ no IIFE               so Terser can compress and mangle at top level
```

Together they take the minified bundle from **44,932 to 45,877 characters** —
945 characters *larger* — and the archive from **16,748 to 16,596 B**.

That is not a paradox, it is the standing measurement stated as a build setting.
Inlining a function body replaces a call — repeated syntax the model predicts
almost for free — with unique text it must pay full price for. Comma-folding
statements does the same to punctuation. **Minified length is not the fitness
function and optimising for it actively hurts.**

This is the same effect that sank the audio VM and property aliasing, finally
pointing the right way: instead of hand-writing more repetition, stop the
minifier destroying the repetition that is already there.

The IIFE is dropped for the competition build only. Roadroller evals the
payload, so declarations land in that eval's scope and nothing else on the page
can reach them. The Wavedash build keeps the wrapper, because there the script
is plain minified JS sharing a page with the injected platform SDK.

### 8/9 — Packer re-search

The cached Roadroller model had been searched against the *old* Terser output.
Re-running `optimize(2)` against the new payload found a better one: −45 B.

Model count was then re-checked properly, giving each of 14/16/18/24 its own
full `optimize(2)` rather than reusing selectors searched at 20. All were worse
(16,634 at best against 16,551), so 20 stands.
