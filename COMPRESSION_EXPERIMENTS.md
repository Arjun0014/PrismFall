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
| Decoder memory ceiling | **150 MB setting = 120 MB allocated** | `Packer.memoryUsageMB`; 700 allocates 486 MB and is not shippable |

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
| 10 | **Decoder-memory audit** — the `--deep` path was building its winner at `maxMemoryMB: 700` | 16,551* | 16,558 | +7 | PASS | **KEEP the +7** — the 16,551 was never shippable, see below |
| 11 | **Compiler tournament** — Terser / esbuild / swc / uglify / Closure (3 levels) / 8 chains / raw, each × Roadroller and × plain deflate, all smoke-validated | 16,558 | 16,558 | **0** | PASS | **KEEP Terser** — nothing else is close |
| 12 | **Terser flag descent** — 78 moves scored as real archives, coordinate descent to a fixed point | 16,558 | **16,481** | **−77** | PASS | **KEEP** |

\* measured by proxy; the resulting bundle hangs, see notes.

\* 16,551 was measured with a decoder that allocates 486 MB. The honest
baseline for everything below is **16,558 B**.

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


### 10 — The decoder was allocating 486 MB (bug, +7 B to fix)

`build.mjs` forces `maxMemoryMB: 150` on the packer it constructs, and the
comment above it explains why at length: the decoder allocates its context
table *before the game exists*, so an over-ambitious figure is not a size trade,
it is a "does the game start at all" trade.

The abbreviation sweep inside the `--deep` path then built each candidate with
`maxMemoryMB: 700` and **returned that candidate directly**. So the flag was
correct everywhere except in the one code path whose output actually ships.

Measured with `Packer.memoryUsageMB` on this payload:

| Setting | Actually allocates | Packed chars |
|---:|---:|---:|
| 50 | 31 MB | 22,098 |
| 100 | 60 MB | 21,985 |
| **150** | **120 MB** | **21,922** |
| 300 | 240 MB | 21,891 |
| 700 | 486 MB | 21,879 |

The 700 setting is worth about 7 archive bytes and asks a phone for half a
gigabyte before the first frame. `RR_MEM = 150` is now a single constant used by
every packer the build constructs, and the tournament and flag-search tools were
corrected to match so their numbers mean something. **The true baseline for this
phase is 16,558 B, not 16,551.**

### 11 — Compiler tournament (Terser keeps the crown)

Every minifier that will compile this source, each scored as a complete archive.
`--deep` gave the six finalists their own `optimize(2)` rather than reusing a
model searched against Terser's output, which is the only way this comparison is
fair. Every entry was validated by `tools/smoke.mjs` first — it boots the
compiled bundle in a stubbed DOM, starts a run, draws strokes in all seven
colours for 240 frames and asserts the canvas and the audio graph both did work.

| Compiler | Roadroller + zip | Plain deflate |
|---|---:|---:|
| **Terser (this config)** | **16,558** | 20,113 |
| Terser → swc | 16,586 | 19,832 |
| swc → Terser | 16,622 | 19,829 |
| esbuild → Terser | 16,658 | 20,070 |
| Terser (stock settings) | 16,698 | 20,064 |
| Closure SIMPLE → Terser | 16,718 | 20,113 |
| swc alone | 16,723 | 19,888 |
| Terser → esbuild | 16,999 | 20,269 |
| esbuild alone | 17,264 | 20,558 |
| Terser → uglify | 17,302 | 20,291 |
| uglify alone | 17,614 | 20,588 |
| Closure SIMPLE | 18,655 | 22,267 |
| Closure WHITESPACE\_ONLY | 19,517 | 23,235 |
| *no minifier at all* | 19,688 | 42,503 |

Closure ADVANCED does not compile this source at all (it renames properties the
DOM and Web Audio own). Closure WHITESPACE\_ONLY → Terser is byte-identical to
Terser alone, which is a useful sanity check on the harness.

Three things worth keeping from this:

- **swc minifies hardest and packs worst.** It produces the shortest
  intermediate file of anything here (43,355 chars vs Terser's 45,877) and a
  *larger* archive. Same law as experiment 7, third confirmation.
- **Roadroller is worth 3.3–3.5 KB on every single compiler.** There is no
  compiler for which plain deflate is competitive, so no packer-free branch is
  worth maintaining.
- **The raw, unminified source packs to 19,688 B.** Minification is worth only
  3.1 KB here, which is the clearest possible statement that this archive is
  distinct information rather than sloppy text.

### 12 — Terser flag descent (−77 B)

`tools/terflags.mjs` scores one flag change at a time as a complete
Terser → Roadroller → Zopfli + ECT archive, in a worker pool, then does
coordinate descent from the shipping config until no single move improves.
78 candidate moves, five taken:

| Move | Delta | Minified chars |
|---|---:|---:|
| `lhs_constants: false` | **−46** | +1 |
| `format.beautify + braces` | **−14** | +28,515 |
| `loops: false` | −9 | +4 |
| `unsafe_arrows: true` | −7 | −5 |
| `passes: 3` | −1 | −10 |
| | **−77** | **16,558 → 16,481** |

`lhs_constants` is the find of the round and it is worth understanding. Terser
rewrites `a = a + b` to `a += b`: one character shorter, and it deletes a
repeated pattern the model was predicting nearly for free, replacing it with a
rarer token. Turning it off costs **one character** across the whole bundle and
buys 46 archive bytes.

`beautify: true` with `braces: true` is the same law at its most extreme. It
takes the bundle from 45,878 to 74,393 characters — 62% larger — and the archive
14 bytes *smaller*. Indentation is the most predictable text that exists, and
mandatory braces turn every single-statement `if` into the same shape as every
other one.

Nothing else moved. In particular `passes` 6/8/12, every `ecma` level from 2015
to 2024, `hoist_props`, `hoist_vars`, `keep_fargs`, `evaluate`, `dead_code`,
`unused`, `arguments`, `typeofs`, `properties`, `computed_props`, `arrows`,
`switches`, `directives` and every quote style are all worth exactly **0 bytes**
on this payload.

### 13 — Compression-aware identifier naming (−229 B, the largest single win yet)

Terser draws mangled names from a 54-character alphabet that it **sorts by how
often each character already appears in the source**. That is exactly right for
a Huffman-coded stream: skew the symbol histogram and the common symbols get
short codes. It is the wrong heuristic here, because a context-mixing coder does
not care how often a character occurs — it cares how predictable it is given the
last few characters.

`tools/mangle.mjs` supplies Terser a custom `nth_identifier` and scores the
archive. This is the safest transformation available: Terser guarantees the
names it emits are unique, non-reserved and non-shadowing whatever alphabet it
draws from, so no candidate in the search can produce an invalid program.

**Simply switching the frequency sort off is worth 136 B.** The rest came from
searching the alphabet itself:

| Alphabet | Zip | Delta |
|---|---:|---:|
| Terser default (frequency-sorted) | 16,481 | — |
| fixed order, no frequency sort | 16,345 | −136 |
| first 26 (`a`–`z`) | 16,340 | −141 |
| first 22 | 16,290 | −191 |
| 26 uppercase (`A`–`Z`) | 16,282 | −199 |
| **hill-climbed, 25 chars** | **16,252** | **−229** |
| first 6 | 16,558 | +77 |
| first 3 | 16,643 | +162 |

The winner is `YBCDEFHIJKLMNOPQSVTURWXAZ` — 25 characters, uppercase, `Y` first.
No amount of reasoning would have produced that. The landscape is rugged and
strongly non-monotonic in alphabet size (22 beats 24, 25, 26 and 27), so it was
found by measurement and it has to be re-found after any significant source
change: `npm run mangle`.

Restricting the alphabet far enough to force longer names is a clear loss — at
6 characters the archive is 77 B *worse* than the default and at 3 it is 162 B
worse. So this is not "smaller alphabets pack better"; the alphabet has an
optimum in both size and order, and neither is where a size heuristic would put
it.

Re-running the Terser flag descent on top of this found **no further moves**:
the flag configuration and the alphabet are jointly at a fixed point.

### 14 — Exact numeric-expression synthesis (0 of 155, abandoned)

The idea: replace a rare literal with an arithmetic expression that evaluates to
bit-identically the same double, built from characters that are already
everywhere. No tuning value changes — `Object.is(eval(expr), value)` is the
admission test, which rejects inexact division and the `0`/`-0` confusion, and
every rewrite is an acorn-driven span replacement, never a textual match.

It has to run after Terser, because `evaluate` folds every one of these straight
back to the literal it came from.

The minified bundle holds **3,301 numeric literals over 311 distinct values**;
116 of those values occur exactly once. 155 of the 311 have an exact expression
at nine characters or fewer.

**Not one of the 155 improves the archive.** `61` → `(122/2)` adds 5 characters
and costs 8 bytes; that is the shape of every single row.

The reasoning behind the idea was wrong in a way worth recording. It assumed a
literal like `.0525` is *novel* text at ~1.8 chars per archive byte while
`21/400` is *common* text at ~8.5. It is not: with 3,301 numeric literals in the
file, digit runs are among the most thoroughly modelled text in the program, and
an expression is made of exactly the same kind of text. So the rewrite does not
move content from the expensive class to the cheap one — it stays in the same
class and there is simply more of it.

Stated generally, and this rules out a whole family of ideas: **an
exactness-preserving rewrite carries the same information by definition.** It
can only win if it moves that information into a cheaper representation, and
digits are already cheap.

A control measured alongside it calibrates the whole phase: appending 33
characters of genuinely novel text (`;var zzzUnlikelyName=12345678901;`) costs
**34 archive bytes**. That is the exchange rate this project is working against —
roughly **one archive byte per novel character** at the margin.

### 15 — What the archive is made of (census)

`tools/census.mjs` replaces one class of content in the minified bundle with a
trivial stand-in of the same shape and weighs the result. None of these are
candidate builds; the question is how much of PRISMFALL is English, how much is
tuning numbers, and how much is program structure — which decides whether any
amount of restructuring can close a given gap.

| Class | Count | Source chars | Archive cost |
|---|---:|---:|---:|
| every numeric literal → `1` | 3,301 | 2,536 | **2,700 B** |
| numeric literals except 0/1/2 → `1` | 2,010 | 2,536 | 2,401 B |
| every string literal → `""` | 270 | 2,897 | **1,296 B** |
| English prose only → `""` | 66 | 1,402 | 776 B |
| *everything else — program structure* | | | **~12,250 B** |

Two things follow.

**Tuning numbers are the single largest content class in the game — 17% of the
archive.** 3,301 uses of 311 distinct values. Note the exchange rate: collapsing
them removes only 2,536 characters but 2,700 bytes, which is *more than a byte
per character removed*. What is being paid for is not the digits, it is which
value — roughly 8.7 B per distinct value. This is the same mechanism the
constant-lattice experiments (#5/#6) found, and it is why they worked: they
reduced the number of distinct values. It is also why they were rejected — the
only way to have fewer distinct tuning values is to change the tuning.

**The floor is arithmetical.** Deleting *every* string literal and collapsing
*every* numeric literal to a single value — a game with no text and one tuning
constant — is worth 3,996 B against a gap of 2,940. There is no combination of
content reductions that reaches 13,312 B while leaving the game recognisable.

### 16 — Free text shape (0 B, in both directions)

Since `beautify + braces` bought 14 bytes for 28,515 extra characters (#12),
the obvious follow-up is whether other predictable text is also free, or better
than free. Every variant below is applied to the minified bundle with acorn span
information, so nothing inside a string, template or regex is touched, and each
one is smoke-tested before it is weighed.

| Variant | Chars | Delta |
|---|---:|---:|
| CRLF line endings | +2,698 | **0** |
| every newline doubled | +2,698 | **0** |
| space after every comma | +2,928 | **0** |
| space after every semicolon | +1,597 | **0** |
| indentation doubled | +15,068 | **0** |
| indentation as tabs | −11,301 | **0** |
| blank line between top-level declarations | +176 | +10 |
| a 64-character banner above every declaration | +11,616 | +10 |

**You can add 15,068 characters to this program or remove 11,301, and the
archive does not change by one byte.** Whitespace is not merely cheap here, it is
free, and there is therefore no textual slack anywhere in the archive to
reclaim — every byte in it is information. The `beautify + braces` win was not
"more text is good"; it was a specific change to which tokens sit next to which.

### 17 — Roadroller input splitting (impossible, not merely bad)

The census makes a case for giving the game's 270 string literals their own
stream with the text model rather than the JS one. Roadroller 2.1.0 answers
directly:

> Packer: this version of Roadroller supports exactly one JS or text input

So the multi-stream idea cannot be tried at all with this packer, and the
single-input type is settled by measurement: `type: 'text'` on the whole bundle
is **+1,546 B** against `type: 'js'`.

### 18 — Is the packer leaving anything on the table?

| Coder | Bytes |
|---|---:|
| gzip -9 | 23,900 |
| **brotli -q 11 -w 24** | **20,642** |
| Roadroller + Zopfli/ECT zip | **16,252** |

Roadroller beats the strongest standard-library coder available by 21%, on a
payload brotli is given every advantage on (maximum quality, 16 MB window, exact
size hint). The final archive carries the game at **1.670 bits per minified
character**. There is no compressor swap left that would help.

### 19 — Retiring a distinct numeric value (−6 B, not applied)

Experiment 14 failed because `122/2` retires the value 61 and introduces the
value 122: the distinct-value count, which is what the census says costs money,
did not go down. `tools/numpool.mjs` fixes exactly that by admitting only
expressions whose every operand is a value the program already uses somewhere
else, so the count really does drop by one.

**178 of the 311 distinct values can be retired that way.** `.75` → `3/4`,
`27` → `3*9`, `56` → `7*8`, `160` → `80*2` — all bit-exact, all built from
numbers already in the file.

| Strategy | Archive | Delta |
|---|---:|---:|
| baseline | 16,250 | — |
| best single retirement (`1298` → `11*118`) | 16,244 | **−6** |
| descending greedy over the 36 individual winners | 16,244 | −6 |
| ascending greedy | 16,248 | −2 |
| take all, then drop whatever hurts | 16,321 | +71 |
| **all 36 winners together** | **16,343** | **+93** |

36 of the 178 improve the archive *on their own*, by 1 to 6 bytes each. Applied
together they are **93 bytes worse than doing nothing.**

That result corrects a piece of reasoning that had looked solid, and the
correction matters more than the six bytes: **8.7 bytes per distinct value is an
average over the class, not a marginal cost.** The model does not store 311
independent values and charge per entry — it prices each one in the context of
the others, so retiring one frees far less than its share, and retiring many
replaces a well-learned population of literals with a new population of
arithmetic expressions it has to learn from scratch.

Six bytes does not justify adding a post-Terser rewrite stage to the build (the
substitution cannot live in the source, because `evaluate` folds it straight
back), so this is recorded and not applied.

### 20 — Top-level function reordering, done properly this time (−1 B)

Experiment 4 hill-climbed function order with a brace-counting splitter that did
not understand regex literals, scored the result with gzip as a proxy, reported
−37 B, and produced a bundle that hung on load.

`tools/ast.mjs` redoes it with acorn: spans are exact statement boundaries, the
comment block above a declaration travels with it, and every rebuild is
re-parsed before it is scored. Only function declarations move, which is safe
because a function declaration is hoisted and fully initialised before any
statement runs, so its position cannot change when it exists or what anything
else sees; every other statement keeps its exact relative order, preserving
evaluation order and every temporal dead zone.

Scored against the real archive rather than gzip, the entire search is worth
**one byte**, all of it in `60_audio.js`. The −37 B was an artefact of the proxy:
gzip ranks duplication, and duplication is the one thing this archive does not
pay for. Not applied.

### 21 — Roadroller model count, re-searched on the new payload

The payload is now 77,000 characters rather than 45,000, so the model count was
re-run from scratch: ten counts from 12 to 32, each given its own `optimize(2)`
and its own abbreviation sweep.

**Twenty still wins.** The best alternative is +38 B and the worst is +130 B.
The abbreviation sweep did find the cached value had drifted — 9 rather than 12,
worth **−2 B**, which is applied.

### 22 — Source file order, searched properly (−26 B, kept)

File order was previously checked by trying five permutations by hand, which
found the existing order best. There are 39,916,800 of them.

`tools/reorder.mjs --files` hill-climbs the order instead. Unlike function
reordering this is **not** provably safe — `const CV = document.getElementById('a')`
lives in `20_state.js` and `85_input.js` touches `CV` at top level, so file order
carries real temporal-dead-zone dependencies. Every candidate is therefore gated
on `tools/smoke.mjs`, which compiles it, boots it in a stubbed DOM, starts a run
and drives 150 frames of real input before the archive is weighed. **67 candidate
orders in the first search did not run and were rejected**, which is the gate
doing exactly the job it exists for.

The winner moves `colors` ahead of `physics` and `world` after `audio`:

```
util  config  state  colors  physics  audio  world  render  hud  input  game
```

Worth −26 B measured alone, −11 B on top of the improved alphabet (the two
changes overlap). Applied by renumbering `src/`. All suites re-run green
afterwards, including both browser engines.

### 23 — Mangling alphabet, second climb (−8 B)

Re-running the alphabet climb after the abbreviation change found
`YCBDEFHIJKLMNOPVSQTURWXAZ`, a further −8 B and **−244 B against Terser's
default**. Two characters swapped. This axis clearly still has a little left in
it each time the payload moves, which is the argument for `npm run mangle` being
part of the routine rather than a one-off.

### 24 — Formula-driven audio, measured rather than argued (worth 448 B)

The proposal, stated precisely: instead of 24 hand-written cue recipes, derive
every cue's waveform, pitch, sweep, duration and envelope arithmetically from
its event id and whatever runtime value it already receives. This is **not** the
audio patch VM of experiment 1 — that stored a packed parameter table and lost
by 17 B because the table was dense novel data. A formula stores nothing at all.

`tools/audioform.mjs` measures the ceiling. It replaces all 24 cue bodies with
calls to one generator whose parameters come only from `id`, and weighs the real
archive. The generator is deliberately the smallest thing that still makes a
two-layer, pitch-swept, envelope-shaped sound, so the number is an upper bound.

| | Archive | Minified |
|---|---:|---:|
| current | 16,230 | 77,281 |
| all 24 cues from one formula | 15,782 | 74,733 |
| **saving** | **448 B** | |

For scale: deleting all 24 cues outright is worth 686 B, so the generator itself
costs 238 B of that.

**448 B, and every sound in the game becomes a different sound.** Sound design
is not recoverable from a hash of the event id — `sndDeath`'s descending minor
run and `sndSpectrum`'s stacked arpeggios are decisions, not parameters. This is
recorded as a costed option, not applied. It is 15% of the remaining gap.

### 25 — HTML shell and ZIP container, re-audited (−5 B)

| Variant | Shell chars | Archive | Delta |
|---|---:|---:|---:|
| current `<canvas id=a>` + `getElementById` | 54 | 16,202 | — |
| **`<canvas>` + `querySelector`** | **49** | **16,197** | **−5** |
| `<body>` + canvas created in JS | 38 | 16,202 | 0 |
| no `<body>` + `documentElement.appendChild` | 32 | 16,198 | −4 |

Moving markup into the payload is a wash: the shell is deflated with
high-entropy packed data so its characters cost ~1 B each, but the JS that
replaces them costs about the same after packing. Dropping the `id` is a genuine
−5 B and is taken; it was verified in Chromium and WebKit, 27 assertions each,
not just in the smoke harness.

**The first run of this audit was wrong and the bug is worth recording.** It
compared source files by object identity (`f === CANVAS_SRC`) against a fresh
array from `readSources()`, so the identity never matched: every variant was
measured with a *trimmed shell and an unchanged payload*, a pairing that cannot
run. It reported 22 B of savings that do not exist. `smoke()` did not catch it
either, because the test harness's `getElementById` returns the canvas whatever
id it is asked for. The number that exposed it was the real build: applying the
"−15 B" variant for real produced exactly 16,202, no change.

The container is at its floor and is on the record:

```
local file header          30 B
file name "index.html"     10 B    required at top level by the rules
central directory header   46 B
file name again            10 B
end of central directory   22 B
---------------------------------
fixed overhead            118 B
```

No extra fields, no data descriptor, no directory entry, no comment.

### 26 — The deep path was shipping regressions (two separate bugs)

Both found by noticing that `--deep` produced a *larger* archive than the fast
build, twice.

1. **The sweep's metric was too weak.** It scored candidates with a single
   zopfli pass at 15 iterations and no ECT, while the build ships
   `[15, 200, 1000, 4000]` + ECT. A model that led by 5 B on the cheap metric
   came out 13 B behind on the real one — and the sweep then cached the loser.
2. **The sweep built its candidates without `allowFreeVars`,** which the fast
   path sets. So it was ranking, and then *shipping*, models built under options
   the product does not use. Worth 15 B, and it made every deep run a
   regression.

Together with the `maxMemoryMB: 700` bug from experiment 10, that is three
separate defects in the same twenty lines, all of the same shape: **the deep
path evaluated candidates under conditions the shipping path does not use.**
It now scores exactly what it ships, and the cached model competes on equal
terms and wins ties.

### 27 — Coordinate descent to a fixed point

The three search axes are coupled: the alphabet that wins depends on the file
order, which depends on the Terser flags. Alternating them:

| Round | Change | Archive |
|---|---|---:|
| — | start of phase | 16,558 |
| 1 | Terser flag descent | 16,481 |
| 2 | alphabet search | 16,252 |
| 3 | abbreviations 12 → 9 | 16,250 |
| 4 | alphabet climb (restart) | 16,242 |
| 5 | file order | 16,231 |
| 6 | file order round 2 | 16,211 |
| 7 | alphabet, re-searched on the new order | 16,202 |
| 8 | shell `id` dropped | **16,197** |

Rounds 5–7 are the point: the alphabet found by round 4 was **worse** than its
predecessor once the file order moved, and had to be re-searched from scratch.
Flags and file order are now both at a fixed point (no single move improves
either), and the alphabet plateaus after ~375 probes.

**16,558 → 16,197 B, −361 B, with no change to any feature, sound, effect,
world, system, cosmetic or tuning value.**


## Where the archive stands: 16,197 B

Measured against the final build.

### By source file (leave-one-out, real pipeline)

| File | Archive cost |
|---|---:|
| render.js | 2,975 |
| world.js | 2,865 |
| hud.js | 2,134 |
| audio.js | 1,602 |
| physics.js | 1,240 |
| colors.js | 1,133 |
| game.js | 1,010 |
| input.js | 491 |
| util.js | 276 |
| config.js | 202 |
| state.js | -42 |
| *packer decoder + zip container + interaction* | ~2,460 |

### By content class

| Class | Count | Archive cost |
|---|---:|---:|
| tuning numbers | 3,301 uses / 311 values | 2,700 |
| string literals | 270 | 1,296 |
| — of which English prose | 66 | 776 |
| program structure | | ~12,200 |

### Costed options that are still open, none of them taken

Every row is a real archive measurement against this build. Nothing on this list
has been applied and no lean build exists.

| Option | Bytes | What it costs the game |
|---|---:|---|
| all 24 audio cues from one formula | 448 | every sound becomes a different sound |
| remove all 24 audio cues | 679 | silence |
| remove Ascension + all boons | 407 | the endgame |
| remove particles + shockwaves | 392 | the impact read |
| remove background motifs | 376 | region identity at a glance |
| remove region force fields | 317 | the thing that makes a region a place |
| remove store + cosmetics | 255 | coins stop being spendable |
| remove the music arrangement | 249 | reactive music |
| remove reward placement | 205 | coin arcs, destruction caches |
| remove the title-screen copy | 185 | how anyone learns to play |
| 9 world archetypes down to 7 | 177 | bowls and crusher lanes |
| remove the trail | 94 | speed read |
| remove the world filler pass | 81 | sparser screens |
| remove focus vaults | 65 | prize rooms |
| remove onboarding hints | 50 | first-run guidance |
| 10 boons to 6 | 49 | Ascension variety |
| 12 cosmetics to 6 | 18 | |
| remove region gates | 18 | |
| 7 boosters to 5 | 15 | |
| 7 regions to 5 | 0 | nothing gained |

**Everything on that list, taken together, is 3,632 B against a gap of 2,885 B.**
Quantity reductions are near-worthless — halving the cosmetics, the boons and the
boosters together buys 82 B, and dropping two whole regions buys nothing at all,
because a table row is repeated text the model already predicts almost free.

---

# Perceptual compression phase

The rule changed here: internal implementation, tuning numbers, sound waveforms
and rendering formulas no longer have to stay identical, provided the player
experience is as good. Ascension and boons were approved for removal.

## EXP 1 — Remove Ascension and boons (KEEP)

| | |
|---|---|
| Before | 16,197 B |
| After | **15,430 B** |
| Delta | **−767 B** |
| Tests | 165 sim, 21 gen, 35 audio, browser ×2 engines, wavedash — green |
| Visual | screenshots re-captured; unicorn, strokes, tether, prism bar, HUD intact |

Worth 767 B where stubbing the two screens measured 407, because a clean
excision also removes the ten-row boon table, the HUD row, the input branch, the
render pips, the stroke charge counter, and all fourteen sites across colours,
physics and game that read a boon bit.

The cycle boundary needed no replacement code at all: `regAt` already wraps and
`difAt` already climbs with the lap count, and a lap boundary is also a region
change, so it still flashes, names itself and sounds a gate.

## EXP 2 — Formula-generated audio (REVERT, twice)

The measured ceiling is real and unchanged: replacing all 23 cues with one
generator whose parameters come only from the cue index saves **454 B**. Two
attempts to collect part of that without making the sounds arbitrary:

### 2a — the seven colour verbs as one spectrum rule

Seven verbs, one sound transposed across the spectrum: Red lowest, Violet
highest, which is the spectrum's own ordering by frequency, with one bit per
colour saying whether the verb adds energy (rises) or bends it (falls).

**−7 B.** Reverted.

### 2b — the eight incidental cues from one derived tick

Fusion, refund, purchase, menu, empty tank, pigment, target, coin: all one
shape, with only the note stored and timbre, glide, length, level and the octave
partner derived from the cue index. The signature sounds were left alone.

**+10 B — worse.** All 35 audio assertions still passed, including "no two cues
share a synthesis signature", so the cues stayed distinct. It simply costs more.
Reverted.

### Why the ceiling is unreachable without losing the design

`O('square', NOTE(n), NOTE(n + 7), .07, .13)` is repeated call syntax whose
numbers are drawn from the pool the whole game already uses — the model predicts
it almost free. `tick(14, 76 + f * 12 | 0)` replaces that with an index that is
itself novel information, plus a generator to interpret it.

**The 454 B is not paid for by sharing the generator. It is paid for by deleting
the parameters — and the parameters are the sound design.** Any version that
keeps a cue's character keeps its parameters and therefore saves nothing. This
closes the audio avenue: the only way to collect that 454 B is to accept
arbitrary sounds, and that is not a compression change, it is a redesign with a
worse result.

## EXP 3 — Targeted perceptual constant clustering

Replace a rare constant with a value the program already uses, close enough that
no player could tell. Unlike the expression rewrites of #14 and #19 this really
does retire a value: it adds no characters and it shrinks the pool.

The search is **subtractive** — snap everything, then drop what hurts. Greedy-add
from nothing stalled at −48 B where snapping everything was worth −155, because
retiring a value only pays once *all* its occurrences are gone, so most
individual snaps measure at zero and a one-at-a-time walk never starts.

| Pass | Files | Tol | Before | After | Delta | Decision |
|---|---|---:|---:|---:|---:|---|
| 3a | render, audio | 12% | 15,430 | **15,348** | **−82** | KEEP |
| 3b | world | 12% | 15,348 | **15,283** | **−65** | KEEP |
| 3c | render, audio, world | 20% | 15,283 | 15,206 | −77 | **REVERT** |

### The rails, all of which were written after something broke

**Structural, not numeric.** The first version snapped `540` to `500` inside
`(((b - a + 540) % 360) - 180)` — the shortest-angular-distance idiom, where 540
is 360 + 180 and is *arithmetic*. Every hue interpolation then took the wrong way
round the wheel and the title screen went from purple to teal. Literals inside
modular or bitwise arithmetic, inside the hue argument of a colour call, inside a
table, or in anything named after a hue are now refused outright.

**Relative tolerance is the wrong ruler for anything exponentiated.**
`p.vx *= .985` → `.9` is an 8% relative change and a **sevenfold** change in how
fast a particle stops, because it is applied sixty times a second. Constants just
under 1 are refused.

**Both ends of a range move together or not at all.** `ri(760, 1080)` snapped
independently became `ri(700, 1400)`: low end 8% down, high end 30% up, span more
than doubled. That is not a nudge to a value, it is a different distribution —
rooms of a different size and a different rhythm.

**UI layout is relational, not perceptual.** `hud.js` is excluded entirely.
Moving `modal`'s subtitle offset without the store's grid offset put the subtitle
straight through the first row of items. Worth 31 B and not worth having.

### Why 20% is over the line

The 12% passes are invisible. The 20% pass passed the archive test and failed the
game, in two specific ways the suites caught:

- **`no seed is hopeless even for a modest policy [804]`** — one seed became
  effectively unplayable, reaching 804 depth against a floor of 1,500.
- **`no two cues share a synthesis signature [sndRail=sndFuse]`** — two sounds
  collapsed into the same sound.

Twelve percent is the ceiling for this codebase, and it is a measured ceiling
rather than a guessed one.
