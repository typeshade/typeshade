# Porting the examples to `"use typeshade"`

Step 1 of the example port: a **classification**, not a port. First measured on `main`
`b6d6c56`; the rows have been re-measured since, most recently on this branch with A1 (#19)
and the #14 fix in place. Where a row's verdict changed, the correction note below says so.

> **Corrected twice.** This document was written before three changes that invalidate much
> of it, and the rows have been updated for all three. (1) **A1** — vector × scalar broadcast
> — landed in [#19](https://github.com/typeshade/typeshade/pull/19), so the single largest
> blocker below is gone. (2) [#13](https://github.com/typeshade/typeshade/issues/13) and
> [#14](https://github.com/typeshade/typeshade/issues/14), the two backend bugs writing the
> twins uncovered, are fixed in
> [#17](https://github.com/typeshade/typeshade/pull/17) and
> [#18](https://github.com/typeshade/typeshade/pull/18). What has **not** changed is the
> lesson those two taught: everything here measures whether the compiler **accepts the
> source**, which is not the same as whether the **output is correct**. See
> [What step 2 found](#what-step-2-found-that-this-classification-could-not).

`"use typeshade"` is the product's language (`docs/use-typeshade-surface.md`), so the
examples should be written in it. They are not yet, because the language surface still has
holes — the ones catalogued in [issue #8](https://github.com/typeshade/typeshade/issues/8).
This document says, for each of the 36 `fn()` EDSL examples, whether it can be ported
**today** and, if not, exactly which missing feature stops it and how many other examples
that same feature stops.

The `fn()` corpus is not being replaced. It stays as the IR-equality oracle the surface
document names; the port adds a `<id>.shade.ts` twin beside each example it can. The ids,
the order in `_order.ts`, and the goldens in `__emit-goldens__/` are untouched by this work.

## How this was measured

Two passes, both mechanical, because "does the compiler take this?" is a question with a
real answer and guessing it wastes the language session's time.

1. **Walk the IR of all 36 built modules.** Every `examples/index.ts` entry exposes its
   `ModuleDecl`. A walk over it collects the facts a twin would have to spell: every `call`
   name, every `binop` whose two operands have different type keys, every non-`varref`
   assignment target, every `discard`, every `for` whose bound is not a constant, every
   `f64` / `vec64` / `texture` / `sampler` type, every `override` read. That is the demand
   side, read off the actual graphs rather than off the imports.

2. **Compile a probe for each feature with `compileTsSource`.** For every feature the walk
   found, a minimal `"use typeshade"` program exercising _just_ that feature was compiled
   through the public `compileTsSource` (`src/index.ts`). Accepted or rejected, with the
   diagnostic text, is the supply side. The probes are listed in the appendix.

Where the two disagree with intuition, the probe wins. Three results came out the opposite
way from what reading the feature list suggested: **A2** (member assignment), which ranks
second in issue #8, blocks nothing here; f64 **arithmetic** already works, so the fp64
family is held up by the cast and the literal rather than by the emulation; and `.length`
on an unsized storage array **was** accepted and emitted `0u`, which is worse than the
rejection it was assumed to be — see the hazards entry below, which records that it is a
diagnostic now.

The classification is then "does every feature this example demands have a probe that
passes". For seven examples the whole shader was additionally written out as a `.shade.ts`
file and compiled, so their verdict rests on a compiler run rather than on a feature list —
see [Verified, not inferred](#verified-not-inferred).

## The table

`Blocks (total)` is how many of the 36 examples the row's **first-listed** blocker stops.
It is the prioritisation signal: a row blocked by something that blocks 28 examples is not
waiting on its own feature, it is waiting on the corpus-wide one.

| #   | Example               | Category     | Now          | Blocked by                   | Blocks (total) |
| --- | --------------------- | ------------ | ------------ | ---------------------------- | -------------- |
| 1   | `graticule`           | cartographic | blocked      | **A6-deriv**                 | 5 / 36         |
| 2   | `hillshade`           | cartographic | **portable** | —                            | —              |
| 3   | `fp64-deep-zoom`      | cartographic | blocked      | **A6-f64**                   | 13 / 36        |
| 4   | `fp64-checker-plane`  | cartographic | blocked      | **A6-f64**, N1, N2           | 13 / 36        |
| 5   | `fp64-loran`          | cartographic | blocked      | **A6-f64**, N1, N2, A6-deriv | 13 / 36        |
| 6   | `fp64-mercator-tiles` | cartographic | blocked      | **A6-f64**, N1, N2, L-loop   | 13 / 36        |
| 7   | `fp64-rtc`            | cartographic | blocked      | **A6-f64**, N1               | 13 / 36        |
| 8   | `color-ramp`          | cartographic | blocked      | **A6-deriv**                 | 5 / 36         |
| 9   | `discard-cutout`      | generic      | blocked      | **A6-discard**               | 1 / 36         |
| 10  | `plasma`              | generic      | **portable** | —                            | —              |
| 11  | `voronoi`             | generic      | **portable** | —                            | —              |
| 12  | `julia`               | generic      | **portable** | —                            | —              |
| 13  | `mandelbrot`          | generic      | **portable** | —                            | —              |
| 14  | `fbm-clouds`          | generic      | blocked      | **L-loop**                   | 4 / 36         |
| 15  | `domain-warp`         | generic      | **portable** | —                            | —              |
| 16  | `raymarch-sphere`     | generic      | **portable** | —                            | —              |
| 17  | `raymarch-boxes`      | generic      | **portable** | —                            | —              |
| 18  | `tunnel`              | generic      | **portable** | —                            | —              |
| 19  | `metaballs`           | generic      | blocked      | **L-loop**                   | 4 / 36         |
| 20  | `ocean`               | generic      | **portable** | —                            | —              |
| 21  | `starfield`           | generic      | **portable** | —                            | —              |
| 22  | `truchet`             | generic      | blocked      | **A6-deriv**                 | 5 / 36         |
| 23  | `kaleidoscope`        | generic      | **portable** | —                            | —              |
| 24  | `heart`               | generic      | blocked      | **A6-deriv**                 | 5 / 36         |
| 25  | `fp64-mandelbrot`     | generic      | blocked      | **A6-f64**, N1, N2, L-loop   | 13 / 36        |
| 26  | `fp64-julia`          | generic      | blocked      | **A6-f64**, N1, N2           | 13 / 36        |
| 27  | `fp64-burning-ship`   | generic      | blocked      | **A6-f64**, N1, N2           | 13 / 36        |
| 28  | `fp64-newton`         | generic      | blocked      | **A6-f64**, N1, N2           | 13 / 36        |
| 29  | `fp64-mandelbrot-de`  | generic      | blocked      | **A6-f64**, N1, N2           | 13 / 36        |
| 30  | `fp64-clock`          | generic      | blocked      | **A6-f64**                   | 13 / 36        |
| 31  | `fp64-cancellation`   | generic      | blocked      | **A6-f64**, N2               | 13 / 36        |
| 32  | `fp64-sine-sweep`     | generic      | blocked      | **A6-f64**                   | 13 / 36        |
| 33  | `gradient`            | generic      | **portable** | —                            | —              |
| 34  | `override-quality`    | generic      | blocked      | **A7-override**              | 1 / 36         |
| 35  | `texture-array-lod`   | generic      | blocked      | **A3**, A7-tex               | 1 / 36         |
| 36  | `compute-reduction`   | compute      | **portable** | —                            | —              |

**Source the compiler accepts today: 14 of 36**, up from 2 when this was first measured — [#19](https://github.com/typeshade/typeshade/pull/19) landed A1 and removed the
single largest blocker. One has shipped as a twin (`compute-reduction` in
[#16](https://github.com/typeshade/typeshade/pull/16)); `gradient` was held by
[#14](https://github.com/typeshade/typeshade/issues/14), which this PR fixes, and lands in
[#36](https://github.com/typeshade/typeshade/pull/36). The other twelve are
unwritten, and _accepts the source_ is not _emits a correct shader_ — see
[What step 2 found](#what-step-2-found-that-this-classification-could-not).

## The blockers

| Code            | Missing feature                                                      | Issue #8        | Blocks | Examples                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A6-f64**      | the `f64()` cast — there is no f32 → f64 promotion at all            | A6, seam S1     | 13     | every `fp64-*`                                                                                                                                                            |
| **N1**          | component read on a `vec2<f64>` (`c.x`)                              | **not in #8**   | 9      | `fp64-checker-plane`, `fp64-loran`, `fp64-mercator-tiles`, `fp64-rtc`, `fp64-mandelbrot`, `fp64-julia`, `fp64-burning-ship`, `fp64-newton`, `fp64-mandelbrot-de`          |
| **N2**          | an f64 literal — `let z: f64 = 0.` and `f64Val * 2.` both fail       | **not in #8**   | 9      | `fp64-checker-plane`, `fp64-loran`, `fp64-mercator-tiles`, `fp64-mandelbrot`, `fp64-julia`, `fp64-burning-ship`, `fp64-newton`, `fp64-mandelbrot-de`, `fp64-cancellation` |
| **A6-deriv**    | `fwidth`, and `dpdx` / `dpdy` to hand-roll it with                   | A6              | 5      | `graticule`, `fp64-loran`, `color-ramp`, `truchet`, `heart`                                                                                                               |
| **L-loop**      | a loop bound that is not a compile-time constant                     | later (M22·S31) | 4      | `fp64-mercator-tiles`, `fbm-clouds`, `metaballs`, `fp64-mandelbrot`                                                                                                       |
| **A3**          | an integer literal taking the declared type (`vec2i(0, 0)`)          | A3              | 1      | `texture-array-lod`                                                                                                                                                       |
| **A6-discard**  | the `discard` statement                                              | A6              | 1      | `discard-cutout`                                                                                                                                                          |
| **A7-tex**      | `texture_2d_array<f32>`, `sampler`, `textureSample*` / `textureLoad` | A7              | 1      | `texture-array-lod`                                                                                                                                                       |
| **A7-override** | `override<T>` specialization constants                               | A7              | 1      | `override-quality`                                                                                                                                                        |

### What the corpus does **not** need

Worth stating, because these rank high in issue #8 and would be natural things to reach for
first. No example in the 36 is waiting on any of them:

| Issue #8 item                                       | Blocks |
| --------------------------------------------------- | ------ |
| **A2** member / component assignment (`v.x = 0.`)   | 0      |
| **A4** `type` / `interface` structs                 | 0      |
| **A5** `@align` / `@size` field decorators          | 0      |
| ~~**A8** element-converting constructors~~ (landed) | 0      |
| **A9** module-level vector constants                | 0      |
| **A10** uninitialised `let`, `switch`, `<<=`        | 0      |
| **A11** object-literal contextual typing            | 0      |
| **S5** `arrayLength`                                | 0      |
| **S7** `mat2` / `mat3`                              | 0      |

A2 in particular: every `.assign()` in the corpus targets a whole value, never a component.
What reads as member assignment in the IR walk (`construct`, `lit`, `binop` targets) is the
auto-var pattern — an EDSL value node that `autoVars` later materialises into a `var` — and
it ports to a plain `let x = …; x = …`, which already compiles. No example assigns to `v.x`.
And no example uses a matrix at all, so `mat2`/`mat3` cannot be on this corpus's path.

## What it takes to unlock the corpus

Landing the features in weight order, how much of the corpus the compiler would accept.
**This counts source acceptance only.** It carried a second caveat until this PR — that #14
additionally blocked the GLSL form of all 33 renderable examples, making every row an upper
bound — and that one is now spent: a source-compiled binding reaches its stages, so a row
below that says "portable" means the GLSL form emits too. What the rows still do not claim is
that the emitted shader is CORRECT; only Tint and WebGL2 answer that.

| After landing      | Portable |
| ------------------ | -------- |
| (today, A1 landed) | 14 / 36  |
| + A6-deriv         | 18 / 36  |
| + A6-discard       | 19 / 36  |
| + L-loop           | 21 / 36  |
| + A6-f64           | 24 / 36  |
| + N1               | 25 / 36  |
| + N2               | 34 / 36  |
| + A7-override      | 35 / 36  |
| + A7-tex           | 35 / 36  |
| + A3               | 36 / 36  |

Two things fall out of this that the issue's own ordering does not show.

**A1 was the whole first half of the corpus, and it has landed.** It blocked 28 of 36 and
twelve examples were waiting on it alone; [#19](https://github.com/typeshade/typeshade/pull/19)
turned it into one rule shared by `lowerBinary` and `lowerAssignOp`, and those twelve are the
jump from 2 portable to 14. Nothing left in the list has that weight.

**The fp64 family needs three features, not one.** Issue #8 lists the `f64()` cast under
A6 and stops there. The corpus needs the cast (13), component reads on `vec2<f64>` (9), and
an f64 literal (9). Land only the cast and 10 of the 13 fp64 examples are still held up by
one of the other two.

### A1 needed no workaround in the end

This section used to argue that `v * vec3(s)` — the spelling that compiled before A1 — was
not an acceptable substitute for `v * s`, because the two build different IR and emit
different text (`(… * 0.5)` against `(… * vec3<f32>(0.5, 0.5, 0.5))`), so a twin written that
way would stop being an IR-equality oracle for its original.

[#19](https://github.com/typeshade/typeshade/pull/19) made the argument moot by accepting
`v * s`. Verified on `main`: `vec3(1., .5, .25) * 0.5`, `0.5 * p.xyz`, `c *= 0.5`,
`p.xy / 2.` and `0.5 + p.xyz` all compile, and each emits the same text the EDSL produces.
The note is kept because the reasoning generalises — a workaround that changes the emit
costs the pairing its whole purpose — and the next blocked feature will face the same test.

## What step 2 found that this classification could not

Everything above is measured two ways — an IR walk for what each example demands, a
`compileTsSource` probe for what the compiler supplies. Both measure the same thing:
**does the compiler accept this source**. Neither looks at what comes out the other end.

Writing the twins ([#16](https://github.com/typeshade/typeshade/pull/16)) did, and the two
examples this document called portable both turned out to emit something wrong. Not because
the classification was careless — because acceptance and correctness are different
questions, and only one of them was being asked.

### [#13](https://github.com/typeshade/typeshade/issues/13) — an integer module constant emits a float literal

`const WINDOW: u32 = 8` compiles with no diagnostic and emits `const WINDOW: u32 = 8.0;`.
Tint: `cannot convert value of type 'abstract-float' to type 'u32'`. GLSL ES 3.00 the same.
It reaches the `fn()` surface too — `emitConst` formats with the type-blind `f32Lit` where
`emitOverride`, seven lines away, uses the type-aware `lit()`.

This one does **not** block the port: the EDSL's `const WINDOW = u32(8)` is a build-time
JavaScript constant that inlines as `8u`, so the faithful twin inlines too and never
declares a module constant. Probe J01 in the appendix says the loop bound compiles, and it
does — the probe just never looked at the emit.

### [#14](https://github.com/typeshade/typeshade/issues/14) — bindings are invisible to stage reachability

The source compiler encodes a binding read as `Expr.constref`; the reachability walk in
`src/core/passes/stage-bindings.ts` counts only `Expr.varref`. So no stage reaches any
binding in any source-compiled module, and the GLSL emit drops the uniform block while
keeping every use of it:

```glsl
// a gradient-pass.ts twin, fragment stage
in vec2 uv;
layout(location = 0) out vec4 _ret;
void main() {
  float t = (uv.y + u.mix_bias);   // WebGL2: "'u' : undeclared identifier"
```

`reflect()` also reports `stages: []` for every binding, so a host building bind group
layouts from it gets `visibility: 0`.

**This was the most important finding in this document, and it has been fixed.**
[#18](https://github.com/typeshade/typeshade/pull/18) lowers a binding read to `varref`, the
same shape the EDSL builds, so every consumer that asks which bindings a stage reaches now
gets an answer: the GLSL writer declares the block it uses, `reflect()` names the stage, and
the CPU oracle resolves the binding — a third symptom the issue had not named.

It mattered more than A1 while both were open, and that ordering held: A1 unlocked twelve
examples' _source_, and #14 meant every one of those twins would have emitted invalid GLSL.
`gradient`, which this document listed as blocked on it, is now portable — its twin's
fragment GLSL declares the uniform block and links.

A gate came with the fix, because a golden pins whatever is emitted, right or wrong, and the
compile gate never saw a source-compiled binding: `examples/binding-declared.test.ts` sweeps
both corpora and asserts that every binding a stage's emitted source mentions, that stage's
source also declares — reading both halves off the bytes rather than off the walk under test.

### What this says about the method

An IR walk plus an acceptance probe is the right instrument for "which language features are
missing", and that part of this document stands. It is the wrong instrument for "is the twin
correct", and nothing short of emitting both sides and handing them to Tint and WebGL2
answers that. #16 adds those gates — `shade-twins.test.ts` pins the two emits against each
other, and the compile gate hands every registered twin's WGSL to Tint — so the next twin to
land cannot repeat this.

## Verified, not inferred

The table's per-example verdicts come from the IR walk. For the examples whose verdict
turns on one feature, the full example was also written as a `.shade.ts` file and compiled,
so the verdict rests on a compiler run rather than on a feature list.

"Compiles clean" is the claim being checked here, and it is a claim about the **front end**.
It is not a claim that the emitted shader is valid — see
[What step 2 found](#what-step-2-found-that-this-classification-could-not) for the two places
that distinction turned out to matter.

| Example             | Written out as                    | Result                                                                                                                       |
| ------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `gradient`          | a faithful twin                   | compiles clean, and since [#18](https://github.com/typeshade/typeshade/pull/18) its GLSL declares the uniform block it reads |
| `compute-reduction` | a faithful twin                   | source compiles clean; shipped as a twin in [#16](https://github.com/typeshade/typeshade/pull/16)                            |
| `plasma`            | a faithful twin                   | 1 error, an A1 mismatch (+1 cascade); clean once `* vec3(0.5)` is used                                                       |
| `tunnel`            | a faithful twin                   | 1 error, an A1 mismatch; clean once `* vec3(…)` is used                                                                      |
| `hillshade`         | a faithful twin                   | 2 errors, both A1 (+10 cascade); clean once `* vec2(…)` / `* vec3(…)`                                                        |
| `graticule`         | twin with `fwidth(x)` → a literal | compiles clean — `fwidth` is genuinely the only gap                                                                          |
| `discard-cutout`    | twin with the `discard` removed   | compiles clean — `discard` is genuinely the only gap                                                                         |

The cascade counts are worth noting on their own: one rejected `const` turns into ten
`Unknown identifier` diagnostics downstream. That is issue #8's A12, seen here at full size
— a two-line shader fault reported as twelve errors.

## Hazards a twin will hit that are not blockers

These do not stop a port. They will silently produce a _wrong_ twin, so step 2 has to watch
for them and the language session should weigh them accordingly.

- **`@interpolate("flat")` is accepted and dropped.** `class VsOut { @location(0) @interpolate("flat") id: u32 }`
  compiles, and the emitted WGSL is `@location(0) id: u32` with no `@interpolate`. An
  integer varying is then invalid on the GPU, and nothing before the driver says so.
  (Issue #8 A5 predicts this; confirmed here.) No current example uses it — but any twin
  that needs a flat varying would be silently broken.
- **`xs.length` on an unsized storage array emitted `0u`.** Probed: the guard
  `if (gid.x >= u32(src.length))` compiled and emitted `if ((gid.x >= 0u))` — true for every
  unsigned invocation, so the kernel returned at once and wrote nothing. Wrong output, no
  diagnostic, valid WGSL, accepted by Tint. (Issue #8 S5, filed as
  [#46](https://github.com/typeshade/typeshade/issues/46).) **It is a diagnostic now**
  (`TS8032`); the `arrayLength` spelling that would let it work is #46's second half.
- **Assignment to a parameter is accepted.** `function fs(x: f32) { x = x + 1. }` compiles.
  WGSL parameters are immutable. (Issue #8 "later", M13·S32.)
- **A `.shade.ts` file cannot import.** `import { VsOut } from './_fullscreen.js'` parses
  and is then ignored, so the type resolves to nothing and the failure surfaces as
  `Unknown field "uv" on struct:VsOut`. Every twin has to be self-contained, which means
  each of the 30 examples that import `_fullscreen.ts` repeats the ~25 lines it shares
  today: the `Uniforms` head, `VsOut`, and the fullscreen-triangle vertex stage. That is a
  real cost of the port and an argument for issue #8's multi-file item (M26·S29).

## Step 2, as it landed

Step 2 is [#16](https://github.com/typeshade/typeshade/pull/16), stacked on
[#11](https://github.com/typeshade/typeshade/pull/11) — which is what gives a `.shade.ts`
file a registry entry, goldens and a compile-gate slot. A twin lands as: write
`<id>-twin.shade.ts`, add the id to `SHADE_ORDER` with `twinOf` naming the EDSL example, bake.
The `-twin` suffix is what keeps the golden stems disjoint; `shade-examples.test.ts` asserts
that disjointness, because both corpora bake into one `__emit-goldens__/` directory.

One twin landed in #16, `compute-reduction-twin`. `gradient` was held by
[#14](https://github.com/typeshade/typeshade/issues/14) until this PR fixed it, and lands as
`gradient-twin` in [#36](https://github.com/typeshade/typeshade/pull/36).

### What changes between an original and its twin

Both differences that survive are optimizer artifacts rather than language gaps, and both are
now pinned as goldens rather than described here:

- **`compute-reduction`** — the EDSL's LICM pass hoists `gid.x * 8u` **above** the
  early-return guard where the twin computes it after (same value, both correct, different
  statement order); the EDSL inlines `gid.x` at the use sites where the twin keeps its
  `let idx`; and `Var`/`Loop` produce `_v0`/`_v1` where the twin has `sum`/`j`. The
  structural golden reports the first two as two insertions and says the interface matches
  exactly.
- **`gradient`** — this document first predicted "byte-identical except for one name"
  (`_av0` vs `pos`). That was measured against a port that **inlined** the fragment body into
  its `return`. The faithful twin keeps the original's two named intermediates, and there the
  prediction does not hold: an EDSL `const` is a build-time JavaScript binding that vanishes,
  while a source-language `const` is a shader `let` that emits. Same program, two more
  statements. Worth knowing before writing the next twin — a twin that mirrors the original's
  **source** will not generally mirror its **emit**.

### The third difference was a bug, not an artifact — and it is fixed

The structural golden used to show every binding read as `constref` on the twin against
`varref` on the original: [#14](https://github.com/typeshade/typeshade/issues/14), sitting in
the committed output. This PR lowers a binding read to `varref`, the same shape the EDSL
builds, so that row is gone from the golden rather than described here. What remains in the
`compute-reduction-twin` diff is the two optimizer artifacts above and nothing else.

## Appendix: the probes

Reproduce any row with a file and one command:

```sh
bun -e 'import {compileTsSource} from "./src/index.ts";
        console.log(compileTsSource(require("fs").readFileSync(process.argv[1],"utf8")).diagnostics)' probe.shade.ts
```

| Probe                                                                                                           | Result                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `vec3(1.,.5,.25) * 0.5`                                                                                         | ✓ since [#19](https://github.com/typeshade/typeshade/pull/19); emits `(… * 0.5)`, the EDSL's own text   |
| `0.5 * p.xyz`                                                                                                   | ✓ since #19, operand order kept as written                                                              |
| `c *= 0.5` (c: vec3)                                                                                            | ✓ since #19                                                                                             |
| `a * b` (both vec3)                                                                                             | ✓                                                                                                       |
| `f64(p.x)`                                                                                                      | ✗ `Unknown function "f64(p.x)"` — `SCALAR_CAST` holds only f32/i32/u32                                  |
| `u.cx * u.cx` (f64 uniform field)                                                                               | ✓ — f64 **arithmetic** works; only the cast and the literal are missing                                 |
| `u.cx * 2.`                                                                                                     | ✗ `Type mismatch: cannot * f64 and f32. Types must match.` — #19 reworded this; f64 is a different item |
| `let zx: f64 = 0.`                                                                                              | ✗ `cannot let/const zx f64 and f32`                                                                     |
| `u.c.x` where `c: vec2<f64>`                                                                                    | ✗ `.x on vec2<f64> — swizzle requires vec2/vec3/vec4`                                                   |
| `vec2f64(u.c)`                                                                                                  | ✓ — the constructor exists, the component read does not                                                 |
| `fwidth(p.x)` / `dpdx(p.x)` / `dpdy(p.x)`                                                                       | ✗ `Unknown function`                                                                                    |
| `exp2(x)` / `saturate(x)` / `select(a,b,c)`                                                                     | ✗ `Unknown function`                                                                                    |
| `sign` `round` `trunc` `ceil` `degrees` `radians` `inverseSqrt`                                                 | ✓                                                                                                       |
| `mod` `atan2` `distance` `normalize` `cross` `dot` `length`                                                     | ✓                                                                                                       |
| `c ? 1. : 0.`                                                                                                   | ✓ — and it lowers to `select(...)`, so it is the spelling for the EDSL's `.select()`                    |
| `discard`                                                                                                       | ✗ `Unsupported expression statement "discard"` — in an entry and in a helper alike                      |
| `declare const tex: texture_2d<f32>` / `sampler`                                                                | ✗ `TS8099 declare "tex" must be uniform<T> or storage<T>`                                               |
| `declare const quality: override<f32>`                                                                          | ✗ same TS8099                                                                                           |
| `for (…; f32(i) < u.n; i++)`                                                                                    | ✗ `for exit must compare "i" to a constant bound`                                                       |
| `for (let i: u32 = 0; i < WINDOW; i++)` with `const WINDOW: u32 = 8`                                            | ✓ — a module const **is** a constant bound                                                              |
| `for (let j: i32 = -1; j <= 1; j++)`, 256-trip loops, nested, `break`, `while`                                  | ✓                                                                                                       |
| `vec2i(1, 2)`                                                                                                   | ✗ `Vector constructor element type mismatch: expected i32`                                              |
| `vec3(0.5)` splat, `vec4(v3, 1.)`, `vec4(v2, 0., 1.)`, `p.rgb`                                                  | ✓                                                                                                       |
| `vec3f(v)`, `vec3u(v)`, `vec2(gid.xy)` (element-converting)                                                     | ✓ since #8 A8                                                                                           |
| `f32(vi & 1) * 4. - 1.` (the fullscreen-triangle vertex stage)                                                  | ✓                                                                                                       |
| `1u`                                                                                                            | ✗ TS parse error — `"const u" requires an initializer`                                                  |
| `type Camera = { view: mat4; pos: vec3 }`                                                                       | ✗ `Unknown field "pos" on struct:Camera`                                                                |
| `class Camera { @align(16) view: mat4 }`                                                                        | ✗ `TS8010 @align on a field is not applied`                                                             |
| `m: mat3`                                                                                                       | ✗ `Unknown type "mat3"`                                                                                 |
| `arrayLength(src)`                                                                                              | ✗ `Unknown function`                                                                                    |
| `let x: f32;` then `x = 1.`                                                                                     | ✗ `"let x" requires an initializer`                                                                     |
| `v.x = 1.`                                                                                                      | ✗ `Assignment target must be a simple identifier`                                                       |
| `dst[gid.x] = 1.` / `dst[gid.x] += 2.`                                                                          | ✓                                                                                                       |
| `declare const params: uniform<vec4u>` (non-struct uniform)                                                     | ✓                                                                                                       |
| `@compute([8, 8, 1])`, a struct return by object literal, a helper returning a struct, a helper taking a struct | ✓                                                                                                       |

The command above prints diagnostics, so it measures acceptance and nothing else. One row
carries a claim it cannot show: the element-converting constructor also changed what the CPU
oracle **computes** — it used to pass the source components through unchanged, so
`vec3u(vec3(1.7, 2.9, -3.2))` evaluated to `[1.7, 2.9, -3.2]` where WGSL gives `[1, 2, 0]`.
That is asserted in `src/core/vec-convert.test.ts`, across both CPU backends, not by the
probe.
