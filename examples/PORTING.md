# Porting the examples to `"use typeshade"`

Step 1 of the example port: a **classification**, not a port. First measured on `main`
`b6d6c56`; the rows have been re-measured since, most recently on this branch with A1 (#19)
and the #14 fix in place. Where a row's verdict changed, the correction note below says so.

> **Corrected four times.** This document was written before five changes that invalidate
> much of it, and the rows have been updated for all five. (1) **A1** — vector × scalar
> broadcast — landed in [#19](https://github.com/typeshade/typeshade/pull/19), so the single
> largest blocker below is gone. (2) [#13](https://github.com/typeshade/typeshade/issues/13)
> and [#14](https://github.com/typeshade/typeshade/issues/14), the two backend bugs writing
> the first twins uncovered, are fixed in
> [#17](https://github.com/typeshade/typeshade/pull/17) and
> [#18](https://github.com/typeshade/typeshade/pull/18). (3) Writing out the remaining twelve
> twins ([#42](https://github.com/typeshade/typeshade/pull/42)) cost three more rows their
> **portable** verdict — [#38](https://github.com/typeshade/typeshade/issues/38) and
> [#40](https://github.com/typeshade/typeshade/issues/40) — so the headline figure was **11 of
> 36**, not the 14 this document measured. (4) The **`f64` surface** (§39 of
> `docs/use-typeshade-surface.md`, [#166] closing [#151]) landed **N1** and **N2**, the two
> blockers no issue #8 item covered, and eleven of the thirteen `fp64-*` examples became twins
> in one change: the headline figure is **24 of 36**. Since then #40 was fixed and
> `voronoi-twin` landed as its gate in [#168](https://github.com/typeshade/typeshade/pull/168), which makes it **25 of 36**.
>
> What has **not** changed is the lesson those five taught, and #40 sharpened it: everything
> here measures whether the compiler **accepts the source**, which is not the same as whether
> the **output is correct** — and `voronoi-twin` shows that passing every gate in this
> repository is not the same either. See
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
rejection it was assumed to be — see the hazards entry below, which records how it was
fixed.

The classification is then "does every feature this example demands have a probe that
passes". For seven examples the whole shader was additionally written out as a `.shade.ts`
file and compiled, so their verdict rests on a compiler run rather than on a feature list —
see [Verified, not inferred](#verified-not-inferred).

## The table

`Blocks (total)` is how many of the 36 examples the row's **first-listed** blocker stops.
It is the prioritisation signal: a row blocked by something that blocks 28 examples is not
waiting on its own feature, it is waiting on the corpus-wide one.

| #   | Example               | Category     | Now          | Blocked by     | Blocks (total) |
| --- | --------------------- | ------------ | ------------ | -------------- | -------------- |
| 1   | `graticule`           | cartographic | blocked      | **A6-deriv**   | 4 / 36         |
| 2   | `hillshade`           | cartographic | **portable** | —              | —              |
| 3   | `fp64-deep-zoom`      | cartographic | **portable** | —              | —              |
| 4   | `fp64-checker-plane`  | cartographic | **portable** | —              | —              |
| 5   | `fp64-loran`          | cartographic | **portable** | —              | —              |
| 6   | `fp64-mercator-tiles` | cartographic | blocked      | **L-loop**     | 4 / 36         |
| 7   | `fp64-rtc`            | cartographic | **portable** | —              | —              |
| 8   | `color-ramp`          | cartographic | blocked      | **A6-deriv**   | 4 / 36         |
| 9   | `discard-cutout`      | generic      | blocked      | **A6-discard** | 1 / 36         |
| 10  | `plasma`              | generic      | **portable** | —              | —              |
| 11  | `voronoi`             | generic      | **portable** | —              | —              |
| 12  | `julia`               | generic      | **portable** | —              | —              |
| 13  | `mandelbrot`          | generic      | **portable** | —              | —              |
| 14  | `fbm-clouds`          | generic      | blocked      | **L-loop**     | 4 / 36         |
| 15  | `domain-warp`         | generic      | **portable** | —              | —              |
| 16  | `raymarch-sphere`     | generic      | blocked      | **B-scope**    | 2 / 36         |
| 17  | `raymarch-boxes`      | generic      | blocked      | **B-scope**    | 2 / 36         |
| 18  | `tunnel`              | generic      | **portable** | —              | —              |
| 19  | `metaballs`           | generic      | blocked      | **L-loop**     | 4 / 36         |
| 20  | `ocean`               | generic      | **portable** | —              | —              |
| 21  | `starfield`           | generic      | **portable** | —              | —              |
| 22  | `truchet`             | generic      | blocked      | **A6-deriv**   | 4 / 36         |
| 23  | `kaleidoscope`        | generic      | **portable** | —              | —              |
| 24  | `heart`               | generic      | blocked      | **A6-deriv**   | 4 / 36         |
| 25  | `fp64-mandelbrot`     | generic      | blocked      | **L-loop**     | 4 / 36         |
| 26  | `fp64-julia`          | generic      | **portable** | —              | —              |
| 27  | `fp64-burning-ship`   | generic      | **portable** | —              | —              |
| 28  | `fp64-newton`         | generic      | **portable** | —              | —              |
| 29  | `fp64-mandelbrot-de`  | generic      | **portable** | —              | —              |
| 30  | `fp64-clock`          | generic      | **portable** | —              | —              |
| 31  | `fp64-cancellation`   | generic      | **portable** | —              | —              |
| 32  | `fp64-sine-sweep`     | generic      | **portable** | —              | —              |
| 33  | `gradient`            | generic      | **portable** | —              | —              |
| 34  | `override-quality`    | generic      | **portable** | —              | —              |
| 35  | `texture-array-lod`   | generic      | **portable** | —              | —              |
| 36  | `compute-reduction`   | compute      | **portable** | —              | —              |

**Portable today: 25 of 36.** That is the 13 this document last measured plus the eleven
`fp64-*` rows the `f64` surface opened, plus `voronoi`, whose twin landed in [#168](https://github.com/typeshade/typeshade/pull/168) once
#40 was fixed. The 13 were the eleven twins that had shipped, plus
`override-quality`, whose source form compiles with `override<T>` (A7), plus
`texture-array-lod`, whose `vec2i(0, 0)` was the last thing holding it after A7 (A3). The
eleven are every `fp64-*` example except `fp64-mercator-tiles` and `fp64-mandelbrot`:
[#166](https://github.com/typeshade/typeshade/pull/166), closing
[#151](https://github.com/typeshade/typeshade/issues/151), landed §39 of
`docs/use-typeshade-surface.md` and with it **N1** (a component read on a `vec2<f64>`) and
**N2** (an f64 literal), the two blockers no issue #8 item covered.

Those eleven are not a feature-list verdict. Each one is written out, compiled, gated and
measured: `reflect()` deep-equals its original's, the two goldens bake, Tint and a real WebGL2
context accept both emits, and the CPU oracle agrees with the original at |Δ| = 0 on the
double row AND on the emulated row over all 101 samples (`examples/fp64-twins.test.ts`). The
two rows that did not move are held by **L-loop** alone, and for the same reason in both: the
loop bound is a uniform the user turns, a zoom level in `fp64-mercator-tiles` and an iteration
budget in `fp64-mandelbrot`, where §17 required a counted `for` over a constant bound. #203
lifted that: a `for` may now count to a uniform, so **L-loop** no longer holds either row.

The earlier figures were 14, up from 2 once
[#19](https://github.com/typeshade/typeshade/pull/19) landed A1 and removed the single largest
blocker, and then 13 once all twelve unwritten twins were written out. Three of those did not
compile: rows 16 and 17 above still carry **B-scope**, and the third, `voronoi`, was held by
**B-negint** until #40 was fixed. Twenty-three twins have shipped: `compute-reduction` in
[#16](https://github.com/typeshade/typeshade/pull/16), `gradient` once
[#14](https://github.com/typeshade/typeshade/issues/14), fixed in
[#18](https://github.com/typeshade/typeshade/pull/18), unblocked its GLSL, nine fullscreen
twins in [#42](https://github.com/typeshade/typeshade/pull/42), the eleven fp64 twins
here, and `voronoi` in [#168](https://github.com/typeshade/typeshade/pull/168).

The three that fell out are the point, not a footnote: _accepts the source_ is not _emits a
correct shader_, and one of the three passed every gate in this repository except Tint — see
[What step 2 found](#what-step-2-found-that-this-classification-could-not).

## The blockers

| Code            | Missing feature                                                                               | Issue #8        | Blocks | Examples                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A6-f64**      | ~~the `f64()` cast~~ — **landed** (#8 A6), and with N1 and N2 the family is open              | A6, seam S1     | 0      | — (was 13: every `fp64-*`; eleven twins shipped, and the last two are L-loop)                                                                                                        |
| **N1**          | ~~component read on a `vec2<f64>` (`c.x`)~~ — **landed** (§39, [#151] in [#166])              | **not in #8**   | 0      | — (was 9: `fp64-checker-plane`, `fp64-loran`, `fp64-mercator-tiles`, `fp64-rtc`, `fp64-mandelbrot`, `fp64-julia`, `fp64-burning-ship`, `fp64-newton`, `fp64-mandelbrot-de`)          |
| **N2**          | ~~an f64 literal: `let z: f64 = 0.`, `f64Val * 2.`~~ — **landed** (§39, [#151] in [#166])     | **not in #8**   | 0      | — (was 9: `fp64-checker-plane`, `fp64-loran`, `fp64-mercator-tiles`, `fp64-mandelbrot`, `fp64-julia`, `fp64-burning-ship`, `fp64-newton`, `fp64-mandelbrot-de`, `fp64-cancellation`) |
| **A6-deriv**    | ~~`fwidth`, and `dpdx` / `dpdy`~~ — **landed** (#8 A6)                                        | A6              | 4      | `graticule`, `color-ramp`, `truchet`, `heart` (`fp64-loran` is off this list: its twin calls `fwidth` twice and compiles)                                                            |
| **L-loop**      | a loop bound that is not a compile-time constant (§17)                                        | later (M22·S31) | 4      | `fp64-mercator-tiles`, `fbm-clouds`, `metaballs`, `fp64-mandelbrot`; it is now the WHOLE of what holds the fp64 family                                                               |
| **A3**          | ~~an integer literal taking the declared type~~ — **landed** (#8 A3)                          | A3              | 0      | — (`texture-array-lod` compiles)                                                                                                                                                     |
| **A6-discard**  | ~~the `discard` statement~~ — **landed** (#8 A6)                                              | A6              | 1      | `discard-cutout`                                                                                                                                                                     |
| **A7-tex**      | ~~`texture_2d_array<f32>`, `sampler`, `textureSample*` / `textureLoad`~~ — **landed** (#8 A7) | A7              | 0      | — (`texture-array-lod` compiles)                                                                                                                                                     |
| **A7-override** | ~~`override<T>` specialization constants~~ — **landed** (#8 A7)                               | A7              | 0      | — (`override-quality` compiles)                                                                                                                                                      |
| **B-scope**     | a local name bound in two block scopes of one function ([#38])                                | **a bug**       | 2      | `raymarch-sphere`, `raymarch-boxes`                                                                                                                                                  |
| **B-negint**    | ~~a negative integer literal in a local or `for` declaration~~ — **fixed** ([#40])            | **a bug**       | 0      | — (was 1: `voronoi`; `voronoi-twin` compiles and is gated)                                                                                                                           |

The last two rows are not missing features. They are compiler defects found by writing the
twins, which is why they carry an issue number where the others carry an issue #8 item — and
why they were filed rather than worked around.

**B-scope measured again, while writing the fp64 twins.** The shape #38 names now compiles.
Two sequential `for (let i: u32 = 0; …)` loops in one function emit `i` and `i_1` with no
diagnostic on this branch, and `fp64-mandelbrot-de-twin`, whose two split-screen branches each
bind `cx`, `cy`, `zx`, `zy`, `ux` and `uy`, is registered, gated and byte-pinned. That is an
observation about the defect, not a verdict on rows 16 and 17: `raymarch-sphere` and
`raymarch-boxes` move only when their twins are written, compiled and handed to Tint and
WebGL2, which is the lesson `voronoi` taught below.

[#38]: https://github.com/typeshade/typeshade/issues/38
[#40]: https://github.com/typeshade/typeshade/issues/40
[#151]: https://github.com/typeshade/typeshade/issues/151
[#166]: https://github.com/typeshade/typeshade/pull/166

### What the corpus does **not** need

Worth stating, because these rank high in issue #8 and would be natural things to reach for
first. No example in the 36 is waiting on any of them:

| Issue #8 item                                                                                 | Blocks |
| --------------------------------------------------------------------------------------------- | ------ |
| ~~**A2** member / component assignment (`v.x = 0.`)~~ (landed)                                | 0      |
| ~~**A4** `type` / `interface` structs~~ (landed)                                              | 0      |
| **A5** `@align` / `@size` field decorators                                                    | 0      |
| ~~**A8** element-converting constructors~~ (landed)                                           | 0      |
| ~~**A9** module-level vector constants~~ (landed)                                             | 0      |
| ~~**A10** uninitialised `let`, `switch`, `<<=`~~ (landed)                                     | 0      |
| ~~**A11** object-literal contextual typing~~ (landed, in every position that declares a type) | 0      |
| **S5** `arrayLength`                                                                          | 0      |
| ~~**S7** `mat2` / `mat3`~~ (landed)                                                           | 0      |

A10 has landed even though it blocks nothing here: the 36 EDSL examples were written
through a surface that spells these differently, so the corpus could not have shown the gap.
`bitfield-bands.shade.ts` is the coverage instead: a `.shade.ts` example the compile gate
hands to Tint and to a real WebGL2 context.

A2 in particular: every `.assign()` in the corpus targets a whole value, never a component.
What reads as member assignment in the IR walk (`construct`, `lit`, `binop` targets) is the
auto-var pattern — an EDSL value node that `autoVars` later materialises into a `var` — and
it ports to a plain `let x = …; x = …`, which already compiles. No example assigns to `v.x`.
It has landed anyway (`v.x = 0.`, `o.pos = …`, `ps[i].a = 1.`, `v.x += 1.`), because it is
what a GLSL port reaches for first; it unblocks no row of the table above.
And no example uses a matrix at all, so `mat2`/`mat3` cannot be on this corpus's path.

## What it takes to unlock the corpus

Landing the features in weight order, how much of the corpus the compiler would accept.
**This counts source acceptance only.** It carried a second caveat until this PR — that #14
additionally blocked the GLSL form of all 33 renderable examples, making every row an upper
bound — and that one is now spent: a source-compiled binding reaches its stages, so a row
below that says "portable" means the GLSL form emits too. What the rows still do not claim is
that the emitted shader is CORRECT; only Tint and WebGL2 answer that.

Since the table was written, **A6-deriv**, **A6-discard** and **A6-f64** (the cast) have
landed in #8 A6, and **N1** and **N2**, which no issue item covered, landed with §39 in
[#166]. So the fp64 rows have moved: eleven of the thirteen are portable and shipped as twins,
and the remaining two are **L-loop** and nothing else.

| After landing                                 | Portable |
| --------------------------------------------- | -------- |
| (today: A1, A3, A6, A7 and §39's f64 surface) | 25 / 36  |
| + re-measuring the four **A6-deriv** rows     | 29 / 36  |
| + re-measuring the one **A6-discard** row     | 30 / 36  |
| + **L-loop**                                  | 34 / 36  |
| + **B-scope** ([#38])                         | 36 / 36  |

The rows are the ones the table above still marks blocked, in weight order, and the arithmetic
is just that table: 25 portable, 11 blocked, four of them on **A6-deriv**, one on
**A6-discard**, four on **L-loop** and two on **B-scope**. Two of those
five rows are named "re-measuring" rather than "landing" on purpose: the feature landed in #8
A6, but a row moves in this document only when its twin has been written and gated, which is
what the eleven fp64 rows in this change did and what `graticule`, `color-ramp`, `truchet`,
`heart` and `discard-cutout` have not. `override-quality` and `texture-array-lod` are the
standing exception: neither has a twin, and both moved on a compile probe alone, which is the
weaker evidence this document's own opening warns about. **L-loop** is the largest single
blocker left, at four rows, and it is the only thing between this corpus and every fp64
example being a twin.

Two things fall out of this that the issue's own ordering does not show.

**A1 was the whole first half of the corpus, and it has landed.** It blocked 28 of 36 and
twelve examples were waiting on it alone; [#19](https://github.com/typeshade/typeshade/pull/19)
turned it into one rule shared by `lowerBinary` and `lowerAssignOp`, and those twelve are the
jump from 2 portable to 14. Nothing left in the list has that weight.

**The fp64 family needed three features, not one, and it got all three.** Issue #8 listed the
`f64()` cast under A6 and stopped there. The corpus needed the cast (13), component reads on
`vec2<f64>` (9), and an f64 literal (9); landing only the cast would have left 10 of the 13
fp64 examples held up by one of the other two. §39 landed all three, and the count bears the
prediction out: eleven of the thirteen became twins in one change, and the two that did not
are blocked by something that has nothing to do with doubles.

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

Writing the twins did, and it has cost this document four of its verdicts so far — two
([#13](https://github.com/typeshade/typeshade/issues/13),
[#14](https://github.com/typeshade/typeshade/issues/14)) from the first two twins in
[#16](https://github.com/typeshade/typeshade/pull/16), two more
([#38](https://github.com/typeshade/typeshade/issues/38),
[#40](https://github.com/typeshade/typeshade/issues/40)) from writing out the remaining twelve
in [#42](https://github.com/typeshade/typeshade/pull/42). Not because the classification was
careless — because acceptance and correctness are different questions, and only one of them
was being asked.

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

### [#38](https://github.com/typeshade/typeshade/issues/38) — TypeScript block scope lowers to flat IR names

`LoweringScope` models block scope correctly for resolution — a frame stack, innermost-first —
and then lowers every binding under its source name verbatim. The IR identifies a local by
name alone within a function, so two bindings that are lexically disjoint in the source
collide, and the compile fails at emit with `SD0112`.

The shape that stopped both raymarchers is the idiomatic one: the march loop binds the ray
position `p`, and the shading block binds `p` again at the hit point. The shape a user will
hit first is worse and is not in the corpus at all —

```ts
for (let i: u32 = 0; i < 4; i++) { … }
for (let i: u32 = 0; i < 3; i++) { … }   // SD0112: fn 'fs' declares 'i' more than once
```

Two sequential loops over `i`. The `fn()` surface escapes this because `Let(value)` may omit
the name and take a function-unique `_v{n}`; TypeScript has no anonymous `const`, so the
remedy the diagnostic suggests cannot be written on this surface.

### [#40](https://github.com/typeshade/typeshade/issues/40) — a negative integer literal in a declaration

`for (let j: i32 = -1; j <= 1; j++)` — the 3x3 neighbour scan `voronoi` is built on — emits
`var j: i32 = -1.0;` with **zero diagnostics**. The sibling site fails the other way:
`let j: i32 = -1` is rejected outright, told to cast an integer it already wrote. A negative
literal is a `PrefixUnaryExpression`, so neither declaration site's `init.op === 'lit'`
coercion fires; `statement.ts` then reports a type mismatch and `control.ts`, which has no
such check, emits the float into the integer declaration.

**This is the one that matters for how this document should be read.** `voronoi-twin`
compiled without a diagnostic, its `reflect()` deep-equalled the EDSL original's, both emit
goldens baked, `bun run build` was clean and all 2444 tests passed. Every instrument in this
repository said yes. Tint and WebGL2 said:

```
wgsl: cannot convert value of type 'abstract-float' to type 'i32'
glsl: '=' : cannot convert from 'const float' to 'highp int'
```

A twin can be accepted, structurally equal to its original, byte-stable against its goldens,
and still not be a shader.

It is fixed: both declaration sites now take the negative literal, `voronoi-twin` emits
`var j: i32 = -1;`, and it is registered as the gate for #40.

### What this says about the method

An IR walk plus an acceptance probe is the right instrument for "which language features are
missing", and that part of this document stands. It is the wrong instrument for "is the twin
correct", and nothing short of emitting both sides and handing them to Tint and WebGL2
answers that.

#16 added `shade-twins.test.ts`, and this section originally claimed that gate meant "the next
twin to land cannot repeat this". #40 falsified that claim: `voronoi-twin` passed
`shade-twins.test.ts` — its `reflect()` deep-equalled the original's and both its goldens
baked — while emitting `var j: i32 = -1.0`. A golden pins whatever is emitted, right or wrong,
and structural equality against an EDSL original says nothing about whether either side is a
legal shader.

The gate that caught it is the compile one, and it is the only one in this repository that
can: an external compiler is the only participant here with no stake in the IR being right.
So the order for the next twin is fixed — write it, compile it, **then** bake. Baking first
records the bug as the expected output.

### And for an emulated double, a third leg

Tint answers "is this a legal shader". It does not answer "does it compute the right number",
and for the `f64` family that is the question the whole feature exists for: a twin whose df64
chain lowered to plausible but wrong f32 arithmetic would pass `shade-twins.test.ts`, bake its
goldens and be accepted by Tint and WebGL2 alike. So would a twin that quietly narrowed an
operand one step earlier than its original, which is the single easiest way to write a
"faithful" fp64 twin that is not one.

`examples/fp64-twins.test.ts` is that leg, and it is the same metamorphic relation
`fp64-lane-stripes.test.ts` holds one example's numeric core to
(`oracle(fp64Lower(m)) ≈ oracle(m)`), run over every registered fp64 twin at the inputs it was
ported against. Each sample is evaluated four times: the original and the twin as authored,
where an `f64` is a JavaScript double, and both again fp64-lowered under `precision: 'f32'`,
where every `f64` is the `splitF64` pair the host packs and every operation rounds the way a
GPU rounds. Twin against original is the gate, on both rows, and it measures **exactly 0** on
all 101 samples. Emulated against double is asserted only on the samples where it should hold:
these are split screens whose left half narrows first on purpose, and the CPU double row does
no `fround`, so on an f32-half sample the emulated row parts from it by design (6.04e-1 on
`fp64-checker-plane`, 1.58e+0 on `fp64-rtc`). Which samples those are is a measurement carried
in the test data, and the suite refuses a sample set that is all of one kind, so neither arm
can go quiet.

## Verified, not inferred

The table's per-example verdicts come from the IR walk. For the examples whose verdict
turns on one feature, the full example was also written as a `.shade.ts` file and compiled,
so the verdict rests on a compiler run rather than on a feature list.

"Compiles clean" is the claim being checked here, and it is a claim about the **front end**.
It is not a claim that the emitted shader is valid — see
[What step 2 found](#what-step-2-found-that-this-classification-could-not) for the two places
that distinction turned out to matter.

| Example               | Written out as                                              | Result                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gradient`            | a faithful twin                                             | compiles clean, and since [#18](https://github.com/typeshade/typeshade/pull/18) its GLSL declares the uniform block it reads                           |
| `compute-reduction`   | a faithful twin                                             | source compiles clean; shipped as a twin in [#16](https://github.com/typeshade/typeshade/pull/16)                                                      |
| `plasma`              | a faithful twin                                             | 1 error, an A1 mismatch (+1 cascade); clean once `* vec3(0.5)` is used                                                                                 |
| `tunnel`              | a faithful twin                                             | 1 error, an A1 mismatch; clean once `* vec3(…)` is used                                                                                                |
| `hillshade`           | a faithful twin                                             | 2 errors, both A1 (+10 cascade); clean once `* vec2(…)` / `* vec3(…)`                                                                                  |
| `graticule`           | twin with `fwidth(x)` → a literal                           | compiles clean — `fwidth` is genuinely the only gap                                                                                                    |
| `discard-cutout`      | twin with the `discard` removed                             | compiles clean — `discard` is genuinely the only gap                                                                                                   |
| eleven `fp64-*`       | faithful twins                                              | compile clean, reflect equal, goldens baked, Tint and WebGL2 accept both emits, oracle agrees at 0 on 101 samples                                      |
| `fp64-mercator-tiles` | a faithful twin, then a scratch scout with the bound frozen | `TS8006 for exit must compare "j" to a constant bound`; with the bound frozen the REST of the shader compiles clean, so **L-loop** is the sole blocker |
| `fp64-mandelbrot`     | a faithful twin                                             | two `TS8006`, one per escape helper, both the `iters` bound read from the uniform; nothing else in the file is refused                                 |

The cascade counts are worth noting on their own: one rejected `const` turns into ten
`Unknown identifier` diagnostics downstream. That is issue #8's A12, seen here at full size
— a two-line shader fault reported as twelve errors.

## Hazards a twin will hit that are not blockers

These do not stop a port. They will silently produce a _wrong_ twin, so step 2 has to watch
for them and the language session should weigh them accordingly.

- **`@interpolate("flat")` was accepted and dropped.** `class VsOut { @location(0) @interpolate("flat") id: u32 }`
  compiled, and the emitted WGSL was `@location(0) id: u32` with no `@interpolate`. An
  integer varying is then invalid on the GPU, and nothing before the driver said so.
  (Issue #8 A5 predicted this; confirmed here.) **Fixed** (§53,
  [#158](https://github.com/typeshade/typeshade/issues/158)): the attribute is emitted as
  written, and an integer varying gets `@interpolate(flat)` from its type without one.
- **`xs.length` on an unsized storage array emitted `0u`.** Probed: the guard
  `if (gid.x >= u32(src.length))` compiled and emitted `if ((gid.x >= 0u))` — true for every
  unsigned invocation, so the kernel returned at once and wrote nothing. Wrong output, no
  diagnostic, valid WGSL, accepted by Tint. (Issue #8 S5, filed as
  [#46](https://github.com/typeshade/typeshade/issues/46).) **It works now**: #46's second
  half reads the buffer, so `src.length` emits `arrayLength(&src)`, and `arrayLength(src)` is
  the same read. An array with no size and no buffer behind it (in a uniform, a local or a
  parameter) is still `TS8032`, which asks for a size.
- **Assignment to a parameter was accepted.** `function fs(x: f32) { x = x + 1. }` compiled.
  WGSL parameters are immutable. (Issue #8 "later", M13·S32.) **It is a diagnostic now**
  (`TS8018`), which names the local copy to write instead.
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
`<id>-twin.shade.ts` with an `@example` block whose `twinOf` names the EDSL example, bake.
The `-twin` suffix is what keeps the golden stems disjoint; `shade-examples.test.ts` asserts
that disjointness, because both corpora bake into one `__emit-goldens__/` directory.

Twenty-three twins have landed: `compute-reduction-twin` in #16, `gradient-twin` once
[#14](https://github.com/typeshade/typeshade/issues/14) was fixed, nine fullscreen twins —
`hillshade`, `plasma`, `julia`, `mandelbrot`, `domain-warp`, `tunnel`, `ocean`, `starfield`,
`kaleidoscope` — in [#42](https://github.com/typeshade/typeshade/pull/42), and eleven fp64
twins once §39 landed: `fp64-deep-zoom`, `fp64-checker-plane`, `fp64-loran`, `fp64-rtc`,
`fp64-julia`, `fp64-burning-ship`, `fp64-newton`, `fp64-mandelbrot-de`, `fp64-clock`,
`fp64-cancellation`, `fp64-sine-sweep`, and `voronoi-twin` in [#168](https://github.com/typeshade/typeshade/pull/168) as the gate for #40.
Every one is in the compile gate: WGSL through Tint,
GLSL ES 3.00 compiled and linked on a real WebGL2 context, 98 examples and 0 failures with the
eleven counted.

The two that were written and could not land are `raymarch-sphere` and `raymarch-boxes`
(`voronoi` was the third until #40 was fixed); `fp64-mercator-tiles` and `fp64-mandelbrot`
join them, each written out in full and each stopped at one line, the `for` whose bound is a
uniform. All four are absent
rather than renamed: a twin that spells the shader differently from its original to dodge a
compiler bug or a refusal is not an oracle, it is a second program that happens to compile.
Freezing `fp64-mercator-tiles`'s bound to the literal 21 was measured, in a scratch file that
is not a deliverable: the oracle then agrees exactly at zoom 21 and disagrees at every other
zoom, by up to 1.306e-1 on the double row over the ported sample set. The loop bound is a
control the user turns, so a constant there draws a different picture at eleven of the twelve
zoom levels.

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

| Probe                                                                                                           | Result                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `vec3(1.,.5,.25) * 0.5`                                                                                         | ✓ since [#19](https://github.com/typeshade/typeshade/pull/19); emits `(… * 0.5)`, the EDSL's own text |
| `0.5 * p.xyz`                                                                                                   | ✓ since #19, operand order kept as written                                                            |
| `c *= 0.5` (c: vec3)                                                                                            | ✓ since #19                                                                                           |
| `a * b` (both vec3)                                                                                             | ✓                                                                                                     |
| `f64(p.x)`                                                                                                      | ✓ since #8 A6 — the cast exists, and since §39 so does the literal                                    |
| `u.cx * u.cx` (f64 uniform field)                                                                               | ✓ — f64 **arithmetic** works, and since §39 so do the cast, the literal and the lane read             |
| `u.cx * 2.`                                                                                                     | ✓ since §39 ([#151] in [#166]): the literal beside an f64 is lifted to a full double                  |
| `let zx: f64 = 0.`                                                                                              | ✓ since §39: a literal in a declared f64 position keeps the whole double                              |
| `u.c.x` where `c: vec2<f64>`                                                                                    | ✓ since §39: `p.x`, `p.xy` and `p[1]` are lane READS, constant index, no writes                       |
| `vec2f64(u.c)`                                                                                                  | ✓ — the constructor and the component read both exist since §39                                       |
| `fwidth(p.x)` / `dpdx(p.x)` / `dpdy(p.x)`                                                                       | ✓ since #8 A6                                                                                         |
| `exp2(x)` / `saturate(x)` / `select(a,b,c)`                                                                     | ✓ since #8 A6 — plus `fma(a,b,c)`, `atan(y,x)`, `bool(i)` and `a ** b`                                |
| `sign` `round` `trunc` `ceil` `degrees` `radians` `inverseSqrt`                                                 | ✓                                                                                                     |
| `mod` `atan2` `distance` `normalize` `cross` `dot` `length`                                                     | ✓                                                                                                     |
| `c ? 1. : 0.`                                                                                                   | ✓ — and it lowers to `select(...)`, so it is the spelling for the EDSL's `.select()`                  |
| `discard`                                                                                                       | ✓ since #8 A6 — in an entry and in a helper the entry calls                                           |
| `declare const tex: texture_2d<f32>` / `sampler`                                                                | ✓ since #8 A7 — written bare, no uniform<> wrapper                                                    |
| `declare const quality: override<f32>`                                                                          | ✓ since #8 A7 — default 0 without an initializer, or `= 1.` to state one                              |
| `for (…; f32(i) < u.n; i++)`                                                                                    | ✗ `for exit must compare "i" to a bound`; `i < i32(u.n)` compiles since #203                          |
| `for (let i: u32 = 0; i < WINDOW; i++)` with `const WINDOW: u32 = 8`                                            | ✓ — a module const **is** a constant bound                                                            |
| `for (let j: i32 = -1; j <= 1; j++)`, 256-trip loops, nested, `break`, `while`                                  | ✓                                                                                                     |
| `for (let i: i32 = 64; i > 1; i /= 2)`, `i *= 2`, `i -= 1`                                                      | ✓ since #8 A15: `+=`, `-=`, `*=` and `/=` are all update forms                                        |
| `for (let i: i32 = 0; i < 1024; i++)`                                                                           | ✓ since #203; #8 A15 had said `for trip count 1024 exceeds 256.`                                      |
| `vec2i(1, 2)`                                                                                                   | ✗ `Vector constructor element type mismatch: expected i32`                                            |
| `vec2i(1, 2)`, `return 0` in a u32 fn, `g(1)`, `{ id: 0 }`, `c ? 1 : 2`, `min(i, 4)`                            | ✓ since #8 A3 (`min(i, 4)` used to emit the invalid `min(i, 4.0)`)                                    |
| `vec3(0.5)` splat, `vec4(v3, 1.)`, `vec4(v2, 0., 1.)`, `p.rgb`                                                  | ✓                                                                                                     |
| `const UP = vec3(0., 1., 0.)`, `const XS = array<f32, 3>(…)` (module vector / array const)                      | ✓ since #8 A9 — through `ConstDecl.valueExpr`, the field the EDSL's `constExpr` fills                 |
| `vec3f(v)`, `vec3u(v)`, `vec2(gid.xy)` (element-converting)                                                     | ✓ since #8 A8                                                                                         |
| `const xs: array<f32, 3> = [1., 2., 3.]` (a list as an array's initializer)                                     | ✓ since #8 A16: `array<i32, 3> = [1, 2, 3]` too, which the `array<i32, 3>(…)` call still cannot spell |
| `f32(vi & 1) * 4. - 1.` (the fullscreen-triangle vertex stage)                                                  | ✓                                                                                                     |
| `1u`                                                                                                            | ✗ TS parse error — `"const u" requires an initializer`                                                |
| `type Camera = { view: mat4; pos: vec3 }`, `interface Camera { … }`                                             | ✓ since #8 A4                                                                                         |
| `class Camera { @align(16) view: mat4 }`                                                                        | ✗ `TS8010 @align on a field is not applied`                                                           |
| ~~`m: mat3`~~                                                                                                   | ✓ since §40 — every `matCxR` is a type                                                                |
| `arrayLength(src)`                                                                                              | ✓ — the read `src.length` emits too: `arrayLength(&src)`                                              |
| `let x: f32;` then `x = 1.`                                                                                     | ✓ since #8 A10; the annotation carries the type, so it is required                                    |
| `v.x = 1.` / `o.pos = …` / `ps[i].a = 1.` / `v.x += 1.`                                                         | ✓ since #8 A2 (`v.xy = …` is still rejected, as WGSL rejects it)                                      |
| `dst[gid.x] = 1.` / `dst[gid.x] += 2.`                                                                          | ✓                                                                                                     |
| `declare const params: uniform<vec4u>` (non-struct uniform)                                                     | ✓                                                                                                     |
| `@compute([8, 8, 1])`, a struct return by object literal, a helper returning a struct, a helper taking a struct | ✓                                                                                                     |

The command above prints diagnostics, so it measures acceptance and nothing else. One row
carries a claim it cannot show: the element-converting constructor also changed what the CPU
oracle **computes** — it used to pass the source components through unchanged, so
`vec3u(vec3(1.7, 2.9, -3.2))` evaluated to `[1.7, 2.9, -3.2]` where WGSL gives `[1, 2, 0]`.
That is asserted in `src/core/vec-convert.test.ts`, across both CPU backends, not by the
probe.
