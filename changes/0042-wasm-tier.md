---
id: '0042'
title: A kernel function, a `@compute` entry and a full-screen draw run on a WebAssembly tier between WebGL2 and the CPU, in linear memory, bit for bit with the oracle
status: draft
rules:
  - '7.2'
  - '11.7'
  - '11.8'
  - '11.13'
surface:
  - 38
  - 64
  - 65
  - 66
  - 67
exports:
  - configure
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The WebGPU and WebGL2 concept page's runtime copy (runtimeP, en and ko), which names the tier order; the Playground's console tier label and style for the new tier; the API reference's configure entry; compiler-changes.md records 0042 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (references/host.md) where it names the tiers and configure; the tsserver fixtures that call configure; compiler-changes.md records 0042 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a future rule, files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0042`, `status: draft`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                              |
| Date and attribution          | Written 2026-10-05, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction, from the owner's intent stated in that conversation ("typeshade wasm") and the measurements recorded in design issue [#459](https://github.com/typeshade/typeshade/issues/459).             |
| Applicability / Effectivity   | The call layer (`src/core/host-kernel.ts`, `host-entry.ts`, `host-draw.ts`, `host-compute.ts`, `resident.ts`), the generated module (`src/compiler/ts/host-face.ts`, `src/vite.ts`), a new encoder beside `src/core/cpu-codegen.ts`, `typeshade/runtime/internal`, the documents named below; the site and the editor. Release version unassigned. |
| Review baseline               | `origin/main` at `f637ae64251f7e49ffe42947e2371837d0bf32c6`.                                                                                                                                                                                                                                                                                       |
| Review and revision authority | No pull request is assigned yet; this line is updated when the proposal-only pull request opens. Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                   |

## What changes

The run layer gains a fourth tier, `'wasm'`, between `'webgl2'` and `'cpu'` in the default
order of Rule 11.8. The compiler encodes a module's IR to a WebAssembly binary at build time,
the way it writes the CPU tier's JavaScript today (Rule 11.7), and the call layer runs the
asynchronous calls on it: a kernel function's body when no GPU tier takes it, a `@compute`
entry's invocations, and a full-screen `@fragment` entry's pixels. Arrays live in the module's
linear memory, laid out as the GPU tier lays out its buffers (Rule 6.8). Every result equals
the oracle's bit for bit (Rule 11.1).

Nothing an author writes changes. The host signature of every export stays what Rules 8.21 and
8.24 give it; `configure({ prefer })` takes the new name; `console.*` events say which tier ran
them (surface §66).

### Before and after

| Today                                                                                             | After this proposal                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A call tries WebGPU, then WebGL2, then the CPU tier (Rule 11.8).                                  | A call tries WebGPU, then WebGL2, then the wasm tier, then the CPU tier. `configure({ prefer: ['wasm'] })` makes it required.                             |
| The CPU tier is the oracle's generated JavaScript; the call layer loops over it in JavaScript.    | The wasm tier is the oracle's generated WebAssembly; the loop over the invocations, iterations or pixels runs inside the module.                          |
| Arrays reach the CPU tier as the oracle's values (`number[]`, plain objects), converted per call. | Arrays reach the wasm tier as bytes in the `std430` layout the GPU tier already packs, copied in and written back in place; a `Resident` stays in memory. |
| A console event's tier is `GPU` or `CPU`.                                                         | `GPU`, `WASM` or `CPU`.                                                                                                                                   |
| A read past an array's end on the CPU tier is `undefined`; a write past the end lands nowhere.    | On both CPU tiers a read past the end gives the element at the clamped index and a write past the end is dropped (open decision 2 of #459).               |

### The numeric contract

The wasm tier is the oracle (Rule 11.1), by construction and not by tuning:

- the module is lowered as the CPU engines lower it: `autoVars`, then the `f32` precision pass,
  and no `fp64Lower`, since both compute `f64` natively;
- an `f32` operation is computed in `f64` and demoted to `f32` where the IR has `__fround`,
  which is `Math.fround` after the operation, instruction for instruction. The five operations
  `+ − × ÷ sqrt` may be emitted as native `f32`: measured identical on 1 048 576 inputs with
  the edge values (#459, M2), and proven by the double-rounding theorem (53 ≥ 2 · 24 + 2). The
  native list grows only by a proof or a sweep of that form;
- the transcendentals are imported from the host's `Math`, so the tier gives the engine's answer
  as the CPU tier does; a libm of its own is stage 2;
- every helper's rule is ported, never assumed: WGSL's integer division and remainder where
  WebAssembly traps, the saturating conversions with their exact bounds (`f32ToI32Sat`
  saturates to 2 147 483 520, where `i32.trunc_sat_f32_s` would give 2 147 483 647), the
  summation order of `dot`, `length`, `normalize` and `cross`, and the reduction tree of
  Rule 7.2;
- `src/core/cpu-codegen.test.ts`'s inputs and `gate:differential`'s seeded corpus hold the
  tier to the oracle, as unit tests in Node, with no browser.

### The artifact

A hand-written binary encoder in the compiler (`src/core/wasm-codegen.ts`, the CPU codegen's
second twin) writes the module: no binaryen, no emscripten, no new dependency. Vectors and
matrices are scalarized into locals and a vector result is a multi-value return; arrays live in
memory. The Vite plugin emits the binary as an asset the generated module loads with
`instantiateStreaming`, with an inline form as the fallback for a bundler with no asset
emission. `WebAssembly.validate` is the gate's compiler for it, fed a broken module first
(AGENTS.md#gate-discipline).

### The two CPU tiers

The JavaScript CPU tier stays. It runs the synchronous helper call (Rule 8.21), which this
proposal does not move, and it is the tier a call falls to when instantiation throws: a page
whose content security policy lacks `'wasm-unsafe-eval'` loses speed and nothing else, and the
reason joins the list the call's error names. Rule 11.7 states that the two tiers coexist and
that the wasm one is optional per host.

### Stages

1. **Stage 1, this proposal's implementation.** The tier for kernel functions, entry dispatch
   and the full-screen draw; the numeric contract above; memory by the `std430` layouts; the
   encoder and the asset; the JS tier as fallback; the CPU tier's refusals inherited (an entry
   that reaches a barrier or a texture has no wasm tier). **Gate:** on the differential corpus's
   kernels at one million invocations, the wasm tier runs at least twice as fast as the CPU tier
   in Node and in Chromium, bit for bit. If it does not, the work stops and this proposal is
   withdrawn with the numbers.
2. **Stage 2, a later proposal.** `f32x4` for vector lanes (#459, M3: 3× over the scalar loop),
   barriers by loop fission and textures by a software sampler (which closes roadmap X3 for
   every example), a correctly rounded `f32` libm imported by both CPU tiers.
3. **Stage 3, a later proposal.** Threads where the page is cross-origin isolated, the tier as
   the comparator of the divergence report (roadmap 19), specialization per override value
   when roadmap 23 lands.

### Exclusions

- No change to what an author writes, to the IR, to the WGSL or GLSL writers, or to the
  program runtime (`typeshade/runtime`, Rule 11.11) and the load-time emitter.
- No synchronous call on the tier. #459 D2 records why: the boundary costs what the arithmetic
  costs, and a browser's main thread refuses synchronous compilation of a module over 4 KB.
- No threads, no SIMD, no libm, no textures and no barriers in stage 1.
- No new dependency.

## Why

### What the measurements say

Design issue [#459](https://github.com/typeshade/typeshade/issues/459) holds the numbers,
measured on `main` at f637ae6. In short:

- After #418 the CPU tier is near hand-written JavaScript on scalars (4.7 ns against 4.6 ns per
  call) and within 2.5× on vectors. Raw scalar arithmetic is therefore not the case for
  WebAssembly: a call across the boundary costs about what the arithmetic costs (6.8 ns against
  5.4 ns).
- The loop inside the module is the case: 1.15 ns per element against 5.4 ns in JavaScript on
  Node with the body inlined, 0.38 ns with `f32x4`, and the copy in and out costs as much as
  the loop, so residency has a meaning on this tier too.
- Native `f32` for `+ − × ÷ sqrt` and the `f64`-with-demote route both gave 0 differences from
  `Math.fround` over 1 048 576 pairs with the edge values, so the identity contract costs no
  speed where it matters.

### Why a tier and not a faster JavaScript tier

The JavaScript tier already compiles to the same `f32` instructions. What it cannot do is lay
a struct array out as bytes without an object per element (#252 M5: about 220 ms in and 1.3 s
out per million), run four lanes at once, run on several threads, or give one answer on every
engine. Each of those is what WebAssembly is for, and none is reachable from JavaScript.

### Why the loop and not the call

The gain is in the loop, not in the call, so the tier takes the calls that already own a loop:
a kernel function, an entry's dispatch and a draw. #410's host loop (a march and a bisection
over a million cells) gets its answer by moving into the shader function: a sequential loop
the proof refuses runs on the CPU, and this tier runs it whole, which no GPU tier can offer.

### Alternatives considered

- **A faster JavaScript tier only.** Allocation-free vectors could be written in JavaScript
  with scratch typed arrays. It would not reach SIMD, threads, byte-laid struct arrays or an
  engine-independent libm, and it would be a third numeric implementation to hold to the
  oracle.
- **binaryen or emscripten.** Rejected for the dependency rule; the IR is small and structured
  and a direct encoder is the smaller thing.
- **Replacing the JavaScript CPU tier.** Rejected: the synchronous helper and the CSP fallback
  need it (Rule 11.7's rationale).

### Unresolved decisions

The seven open questions of #459: the tier's name; the out-of-range behaviour of both CPU
tiers; whether the synchronous helper is ever a target; asset with inline fallback or inline
only; whether an engine-independent libm is wanted; the gate's threshold and the roadmap
placement; whether the tier-name unification lands as its own pull request first.

## What it touches

- Rule 7.2: the reduction row names the wasm tier among the tiers that fold in the tree order.
- Rule 11.7: the CPU tier's definition gains the wasm tier beside the JavaScript one, their
  relation (the JavaScript tier runs the synchronous call and is the fallback), the
  out-of-range behaviour, and the `'wasm-unsafe-eval'` note in the rationale.
- Rule 11.8: the default order with `'wasm'`, what the tier can run (the asynchronous calls
  the CPU tier runs, with the same refusals), and a `Resident` on it.
- Rule 11.13 (new): the numeric contract (the lowering, the demote at each rounding point, the
  five native operations, the `Math` imports, the ported helper rules) and the artifact (the
  encoder in the compiler, the asset, `WebAssembly.validate` as the gate's compiler).
- Surface §38: a row for the out-of-range behaviour, if decision 2 is taken. §64: the call's
  tiers. §65: a kernel's tiers. §66: the `WASM` console tier label. §67: an entry's and a
  draw's tiers.
- `configure` (exported from `typeshade` and `typeshade/runtime`): its `Tier` union gains
  `'wasm'`; the refusal text names four tiers.
- `src/core/resident.ts`: the tier list, which `src/core/compute/runner.ts` reads after the
  unification pull request.
- `src/core/wasm-codegen.ts` (new), `src/core/host-wasm.ts` (new, the tier's call path and
  memory), `src/compiler/ts/host-face.ts` and `src/vite.ts` (the asset), `src/core/console-print.ts`
  (the label), `typeshade/runtime/internal` (the instantiation glue, within Rule 11.7's "op
  library alone" widened to say so).
- Tests: `src/core/wasm-codegen.test.ts` (the oracle's inputs, both precisions, and the
  validate gate's broken module), `gate:differential`'s corpus on the tier, the compile gate's
  entry-call leg on the tier, `src/compiler/ts/host-kernel.test.ts` and `host-entry.test.ts`
  (each tier's reason, the required tier), a journey with `configure({ prefer: ['wasm'] })`.
- `docs/roadmap.md`: a row for the tier where the owner places it; `CHANGELOG.md`: an entry.
- No code, no example id.

### Draft impact estimate

| Area               | Expected work                                                                                                                                       | Basis and uncertainty                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoder            | A binary encoder over the IR's `Expr` and `Stmt` unions, scalarized vectors, memory access by `Layout`, the ported helper rules, `console` imports. | The CPU codegen is 1 983 lines over the same IR; the encoder is of that order. The probes (#459) show the encoding is routine; the helper rules are the work. |
| Call layer         | A `'wasm'` branch in three tier loops, the memory and marshalling, the fallback reason.                                                             | The WebGL2 tier (`host-kernel-gl.ts`, 199 lines; `lowerKernelGl`) is the precedent.                                                                           |
| Plugin and runtime | Asset emission, `instantiateStreaming`, the inline fallback, the glue in `runtime/internal`.                                                        | Small. The bundle budget of Rule 11.11 is untouched; `runtime/internal` has no budget today.                                                                  |
| Tests and gates    | The differential tests in Node, the gate legs, the validate sanity, the stage-1 gate's benchmark.                                                   | The instruments exist; each gains a tier.                                                                                                                     |
| Documents          | Rules 7.2, 11.7, 11.8, a new 11.13; five surface sections; the roadmap row; the changelog.                                                          | `bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` hold the set.                                                                               |
| Compatibility      | Additive: a new tier name, a new console label, and the out-of-range behaviour if decision 2 is taken (a change for programs already out of range). | Known.                                                                                                                                                        |
| Dependencies       | None.                                                                                                                                               | Known.                                                                                                                                                        |
| Duration and cost  | Unknown; not estimated.                                                                                                                             | No basis established.                                                                                                                                         |

### Approval and plan record

This record does not yet apply. Acceptance requires: the owner's answers to the seven open
questions of #459 recorded in this file; the actual decision and its pull request reference;
the approved revision of this file; the finalized surface sections (the numbers above are the
tree's at the baseline); the roadmap placement; and the gate's threshold. No responsibility,
milestone, duration or cost is assigned by this draft.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with
`Change: 0042`; the differential tests and the gates green on the delivered revision; the
stage-1 gate's benchmark recorded with its machine, engines and numbers; `bun run docs:impact`,
`docs:refs`, `reqs:sync` and `doorstop -C` clean after the rule edits; and, separately, the
site's and the editor's pin pull requests with `0042` recorded in their `compiler-changes.md`.

## What it owes downstream

**typeshade.github.io.** The WebGPU and WebGL2 concept page's runtime copy (`runtimeP`, en and
ko) names the tier order "WebGPU, then WebGL2, then the CPU" and gains the wasm tier in one
sentence; the Playground's console draws a tier label from the compiler's `ConsoleTier` and
needs a style for `WASM`; the API reference's `configure` entry lists the fourth name.
`compiler-changes.md` records `0042` when the pin moves.

**vscode-typeshade.** The skill's host reference (`references/host.md`) names the tiers and
`configure({ prefer })` and gains the fourth name with one sentence on when it runs; the
tsserver fixtures that call `configure` take the new literal. `compiler-changes.md` records
`0042` when the pin moves.
