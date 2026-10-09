---
id: '0056'
title: '`grad` differentiates in reverse mode as well as forward mode, with respect to scalars, vectors and storage arrays, and the derivative program reaches a runtime-only package through the manifest'
status: accepted
rules:
  - '7.2'
  - '8.22'
  - '11.10'
  - '11.11'
  - '11.14'
surface:
  - 38
  - 64
  - 65
  - 69
  - 71
exports:
  - grad
  - GradOptions
  - GradResult
  - gradCheck
  - GradCheckOptions
  - GradCheckResult
  - Pack
  - PackOptions
  - Program
  - TypeshadeViteOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The guide's derivative section (content/guide/ko/the-cpu-oracle.md "grad로 구하는 미분" and its English source) describes reverse mode and the gradient check; the API pages that read src/core/passes/grad.ts and the runtime's JSDoc show the new options and the Program method; the kernel-loop pages (src/lib/kernel-loops.ts, the control-flow page) say an f32 array combined with += at any index runs on the GPU in the tree order; compiler-changes.md records 0056 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (plugins/typeshade/skills/typeshade/references/host.md) and SKILL.md, which say a kernel loop that is not proved runs on the CPU with TS8070, say that an f32 scatter with += is proved now; the diagnostics reference's TS8070 row is read again; compiler-changes.md records 0056 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names exports, sections, rules and files that do not exist yet, and files in other repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0056`, `status: draft`. The front matter is the lifecycle authority. `0052` is taken by an unmerged branch (`changes/0052-target-wgsl-directive.md`, the closed pull request #502), and `0053` to `0055` are on `main`, so this draft takes `0056`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Date and attribution          | Written 2026-10-09, Asia/Seoul. The date is the authoring context, not an approval. A coding agent drafted it at the request of the typeshade/radiance session, which relayed the owner's direction: the compiler supports gradients officially, and `grad` supports forward and reverse mode. Attribution is not approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Applicability / Effectivity   | `src/core/passes/grad.ts` and a reverse-mode pass beside it, the kernel-function proof (`src/core/passes/parallel-loop.ts`), the reduction order (`src/core/kernel-tree.ts`), the oracle (`src/core/oracle.ts`, `src/core/cpu-codegen.ts`), the determinism report (`src/core/passes/determinism.ts`), the manifest and `packModule`, the program runtime (`src/runtime/`), the Vite plugin (`src/vite.ts`), the WebGL2 compute executor of change 0054. Rules 7.2, 8.22, 11.10 and 11.11 and a new rule; surface §38, §64, §65, §69 and a new §71; the site and the editor. Release version unassigned.                                                                                                                                                                                                                                                                                                                                                       |
| Review baseline               | `origin/main` at `1dd149e644db004f2259da7bd348172e1d599c65` (the merge of PR #532). typeshade/radiance read at `main` `4c94329c214a56291615edc98cc46df381f0c530`. The site read at `252f589`, the editor at `bbed90e`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Review and revision authority | [PR #534](https://github.com/typeshade/typeshade/pull/534), opened as a draft. Git records the revisions. The pull request's review and merge will record the decision. This document does not name the hash of the commit that will contain it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Amendment                     | The first amendment, with step 2's slice 2a (`f32` scatter on the CPU tier, [PR #548](https://github.com/typeshade/typeshade/pull/548)). The impact estimate said a program that compiles today computes the same. Item 3's option C does not keep that for one case: the CPU sum of a `g[idx[i]] += x[i]` loop over `f32`, at an index not shown distinct, changes from the sequential order to Rule 7.2's tree, so its last places may differ. The owner decided in conversation on 2026-10-09, Asia/Seoul (\"네\", to amending this record and not narrowing the change) that the tree order is the one answer that every tier will give, so the CPU tier takes it first and the GPU lowering follows in a later slice; a loop that reproduces the old sequential bits is not kept. Any later change that moves the last places of an existing program's result is made the same way: an amendment first. The merge of this pull request is its acceptance. |

## What changes

`grad` gains a reverse mode. A function, a kernel function (Rule 8.22) or a `@compute` entry is
differentiated with respect to many parameters at once, storage arrays among them. The forward
mode of today stays as it is, and every call that compiles today gives the same result.

| Before (measured on `main` at `1dd149e6`)                                                                                                                                            | After                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grad(m, fn, param, opts)` is forward mode only: one `f32` parameter, or one `f32` vector along one `opts.direction` (`src/core/passes/grad.ts`, `grad` and `seedFor`).              | `grad(m, fn, wrt, { mode: 'reverse' })` returns the derivative of the result with respect to every name in `wrt` in one evaluation. `mode: 'forward'` is the default, so today's calls do not change. |
| A parameter of an array type is refused: `"xs" of "f" is array<f32>; grad differentiates with respect to an f32 or an f32 vector` (`SD0118`, probe 2 below).                         | A float storage array is a parameter `wrt` can name: a kernel function's `array<T>` parameter, or a `@compute` entry's read-only storage binding. Its adjoint is an array of the same length.         |
| A `@compute` entry is refused: `"main" returns void` (`SD0118`, probe 5).                                                                                                            | A `@compute` entry and a kernel function have a reverse-mode derivative: a derivative program of entries and a dispatch plan.                                                                         |
| An `f32` array that a kernel loop combines with `+=` at a computed index is not proved: `TS8070`, and the function runs on the CPU (probe 7). An integer array is proved (probe 7b). | The proof accepts it. Its result is defined by Rule 7.2's tree in a stated order, on every tier. The reverse mode uses this to accumulate adjoints.                                                   |
| A program that a runtime-only package loads carries no derivative: `grad` is exported from the root only (`src/index.ts` line 122).                                                  | `packModule(m, { derivatives })` and `typeshade({ derivatives })` put the derivative programs into the manifest at build time. The program runtime runs them as it runs any entry.                    |
| The roadmap places "Reverse-mode `grad`" after 1.0 (`docs/roadmap.md`, "After 1.0").                                                                                                 | The roadmap places it before 1.0 (decision 8).                                                                                                                                                        |

### What reverse mode computes

For a function `f(x1, ..., xn) -> y` and a seed `dy` of the type of `y`, reverse mode computes
the vector-Jacobian product: for each name `xi` in `wrt`, `dxi = dy · ∂y/∂xi`. One evaluation
gives every `dxi`. Forward mode gives one directional derivative per evaluation. So reverse mode
is the cheaper mode when the parameters are many and the result is small, as in a loss over the
parameters of many splats.

The derivative is the same derivative forward mode takes, transposed. The two modes take the
same branch at a condition and give a piecewise-constant builtin the same zero (item 7). The
gradient check holds the two modes to each other (item 5).

### Item 1. The tape: store or recompute

The reverse sweep reads the values the forward sweep computed, in reverse order. The record of
those values is the tape. This proposal chooses recomputation with a fixed number of checkpoint
slots, in function memory.

1. **Straight-line code and branches** need no tape beyond what the function holds. The
   derivative function runs the forward body first and keeps each `let`. Before a `var` is
   written, a value the reverse sweep needs is copied into a fresh `let`. The count of these is
   known at compile time.
2. **A loop** saves its loop-carried state (the live variables the next iteration reads) at a
   checkpoint every `K` iterations, into a function-memory array of `C` slots. `C` is a
   compile-time constant: proposed default 32, set by `opts.checkpoints`. The reverse sweep takes
   the segments last to first. It recomputes each segment from its checkpoint into a second
   array of `C` slots, then sweeps the segment backward. `K` is `ceil(N / C)` at run time, where
   `N` is the trip count.
3. **The cost.** For `N ≤ C²` (1,024 iterations at `C = 32`), the loop body runs about three
   times forward and once in reverse. Past `C²`, a segment no longer fits its slots and is
   reversed by recomputing from its checkpoint for each iteration. The time then grows as
   `N² / C`. The basis is the arithmetic of the schedule. No time was measured.
4. **A nested loop** applies the same schedule at each level, each level with its own slots. The
   function memory is the sum over the levels.
5. **An author-written adjoint** replaces the generated one for a named function:
   `opts.custom: { fn: 'adjointFn' }`. This is the escape hatch for a recurrence the author can
   invert. For example, the transmittance of front-to-back compositing can be recovered as
   `T / (1 - a)` instead of from checkpoints. The compiler does not find such an inversion
   itself. The gradient check holds a custom adjoint as it holds a generated one (decision 2).

**The GPU memory rules** (proposed as part of the new rule):

- M1. The tape lives in function memory, with a size fixed at compile time. `GradResult` and the
  manifest report it in bytes per invocation. A derivative allocates no hidden storage buffer for
  its tape.
- M2. The only device memory a derivative program allocates is the accumulation scratch of
  item 3. Its size formula is in the plan, and the runtime reports the bytes of each call.
- M3. A derivative program does not keep the forward pass's intermediate arrays. It recomputes
  from the forward inputs, so the host passes the same inputs to the derivative call as to the
  forward call. A `Resident` input that the host keeps between the two calls costs no upload.
- M4. On WebGL2, the tape is part of each invocation's record, since the record holds every
  private variable (`src/core/passes/gl-compute.ts`, lines 366 to 384). Each cut of a phase
  writes it again (item 6).

Worked size, for the per-pixel loop of probe 3: the loop-carried state is `t`, `c` and the
counter, 3 words. With `C = 32`, two arrays of 32 slots hold 192 words, 768 bytes of function
memory per invocation. This is arithmetic, not a measurement. What a driver does with 768 bytes
of function memory (registers or spill) is unknown.

### Item 2. The reverse pass of a loop with a run-time length

Forward mode already differentiates a loop with a run-time bound. The tangent runs forward with
the primal, so it needs no tape. Measured: probe 1 (a kernel function over `xs.length`), probe 3
(a loop over `arrayLength(splats)`, the shape of a per-pixel loop over a list of splats) and
probe 4 (a `while`) each give the derivative the oracle's central difference gives.

Reverse mode needs `N` before the loop's first checkpoint, to choose `K`:

- **A counted `for` (Rule 7.5)** has a header from which `N` is computed before the loop runs:
  the start, the bound and the constant step. The schedule of item 1 applies directly.
- **A `while`, and a loop with a `break` or a `return` inside**, give `N` only when the loop has
  run. The derivative runs a count sweep first: the loop again, with no tape, which counts the
  iterations. The second sweep uses that `N`. This costs one more forward run of the loop. A
  front-to-back compositing loop that stops when the transmittance falls below a threshold is
  this case.
- **The trip count of each invocation is its own.** In a `@compute` entry or a kernel loop, each
  invocation computes its own `N` and its own `K`. Nothing is shared.

Alternative considered: refuse a `while` and an early `break` in reverse mode. That is simpler,
but it refuses the compositing loop that motivates this proposal.

### Item 3. Adjoint accumulation: a gather becomes a scatter

A forward read `v = A[j]` in an invocation becomes, in reverse, `dA[j] += dv`. Where `j` is
computed (a splat index read from a sorted list), many invocations add to one element of `dA`.
WGSL has atomics on `atomic<u32>` and `atomic<i32>` only (surface §23), so there is no float
atomic add.

**The read's index decides the form** (proposed):

| Forward read                                         | Reverse form                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| at the invocation's own index (`A[i]`, `A[a*i + c]`) | a plain write of the adjoint at the same index; no accumulation                                              |
| at an index the same for every invocation            | a reduction, `s += e`, in Rule 7.2's tree, which the kernel layer already lowers (`src/core/kernel-tree.ts`) |
| at a computed index                                  | a scatter accumulation, by one of the options below                                                          |

**The options for a scatter accumulation:**

- **(A) Float atomics emulated with a compare-exchange loop** on the bits of a `u32`
  (`atomicCompareExchangeWeak`, surface §48). The result depends on the order in which the
  device runs the invocations. That breaks Rule 1.3's oracle equality and the engine's
  determinism promise. Rejected.
- **(B) Fixed-point integer atomics.** Each contribution is scaled by a declared `S`, rounded to
  an integer and added with `atomicAdd`. Integer addition is exact and associative, so the sum
  has one value in every order, on every device. A 64-bit sum is two `u32` words: the carry of
  the low word is known from the value `atomicAdd` returns. Costs: a contribution smaller than
  `1 / S` is lost; a sum past the range overflows; the author must choose `S`; on WebGL2 each
  atomic operation ends a phase (item 6).
- **(C) A deterministic reduction (proposed default).** The result is defined as follows. Within
  one invocation, consecutive contributions to one element are added in program order. Across
  invocations, the per-invocation sums to one element are folded in Rule 7.2's 256-wide tree, in
  the order of the invocation's linear index. On a GPU tier, a count pass sizes the scratch, each
  invocation writes its (element, value) pairs to its own range, a stable sort by element keeps
  the invocation order within each element, and a segmented tree reduction folds each element.

**How the oracle defines the result.** The oracle has two precisions, and the request's phrase
"CPU f64 oracle" fits only one of them. `compileModule` defaults to `precision: 'f64'`: every value
is a JavaScript double, with no rounding to `f32` (`src/core/oracle.ts`, the caveat at lines 20 to
37 and the JSDoc of `compileModule` at lines 746 to 753). `precision: 'f32'` runs the `froundF32`
pass first (line 805) and rounds every `f32` operation. The CPU tier is the generated code at
`f32` (Rule 11.7). The GPU differential gate holds a GPU result to the `f32` oracle bit for bit
(`AGENTS.md#tests`). The finite-difference tests of `grad` run at `f64`
(`src/core/passes/grad.test.ts`, `checkAgainstFiniteDifference`, lines 27 to 63, on
`compileModule` and `compileModuleJs` with their default precision).

So for (C), the oracle computes the contributions in each precision and folds them in the order
above, with `kernelTree`. At `f32` it gives the bits every GPU tier must give, except where an
operation of the determinism report enters a contribution (as the gate already excludes, #378).
For (B), the oracle rounds each contribution to its integer and sums exactly. At `f32` it gives
the GPU's integers whenever the contributions are the same.

**The determinism promise.** typeshade/radiance design record 0005 promises: on one device and
one driver, one seed gives one image, bit for bit, when the renders have the same split (record
0005, "The promise" and "The split"). Its rule 4 keeps atomics off the accumulation path, and its
rule 5 asks a reduction to have one order, a compiler kernel function in Rule 7.2's tree or a sum
on the host. (C) is rule 5's form. (B) gives one result too, and in every order. It is still an
atomic on an accumulation path, so the engine's record would have to say that rule 4 admits an
exact integer sum. That is the engine's decision, not this proposal's. (A) breaks the promise.

**The determinism report** (Rule 11.5, surface §38). Each scatter accumulation of a float under
(C) is a row of kind `order`, the kind a reduction of a kernel loop has today
(`src/core/passes/determinism.ts`, `ORDER_BOUND`, lines 481 and 482: "one answer on every tier").
The derivative functions are ordinary IR, so the report lists their operations as it lists any
other. The derivative of `sin` is `cos`, so a derivative can add a row its forward function does
not have. A fixed-point accumulation (B) is exact and adds no row. Rule 11.5 does not change.

**The scratch size of (C)** is 2 words for each (element, invocation) run of each float lane.
Worked size, as an illustration and not a measurement of the engine: 1920 × 1080 invocations,
each adding to 32 splats of 9 float lanes, is 2,073,600 × 32 × 9 × 8 bytes, about 4.8 GB. That is
past what a browser GPU gives one buffer. The count shrinks when one invocation adds to one
element many times in a row: an invocation that handles a tile of pixels and loops over the
tile's splats outside its loop over pixels writes one run for each splat of the tile. So the shape
of the kernel decides whether (C) fits. Decision 3 asks for this to be measured before the
default is fixed.

### Item 4. The API

```ts
// Forward mode, as today: one f32 or one f32 vector along a direction.
grad(m, 'f', 'k')
grad(m, 'f', 'p', { direction: [1, 0, 0] })

// Reverse mode: many parameters in one evaluation.
const d = grad(m, 'f', ['k', 'p'], { mode: 'reverse' })
// d.name is f_vjp(x, k, p, dy): returns a struct { k: f32, p: vec3 }
// d.adjoints is { k: 'k', p: 'p' }, the struct's fields

// A kernel function or a @compute entry, with respect to storage arrays.
const r = grad(m, 'rasterize', ['means', 'opacity'], { mode: 'reverse' })
// r.plan: the entries and dispatches of the derivative program, its scratch formula
// and its tape bytes per invocation
```

1. **One entry point.** `grad` gains `mode: 'forward' | 'reverse'`, with `'forward'` as the
   default. Its third argument also takes a list of names in reverse mode. `GradResult` gains
   `adjoints` and, for a kernel function or an entry, `plan`. All of these are optional, so no
   call that compiles today changes. Alternative: a separate `vjp` export, as JAX spells it,
   which keeps `GradResult` one shape (decision 4).
2. **A function** gets a derivative function with the primal parameters, then `dy`. It returns a
   generated struct with one field for each name in `wrt`. A struct is a host value (Rule 8.21),
   so the CPU tier returns it as an object. A call to another function of the module goes
   through a helper `g_vjp`, generated once for each callee, as forward mode generates `g_jvp`
   (`src/core/passes/grad.ts`, lines 24 to 27).
3. **A kernel function** gets a derivative kernel function. It takes the primal arrays, an
   adjoint array for each array the forward writes, and an adjoint array for each name in `wrt`,
   into which it accumulates.
4. **A `@compute` entry** gets a derivative program: entries of the same workgroup size and a
   dispatch plan (the count pass, the adjoint pass, the sort and the segmented reduction of
   item 3). The entry's forward must be free of data races on what the derivative reads. In this
   change, the derivative refuses (`SD0118`) where a non-zero adjoint reaches workgroup memory, a
   barrier or an atomic operation. A tile kernel that loads splats into workgroup memory is
   therefore out of scope until an amendment.
5. **No run-time tape object.** The host runs the derivative programs in the reverse order of
   the forward calls. The host's sequence of calls is the tape at the program level, as
   `wp.Tape` records launches in NVIDIA Warp (`docs/dx.md`). A `Tape` in `typeshade/runtime` is a
   possible later change, not part of this one.

**How a runtime-only package gets the derivative.** typeshade/radiance design record 0006, item 7,
says a package may import only `typeshade/runtime`. It names two routes: the Vite plugin emits a
derivative module at build time (roadmap X5), or `typeshade/emit` gains `grad` over the
manifest's portable IR. The manifest has no kernel functions (`src/core/manifest-types.ts` has no
field for one), so the derivative reaches the program runtime as entries and a plan.

- **Build time (proposed).** `packModule(m, { derivatives: [{ fn, wrt, mode }] })` and
  `typeshade({ derivatives })` put each derivative program into the manifest: its entries beside
  the module's own, and its plan under `Pack.derivatives`. The runtime loads it like any entry,
  and `Program` gains one method that runs a plan (name settled at acceptance). The runtime still
  carries no compiler (Rule 11.11), and its bundle grows only by the plan runner. The derivative
  functions of a plain function also reach the host import, so the CPU tier calls them (§64). This
  is a step toward X5. X5 itself, `grad(f, 'k')` on an imported function, stays its own item.
- **Load time (alternative).** `typeshade/emit` gains `grad` over the portable IR. The manifest
  must then carry the IR (`packModule(m, { ir: true })`), and only the package version that wrote
  the IR reads it (`repack` throws on another version, `src/emit.ts`, lines 42 to 50). The
  emitter carries the differentiation pass, and its bundle budget grows. A package still imports
  only the runtime, since the application hands the emitter to `createRuntime({ emit })`.

### Item 5. Validation

- **Finite differences at `f64`.** Each reverse rule is held to a central difference on the
  oracle at `f64`, as `grad.test.ts` holds each forward rule today (`h = 1e-5`, relative
  tolerance `1e-4`). A finite difference at `f32` loses about half the digits, as the `fma` case
  of `grad.test.ts` (lines 331 to 334) records.
- **The transpose test.** For random `v` and `w`, `w · (J v)` from forward mode equals
  `(Jᵀ w) · v` from reverse mode, at `f64`, to rounding. This holds the two modes to each other
  where a finite difference is ill-conditioned.
- **The GPU tiers.** The derivative programs run in `scripts/gpu-differential.ts` on WebGPU and
  on WebGL2, and every adjoint word must equal the `f32` oracle, except a value that an operation
  of the determinism report enters. The scatter accumulation must be equal bit for bit, since its
  order is defined.
- **Roadmap item 20 lands with this change** (decision 6): `gradCheck(m, fn, opts)` compares a
  derivative, of either mode, with a central difference on the `f64` oracle at the points the
  caller gives, and returns the parameter and the input where they part. It is built on the same
  helper as the tests. Item 19's divergence report is not needed for it.

### Item 6. The WebGL2 tier

Change 0054 runs a `@compute` entry on WebGL2 in passes. Memory is `R32UI` words, an atomic
operation is resolved by the host in invocation index order, and a write log of 4 entries cuts a
phase when it can fill (`changes/0054-webgl2-compute.md`, "The execution model";
`src/core/gl-compute.ts`, header).

- A derivative function is ordinary IR, so the GLSL ES 3.00 writer emits it as it emits any
  function, in every stage.
- A derivative program under (C) uses no atomic operation. It runs in the 0054 executor with the
  same words as WebGPU, since adjoints are `f32` bits in `R32UI` words (0054, decision 5). Each
  invocation's (element, value) pairs are writes to the log, so an invocation with many
  contributions cuts a phase every 4 writes. At each cut, its record, the tape among its private
  variables, is written again (M4). The cost is not measured; `scripts/gl-compute-bench.ts` is
  where it will be.
- Under (B), each atomic operation ends a phase, and the host performs the requests in invocation
  index order on the memory it reads back (`src/core/gl-compute.ts`, header). The words are the
  same as WebGPU's, since the sum is exact. A pass and a read-back for each contribution make (B)
  impractical for many contributions on WebGL2. Proposed: (B) is allowed there, and the plan
  reports the cost.
- The call layer's WebGL2 kernel tier (Rule 11.8) runs only loops that write one array at exactly
  `i`. A derivative kernel function with a scatter accumulation falls outside it and runs on the
  next tier of `configure({ prefer })`, unless the kernel layer gains a path through the 0054
  executor. That path is not part of this change.

### Item 7. Discontinuities have a zero derivative

The current rule stays, and reverse mode inherits it. Where it is stated today:

- `src/core/passes/grad.ts`, lines 29 and 30: "Piecewise-constant builtins (`floor`, `ceil`,
  `round`, `trunc`, `sign`, `step`) have a zero derivative, which is the derivative almost
  everywhere; the docs say so." The rules are `flat` (lines 643 to 648).
- `src/core/passes/grad.ts`, lines 15 and 16: `if`, `switch` and `for` keep their primal
  conditions and carry the tangents through their bodies. `min`, `max`, `clamp` and `select`
  differentiate the operand the condition picks (lines 650 to 664 and 760).
- `AUTHORING.md#derivatives-with-grad`: "the derivative everywhere but at their jumps".
- `docs/roadmap.md`, item 18: "the discontinuous builtins (`floor`, `step`, `sign`, `round`) have a
  zero derivative and the docs say so".

Measured (probe 6): `vis(x, k)` returns 1 when `x < k` and 0 otherwise. Its derivative in `k` is
0 on both sides of the jump. So a visibility edge contributes nothing. In a splat renderer, the
sort order, the tile a splat falls in, an opacity threshold and the early stop of compositing are
integer or branch data, and their derivative is zero. The derivative flows through the smooth
Gaussian weights. Inference, not checked here: published Gaussian splatting rasterizers treat the
sort order and the culling as constants in their backward pass in the same way.

The new rule and §71 state the zero at a jump for both modes. Edge sampling and
reparameterization (the boundary term of a discontinuous integrand) are out of scope.

### Exclusions

- A non-zero adjoint through workgroup memory, a barrier or an atomic operation (item 4).
- A derivative with respect to a texture, and through a texture sample. `SD0118` refuses both
  today, and this change keeps the refusal.
- Second derivatives (a derivative of a derivative function). Nothing refuses them, but this
  change does not test them.
- A `"use typeshade"` spelling for a derivative. It would need a §9.3 row first, as roadmap item 18
  notes. The request is a host option.

## Why

typeshade/radiance plans a 2D Gaussian Splatting training pipeline: photographs or video, then
camera poses, then 2DGS training, then a 3D scene. Its side of the work is being written as its
design record 0011 (Gaussian splatting, a draft), which names this compiler change as a
dependency. That record is not on radiance's `main` at `4c94329`, and this proposal cites
nothing from it. Training fits the parameters of many splats to the photographs. That needs the
gradient of one loss with respect to every parameter, which is reverse mode.

`docs/roadmap.md` places "Reverse-mode `grad`" after 1.0, because it "needs the tape and the memory
rules a design issue has to settle". Items 1 to 3 above settle them, or put them to the owner as
decisions with a proposed choice. The roadmap's own reason for forward mode first stands:
forward mode covers a few parameters at a time. The engine's use is the other case.

### Evidence

Measured on `main` at `1dd149e6` with Bun 1.4.2 on Windows 11, 2026-10-09, by a script that calls
`compile`, `grad` and `compileModule` from `src/index.ts` (not committed; the sources are the
ones shown):

| Probe | Program                                                                                              | Result                                                                                                                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | kernel function `f(xs: array<f32>, k: f32)`, `s += xs[i] * k` for `i < xs.length`; `d/dk`            | `grad()` ok, `f_d_k`. The oracle gives `f_d_k([1, 2, 3], 2) = 6`.                                                                                                                                              |
| 2     | the same, `d/dxs`                                                                                    | `SD0118`: `"xs" of "f" is array<f32>; grad differentiates with respect to an f32 or an f32 vector`.                                                                                                            |
| 3     | `shade(px, k)` over `arrayLength(splats)`, `c += t * a * s.w; t *= 1. - a`, `a = exp(-k * d²) * s.z` | `grad()` ok. `shade_d_k = -0.01673896622194248`; the central difference at `h = 1e-5` is `-0.01673896622422788`. The reads of `splats` have a zero tangent: there is no derivative with respect to the buffer. |
| 4     | `while (i < n) { x = x * k; }`, `d/dk` at `n = 3`, `k = 1.5`                                         | `13.5`, which is `4 · 1.5³`.                                                                                                                                                                                   |
| 5     | a `@compute` entry                                                                                   | `SD0118`: `"main" returns void; grad differentiates a function that returns f32, an f32 vector or an f32 matrix`.                                                                                              |
| 6     | `vis(x, k)`: 1 if `x < k`, else 0; `d/dk` at `x = 0.5`, `k = 0.49` and `0.51`                        | `0` and `0`.                                                                                                                                                                                                   |
| 7     | kernel function, `g[idx[i]] += x[i]` on `f32` arrays                                                 | `TS8070`: `This loop runs on the CPU because line 3 writes "g[idx[i]]", an element two iterations can share. Write at an index made from "i".`                                                                 |
| 7b    | the same on `u32` arrays                                                                             | no diagnostic: proved, a scatter reduction (`src/core/passes/parallel-loop.ts`, `isIntegerArray`, line 373).                                                                                                   |

The first version of probe 4 did not compile. It wrote `var` (`TS8013`) and `let i = 0` against an
`i32` bound (`TS8003`). `let i = 0` is an `f32` until the change of #148 flips the default (roadmap
T15), so the probe declares `let x = k` and `let i: i32 = 0`.

### Alternatives considered

- **Keep reverse mode after 1.0** (the roadmap today). Then the engine's training pipeline has no
  compiler support before 1.0, and the engine writes its backward passes by hand, outside the
  oracle's checks.
- **Reverse mode for functions only** (items 1 and 2 without the kernel and entry forms). This is
  smaller, but only a kernel function takes an array with no size (surface §65, `TS8020`), and
  `grad` refuses an array parameter (probe 2). So the parameters of many splats stay out of
  reach.
- **Store the whole tape in a storage buffer.** The memory is invocations × iterations × state,
  and the iterations of a run-time loop are not known when the buffer is made. Rejected for the
  default; a checkpoint schedule bounds the memory instead (item 1).
- **Binomial checkpointing ("revolve", Griewank and Walther).** Optimal recomputation for a fixed
  number of slots, at the cost of a more complex schedule in the generated code. Proposed as the
  alternative to the two-level schedule of item 1 (decision 1).

### Decisions at acceptance

1. **The tape.** The two-level schedule with `C` slots and the count sweep (items 1 and 2), or
   revolve. Proposed: two-level, `C = 32` by default, `opts.checkpoints` to change it.
2. **Author-written adjoints.** Include `opts.custom` in this change. Proposed: yes.
3. **The scatter accumulation.** (C) as the defined result and the default, (B) as an opt-in for
   each array (`accumulate: { means: { fixed: 2 ** -24 } }`), (A) rejected. Proposed: (C) and (B)
   both, with (C) the default. Before the default is final, the first implementing pull request
   measures (C)'s scratch and time on a synthetic splat kernel of a stated size.
4. **The spelling.** `grad(m, fn, wrt, { mode })`, as the request asks, or a separate `vjp`.
   Proposed: `mode` on `grad`.
5. **The route to the runtime.** Build time through `packModule` and the plugin, or load time
   through `typeshade/emit`. Proposed: build time.
6. **Roadmap item 20.** Deliver `gradCheck` as an export in this change. Proposed: yes.
7. **Item 7.** Keep the zero derivative at a jump for both modes. Proposed: yes.
8. **The roadmap.** This draft does not edit `docs/roadmap.md`. A proposal-only pull request
   changes only `changes/` (`changes/README.md`, "The lifecycle"). Proposed: the pull request that
   accepts this proposal moves "Reverse-mode `grad`" from "After 1.0" into 0.7 as item 18a, and
   extends the 0.7.0 row of "Versions" to it. The row of `docs/language-design.md` §14 ("Open
   decisions") that lists reverse-mode `grad` changes in the first implementing pull request,
   since it records what holds today.

## What it touches

- `rules: [7.2, 8.22, 11.10, 11.11, 11.14]`. Rule 7.2: the tree order covers an `f32` scatter
  combined with `+=` and an adjoint accumulation, in the order of item 3. Rule 8.22: the proof
  accepts an `f32` array combined with `+=` at any index (probe 7). Rule 11.10: the manifest
  carries the derivative programs and their plans. Rule 11.11: the program runtime runs a plan.
  Rule 11.14 (new): what a derivative of either mode computes, the zero at a jump, memory rules
  M1 to M4 and the accumulation order. Draft 0042 proposes a Rule 11.13, so this draft takes
  11.14. The number is settled at acceptance.
- `surface: [38, 64, 65, 69, 71]`. §38: an adjoint accumulation is an `order` row. §64: a
  derivative function of a host-callable function reaches the host import. §65: the proof's R3
  admits an `f32` scatter with `+=`. §69: `Program` runs a derivative plan. §71 (new): derivatives
  in both modes, what they compute and what they refuse.
- `exports`: `grad`, `GradOptions` and `GradResult` gain the reverse mode (additive and optional).
  `gradCheck`, `GradCheckOptions` and `GradCheckResult` are new (decision 6). `Pack` gains
  `derivatives`, `PackOptions` and `TypeshadeViteOptions` gain `derivatives`, and `Program` gains
  the plan runner (decision 5). No export is removed.
- `codes: []`. Reverse mode refuses with `SD0118`, whose summary is "grad cannot differentiate this
  function" (`src/core/diagnostics/codes.ts`). Its hint gains the reverse-mode forms. `TS8070`
  keeps its number and fires on fewer loops.
- `examples: []`. No example is added. A journey runs a reverse-mode fit through the packed
  tarball, and a journey is not in the set of examples.

Required functional evidence:

- The reverse rule of every builtin forward mode differentiates, against a central difference at
  `f64` on both CPU modules, and the transpose test against forward mode, in a new
  `src/core/passes/grad-reverse.test.ts`.
- A loop with a counted bound, a `while` and a loop with an early `break`, each at a trip count
  below `C²` and above it, against the same checks.
- An `f32` scatter with `+=` in a kernel function, on WebGPU, on WebGL2 and on the CPU tier,
  equal bit for bit to the `f32` oracle.
- A kernel function and a `@compute` entry differentiated with respect to a storage array, in
  `scripts/gpu-differential.ts`, on WebGPU and on WebGL2 through the 0054 executor.
- A refusal by name for an adjoint through workgroup memory, a barrier and an atomic operation,
  read by both halves (`CLAUDE.md`, "A test reads both halves") where the refusal reaches the
  editor.
- The tape bytes and the scratch bytes the plan reports, against the sizes the runtime allocates.
- A journey that loads a manifest with a derivative program through `typeshade/runtime` alone and
  fits the parameters of a few splats to a target image.
- The bundle boundary (`bun run gate:boundary`): `typeshade/runtime` within its budget with the
  plan runner.

### Draft impact estimate

The work is large. Proposed order, each step its own pull request under this record:

1. Reverse mode for functions: straight-line code, branches, calls through `g_vjp`, loops with
   the checkpoint schedule and the count sweep, the struct of adjoints, `opts.custom`, the tests
   and `gradCheck`.
2. The `f32` scatter in the tree order: Rule 7.2, Rule 8.22 and §65; the oracle; the WebGPU
   lowering (`src/core/passes/kernel-lower.ts`); the determinism report's `order` rows. This step
   is useful without reverse mode, since an author can write the scatter.
3. Reverse mode for kernel functions, with respect to their arrays, on step 2.
4. Reverse mode for `@compute` entries, the plan, `packModule` and the plugin's `derivatives`,
   and the runtime's plan runner on WebGPU and on WebGL2.
5. The fixed-point opt-in, if decision 3 keeps it.
6. The documents, the site and the editor.

Duration and cost are not estimated. The basis for "large" is the size of what it builds on:
`src/core/passes/grad.ts` is 789 lines for forward mode over functions alone, and change 0054
planned its executor in five steps. A program that compiles today compiles and computes the same, since
every new option is optional and only a loop that runs on the CPU today (probe 7) changes tier.
One exception, by the first amendment: a kernel loop that scatters `f32` values with `+=` at an
index the proof cannot show distinct (probe 7) runs on the CPU today as a sequential sum, and its
sum now follows Rule 7.2's tree, which may differ from the sequential sum in the last places.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's decision on decisions 1 to 8
and the review and merge of this proposal's pull request with `status: accepted`; the approved
revision and scope; the finalized front matter, the new rule's number among them; and the
assigned responsibilities and milestones, if any are set. No approver, schedule or estimate is
recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits with
`Change: 0056`; the functional evidence above, green on the delivered revision, with the tested
configuration; `bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` clean; and,
separately, the downstream pin pull requests with `0056` recorded in their `compiler-changes.md`.

## What it owes downstream

- **typeshade.github.io.** The guide's derivative section (`content/guide/ko/the-cpu-oracle.md`,
  "grad로 구하는 미분", and the English text it is read from) gains reverse mode, the gradient
  check and the zero at a jump. The API pages that read `src/core/passes/grad.ts`
  (`src/lib/api.ts` maps it to the IR page) and the runtime's JSDoc show the new options and the
  `Program` method. The kernel-loop pages (`src/lib/kernel-loops.ts` and the control-flow page)
  say that an `f32` array combined with `+=` at any index is proved. `compiler-changes.md`
  records `0056`.
- **vscode-typeshade.** `plugins/typeshade/skills/typeshade/references/host.md` and `SKILL.md`
  describe the `TS8070` fallback; each says that an `f32` scatter with `+=` is proved now. The
  `TS8070` row of `references/diagnostics.md` is read again. A search of the skill at `bbed90e`
  found no mention of `grad`. `compiler-changes.md` records `0056`.
- **radiance** (not a repository `scripts/changes.ts` tracks). Its design record 0011, in draft,
  names this change as a dependency. Its record 0006, item 7, chooses the route of decision 5 in
  its own fit package's record. If decision 3 makes (B) its accumulation, its record 0005's rule 4
  needs the engine's own amendment.

Each item is expected work. None is started, and each follows the pin that carries the
implementation.
