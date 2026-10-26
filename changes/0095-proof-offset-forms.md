---
id: '0095'
title: A kernel function's loop writes an array at a base it does not change plus a record of its own iteration, `b + w*i + o` with every offset below the stride, and the call checks the stride and the offsets as it checks `a*i + c`
status: draft
rules:
  - '8.21'
  - '8.22'
surface:
  - 65
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Describe R3's record form and the call's new checks on the kernel-function page, update the R3 remedy of TS8070 in the error-code data, in both locales, and record 0095 when the pin moves.
  - repo: vscode-typeshade
    what: Update the skill text and any fixture that quotes the R3 remedy "Write at an index made from", describe the record form in the kernel-function reference, and record 0095 when the pin moves.
  - repo: typecv
    what: Decide in phase 10 step "C6 and C7" of docs/library-structure.md which per-level maps, nested records and records convert as written, correct the C6 attribution of the maps whose writes R3 accepts today, renew the probes P9b, P20c, P20d and P30b, and record 0095 when the pin moves.
---

<!-- doc-refs: skip-file — this draft names files of the TypeCV repository, which this tree does not have, and tests that a later implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0095`, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Date and attribution          | Written on 2026-10-26, UTC. The date records authorship, not an approval. A Claude Code sub-agent (Claude Opus 5.5) drafted it at the request of the coordinating Claude Code session of TypeCV's refactoring programme. TypeCV's owner decided on 2026-10-26 to open TypeCV's request C6 as a TypeShade proposal (TypeCV `docs/library-structure.md`, section 7, item 7). Sources: that document, `docs/audits/2026-10-26-kernel-style.md`, `tests/typeshade/compiler-probes.test.mjs` and the kernels under `src/gpu/` at TypeCV `0f28d8d`, this tree, and the probes in "Why". No approval exists. |
| Applicability / Effectivity   | Rule 8.22's proof of a kernel function's loops and the call's check of the indices they write: `src/core/passes/parallel-loop.ts` (R3's index forms), `src/core/passes/kernel-lower.ts` (the checks a lowered loop carries), `src/core/host-kernel.ts` (`rangesOf`, the call's checks), `src/compiler/ts/host-face.ts` (the checks in the face) and `src/compiler/ts/kernel-loops.ts` (the text of `TS8070` for R3). The IR, the backends, the WebGL2 tier and the runtime's other paths do not change. No release version is assigned.                                                               |
| Review baseline               | `main` at `8150508b6ebc42fc5447924bb518766e03d52732`. The probes in "Why" ran on `fc234dbc6568bacc33349d5492a27a418c0950c9`; `8150508` adds only `changes/0093-optional-positions.md` to it. TypeCV evidence: `main` at `0f28d8d42d81316bc1f6c2060e8e873bca9c9a94`, whose compiler pin is `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc` (`package.json` line 60). `src/core/passes/parallel-loop.ts` and `src/core/passes/kernel-lower.ts` are byte-identical at the pin and at `8150508`.                                                                                                               |
| Review and revision authority | [PR #772](https://github.com/typeshade/typeshade/pull/772), opened on 2026-10-26, UTC, is the review record. Git records the revisions. The review and merge of PR #772 will record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                    |

## What changes

**Proposal.** R3 of Rule 8.22 accepts one more form of write to an outer array: a **record**, at
`b + w*i + o`. The base `b` is an expression the loop does not change. The stride `w` is one
nonzero value for every write to that array. Each write's offset `o` is a constant or a nested
loop's counter in a form whose values the proof bounds, and the offsets of all writes to the array
lie within `|w|` consecutive values. Where the stride or the offsets are values, the call checks
them before anything runs, as it checks the indices of `a*i + c` today (Rule 8.21). The `TS8070`
remedy for a write that two iterations can share names the form.

The three forms that R3 accepts for an array today are records with fixed parts, so the record form
replaces them, and every loop that R3 accepts today stays accepted.

### Before and after

| Written in a kernel function's loop                                                    | Today, at `8150508`       | With this proposal                                                         |
| -------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `out[base + i]` (P20d), `blurOut[level.outOffset + i]`, `out[view * P + i]`            | the CPU tier, `TS8070` R3 | a GPU loop: `b` is the base, `w` is 1                                      |
| `out[i * 1 + base]`                                                                    | a GPU loop, no check      | a GPU loop, checked at the call                                            |
| `out[s * i]` and `out[s * i + 1]` (P20c)                                               | the CPU tier, `TS8070` R3 | a GPU loop; the call checks that `s` is 2 or more                          |
| `g[2 * (o + k)]` and `g[2 * (o + k) + 1]`                                              | the CPU tier, `TS8070` R3 | a GPU loop: `b` is `2 * o`, `w` is 2                                       |
| `out[(i * slots + s) * 4 + c]` over `s < slots` (P9b)                                  | the CPU tier, `TS8070` R3 | a GPU loop: `w` is `slots * 4`, the offset `s * 4 + c`                     |
| `out[i * 23 + k]` over `k < 23`, and `out[i * 23 + 3 + row * 3]` over `row < 2` (P30b) | the CPU tier, `TS8070` R3 | a GPU loop: `w` is 23, the offsets lie in 0 to 22                          |
| `out[n - 1 - i]`                                                                       | the CPU tier, `TS8070` R3 | a GPU loop: `b` is `n - 1`, `w` is -1                                      |
| `out[stride * i]` with `stride` 0 at the call                                          | runs, unchecked           | refused by the call: "written at a stride of 0"                            |
| `out[i * w + x]` over `x < w`, with `out` shorter than `n * w`                         | runs, unchecked           | refused by the call: "holds … elements, and loop 1 writes it at indices …" |
| `out[idx[i]]`, `out[k * 2 + written]` with `written` a variable of the iteration       | the CPU tier, `TS8070` R3 | the same, with a remedy that names the record form                         |

### 1. The record form of R3

A write to an outer array is a record write when the proof reads its index, through casts and the
constants the index names (as it reads one today), as `b + w*i + o`:

- **The base `b`** reads neither the counter `i` nor a name that the loop's body declares. It is the
  same at every write to the array. It may be 0, a constant, a scalar parameter, a field of a struct
  parameter, or an expression of those: `level.outOffset`, `view * P`, `n - 1`.
- **The stride `w`** is the coefficient of `i`. It reads no name that the loop's body declares, and
  it is the same at every write to the array. It is a nonzero constant, or a value that the call
  knows: a scalar parameter, an array's `.length`, or an expression of those.
- **The offset `o`** of each write is one of these:
  1. a constant;
  2. a nested loop's counter that runs from 0 by 1 below `w` (the form `i*W + x` of today);
  3. `x * k + o'`, with `x` a nested loop's counter that runs from 0 by 1 below `s`, `o'` an offset
     of this list below `k`, and `w` equal to `s * k` as the proof reads them (a nested record:
     `(i * s + x) * k + c` reads as `w = s * k` and `o = x * k + c`);
  4. a sum of constants and nested loops' counters times constants, each counter with a constant
     bound (`3 + row * 3` over `row < 2` lies in 3 to 6).
- **The span.** The offsets of every write to the array lie in `|w|` consecutive values: the
  greatest offset less the least is less than `|w|`. The proof shows the span where the stride and
  the bounds are constants. The call checks it where one of them is a value (part 2).

**Why no two iterations share an element.** Two iterations `i` and `i'` write at indices that differ
by `w*(i − i') + (o − o')`. The first term is at least `|w|` in magnitude, and the second is less
than `|w|`, since both offsets lie in one window of `|w|` values. So the difference is never 0. The
writes of one iteration may overlap: one invocation runs them in program order. P30b's record writes
23 zeros, then words 3 and 6 again. **Inference.** The GPU then gives the words of the CPU tier.

**The forms of today are records.** `a*i + c` is `b = 0`, `w = a` and the offsets `c` (one `c`
outside `[0, |a|)` becomes the base). `i*W + x` over `x < W` is offset form 2. One index whose
coefficient of `i` is loop-invariant is a record of offset 0. So R3's three clauses for an outer
array become one, and a loop that R3 accepts today is accepted with the same facts for the planner
(Rule 11.13, F3).

**What the proof needs.** No solver: each step is a rule a reader applies by hand (Rule 8.22,
Rationale).

- The index is expanded into a sum of terms, each a coefficient times `i`, times a nested counter
  or times 1. A product is distributed over a sum, one level for each product: `2 * (o + k)` gives
  `2*o + 2*k`, and `(i * s + x) * 4` gives `4*s*i + 4*x`.
- The coefficient of `i` is the stride. The terms that are neither constant nor a counter's are the
  base. The rest, constants and counters' terms, are the offset.
- The offset's values come from the nested counters' ranges: a constant bound gives an interval of
  constants, and forms 2 and 3 give the bound `w − 1` by their shape.
- An index with `i` in a product with a nested counter or with itself, under `%`, `/` or a call, or
  read from an array, is no record. It keeps today's refusal. The texel form, `vec2(i % W, i / W)`,
  stays the one texture form (change 0077).

### 2. The call's checks

**Fact.** Rule 8.21: "before anything runs, the call checks each array against the indices a loop
writes at `a*i + c` and refuses one too short with a `TypeError` naming the function, the parameter
and both numbers". `lowerKernel` fills the face's `checks` from the `a*i + c` writes only, and
`rangesOf` in `src/core/host-kernel.ts` reads nothing else.

**Proposal.** For each array that a loop writes in the record form, the lowering writes CPU-tier
functions that give its `b`, its `w` and the bounds of its offsets that are values, as it writes a
loop's range function and a texture's row width today. Before anything runs, the call evaluates
them and refuses the call with a `TypeError` that names the function, the parameter and the numbers:

| Refusal                                    | Text (proposed)                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| a stride of 0                              | `f(): parameter "out" is written at a stride of 0 in loop 1, so every iteration writes one element.`                   |
| offsets whose span reaches the stride      | `f(): parameter "out" is written in loop 1 at a stride of 1 with offsets 0 to 1, so two iterations write one element.` |
| an index outside the array (today's words) | `f(): parameter "out" holds 10 elements, and loop 1 writes it at indices 4 to 27.`                                     |

An `a*i + c` write keeps its check and its text. A write of the `scaled` and `row-major` forms of
today gains the bounds check, and a `scaled` write the check of its stride. The proof's own comment
promises that check today: "At one index whose coefficient of `i` is loop-invariant, which the call
checks is not 0" (`LoopWrite` in `src/core/passes/parallel-loop.ts`). Decision D2.

A loop whose trip count the device holds (proposal 0094, draft) keeps the checks of the stride and
the span, which do not depend on the trip count. It drops a write past an array's end instead of the
bounds check, as 0094's decision D2 proposes.

### 3. The text of `TS8070` for R3

**Fact.** The remedy for a write that two iterations can share is "Write at an index made from
"i"." (`indexRemedy` in `src/compiler/ts/kernel-loops.ts`). The probes below show it for
`out[base + i]`, `out[view * P + i]` and `g[2 * (o + k)]`, which are made from `i`, and for
`features[out * 4]`, whose `out` is made from `t`. It names no form that R3 accepts.

**Proposal.** The first sentence keeps naming the line and the access in the author's words, and
the second names the record form and, where the proof knows it, the part that fails (Rule 12.1: two
sentences). The texts below are proposals; the implementation fixes them in both halves (Rule 12.5):

| What the proof finds                                   | Second sentence                                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| an index read from an array, or a variable of the body | `Write at b + w * i + c, with one base b and one stride w for every write to "out" and each offset c below w.` |
| offsets that reach the next iteration's record         | `Keep every offset of "out" below its stride 4, as in out[i * 4 + 3].`                                         |
| two strides                                            | `Write every element of "out" at one stride; line 6 writes it at "t * i".`                                     |
| two bases                                              | `Write every element of "out" from one base; line 6 writes it from "b2".`                                      |

The first sentence keeps its words: `This loop runs on the CPU because line 4 writes
"out[idx[i]]", an element two iterations can share.` No code is added.

### Exclusions

- No change to reads: R4 still reads a written array only at an index the loop writes.
- No change to fusion: a record write is not at exactly `i`, so F3 keeps such a call apart, as it
  keeps `out[2 * i]` apart today (surface §71).
- No new WebGL2 loop. WebGL2 takes a loop that writes one array at exactly `i` (Rule 11.8), and
  `b + i` stays a CPU-tier loop there (decision D5).
- No permutation, no data-dependent index, and no index that reads a variable the iteration
  changes. `knnMean[visitOrder[lane]]` and `orientFlags[k * 2 + written]` stay refused.
- No layout annotation, and no solver.

## Why

### TypeCV's evidence

**Fact** (TypeCV `docs/library-structure.md` at `0f28d8d`, section 6, row C6). The limit: "the proof
refuses `out[base + i]` with a loop-invariant `base`, several fields at a runtime stride, a nested
affine record and two record forms in one loop (rule R3 of 8.22)". The effect: "several maps cannot
convert as written". The request: "accept an injective offset, offsets `c < s` checked at the call
as `a·i + c` is, and nested affine records". The row is an "enabler", with no line count. Section 5,
phase 10, lists "C6 and C7: the loop-heavy maps (SIFT orient and describe, the global descriptor,
the scalar matchers, k-NN) and the entries that phase 9 left" with the gate "phase 9's gate plus a
hardware run". Section 7, item 7 opens C6 as a proposal.

**Fact** (TypeCV `docs/audits/2026-10-26-kernel-style.md` at `0f28d8d`). Section 6, rank 6 (G-E):
"R3 refuses `out[base + i]` with a loop-invariant `base`, several fields at a runtime stride
`s * i + c`, a nested record `(i * S + s) * K + c`, and two record forms in one loop (P9b, P20,
P30)". Section 3: SIFT's "`blurOut[outOffset + i]` needs a shifted range, P20; `siftOrient`'s
`k * 2 + written` and `siftDescribe`'s `return` need a rewrite";
"`selectTileCorners` refused (R3) without a rewrite"; inverse depth "convertible: `array<S>` in
and out (P30) lets the runtime pack".

**Fact** (TypeCV `tests/typeshade/compiler-probes.test.mjs` and `compiler-probes.sources.mjs` at
`0f28d8d`, #243, holding the verdicts of the pin). P9b, P20c, P20d and P30b: the CPU tier with
`TS8070` R3. P16 (`out[i * 4 + k]`) and P20b (one write at `out[stride * i]`): GPU loops. Each C6
probe's signal says that the maps that need its form "may convert in phase 10 step "C6 and C7" once
C7 is closed too".

**Fact** (the kernels under TypeCV `src/gpu/` at `0f28d8d`, read for this draft). The record forms
appear in these writes:

| Form                                      | Writes                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a base the loop does not change, plus `i` | `blurOut[level.outOffset + i]` (`siftBlurH`, `siftBlurV`); `pyr[lv.offset + i]` and `scores[lv.offset + i]` (`orb.shade.ts`); `kltPyramid[kltLevel.offset + k]` (`klt.shade.ts`); `undistortOutput[undistortControl.view * P + i]`, `mvsDepth[r * P + i]` and `mvsGeoDepth[mvsControl.state * P + i]` (`mvs.shade.ts`); `flags[count + h]` (`triangulation.shade.ts`) |
| a base and two fields at stride 2         | `kltGradOut[2 * (o + k)]` and `kltGradOut[2 * (o + k) + 1]` (`klt.shade.ts`)                                                                                                                                                                                                                                                                                          |
| a nested record                           | `features[out * 4 + c]` with `out = selectedTile * featureControl.slotsPerTile + slot` (`selectTileCorners`, which also writes `scores[bestIndex] = -1`)                                                                                                                                                                                                              |
| two record forms                          | the 23-word record of `linearizeInverseDepth`: `out + k` over `k < 23`, `out + c`, `out + 3 + row * 3` over `row < 2`, and `at + c` with `at = out + 9 + row * 6`                                                                                                                                                                                                     |
| several fields at a runtime stride        | none found: a search of the 30 kernel files for a write at `name * name + c` found only MVS's `view * P + i` forms above and the symmetric fill of `cacheBundleSchurRows` (`joint-focal.shade.ts`), whose transposed write `schur[column * m + row]` no record form covers                                                                                            |

**Fact** (the same reading, with the probes of their shapes below). The writes of several maps that
phase 10 lists under "C6 and C7" are forms that R3 accepts today: `descriptors[k * 128 + j]`
(`siftDescribe`), `nearestIndices[query * 3 + c]` and `nearestDistances[query * 2 + c]` (the
scalar float matchers), `matches[i * 3 + c]` (`matchBrief`), `globalWords[i]` (the global
descriptor) and `planarPlanes[t * WORDS + c]` with `WORDS` 14 (`planarFit`). **Inference.** Those
maps wait for C7 and, for `siftDescribe`, for its `return` written as `continue` (R2), not for this
proposal. `knnMean[visitOrder[lane]]` (`knnMeanDistance`) and `orientFlags[k * 2 + written]`
(`siftOrient`) are forms that no record covers. `candidates[row * 8 + c]` with `row` from a device
count is a compaction (proposal 0094).

**Fact** (TypeCV `docs/design-rules.md` at `0f28d8d`, Rule 3.3). What TypeShade cannot do yet
becomes a proposal in TypeShade's `changes/`, not a workaround inside TypeCV.

### What R3 accepts today, and why it refuses the rest

**Fact** (`distinctForm` in `src/core/passes/parallel-loop.ts`). The writes to one outer array must
all take one of three forms, the same one:

- **(b) `a*i + c`** (`affine`): `a` and `c` constants, read through casts and constant `let`s; one
  nonzero `a` at every write; one `c`, or every `c` in `[0, |a|)`.
- **(c) `i*W + x`** (`rowMajor`): `x` the counter of a nested loop from 0 by 1 below `W`, and one
  loop-invariant `W` at every write.
- **(b') one index** (`scaledCoefficient`), the same at every write: `i*k` or `i*k + j`, with `k`
  and `j` loop-invariant. The function drops the loop-invariant addend and then needs a product of
  `i` and `k`.

The four probes of row C6 fail them for these reasons:

- **P20d, `out[base + i]`.** (b) needs `base` to be a constant. (c) needs a nested counter. (b')
  drops `base` and finds `i` alone, which is no product. `out[i * 1 + base]` lowers (probe below).
- **P20c, `out[s * i]` and `out[s * i + 1]`.** (b) needs `s` to be a constant. (c) needs a nested
  counter. (b') needs one index at every write, and these are two.
- **P9b, `out[o * 4]` and `out[o * 4 + 1]` with `o = i * slots + s`.** (b) needs constants, and `s`
  is a counter. (c) needs `i*W` plus a bare counter at the top of the index, and the index is a
  product. (b') needs one index.
- **P30b, `out[i * 23 + k]` over `k < 23`, and `out[i * 23 + 3 + row * 3]` over `row < 2`.** The
  first is (c). The second is no form, since `3 + row * 3` is neither a constant nor a bare counter.
  All writes to one array must take one form.

**Fact** (probes on `fc234db`, Bun 1.4.4, `compile()` and `hostFace()` on the same source):

| Source (a kernel function's loop over `i < n`)                            | Verdict                                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `out[base + i]`                                                           | `TS8070`: "… writes "out[base + i]", an element two iterations can share. Write at an index made from "i"." |
| `blurOut[level.outOffset + i]`, with `level` a struct parameter           | `TS8070` R3, the same remedy                                                                                |
| `outv[view * P + i]`                                                      | `TS8070` R3, the same remedy                                                                                |
| `g[2 * (o + k)]` and `g[2 * (o + k) + 1]`                                 | `TS8070` R3, remedy "Write at an index made from "k"."                                                      |
| `features[out * 4 + c]`, `c` 0 to 3, `out = t * slotsPerTile + slot`      | `TS8070` R3, remedy "Write at an index made from "t"."                                                      |
| `out[i * 5]` and `out[i * 5 + 1 + k]` over `k < 4`                        | `TS8070` R3                                                                                                 |
| `out[i * w + x]` over `x < w`, and `out[i * w]`                           | `TS8070` R3                                                                                                 |
| `out[n - 1 - i]`                                                          | `TS8070` R3                                                                                                 |
| `out[7 - i]` over `i < 8`                                                 | a GPU loop; checks `a = -1`, `c = 7`                                                                        |
| `out[i * 1 + base]`; `out[stride * i]`; `out[stride * i + base]`          | GPU loops; no check                                                                                         |
| `out[i * w + x]` over `x < w`; `descriptors[k * 128 + j]` in two branches | GPU loops; no check                                                                                         |
| `out[i * 2]` and `out[i * 2 + 1]`; `matches[i * 3 + c]`                   | GPU loops; checks at `a = 2` and `a = 3`                                                                    |
| `features[t * slotsPerTile + slot]` on `array<vec4f>`                     | a GPU loop; no check                                                                                        |
| `for (let j = base; j < base + n; j++) blurOut[j] = src[j - base]`        | a GPU loop on WebGPU and WebGL2; check at `a = 1`, `c = 0`                                                  |

**Fact** (the CPU tier, measured through the generated module on `fc234db`). `strided(4, 0, xs,
out)`, which writes `out[stride * i]` at a stride of 0, runs with no refusal and leaves `[4, 0, 0,
0]`. `strided(4, 2, …)` on an array of 4 runs, and drops the writes at 4 and 6. `rows(3, 2, …)`,
which writes `out[i * w + x]`, runs on an array of 4. `pair(3, …)`, which writes `out[i * 2]` and
`out[i * 2 + 1]`, is refused: "pair(): parameter "out" holds 4 elements, and loop 1 writes it at
indices 0 to 4."

**Inference.** At a stride of 0 every iteration writes one element, so on WebGPU its value is the
write of whichever invocation wrote last, and the CPU tier keeps the last iteration's. WGSL lets an
out-of-bounds store write a location of the same buffer or not run (W3C Candidate Recommendation
Draft of 21 October 2026, §6.5.7 "Out-of-Bounds Access", read on 2026-10-26), and the CPU tier drops
it. So the GPU and the CPU tier can disagree on those two forms today. Not measured on a GPU.

### Relation to accepted proposals

- **Change 0082** (accepted) gives a read-only array of flat structs a private layout chosen from
  its field use, and adds "no new authoring syntax, layout annotation, configuration option". This
  proposal is about flat arrays that a loop writes at a stride, which 0082 does not reach, and it
  keeps 0082's choice of no annotation (alternative 2). A struct array, `out[i] = { … }`, stays the
  form for a record whose stride a type fixes (TypeCV's P30a lowers).
- **Change 0079** (implemented) makes an array method the loop it stands for. The body of a
  `forEach` is a loop body, so its writes take the record form too.
- **Change 0078** (implemented) adds R3's append form. An array that a loop pushes onto is written in
  no other form (`push-mixed`), and this proposal keeps that. A record at a row that a count gives,
  `candidates[row * 8 + c]`, is a compaction: `push` and proposal 0094 (draft).
- **Changes 0013 and 0058** (implemented) are R3's origin and the planner's fact F3. Neither changes.
- **Proposal 0094** (draft) keeps a trip count on the device; part 2 above states how its loops keep
  the stride and span checks.

### Alternatives considered

1. **Rewrite the maps by hand.** Each form has a rewrite that lowers today (probes above):
   `out[i * 1 + base]`; a shifted range, `for (let j = base; j < base + n; j++)`, which reads at
   `j − base`; `array<vec4f>` for a record of 4 words, `features[t * slotsPerTile + slot]`; a struct
   array for the inverse-depth record, which TypeCV plans after R03. **Inference.** The cost is an
   edit of each write and of its reads, and a rewrite that hides the author's index: `i * 1 + base`
   survives only while no tool simplifies it, and a shifted range moves the reads. The scaled and
   row-major forms stay unchecked. Kept as TypeCV's option until this change lands; not a reason to
   keep the refusal.
2. **A `@layout` declaration** of a record's stride and fields. No such name comes from WGSL or
   ECMAScript, so it needs a row in §9.3 (Rule 2.1, source (c)). The call would still check what it
   declares, since the proof could not rely on it. Change 0082 chose no layout annotation. Rejected.
3. **Keep the refusal.** The CPU tier runs the loop, so the program is correct (Rule 8.22). The maps
   stay entries, and the unchecked forms stay unchecked. Rejected.
4. **A solver** (an integer-linear or Presburger test of injectivity). It covers more indices, and
   its verdicts are not rules a reader applies by hand. Rule 8.22's rationale and the file comment
   of `parallel-loop.ts` ("There is no solver and no alias analysis") exclude it. Rejected.

### Unresolved decisions

- **D1. The offset forms.** The four forms of part 1 (this draft), or a general interval analysis of
  any bounded expression, with the call checking every bound that is a value.
- **D2. The checks of today's forms.** With this change (this draft), or first, as a fix of the
  defect measured above. A fix adds refusals to the call and a sentence to Rule 8.21, so it needs
  this proposal or a recorded reason (`changes/README.md`).
- **D3. The text.** A second sentence for each failure (this draft), or one remedy that names the
  record form in every case.
- **D4. A negative stride.** Accepted as `|w|` (this draft: `out[n − 1 − i]` reverses an array), or
  refused, which the step of a decreasing loop already covers.
- **D5. WebGL2.** Whether a write at `b + i` also runs on WebGL2, as a draw that starts at texel `b`.
  This draft leaves WebGL2 as it is.

## What it touches

- **Rule 8.21.** The call checks the stride, the offsets' span and the indices of every record write
  whose parts are values, and refuses with the `TypeError`s of part 2. Today's sentence names
  `a*i + c` only.
- **Rule 8.22.** R3's clauses for an outer array, `a*i + c`, one index with a loop-invariant
  coefficient, and `i*W + x`, become the record form `b + w*i + o` with its offsets and its span.
  The "Enforced by" names the tests below.
- **Surface §65.** The proof's R3 list, the paragraph "Where it runs" (the call's checks) and the
  `TS8070` table's R3 row (the remedy).
- **Code.** `src/core/passes/parallel-loop.ts` (the normal form, the record, the span),
  `src/core/passes/kernel-lower.ts` (the CPU-tier functions of the checks),
  `src/core/host-kernel.ts` (`rangesOf`), `src/compiler/ts/host-face.ts` (the checks in the face)
  and `src/compiler/ts/kernel-loops.ts` (the remedies).
- **Tests.** `src/core/passes/parallel-loop.test.ts`: every form of the "Before and after" table,
  every loop that R3 accepts today still accepted with the same planner facts, and each refusal.
  `src/compiler/ts/kernel-loops.test.ts` and `src/compiler/ts/kernel-corpus.test.ts`: each new
  `TS8070` text in `compile()` and in the language service on the same source (Rule 12.5). The CPU
  tier against the oracle, and each refusal of the call with its text
  (`src/compiler/ts/host-kernel.test.ts`). The generated differential (`scripts/gpu-differential.ts`)
  with record writes, held to the `f32` oracle bit for bit.
- **Not touched.** No export, no diagnostic code, no example, no IR node, no backend.

**Fact** (`main` at `8150508`). Accepted proposals that are not implemented also declare these items:
Rule 8.21 (0082, 0088, 0093), Rule 8.22 (0056, 0067, 0077, 0080, 0085, 0091) and §65 (0051, 0056,
0065, 0067, 0068, 0077, 0080, 0082, 0085, 0091). Proposal 0094 (draft) declares Rules 8.21 and 8.22
and §65 too. The implementation that lands second rebases on the others' text.

### Draft impact estimate

**Known.** A loop that R3 accepts today stays accepted, with the same lowering. A call that writes
in the `scaled` or `row-major` form at a stride of 0 or past an array's end is refused where it ran
before; the measured cases above show that such a call gave a result that the GPU need not give. The
`TS8070` text of R3's shared element changes, so a fixture that quotes it changes.

**Estimate.** The proof's change is the normal form and the span, of the size of `distinctForm`,
`affine`, `rowMajor` and `scaledCoefficient` today (about 150 lines of
`src/core/passes/parallel-loop.ts`). The call's checks follow the texture checks of change 0077 in
`rangesOf`. Duration and cost are unestimated.

**TypeCV.** No line count (the row is an enabler). **Inference.** The writes of the first table of
"Why" convert as written. The maps whose writes R3 accepts today gain nothing from this change.

**Decisions before acceptance:** D1 and D2. D3 to D5 may stay open.

### Approval and plan record

This record does not yet apply. Acceptance requires the merge of the proposal-only pull request
with `status: accepted`, the approved revision, the decisions taken on D1 to D5, the finalized
impact declarations, the assigned responsibilities and the required validation below. No approver,
milestone, duration or cost is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits with
`Change: 0095`; the tests above, green; `bun run gate:differential` with record writes; `bun run
gate:compile`; `bun run build`, `bun run lint`, `bun run format:check` and `bun run test`;
`bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C -e -F`, with Rules 8.21 and 8.22 reviewed. Downstream pins are
tracked apart. These are requirements, not results.

## What it owes downstream

This draft did not search the site or the editor repository. The work below is expected work; a
search of each repository for "Write at an index made from" and "two iterations can share" fixes
the list.

**typeshade.github.io.** The kernel-function page gains the record form, its offsets and the call's
new checks. The error-code data for `TS8070` gains the new remedies. In English and Korean.

**vscode-typeshade.** The skill's kernel-function reference gains the record form. A fixture or skill
text that quotes "Write at an index made from" changes.

**typecv.** Expected work, decided by TypeCV:

- The per-level maps of SIFT (blur), ORB, KLT and MVS, and the triangulation flags, may write
  `base + i` as written. `selectTileCorners` gains its nested record, and still needs a rewrite of
  `scores[bestIndex] = -1`. The inverse-depth record converts as written or as a struct array, after
  R03 (TypeCV section 4, rule 6).
- **Inference.** Section 5's phase 10 row lists SIFT orient and describe, the global descriptor, the
  scalar matchers and k-NN under "C6 and C7". By the kernels at `0f28d8d`, `siftDescribe`, the
  global descriptor and the scalar matchers write in forms R3 accepts today and wait for C7 only;
  `siftOrient` and k-NN write in forms that this proposal does not cover. The row may say so.
- The probes P9b, P20c, P20d and P30b change their verdicts when this change lands, as their
  signals state.
- Record 0095 in `compiler-changes.md` when the pin moves.
