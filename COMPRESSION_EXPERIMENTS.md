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
