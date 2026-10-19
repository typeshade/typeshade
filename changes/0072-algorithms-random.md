---
id: '0072'
title: Two common modules written in TypeShade, `typeshade/algorithms` and `typeshade/random`, give every host the copy, fill, maps, reductions, scan, compaction and histogram over resident arrays and the generators and hashes a kernel draws from, each held to the CPU oracle on every tier
status: accepted
rules:
  - '11.20'
surface:
  - 72
  - 73
exports:
  - copy
  - fill
  - sequence
  - add
  - sub
  - mul
  - div
  - scale
  - abs
  - neg
  - sqrt
  - rsqrt
  - exp
  - log
  - expm1
  - log1p
  - floor
  - ceil
  - round
  - sign
  - sin
  - cos
  - tan
  - tanh
  - sigmoid
  - relu
  - clip
  - sum
  - max
  - min
  - sumAxis
  - meanAxis
  - prodAxis
  - maxAxis
  - minAxis
  - argMaxAxis
  - argMinAxis
  - inclusiveScan
  - exclusiveScan
  - compact
  - histogram
  - xorshift32
  - hash32
  - uniform
  - fillUniform
  - fillWords
  - generator
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: A guide page for each module, en and ko, that teaches the host face (a call over resident arrays, inside and outside `fuse`) and the device face (an import from a `"use typeshade"` file). The kernel-function copy of §65 and the `fuse` copy of §71 link to §72 and §73. The API reference is generated from the pinned compiler's source and lists the new subpaths with no hand edit. compiler-changes.md records 0072 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references gain the two modules, their two faces and the one-oracle rule, so that the assistant suggests an import before an author writes a copy, a reduction or a scan again. compiler-changes.md records 0072 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in other repositories -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0072. This file is the proposal source and the approved design of the change. It has status `accepted`.                                                                                                                                                                                                                                                                                                                          |
| Revision context            | Drafted 2026-10-19, UTC. The date is the authoring context. It is not an approval date. The owner approved the proposal on 2026-10-19 (UTC) in the project conversation. See Approval and plan record.                                                                                                                                                                                                                                    |
| Request source              | The repository owner, Seungup, in a Claude Code session of 2026-10-19. After proposal 0071 (the device owner) the owner asked which other areas TypeNN and TypeCV had each written for themselves, observed that TypeShade needs what a standard library is to C, chose two modules over one, named the first `algorithms`, asked how CUDA divides the same ground, and then said to proceed. No GitHub issue is recorded for this draft. |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                                                                                                       |
| Current lifecycle state     | `accepted`, by the owner's approval of 2026-10-19 (see Approval and plan record). The merge of PR #679 records the acceptance. No implementation exists.                                                                                                                                                                                                                                                                                  |
| Applicability / effectivity | Two new package subpaths, `typeshade/algorithms` and `typeshade/random`, each a shader package in the sense of change 0024 (shader modules under the `typeshade` export condition, host JavaScript under `default`). A new Rule 11.20 and two new surface sections, §72 and §73. The site and the editor. No release version is assigned.                                                                                                 |
| Review baseline             | `origin/main` at `454fbf0` (commit "Merge pull request #670 from typeshade/claude/impl-0051-device-limits"), read on 2026-10-19. Proposal ids 0000 to 0071 were read on `origin/main` and on every remote branch on 2026-10-19. Id 0072 was not in use on any of them. The consumers were read at typenn `61259c3`, typecv `f42f223` and radiance `3e4efb3`, each the `main` of 2026-10-19.                                               |
| Proposal review             | [PR #679](https://github.com/typeshade/typeshade/pull/679), the proposal-only pull request, opened 2026-10-19 as a draft.                                                                                                                                                                                                                                                                                                                 |
| Revision authority          | Git records the revisions of this file. The review and merge of PR #679 record the decision.                                                                                                                                                                                                                                                                                                                                              |

## What changes

TypeShade has a language, a compiler, an oracle and a runtime, and no library. Every host that
needs a copy, a fill, a map, a reduction, a scan, a compaction or a random draw writes it in its
own repository, with its own tests on its own tiers. Two hosts did (Why). This proposal adds the
library, as two modules, and one rule that every item of them obeys.

The division follows the one CUDA settled on (Why, "The precedent"): the algorithms over arrays
in one place, the random numbers in another, and the domain libraries (a neural network, a
camera pipeline, a renderer) outside both.

### The rule

**Rule 11.20 (new).** A common module is a shader package the compiler repository publishes under
a `typeshade/<name>` subpath. Every function of it is written in `"use typeshade"`. Every function
of it gives, on WebGPU, on WebGL2 and on the CPU tier, the bits the CPU oracle gives, under the
determinism report's rows (Rule 11.5), and the differential gate holds that. Every kernel function
of it satisfies the planner's facts (Rule 11.13), so that it fuses with its neighbours in a `fuse`
scope. A common module imports `typeshade/runtime` and its sibling modules, and nothing of the
compiler.

The rule has three consequences the proposal relies on. The library proves that the language can
write its own library. The oracle is the reference implementation of every item, with no second
copy in TypeScript. A host that uses the library inherits the gates, instead of writing them.

### Two faces of each module

Each module is one shader package (change 0024, Rule 3.9, surface §68). Its `exports` map
publishes the shader modules under the `typeshade` condition and the host JavaScript under
`default`, as `journeys/_shade-package/package.json` does today. One specifier therefore serves two
callers:

- **The host face.** Host TypeScript imports a kernel function or a `@compute` entry and calls it
  over `Resident` arrays (Rule 11.8), alone or inside a `fuse` body (Rule 11.13), or inside
  `device.fuse()` once proposal 0071 is implemented.
- **The device face.** A `"use typeshade"` file imports a helper and calls it inside its own
  kernel or entry, as `examples/imported-noise.shade.ts` imports `fbm`. Rule 8.6 keeps the two
  faces apart: a kernel function is not called from another function, so a device-face helper is
  an ordinary function, never a kernel function.

```ts
// The host face: a chain over resident arrays, one plan.
import { fuse } from 'typeshade/fuse';
import { exclusiveScan, compact, sumAxis } from 'typeshade/algorithms';
import { fillUniform } from 'typeshade/random';

await fuse(() => {
  fillUniform(noise, 12345);
  exclusiveScan(offsets, flags);
  compact(kept, rows, flags, offsets);
  sumAxis(rowSums, kept, columns, 1);
});
```

```ts
// The device face: a kernel draws from the common generator.
'use typeshade';
import { xorshift32, uniform } from 'typeshade/random';

export function jitter(out: array<f32>, seed: u32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = uniform(xorshift32(seed ^ i));
  }
}
```

### `typeshade/algorithms` (surface §72, new)

The first delivery is the set below. Each row names the host-face function and its contract. An
array parameter is an `array<T>` of Rule 8.23. `T` is `f32` unless the row says otherwise. Each
function writes every element of its output (Rule 8.23), so a pooled array needs no zeroing.

| Group            | Functions                                                                                                                                                                             | Contract                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy and fill    | `copy(out, x)`, `fill(out, value)`, `sequence(out, start, step)`                                                                                                                      | One loop at `i`. A kernel function.                                                                                                                                                                        |
| Binary maps      | `add`, `sub`, `mul`, `div` as `(out, a, b)`; `scale(out, x, k)`                                                                                                                       | One loop at `i`. A kernel function.                                                                                                                                                                        |
| Unary maps       | `abs`, `neg`, `sqrt`, `rsqrt`, `exp`, `log`, `expm1`, `log1p`, `floor`, `ceil`, `round`, `sign`, `sin`, `cos`, `tan`, `tanh`, `sigmoid`, `relu` as `(out, x)`; `clip(out, x, lo, hi)` | One loop at `i`. A kernel function. `expm1` and `log1p` keep a series near zero, as TypeNN's do.                                                                                                           |
| Whole reductions | `sum(x): f32`, `max(x): f32`, `min(x): f32`                                                                                                                                           | A kernel function with a result (Rule 8.22). Folded in Rule 7.2's one tree order on every tier.                                                                                                            |
| Axis reductions  | `sumAxis`, `meanAxis`, `prodAxis`, `maxAxis`, `minAxis`, `argMaxAxis`, `argMinAxis` as `(out, x, axis: u32, inner: u32)`                                                              | `x` is read as `[outer, axis, inner]`. One loop at `i` over `out`. `argMaxAxis` and `argMinAxis` write the index as `f32`, the first maximum or minimum winning a tie.                                     |
| Scan             | `inclusiveScan(out, x)`, `exclusiveScan(out, x)` over `array<u32>`                                                                                                                    | A `@compute` entry with workgroup memory and barriers (§24, §25), in two passes: a workgroup scan, then the block offsets. It joins a `fuse` scope once change 0069 is implemented, and runs apart before. |
| Compaction       | `compact(out, x, flags: array<u32>, offsets: array<u32>)`                                                                                                                             | A stable scatter of the elements whose flag is 1 to `offsets[i]`. One loop at `i`. A kernel function.                                                                                                      |
| Histogram        | `histogram(bins: array<u32>, x, lo, hi)`                                                                                                                                              | A kernel function whose loop scatters by atomics, as `examples/atomic-histogram.shade.ts` does. `bins.length` is the bin count.                                                                            |

Excluded from the first delivery, each a candidate for a later one: sort (radix), partition, a
segmented reduction, `reduceByKey`, a nearest-neighbour search, matrix products and the `f64`
linear algebra TypeCV wrote (`solve3`, `solve6`, QR, SVD). A later delivery is an amendment of
this proposal or a proposal of its own (D6).

### `typeshade/random` (surface §73, new)

| Face   | Functions                                                              | Contract                                                                                                                                              |
| ------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device | `xorshift32(state: u32): u32`                                          | One step of xorshift32 (shifts 13, 17, 5). A zero state stays zero, and the caller seeds with a non-zero word.                                        |
| Device | `hash32(x: u32): u32`                                                  | A 32-bit integer finaliser (the `lowbias32` constants), for a stateless draw from an index.                                                           |
| Device | `uniform(word: u32): f32`                                              | The 24 high bits of `word` as an `f32` in `[0, 1)`, bit for bit on every tier.                                                                        |
| Host   | `fillUniform(out, seed: u32)`, `fillWords(out: array<u32>, seed: u32)` | Kernel functions. Element `i` is `uniform(hash32(seed ^ i))`, so the result does not depend on the tier or on the dispatch shape.                     |
| Host   | `generator(seed: u32): () => number`                                   | Plain JavaScript, the same `hash32` and `uniform` over a counter, so a host-side shuffle and a device-side draw from one seed agree bit for bit (D5). |

Excluded from the first delivery: a normal distribution, a counter-based generator with a larger
state (Philox, PCG), and a permutation. Each is a later delivery (D6).

### What stays

- Nothing an author writes changes. The language, its names and its diagnostics are unchanged.
- `resident()`, `configure()`, `fuse()` and the program runtime are unchanged. The modules are
  callers of them.
- `examples/` is unchanged. An example teaches a construct. A module item is a stable export with
  a contract. `examples/workgroup-reduce.shade.ts`, `atomic-histogram.shade.ts` and
  `loop-reduction.shade.ts` are the seeds of three rows above, and stay as examples.

### What is excluded

- Workgroup-level helpers that a kernel author calls over its own `workgroup<array>` (the CUB
  block level). The first delivery's device face is scalar helpers only (D4).
- A pool, an owner or a tier choice. Those are proposal 0071's.
- A partial read of a `Resident`, and a narrow-integer array type. Those are a proposal of their
  own (area D of the owner's survey).
- A test double of WebGPU and a browser harness for consumers. Those are a proposal of their own
  (area E).

## Why

### The problem

Two hosts built on the compiler each wrote the same algorithms, and a third wrote parts of them.
Read on 2026-10-19:

| Item                  | TypeNN (`61259c3`)                                                                                             | TypeCV (`f42f223`)                                                                                                                                                      | Radiance (`3e4efb3`) |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Copy                  | `copy` in `src/kernels/map.shade.ts`, line 9                                                                   | None. Loops write what a copy would                                                                                                                                     | None                 |
| Fill, zero            | None. Uploads zeros (closed by change 0065 for `f32`)                                                          | None. Uploads a host `Float64Array` of zeros (`src/gpu/device.ts`, line 272)                                                                                            | None                 |
| Unary and binary maps | 30 maps in `map.shade.ts`, named `<op>Map`                                                                     | Inline in domain kernels                                                                                                                                                | Inline               |
| Axis reductions       | 7 in `src/kernels/reduce.shade.ts`, serial in one invocation                                                   | `blockStats`, `modelStats`, `selectBest` in `src/gpu/epipolar.shade.ts`, lines 67 to 103, a two-level tree with an argmax                                               | None                 |
| Scan and compaction   | None                                                                                                           | `scanPairRows` (64-lane Hillis-Steele), `scanPairBlocks`, `compactImagePair` in `src/gpu/pair-preparation.shade.ts`, lines 87 to 174, plus `scanPairRowsOracle`         | None                 |
| Histogram             | None                                                                                                           | None                                                                                                                                                                    | None                 |
| PRNG and hash         | `mulberry32` on the host, twice (`src/data/device-dataset.ts`, line 144; `website/src/lab/train.ts`, line 232) | `randomWord` (xorshift32) three times (`consensus.shade.ts`, line 84; `pair-models.shade.ts`, line 37; `pnp.shade.ts`, line 95); `hash` in `features.shade.ts`, line 99 | Its own sampler      |
| CPU-tier twins        | None needed, the kernels being loops                                                                           | Five `*Oracle` kernels, one per workgroup kernel the CPU tier would not run                                                                                             | None                 |
| Fusion facts          | `README.md`, lines 76 to 82, teaches F2, F3 and F5 to its own kernel authors                                   | Not written down                                                                                                                                                        | Not applicable yet   |

TypeNN names every map `<op>Map` because a kernel function named `clamp` that calls the builtin
`clamp` is a recursive call, TS8031 (`TODO.md`, "Gaps in TypeShade at commit 96dbaa9"). TypeCV
wrote `scanPairRowsOracle` because its workgroup scan did not run on the CPU tier. Each host
solved these once more, in its own way, and wrote its own tests of the result. The two
repositories pin different compiler commits (`96dbaa9f` and `212d26d2`), so a fix in the compiler
reaches neither until each moves its pin.

### Why a module of the compiler repository

- **The oracle is the reference.** Rule 13.3's method (measure a design on every target before it
  is kept) and the differential gate exist in this repository. A module here inherits them. A
  module elsewhere writes its own, as TypeCV's `*Oracle` twins and TypeNN's recorded losses show.
- **The language is proven by its library.** C's libc is written in C. Writing `scan`,
  `histogram` and `xorshift32` in `"use typeshade"` is the test that the language is enough for
  its own library, and each gap found is a proposal, not a workaround in a consumer.
- **One pin.** Thrust and CUB were separate repositories for years, and their versions drifted
  against each other until NVIDIA merged them, with libcu++, into one (CCCL, 2023). TypeNN and
  TypeCV already pin two commits. Modules of one repository move with one pin.
- **The change control is here.** `changes/`, `scripts/changes.ts`, the API-surface bake and the
  gates hold a public export to its record. A library outside has none of them yet.

### The precedent

CUDA divides the same ground in four layers: the compiler and its math intrinsics; the runtime
API; the core compute libraries, CCCL (Thrust for host-callable algorithms, CUB for the primitives
a kernel author composes, libcu++ for types and synchronisation); and the domain libraries
(cuBLAS, cuDNN, cuFFT, cuRAND, NPP). Random numbers are cuRAND, outside CCCL, with a host API that
fills arrays and a device API a kernel calls. This proposal maps to it as follows: the compiler and
WGSL's builtins are the first layer, `typeshade/runtime` with proposal 0071 the second,
`typeshade/algorithms` the host-callable part of the third, `typeshade/random` the fourth's cuRAND,
and TypeNN, TypeCV and Radiance the domain libraries. The CUB block level (the helpers a kernel
composes over its own workgroup memory) is left for a later delivery (D4).

### Alternatives

- **One module named `std`.** Rejected by the owner on 2026-10-19: the name says nothing about
  the contents, and random numbers and linear algebra are not algorithms. Two modules, each named
  for what it holds, follow the precedent.
- **A module named `kernels`.** Rejected: it names how the items run, not what the caller gets,
  and roadmap item X1 keeps GPU vocabulary out of a compute program's world.
- **Leave it to the consumers, and share by copying.** Rejected: that is the baseline, and the
  table above is its result.
- **A separate package `@typeshade/algorithms` in its own repository.** Possible later, once the
  compiler publishes to npm and the consumers pin a version rather than a tarball. Rejected for the
  first delivery for the reasons under "Why a module of the compiler repository" (D1).
- **Host-side TypeScript implementations with a GPU path.** Rejected: it doubles every item and
  breaks the one-oracle rule.

### Assumptions

- Change 0024 (a package's shader modules under the `typeshade` export condition) serves a
  subpath of the compiler's own package as it serves `shade-contour`. To be verified first in the
  implementation. If `exports` cannot carry both conditions under one subpath, the device face
  takes a sibling specifier (`typeshade/algorithms/shade`), and this record is amended.
- A kernel function named like a builtin can call that builtin through a helper in a sibling
  shader file, since each file keeps its own scope (Rule 3.9). Not measured. If it does not hold,
  the maps take the names of D2's fallback, and the front matter is amended before acceptance of
  the implementation.
- The CPU tier runs a `@compute` entry with barriers through `dispatch` in passes (surface §25,
  change 0054). Whether the host entry call of §67 does the same on the CPU tier is to be
  measured in the implementation. If it refuses, the scan's CPU path is the oracle's `dispatch`,
  and the record states it.
- Change 0069 lands before or after this proposal. Before it, `inclusiveScan`, `exclusiveScan`
  and the two-pass structure run apart from a `fuse` scope and the report says so.

## What it touches

- **Rule 11.20 (new).** The common-module rule above.
- **Surface §72 (new).** `typeshade/algorithms`: the two faces, the table, a sample with `fuse`,
  and the planner's facts each kernel function meets.
- **Surface §73 (new).** `typeshade/random`: the generators, `uniform`, the host generator's
  parity, and the seeding rule.
- **Exports.** The names of the two tables, on the two new subpaths. No export is removed or
  reshaped. The root exports none of them.
- **Package.** `package.json` gains the two subpaths in `exports`, with the `typeshade` and
  `default` conditions, and `files` ships their sources and their host JavaScript.
  `scripts/publish-manifest.ts` derives the dist manifest from the same map.
- **Gates.** `gate:differential` gains one row per function of both modules. `gate:boundary`
  gains the two host-face bundles, with a size budget set when measured.

### Draft impact estimate

- **Technical work.** Two shader packages under `src/algorithms/` and `src/random/` (or
  `packages/`, D1), each with its shader modules, its host face and its tests. The compiler's
  build compiles the host face as `tshc sync` compiles a consumer's. The planner's facts for each
  kernel function are checked by a test that fuses it with a neighbour. The entries (scan,
  histogram's atomics) are measured on Tint and on the CPU tier before they are kept (Rule 13.3).
- **Compatibility.** No existing call changes. A host that imports nothing new sees nothing new.
- **Dependencies.** Change 0024 (implemented). Change 0065 (accepted; `ZeroedState` exists at
  `454fbf0`). Change 0069 (accepted, not implemented) for a scan inside `fuse`. Proposal 0071
  (accepted, not implemented) for ownership of the arrays. Change 0051 (accepted; its
  implementation merged as PR #670 at `454fbf0`) for the limits a histogram's bin count is checked
  against. No package is added.
- **Tools.** None added.
- **Bundle.** Unknown until measured. The host face of each module is compiled JavaScript over
  `typeshade/runtime`, so it carries no compiler.
- **Validation work.** Listed below.
- **Downstream.** The site and the editor, as the front matter says. TypeNN, TypeCV and Radiance
  are consumers, not repositories `scripts/changes.ts` lists (0071's D6 is open). What each would
  retire is under "What the consumers retire".
- **Effort and date.** Unestimated. No milestone is set.

### Decisions for the owner

- **D1. Where the sources live.** In this repository, under `src/algorithms/` and `src/random/`,
  built with the compiler (the draft). The alternative is a separate repository once npm
  publication exists.
- **D2. Map names.** The builtin's name, `abs(out, x)`, with the builtin reached through a helper
  in a sibling file (the draft, to be measured). The fallback is TypeNN's `<op>Map`.
- **D3. Scan element and operator.** `u32` and addition only in the first delivery (the draft).
  The alternative adds `f32` and `i32`, and `max` and `min`, at once.
- **D4. Workgroup-level helpers.** Deferred (the draft). The alternative delivers a `scan64` and
  a `reduce64` over `workgroup<array<u32, 64>>` in the first delivery, which needs a measured
  design for passing workgroup memory to a function.
- **D5. Host generator parity.** `generator(seed)` reproduces `fillUniform` bit for bit (the
  draft). The alternative drops the host face of `random`, and TypeNN keeps `mulberry32`.
- **D6. Later deliveries.** Sort, segmented reductions, nearest neighbour, linear algebra, a
  normal distribution: each an amendment of this proposal (the draft) or a proposal of its own.

### Required validation

Functional, each a test in this repository:

- Every function of both modules compiles under `typeshade({ fuse: true })` and its module holds
  the planner's facts for each kernel function.
- `gate:differential` runs every function on WebGPU and WebGL2 against the CPU oracle, bit for
  bit under the determinism report's rows. The scan and the histogram run on WebGPU and on the
  CPU tier's `dispatch`.
- A test fuses `fill → add → relu → sumAxis` in one scope and asserts one dispatch for the first
  three calls and the reduction last, as `src/fuse.test.ts` asserts for its own kernels.
- `fillUniform(out, seed)` on each tier equals `generator(seed)` on the host, element for element.
- `compact` is stable: the order of kept elements is the input's.
- `argMaxAxis` returns the first index on a tie, on every tier.
- A `"use typeshade"` file in `journeys/_host-import/` imports `xorshift32` and `uniform` from
  `typeshade/random` by the package name, and the host imports `fillUniform` from the same
  specifier (change 0024's path).
- `gate:boundary` holds the two host-face bundles, and the implementation records their sizes.

Document validation: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` pass after the rule and surface edits. `bun run bake:api-surface`
lists the two subpaths and their exports.

### Approval and plan record

- **Decision.** The owner, Seungup, approved the proposal on 2026-10-19 (UTC) in the project
  conversation, after the survey of the consumers, the discussion of the CUDA precedent and the
  consumers' expected use, and after reading the draft as PR #679 presented it. The word of the
  decision was "승인" (approval).
- **Decisions D1 to D6.** The approval takes the draft's defaults: D1 the sources live in this
  repository and are built with the compiler, D2 a map takes its builtin's name and reaches the
  builtin through a helper in a sibling shader file, with `<op>Map` as the fallback if that does
  not hold when measured, D3 the scan is over `u32` with addition in the first delivery, D4 the
  workgroup-level helpers are deferred, D5 `generator(seed)` reproduces `fillUniform` bit for
  bit, D6 a later delivery is an amendment of this proposal.
- **Review and merge reference.** PR #679. Its merge with `status: accepted` is the agreement
  (`changes/README.md`, The lifecycle, step 2). The commit that contains this record is known to
  Git, not to this file.
- **Approved revision and scope.** The text of this file at the merge of PR #679: "What changes"
  with its two tables, "What stays" and "What is excluded". The front matter is the declared
  scope. The three assumptions under "Why" are to be verified first in the implementation, and a
  failed one amends this record before the implementation is accepted as delivered.
- **Responsibilities.** The implementation is not assigned. No milestone or date is agreed. No
  duration or cost estimate is established.
- **Required validation.** The functional and document validation listed under "Required
  validation" is required at implementation. Change 0069 gates the scan's place inside a `fuse`
  scope, and proposal 0071 gates the ownership of the arrays. Neither gates the first delivery of
  the kernel functions.

### Configuration and validation record

This record does not yet apply. Delivery will require: the accepted revision, the implementing
pull requests with their `Change: 0072` lines, the delivered configuration (commit, bun and
TypeScript versions), the observed results of each test above, the measured bundle sizes, and the
disposition of each deviation from the approved text.

## What it owes downstream

- **typeshade.github.io.** A guide page for each module, en and ko, that teaches the host face and
  the device face. The kernel-function copy of §65 and the `fuse` copy of §71 link to §72 and §73.
  The API reference is generated from the pinned compiler's source and lists the new subpaths with
  no hand edit. `compiler-changes.md` records 0072 when the pin moves.
- **vscode-typeshade.** The skill's references gain the two modules, their two faces and the
  one-oracle rule. `compiler-changes.md` records 0072 when the pin moves.

### What the consumers retire

The consumers are not declared downstream repositories. This list is the expected work, read at
the commits in Review baseline, for their owners. It is not an obligation of this record.

- **TypeNN** (`61259c3`). `src/kernels/map.shade.ts` and `reduce.shade.ts` are replaced by imports
  from `typeshade/algorithms`; `src/tensor/operations/reductions.ts` and `elementwise.ts` keep the
  shape arithmetic and bind the imported functions. `distinct()` in `src/runtime/execute.ts`
  imports `copy`. The two `mulberry32` copies become `generator(seed)` from `typeshade/random`.
  `README.md`, lines 76 to 82, no longer teaches F2, F3 and F5 to kernel authors. `conv`, `pool`,
  `matmul`, `softmax`, `loss` and `optim` stay.
- **TypeCV** (`f42f223`). `scanPairRows`, `scanPairRowsOracle`, `scanPairBlocks` and
  `compactImagePair` in `src/gpu/pair-preparation.shade.ts` become `exclusiveScan` and `compact`,
  and `src/gpu/pair-estimation.ts`, lines 420 to 429, calls them once per tier instead of choosing
  a twin. `blockStats`, `modelStats` and `selectBest` in `epipolar.shade.ts` become an axis
  reduction and `argMaxAxis` where the tie rule allows, and keep the cost tiebreak otherwise. The
  three `randomWord` copies import `xorshift32`. `src/gpu/numerics.shade.ts` (`solve3`, `solve6`),
  `projective.shade.ts` and the SVD sweeps stay until D6 delivers linear algebra.
- **Radiance** (`3e4efb3`). Nothing retires in the first delivery. Its plan's radix sort for the
  GPU BVH build (`docs/plan.md`, §9) is a D6 candidate.
