---
id: '0042'
title: A kernel function, a `@compute` entry and a full-screen draw run on a WebAssembly tier between WebGL2 and the JavaScript CPU tier, in the one memory region of change 0138, with the oracle's bits on every engine
status: draft
rules:
  - '7.2'
  - '11.7'
  - '11.8'
  - '11.11'
  - '11.13'
  - '11.24'
surface:
  - 38
  - 64
  - 65
  - 66
  - 67
exports:
  - configure
  - Device
  - DeviceOptions
  - ComputeBackend
  - ComputeRunnerOptions
  - FuseReport
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The WebGPU and WebGL2 concept page's runtime copy (runtimeP, en and ko), which names the tier order; the Playground's console tier label and style for the new tier; the API reference's configure and createDevice entries; the page that states what an out-of-range index reads on the CPU tier, if a search finds one; compiler-changes.md records 0042 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (references/host.md) where it names the tiers, configure and createDevice; the tsserver fixtures that pass prefer; compiler-changes.md records 0042 when the pin moves.
  - repo: radiance
    what: A search for a pinned CPU-tier value of a transcendental function and for a read past an array's end; compiler-changes.md records 0042 when the pin moves.
  - repo: typenn
    what: Tests that pin a CPU-tier value of exp, log, tanh or pow to the last bit are baked again; compiler-changes.md records 0042 when the pin moves.
  - repo: typecv
    what: The same check as typenn; compiler-changes.md records 0042 when the pin moves.
  - repo: typeaudio
    what: The same check as typenn, for sin, cos, exp and pow; compiler-changes.md records 0042 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a future rule, files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0042`, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Date and attribution          | First written 2026-10-05 (Asia/Seoul) by the repository's coding agent at the owner's direction, from design issue [#459](https://github.com/typeshade/typeshade/issues/459). Revised 2026-11-10 (UTC) by an AI agent (Claude Code) at the owner's direction. The revision applies the owner's answers of 2026-11-10 and proposal 0138 (accepted). Each date is an authoring date. Neither is an approval date. Git authorship is not an approval signature.                                                                |
| Request source                | The owner (Seungup). The first draft: the owner's intent "typeshade wasm" and the measurements of #459. The revision: the owner's answers in the Claude Code session of 2026-11-10 (Owner's decisions), and Amendment A4 of proposal 0138, which requires this revision.                                                                                                                                                                                                                                                    |
| Applicability / Effectivity   | The call layer (`src/core/host-kernel.ts`, `host-entry.ts`, `host-draw.ts`, `host-compute.ts`, `resident.ts`, `tiers.ts`), the op library and the oracle (`src/core/cpu-runtime.ts`, `oracle.ts`, `cpu-codegen.ts`), a new encoder and a new libm beside them, the region (`src/runtime/region.ts`), the CPU backend of the RHI (`src/rhi/cpu.ts`), the generated module (`src/compiler/ts/host-face.ts`, `src/vite.ts`, `tshc`), `typeshade/runtime/internal`, the documents named below, and the downstream repositories. |
| Release version               | Unassigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Review baseline               | The revision: `origin/main` at `9c7b1899`. The first draft and the measurements of #459: `main` at `f637ae64251f7e49ffe42947e2371837d0bf32c6`.                                                                                                                                                                                                                                                                                                                                                                              |
| Review and revision authority | The first draft: [PR #460](https://github.com/typeshade/typeshade/pull/460). The revision: no pull request is assigned yet. Git records revisions. The review and the merge of a pull request record a decision.                                                                                                                                                                                                                                                                                                            |
| Earlier amendment, superseded | On 2026-10-13 the owner moved the new rule to the number 11.21 ("0042를 11.21로"). [fact] On `main` at `9c7b1899`, Rule 11.21 is the subgroup rule of proposal 0117 (`implemented`), and the last rule of §11 is Rule 11.23. Under Rule 3.7 the new rule takes the next free number as the current tree makes it. That number is 11.24 at this baseline. The number is fixed when the rule is written.                                                                                                                      |

## What changes

The run layer gains a fourth tier, `'wasm'`, between `'webgl2'` and `'cpu'` in the default
order of Rule 11.8. The compiler encodes a module's IR to a WebAssembly binary at build time,
as it writes the JavaScript of the CPU tier today (Rule 11.7). The call layer runs the
asynchronous calls on it: a kernel function, a `@compute` entry's invocations and a full-screen
`@fragment` entry's pixels.

The WebAssembly tier stands beside the JavaScript CPU tier (proposal 0138, Amendment A4). Both
are the oracle's generated code, and both give the oracle's bits (Rule 11.1, Rule 11.7).

The memory of the tier is the one global region of proposal 0138 (R17). A resource is computed
where it lies. Stage 1 also writes an engine-independent libm, which the oracle and both CPU
tiers use.

Nothing an author writes changes. No name, type, attribute or diagnostic code is added.

### Terms

| Term                | Meaning in this proposal                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript CPU tier | The tier named `'cpu'`: the oracle's generated JavaScript (`generateModuleJs`, Rule 11.7).                                              |
| WebAssembly tier    | The tier named `'wasm'`: the oracle's generated WebAssembly.                                                                            |
| CPU tiers           | The JavaScript CPU tier and the WebAssembly tier.                                                                                       |
| Region              | The one global memory region of proposal 0138, R17 (`src/runtime/region.ts`, `globalRegion()`).                                         |
| Resource            | A `Buffer<T>` or a `Uniform<T>` of proposal 0138 (`zeros`, `array`, `uniform`, an exported binding), and the host copy of a `Resident`. |
| Plain data          | A typed array, an array or an object that a host passes to a call (Rule 8.21).                                                          |
| libm                | The routines for the functions that WebAssembly has no instruction for (`sin`, `exp`, `pow` and the others listed below).               |

### Before and after, for a host

An author's `"use typeshade"` file is the same before and after. The table shows what a host
sees.

| Subject                                    | Today (`main` at `9c7b1899`)                                                                                                    | After stage 1                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| What an author writes                      | A `"use typeshade"` file.                                                                                                       | The same file. No change.                                                                                                               |
| The default tier order                     | `webgpu`, `webgl2`, `cpu` (`TIERS` in `src/core/tiers.ts`).                                                                     | `webgpu`, `webgl2`, `wasm`, `cpu`.                                                                                                      |
| `prefer`                                   | `configure({ prefer })` and `createDevice({ prefer })` take the three names.                                                    | Both take `'wasm'` too. `prefer: ['wasm']` makes the tier required: a call that it cannot run throws an `Error` with the reason.        |
| `prefer: ['cpu']`                          | The JavaScript CPU tier alone.                                                                                                  | The same. A host that lists tiers by name gets the WebAssembly tier only when it adds `'wasm'`.                                         |
| A console event's tier label               | `GPU` or `CPU` (`ConsoleTier` in `src/core/console-print.ts`, surface §66).                                                     | `GPU`, `WASM` or `CPU`.                                                                                                                 |
| A read past an array's end, CPU tiers      | `undefined` on the JavaScript CPU tier, which becomes `NaN` in arithmetic (`src/core/cpu-codegen.ts`, the comment at line 570). | The element at the last index, on both CPU tiers, as WGSL clamps the index.                                                             |
| A write past an array's end, CPU tiers     | The write lands nowhere.                                                                                                        | The write is dropped. No change in what a host observes.                                                                                |
| `sin`, `exp`, `pow` and the like, on a CPU | The answer of the engine's `Math` (`COMPONENTWISE` in `src/core/cpu-runtime.ts`). V8 and JavaScriptCore may differ.             | The answer of the libm. It is the same in every browser, in Node and in Bun. It may differ from today's answer in the last bit.         |
| A resource on a CPU tier                   | Not applicable: no call takes a resource yet (proposal 0138, milestone 3).                                                      | The tier reads and writes the resource's range of the region. It makes no copy.                                                         |
| A call with plain data                     | The JavaScript CPU tier converts each array to the oracle's values for each call.                                               | The WebAssembly tier copies the bytes into the region in the layout of Rule 6.8 and writes them back in place.                          |
| A page whose CSP refuses WebAssembly       | Not applicable.                                                                                                                 | The call runs on the JavaScript CPU tier. The reason joins the list that the call's error names. The page loses speed and nothing else. |
| A synchronous helper call (Rule 8.21)      | The JavaScript CPU tier.                                                                                                        | The JavaScript CPU tier. No change.                                                                                                     |

### What runs on the tier

Stage 1 runs the asynchronous calls that own a loop:

- a kernel function's body when no GPU tier takes it, and its loops;
- a `@compute` entry's dispatch: every invocation of every workgroup, in order, with the
  workgroup variables zeroed for each workgroup, as `src/core/host-entry.ts` does;
- a full-screen `@fragment` entry's pixels into the `ImageData` that the JavaScript CPU tier
  writes today.

The loop over the invocations, the iterations or the pixels runs inside the module. A call that
the tier cannot encode names its reason, and the call falls to the JavaScript CPU tier. Stage 1
encodes no texture call, no barrier, no `Map` or `Set` and no loop that pushes. Each of those
runs on the JavaScript CPU tier where that tier runs it today.

The synchronous helper call is never a target of this tier (decision D2 of 2026-11-10).

### The numeric contract

The WebAssembly tier is the oracle (Rule 11.1), by construction:

- The module is lowered as the CPU engines lower it: `autoVars`, then the `f32` precision pass.
  `fp64Lower` does not run, since WebAssembly computes `f64` natively.
- An `f32` operation is computed in `f64` and demoted to `f32` where the IR has `__fround`.
  That is `Math.fround` after the operation, instruction for instruction.
- The five operations `+ − × ÷ sqrt` may be emitted as native `f32`. #459 (M2) measured them
  identical on 1 048 576 inputs with the edge values. The double-rounding theorem proves it
  (53 ≥ 2 · 24 + 2). The native list grows only by a proof or a sweep of that form.
- The libm computes each function that WebAssembly has no instruction for (below). The module
  imports nothing from the host's `Math`.
- Each helper's rule is ported: WGSL's integer division and remainder where WebAssembly traps,
  the saturating conversions with their exact bounds, the summation order of `dot`, `length`,
  `normalize` and `cross`, and the reduction tree of Rule 7.2. For example, `f32ToI32Sat`
  saturates to 2 147 483 520, where `i32.trunc_sat_f32_s` gives 2 147 483 647.
- The inputs of `src/core/cpu-codegen.test.ts` and the seeded corpus of `gate:differential` hold
  the tier to the oracle, as unit tests in Node, with no browser.

The bits of a NaN are not settled by this text. See Conflicts for the owner, C3.

### The libm (decision D9 of 2026-11-10)

[decision] The owner chose that an engine-independent libm is part of stage 1. The first draft
imported the host's `Math` in stage 1 and left the libm to stage 2.

[fact] Today the oracle computes these functions with the engine's `Math`. `COMPONENTWISE` in
`src/core/cpu-runtime.ts` (lines 360 to 391) binds `sin`, `cos`, `tan`, `asin`, `acos`, `atan`,
`sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `exp`, `log`, `log2`, `atan2` and `pow` to
the `Math` member, and `exp2` to `2 ** x`. Those are 18 functions. The interpreter, the
generated JavaScript and every helper read that one table.

[inference] The libm must replace those 18 entries in that one table. Rule 11.7 says that the
CPU tier is the oracle, and `src/core/cpu-codegen.test.ts` holds the generated code to the
interpreter bit for bit. So the interpreter, the JavaScript CPU tier and the WebAssembly tier
must call the same routines. A libm in the WebAssembly tier alone would break Rule 11.7.

[proposal] The design of the libm:

- One source. Each routine is written once, in terms of `f64` `+ − × ÷ sqrt`, integer
  operations, comparisons and constant tables. The JavaScript form and the WebAssembly form are
  written from that one source.
- No new dependency. The routines are written in this repository, as the encoder is.
- The 18 functions above, for an `f32` argument and an `f32` result. Whether the libm also
  serves an `f64` operand is Conflicts for the owner, C1.

The guarantee that this proposal can promise, and the one that it cannot yet:

| Guarantee                                         | Status                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The same bits on every engine                     | Promised, by construction. ECMAScript and WebAssembly both compute `f64` `+ − × ÷ sqrt` as IEEE 754 round-to-nearest. A routine that uses only those operations and integers gives one answer everywhere.                                                                                  |
| The same bits on both CPU tiers and the oracle    | Promised, by the same construction, and held by the differential tests.                                                                                                                                                                                                                    |
| Correctly rounded, one-argument functions (16)    | Not promised yet. A one-argument `f32` function has 2³² inputs, so a sweep can check every input against a correctly rounded reference. The proposal claims "correctly rounded" for a function only after that sweep ran and found 0 differences. The sweep has not run. Open question N9. |
| Correctly rounded, `pow` and `atan2`              | Not promised. Two `f32` arguments give 2⁶⁴ pairs, which no sweep covers. The proposal promises a stated bound in ULP for each, with the algorithm named in the rule and a sampled sweep as evidence. The bound is not chosen yet. Open question N9.                                        |
| At least as accurate as the engine's `Math` today | Not measured. The sweep of N9 reports the largest distance from the reference for the libm and for V8's and JavaScriptCore's `Math`.                                                                                                                                                       |

#459 (D9) names the CORE-MATH project as a source of correctly rounded `f32` algorithms.
[inference] Its routines are C, and some use an `fma` or a 128-bit integer, which the one-source
form above does not have. So a port is new code, and its rounding claim must be checked again.
The proposal does not take CORE-MATH's claim for the port.

The costs of the decision, as facts and as items not measured:

- **CPU results change in the last bit.** A program that calls one of the 18 functions may get
  a different last bit on the JavaScript CPU tier than it gets today.
- **Tests that pin `Math` results.** [fact] At `9c7b1899`, 31 test files under `src/` contain a
  call of a `Math` transcendental (a `grep` for `Math.sin(`, `Math.exp(`, `Math.pow(` and the
  like). Examples: `src/compiler/ts/host-kernel.test.ts`, `host-draw.test.ts`,
  `src/core/kernel-tree.test.ts`, `src/common-modules.test.ts`. How many of them use the call as
  an expected value is not counted. Each such expectation must read the libm.
- **Goldens.** [fact] `examples/__emit-goldens__/` holds emitted text, not computed values. A
  module-scope constant keeps its call in the emit (`src/compiler/ts/module-const.ts`, the
  comment at line 870). So no emit golden is expected to change. This is not verified by a run.
- **Compile-time evaluators.** [fact] `src/compiler/ts/loop-bound.ts` (lines 721 to 731) and the
  value of a module-scope constant compute `pow`, `log`, `exp` and others with `Math` at compile
  time. [inference] A loop bound that the compiler computes with `Math` and the CPU tier computes
  with the libm can differ by one. Open question N10.
- **Size.** Not measured. The op library (`typeshade/runtime/internal`) gains the JavaScript
  form. `COMPONENTWISE` is one table, so a bundler cannot drop the unused routines today. Each
  WebAssembly module carries only the routines that it calls. The measurement is part of N5.
- **Speed.** Not measured. The engine's `Math.sin` is native code. The validation record
  reports the time of each libm routine against `Math`, on Node and on Bun.
- **The GPU does not follow.** A GPU's `sin` stays the driver's (surface §38). The gates that
  compare a GPU with the oracle keep their ULP room for these functions.
- **What a user gains.** CPU results are the same in Chromium, Firefox, Safari, Node and Bun. A
  test that passes on one engine passes on the others.

### Out-of-range access (decision D4 of 2026-11-10)

[decision] Both CPU tiers behave as the GPU does. A read past an array's end gives the element
at the last index. A write past an array's end is dropped. WGSL permits this answer, and Rule
11.7 already gives it for a texture of the CPU tier.

[inference] The interpreter takes the same behaviour, because Rule 11.7 holds the generated
code to it. The WebAssembly tier checks each indexed access whose index the compiler has not
proved in range. A check costs one comparison. The cost is not measured.

[decision, cost recorded] The JavaScript CPU tier's present behaviour changes. A program that
reads past an array's end gets an element today's tier does not give. Surface §38 gains a row.
The cases this text does not settle are open question N12.

### Memory: the region is the module's linear memory

[decision] The owner chose "영역을 WASM 메모리로" on 2026-11-10. The region of proposal 0138
(R17) is the linear memory of the WebAssembly tier. One region serves every device of a page
(proposal 0138, Amendment A4).

- The region is one `WebAssembly.Memory`. Each generated module imports it. No module exports a
  memory of its own. The first draft gave each module its own memory; this revision removes
  that.
- A resource is a byte range of the region, laid out by Rule 6.8. The WebAssembly tier takes
  the range's offset and length, and it reads and writes the resource where it lies. It makes
  no copy.
- A call with plain data copies the bytes into a staging range of the region. After the call,
  it writes the changed arrays back into the caller's arrays in place (Rule 8.23). It frees the
  staging range.
- The host copy of a `Resident` is a range of the region. So a call on a `Resident` copies
  nothing on this tier.
- A resource that lives only on a GPU device takes no range (R17).
- Scalars and vectors that a function takes by value are WebAssembly parameters, one for each
  component. A vector result is a multi-value return.
- Where `WebAssembly.Memory` does not exist, the region is an `ArrayBuffer`, as at milestone 1
  of proposal 0138. The JavaScript CPU tier reads either one.

[fact] On `main` at `9c7b1899`, `src/runtime/region.ts` holds the region as an `ArrayBuffer`,
resizable where the runtime has one. Its header says that milestone 2 makes it the linear
memory of the WebAssembly CPU tier. No call takes a `Buffer<T>` or a `Uniform<T>` yet: that is
milestone 3 of proposal 0138. So stage 1 delivers the mechanism (a range that a module can
address) and uses it for `Resident` arrays and for plain data. Milestone 3 of proposal 0138
then passes a resource through the same mechanism.

`docs/typeshade-plan.md` unit R2 says "One `WebAssembly.Memory` per device owner". The
implementing pull request writes it again: one region for the page (Amendment A4 of 0138).

How the region grows, and what a growth does to the accessors of proposal 0138, is open
question N2.

### The artifact (decision D6 of 2026-11-10)

- A hand-written binary encoder in the compiler (`src/core/wasm-codegen.ts`, beside
  `src/core/cpu-codegen.ts`) writes the module. It uses no binaryen, no emscripten and no new
  dependency.
- Vectors and matrices are scalarized into locals. Arrays live in the region.
- [decision] The Vite plugin and `tshc` emit the binary as a `.wasm` asset. The generated module
  loads it with `instantiateStreaming`. An inline form is the fallback for a bundler that emits
  no asset. The inline form compiles asynchronously too.
- `WebAssembly.validate` is the gate's compiler for the binary. The gate feeds it a broken
  module first (AGENTS.md#gate-discipline).
- The runtime instantiates a module that the build wrote. It builds no code at run time.
- `scripts/bundle-boundary.ts` admits only local JavaScript assets today. It must admit a
  `.wasm` asset (Rule 11.11; proposal 0138, Q10).

### The two CPU tiers

The JavaScript CPU tier stays (proposal 0138, Amendment A4). It runs:

- the synchronous helper call (Rule 8.21);
- every call on a page that refuses WebAssembly, for example a page whose content security
  policy lacks `'wasm-unsafe-eval'`;
- every call that the WebAssembly tier does not encode.

Rule 11.7 states that the two tiers coexist, that both are the oracle's generated code, and that
the WebAssembly tier is optional for each host.

### Stages

Each milestone is one or more pull requests, and each leaves `main` green. The order inside
stage 1 is a proposal; the owner fixes it at acceptance.

**Prerequisite, its own pull request (decision of 2026-11-10: "먼저 별도 PR").** One authority
for the tier names. [fact] `src/core/tiers.ts` already holds `TIERS`, and
`src/core/compute/runner.ts` derives `ComputeBackend` and `DEFAULT_PREFER` from it. These unions
still write the names again: `DrawTier` (`src/core/host-draw.ts`), `CallTier`
(`src/core/host-entry-program.ts`), `FuseReport`'s `tier` (`src/core/fuse-report.ts`, two
places), `RhiDevice`'s `backend` (`src/rhi/rhi.ts`) and `RuntimeTier`
(`src/runtime/runtime.ts`). The prerequisite makes each read `TIERS` or states why it is a
different list. It changes no export's shape, so it needs no proposal.

**Stage 1, this proposal.**

| Milestone | Content                                                                                                                                                                                                              | What changes for a host                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1a        | The libm, in the oracle and the JavaScript CPU tier. Rule 11.24 (the libm part). The sweep of N9. The tests that pin `Math` results read the libm.                                                                   | CPU results of the 18 functions; the same on every engine. |
| 1b        | The out-of-range behaviour, in the interpreter and the JavaScript CPU tier. Rule 11.7, surface §38.                                                                                                                  | A read past an array's end.                                |
| 1c        | The encoder (`src/core/wasm-codegen.ts`) and its differential tests in Node, with the `WebAssembly.validate` gate. No call uses it yet.                                                                              | Nothing.                                                   |
| 1d        | The region is an imported `WebAssembly.Memory` where one exists. The JavaScript CPU tier reads it. `docs/typeshade-plan.md` unit R2 is written again.                                                                | Nothing.                                                   |
| 1e        | The tier `'wasm'` in `TIERS`, for a kernel function: plain data copied in and written back, a `Resident` in place, the inline form, the console label `WASM`, the fallback reason. Rules 7.2, 11.8, 11.13 and 11.24. | The default order; `prefer: ['wasm']`; the console label.  |
| 1f        | A `@compute` entry's dispatch and a full-screen draw on the tier. Surface §67.                                                                                                                                       | Those calls run on the tier.                               |
| 1g        | The `.wasm` asset in the Vite plugin and `tshc`, `instantiateStreaming`, `scripts/bundle-boundary.ts`. The bundle, build and speed measurements (N5). Rule 11.11.                                                    | The asset in the build output.                             |

[decision] Stage 1 has no speed threshold (decision D10 of 2026-11-10: "기준 없이 진행"). The
work does not stop on a 2× gate. The validation record still reports the speed of the
WebAssembly tier against the JavaScript CPU tier (Configuration and validation record).

**Stage 2, a later proposal.** `f32x4` for vector lanes (#459, M3: 3× over the scalar loop).
Barriers by loop fission. Textures by a software sampler, which closes roadmap X3 for every
example. The triangle draw of a render composition (N6).

**Stage 3, a later proposal.** Threads where the page is cross-origin isolated (see C2). The
tier as the comparator of the divergence report (roadmap 19). Specialization for each override
value when roadmap 23 lands.

**Roadmap placement.** The work is milestone 2 of proposal 0138. `docs/roadmap.md` gains its row
there.

### Exclusions

- No change to what an author writes, to the IR, to the WGSL writer or to the GLSL writer.
- No synchronous call on the tier. #459 (D2) records why: the boundary costs what the arithmetic
  costs, and a browser's main thread refuses the synchronous compilation of a module over 4 KB.
- No SIMD, no texture and no barrier on the tier in stage 1.
- No thread in stage 1, unless the owner decides C2 otherwise.
- No new dependency.
- No change to what a GPU tier computes.

## Why

### What the measurements say

Design issue [#459](https://github.com/typeshade/typeshade/issues/459) holds the numbers. They
were measured on `main` at `f637ae6`, on Linux x64 with Node v22.22.0 and Bun 1.3.14. They were
not measured again for this revision.

- After #418 the JavaScript CPU tier is near hand-written JavaScript on scalars (4.7 ns against
  4.6 ns for each call, Bun) and within 2.5× on vectors.
- A call across the boundary costs about what the arithmetic costs (6.8 ns against 5.4 ns, Node).
  So raw scalar arithmetic is not the case for WebAssembly.
- The loop inside the module is the case: 1.15 ns for each element against 5.4 ns in JavaScript
  on Node, with the body inlined. With `f32x4` it is 0.38 ns.
- The copy in and out costs as much as the loop (4.5 ns with the copy against 2.5 ns resident,
  Node). So a resource that stays in the region is the fast path.
- Native `f32` for `+ − × ÷ sqrt` and the `f64`-with-demote route both gave 0 differences from
  `Math.fround` over 1 048 576 pairs with the edge values.

### Why a tier and not a faster JavaScript tier

The JavaScript CPU tier already compiles to the same `f32` instructions. It cannot lay a struct
array out as bytes without an object for each element (#252 M5: about 220 ms in and 1.3 s out
for each million). It cannot run four lanes at once or run on several threads. Each of those is
what WebAssembly is for.

### Why the loop and not the call

The gain is in the loop, so the tier takes the calls that already own a loop. #410's host loop
gets its answer by moving into the shader function. A sequential loop that the kernel proof
refuses runs on a CPU tier, and the WebAssembly tier runs it whole.

### Why the region and not a memory for each module

Proposal 0138 (R17) puts every resource in one region so that the CPU tier computes it with no
copy. #459 (M2) measured that the copy costs as much as the loop. A memory for each module would
need a copy between two modules that share one resource.

### Alternatives considered

- **A faster JavaScript tier only.** It would not reach SIMD, threads or byte-laid struct
  arrays.
- **binaryen or emscripten.** Rejected for the dependency rule. The IR is small and structured,
  and a direct encoder is the smaller thing.
- **Replacing the JavaScript CPU tier.** Rejected by the owner on 2026-11-10 ("JS 옆에 병행",
  proposal 0138, Amendment A4). The synchronous helper and the CSP fallback need it.
- **Importing the host's `Math`.** The first draft's stage 1. The owner chose the libm (D9).
- **A 2× gate.** The first draft's stage 1 gate. The owner chose no threshold (D10).

### Assumptions

- A routine that uses only `f64` `+ − × ÷ sqrt` and integers gives the same bits in V8,
  JavaScriptCore, SpiderMonkey and every WebAssembly engine. The test of milestone 1a checks
  this on the engines that CI runs. Whether CI runs an engine other than V8 is not verified.
- `new WebAssembly.Memory` works on a page whose content security policy refuses the
  compilation of a module. This is not verified (N7).
- The measurements of #459 still hold at `9c7b1899`. They were not repeated.

## Owner's decisions

The proposal rests on these entries of `docs/owner-decisions.md`. It reverses none of them.

- **OD-1** (a language of its own): the tier changes no syntax and asks nothing of a TypeScript
  tool.
- **OD-3** (the language stays small; the compiler's work is not pushed onto the author): the
  tier, the memory layout, the libm and the bounds checks are the compiler's and the runtime's
  work. No author-facing name is added.
- **OD-4** (show the owner what changes): the table "Before and after, for a host" is above, and
  each decision below records its cost.
- **OD-6** (nothing is released yet): the change of CPU results in milestones 1a and 1b owes no
  warning release under Rules 13.9 and 13.10.

OD-2, OD-5 and OD-7 concern what an author writes. The proposal touches none of them.

The owner's decisions on this proposal, taken on 2026-11-10 in the Claude Code session. The
owner was asked one question at a time, with options and costs.

| #   | Question                                    | The owner's words          | What it means                                                                                                                                                                                | Cost recorded                                                                                              |
| --- | ------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | #459 D1, the tier's name                    | "'wasm'"                   | The tier is `'wasm'`. The order is `webgpu`, `webgl2`, `wasm`, `cpu`.                                                                                                                        | Six exports take a fourth literal.                                                                         |
| 2   | #459 D4, out-of-range access                | "두 CPU 티어 모두 GPU처럼" | Both CPU tiers clamp a read to the last element and drop a write, as WGSL does.                                                                                                              | The JavaScript CPU tier's present behaviour changes: a read past the end is `undefined` today.             |
| 3   | #459 D2, the synchronous helper             | "대상 아님"                | The synchronous helper call is never a target of this tier. It stays on the JavaScript CPU tier.                                                                                             | A host loop of single calls gains nothing; it moves into the shader function (#410).                       |
| 4   | #459 D6, the artifact                       | "별도 파일 + 인라인 대체"  | An emitted `.wasm` asset loaded with `instantiateStreaming`, with an inline fallback.                                                                                                        | The plugin and `tshc` emit an asset; `scripts/bundle-boundary.ts` changes.                                 |
| 5   | #459 D9, the libm                           | "1단계에 포함"             | An engine-independent libm is part of stage 1. The owner chose this over the recommendation "a later stage".                                                                                 | The costs listed under "The libm": CPU results change in the last bit; size and speed are not measured.    |
| 6   | #459 D10, the gate                          | "기준 없이 진행"           | No speed threshold. The work does not stop on a 2× gate. The owner chose this over keeping the gate. The speed is still measured and reported. The roadmap placement is milestone 2 of 0138. | The tier may land without a proven gain on some workloads. `docs/typeshade-plan.md` still names the gate.  |
| 7   | #459 D1 prerequisite                        | "먼저 별도 PR"             | The tier-name unification lands as its own pull request before the first implementing pull request.                                                                                          | One more pull request.                                                                                     |
| 8   | The relation to the region of proposal 0138 | "영역을 WASM 메모리로"     | The region of R17 is the module's linear memory. A resource is computed where it lies. Plain data is copied in and written back. One region for all devices.                                 | Every device of a page shares wasm32's 4 GiB (Amendment A4 of 0138). Unit R2 of the plan is written again. |

Decisions of the owner that this proposal takes from proposal 0138:

- 2026-11-10, Amendment A4: "JS 옆에 병행". The WebAssembly tier stands beside the JavaScript CPU
  tier.
- 2026-11-10, Amendment A4: "전역 하나". One global region, shared by every device.
- 2026-11-09, Amendment A1: "접근자가 다시 만듦". An accessor makes its views again after a growth
  of the region.

The seven open questions of #459 are closed by rows 1 to 7.

## Conflicts for the owner

The proposal does not choose between two sources that point different ways. Each conflict below
names both sources and shows one example. Each waits for the owner's answer. Until then, the
text above does not depend on either answer, except where it says so.

### C1. The libm against ECMAScript's result for `Math.sin` on an `f64`

- **Source A.** Decision D9 of 2026-11-10 ("1단계에 포함"): the CPU tiers give one answer on every
  engine. Rule 1.6: TypeShade code "gives the same answer on every target".
- **Source B.** Rule 1.3: the oracle gives "ECMAScript's result for a form borrowed from
  ECMAScript". `Math.sin` is borrowed from ECMAScript (Rule 9.4). ECMAScript leaves the result
  of `Math.sin` to the engine.
- **Example.**

  ```ts
  // wave.shade.ts
  'use typeshade';
  export function wave(t: f64): f64 {
    return Math.sin(t);
  }
  ```

  ```ts
  // host.ts
  import { wave } from './wave.shade.ts';
  wave(0.5) === Math.sin(0.5); // true today, in every engine
  ```

  Under source A with an `f64` libm, the comparison can be false in the last bit, and `wave`
  gives the same bits in Chromium and in Safari. Under source B, the comparison stays true, and
  `wave` can differ between Chromium and Safari.

- **Options.** (a) The libm serves `f32` only; an `f64` operand keeps the engine's `Math` on
  both CPU tiers. (b) The libm serves `f32` and `f64`. (c) The libm serves `f32` in stage 1, and
  `f64` is decided with its own measurement.
- **Costs.** (a) and (c): an `f64` result stays engine-dependent, and the WebAssembly module
  imports `Math` for `f64`. (b): a second set of 18 routines with a higher precision need; its
  size, speed and accuracy are not measured; Rule 1.3 gains a recorded divergence.
- **For `f32` the same question exists in a smaller form.** `Math.fround(Math.sin(x))` in host
  code and `sin(x)` on an `f32` in a helper can differ in the last bit after the libm. Decision
  D9 already accepts that cost.

### C2. Threads and a worker: the plan against stage 1 and the region

- **Source A.** `docs/typeshade-plan.md`, area W: "threads, shared memory and asynchronous calls
  are the default, not a later stage" (the owner, 2026-10-27: "가능하면 최대한 활용하는게
  좋아보여요"). Unit W1 runs the tier "in a worker so the calling thread never blocks". Unit W2
  uses one shared `WebAssembly.Memory` where `crossOriginIsolated` is true.
- **Source B.** This proposal's first draft and #459 (D10): threads are stage 3. Proposal 0138,
  R17 and Amendment A1: the host reads and writes the region through accessors on its own
  thread, and the region uses a resizable `ArrayBuffer` where the runtime has one.
- **Example.**

  ```ts
  const ps = ts.zeros(Particle, 1_000_000);
  ps.at(0).pos.set(0, 1, 0); // the host thread writes the region
  step(ps, 1 / 60); // the WebAssembly tier reads the same range
  ```

  Under source A, on a page that is not cross-origin isolated, a worker cannot see the host
  thread's memory. So the call copies the range to the worker and back, or it runs on the host
  thread after all. Under source B, the call runs on the host thread with no copy, and a long
  loop blocks that thread as the JavaScript CPU tier does today.

- **Options.** (a) Stage 1 runs on the calling thread; threads are a later proposal. (b) Stage 1
  runs in a worker over a shared memory where the page is cross-origin isolated, and on the
  calling thread elsewhere. (c) Stage 1 always runs in a worker and copies where the memory is
  not shared.
- **Costs.** (a): a long call blocks the calling thread; the plan's area W is written again.
  (b): two code paths in stage 1; a shared memory cannot be a resizable `ArrayBuffer`, so the
  region has two forms; GitHub Pages cannot set the isolation headers. (c): the copy that the
  region exists to avoid.
- **What the text above assumes.** The exclusions and milestone 1e are written for option (a).
  They change if the owner chooses (b) or (c).

### C3. The bits of a NaN: R16 of proposal 0138 against this proposal's contract

- **Source A.** Proposal 0138, R16 (accepted): "a NaN result is made canonical where WGSL leaves
  its bits open".
- **Source B.** The numeric contract of this proposal and of #459 (D3): each operation is the
  oracle's operation, instruction for instruction. It says nothing about the bits of a NaN.
  Amendment A4 of 0138 says that the tier is "as proposal 0042 designs it" and does not repeat
  the design.
- **Example.**

  ```ts
  'use typeshade';
  export function f(xs: array<f32>, bits: array<u32>) {
    for (let i = 0; i < xs.length; i++) {
      xs[i] = (xs[i] - xs[i]) / (xs[i] - xs[i]); // 0 / 0
      bits[i] = bitcast<u32>(xs[i]);
    }
  }
  ```

  WebAssembly leaves the sign and the payload of an arithmetic NaN to the engine and the
  hardware. So `bits[i]` can differ between two machines on the WebAssembly tier, and between the
  WebAssembly tier and the JavaScript CPU tier. With resources in the region, a host can read
  those bits through a view. The exact values on each machine are not measured.

- **Options.** (a) The tier writes the canonical quiet NaN wherever a NaN reaches memory or a
  `bitcast`, as R16 says. (b) The contract compares every NaN as equal and leaves its bits open.
- **Costs.** (a): a check at each such store; its time is not measured; the JavaScript CPU tier
  and the interpreter must give the same canonical bits. (b): "bit for bit" does not hold for a
  NaN, and two machines can disagree on a `bitcast`.

### C4. Out-of-range reads: the decision against ECMAScript's result for an array

- **Source A.** Decision D4 of 2026-11-10 ("두 CPU 티어 모두 GPU처럼"): a read past the end
  gives the last element.
- **Source B.** Rule 1.3: "ECMAScript's result for a form borrowed from ECMAScript". In
  ECMAScript, `xs[xs.length]` is `undefined`.
- **Example.** `const xs = [1, 2, 3]; const y = xs[5];` in a `"use typeshade"` function. Under
  source A, `y` is `3` on every tier. Under source B, `y` has no value, which is what the
  JavaScript CPU tier gives today.
- **Question.** Does decision D4 cover every array, an ECMAScript list included (surface §63)?
  Or does it cover only an array that WGSL defines (a binding, an `array<T, N>`), with a list
  keeping ECMAScript's answer? Rule 1.3 gains a recorded divergence under the first reading.

## Open questions

The seven questions of #459 are decided (Owner's decisions). The questions below are new. Each
has the author's recommendation and its cost. The owner decides each before the milestone that
needs it.

| #   | Question                                                                                                                                 | Recommendation                                                                                                                                                                                                                                               | Cost of the recommendation                                                                                                                                                                                                       | Needed by |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| N1  | One instance for each shader module, or one instance for the page? And who owns the memory?                                              | One instance for each shader module. Every instance imports the one `WebAssembly.Memory` that `globalRegion()` owns. A module's private data (workgroup variables, local arrays, the console scratch) is a range of the region.                              | No isolation between modules: a wrong offset in one module can write another module's resource. The bounds checks of D4 are the guard. Two copies of the runtime in one page have two regions.                                   | 1d        |
| N2  | How does the region grow, and what does a growth do to the accessors of proposal 0138?                                                   | Only the runtime grows the region, with `Memory.grow`, between calls. No module contains `memory.grow`. Each growth moves the region's generation, so each accessor makes its views again (Amendment A1 of 0138). The region grows by doubling.              | A `WebAssembly.Memory` never shrinks. Its buffer is not a resizable `ArrayBuffer` at the baseline, so every growth detaches every view; milestone 1 of 0138 avoided that. Doubling can reserve unused pages.                     | 1d        |
| N3  | Threads, `SharedArrayBuffer` and cross-origin isolation.                                                                                 | See C2. The author's recommendation is option (a) of C2.                                                                                                                                                                                                     | See C2.                                                                                                                                                                                                                          | 1e        |
| N4  | What happens at wasm32's 4 GiB?                                                                                                          | An allocation that the region cannot place throws a `RangeError` that names the resource and the region's size. A resource that lives only on a GPU device takes no range. `memory64` is not used.                                                           | A page's CPU-side data is limited to 4 GiB in total, across all devices (recorded by Amendment A4 of 0138). Engines may allow less; the limit of each engine is not measured.                                                    | 1d        |
| N5  | The bundle and build cost (Q10 of proposal 0138).                                                                                        | Measure and record, with no threshold: the measurement plan is below.                                                                                                                                                                                        | The numbers may be large for a module that calls many libm routines. No budget stops the work.                                                                                                                                   | 1g        |
| N6  | How do the graphs and the render compositions of proposal 0138 (milestones 4 and 5) reach the tier?                                      | Through the CPU backend of the RHI (`src/rhi/cpu.ts`). Its `CpuProgram` gains a WebAssembly form beside the JavaScript form. No fourth `RhiDevice` backend is added. A graph's calls run apart on the tier in stage 1, as on the JavaScript CPU tier.        | The vertex loop and the rasterizer (`src/rhi/cpu-raster.ts`) stay JavaScript in stage 1. A triangle draw then crosses the boundary for each pixel, so it stays on the JavaScript CPU tier until stage 2.                         | 0138 m4   |
| N7  | The CSP fallback: when is the refusal found, and what is the region then?                                                                | The region is a `WebAssembly.Memory` whenever the constructor exists. The first instantiation that throws records the reason for its module. Later calls of that module go to the JavaScript CPU tier and do not try again.                                  | Whether a page that lacks `'wasm-unsafe-eval'` may construct a `WebAssembly.Memory` is not verified. The journey of milestone 1e measures it in Chromium; Firefox and Safari are not in CI.                                      | 1d, 1e    |
| N8  | Is `'wasm'` a tier that a device opens on (`createDevice({ prefer: ['wasm'] })`, `device.tier`)?                                         | Yes. A device opens on `'wasm'` when a probe module instantiates. `device.skipped` names the reason when it does not. The JavaScript CPU tier stays the fallback of a call.                                                                                  | `Device` and `DeviceOptions` are reshaped. A host that compares `device.tier` with `'cpu'` must handle `'wasm'`.                                                                                                                 | 1e        |
| N9  | The libm's accuracy claim and its reference.                                                                                             | Claim "the same bits on every engine" in Rule 11.24. Claim "correctly rounded" for a one-argument function only after a sweep of all 2³² inputs finds 0 differences. Give `pow` and `atan2` a stated ULP bound. Run the sweep as a script outside the gates. | The reference needs a correctly rounded source outside the repository's dependencies (for example the CORE-MATH C sources built by a script). The tool is not chosen. A sweep of 16 functions is long; its time is not measured. | 1a        |
| N10 | Do the compile-time evaluators use the libm (`src/compiler/ts/loop-bound.ts`, a module-scope constant's value)?                          | Yes. A value that the compiler computes and a CPU tier also computes comes from one routine.                                                                                                                                                                 | The compiler's own results change in the last bit for those calls. A loop bound that sits on a rounding edge can change by one.                                                                                                  | 1a        |
| N11 | The libm for an `f64` operand.                                                                                                           | See C1. The author's recommendation is option (c) of C1.                                                                                                                                                                                                     | See C1.                                                                                                                                                                                                                          | 1a        |
| N12 | Out-of-range details: a read of an array with no element; a negative index; an index into a vector or a matrix; an ECMAScript list (C4). | An array with no element reads the zero value of its element type. An index is clamped as an unsigned number, so a negative `i32` index reads the last element. A vector or a matrix index is clamped the same way.                                          | "The zero value" is this proposal's choice where WGSL leaves room; a GPU may give another value, so surface §38 lists the row.                                                                                                   | 1b        |
| N13 | The new rule's number.                                                                                                                   | Rule 11.24, the next free number at `9c7b1899` (Rule 3.7). The implementing pull request takes the next free number of its own base.                                                                                                                         | The front matter changes by an amendment if another change takes 11.24 first.                                                                                                                                                    | 1a        |

### The measurement plan for N5

Nothing below is measured yet. Milestone 1g records each number with its commit, its machine
and its tool versions.

1. Record the bytes of the `.wasm` asset of each module under `examples/`, raw and gzipped.
2. Record the bytes of the libm in one module that calls all 18 functions, raw and gzipped.
3. Record the gzipped bytes that the libm adds to `typeshade/runtime/internal`.
4. Record the gzipped bytes that the instantiation glue adds to `typeshade/runtime`.
5. Record the time that `compile()` takes with and without the encoder, over `examples/`.
6. Record the time of `instantiateStreaming` and of the inline form, in Chromium.
7. Record whether Chromium caches the compiled code of the asset on a second load.
8. Record the time of each kernel of the differential corpus at one million invocations, on the
   WebAssembly tier and on the JavaScript CPU tier, in Node and in Chromium.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name (`names: []`), no diagnostic code and no
surface form. An author writes nothing new, so nothing is asked of the author that the compiler
could decide.

What the proposal adds:

- one rule, Rule 11.24: the numeric contract of the WebAssembly tier, the libm and the artifact.
  It is a rule about the compiler's and the runtime's own work;
- one host-facing literal, `'wasm'`, in the `prefer` lists and the reported tiers. A host
  writes it only to require or to exclude the tier. The default order needs no host code;
- one console tier label, `WASM`.

The tier's choice for each call is the runtime's (Rule 11.8). The memory layout, the bounds
checks and the libm are the compiler's work (OD-3).

## What it touches

**Rules.**

- Rule 7.2: the reduction row names the WebAssembly tier among the tiers that fold in the tree
  order.
- Rule 11.7: the CPU tier's definition gains the WebAssembly tier beside the JavaScript one,
  their relation, the out-of-range behaviour of both, the libm in place of the engine's `Math`,
  and the `'wasm-unsafe-eval'` note.
- Rule 11.8: the default order with `'wasm'`; what the tier runs; plain data copied in and
  written back; a `Resident` in the region; `'wasm'` as a device's tier (N8).
- Rule 11.11: an emitted asset may be a `.wasm` binary; the boundary check admits it.
- Rule 11.13: the tier on which a `fuse` scope's calls run, and `FuseReport`'s `tier`.
- Rule 11.24 (new): the numeric contract (the lowering, the demote at each rounding point, the
  five native operations, the ported helper rules), the libm (the functions, the one-source
  form, the guarantee), and the artifact (the encoder, the asset, `WebAssembly.validate`).

**Surface.** §38: a row for the out-of-range read. §64: the tiers of a call. §65: the tiers of a
kernel. §66: the `WASM` console tier label. §67: the tiers of an entry and of a draw.

**Exports.** Each of these carries the tier union and gains `'wasm'`. The names are those of
`src/__api__/surface.md` at `9c7b1899`.

- `configure`: its `prefer` option. `createDevice` takes the union through `DeviceOptions`; its
  own line of the surface does not change.
- `DeviceOptions`: its `prefer` option.
- `Device`: `tier` and the `tier` of each entry of `skipped`.
- `ComputeBackend` and `ComputeRunnerOptions` (`typeshade/compute`): the union and `prefer`.
- `FuseReport`: its `tier` fields.

No export is added. No export is removed.

**Codes, examples, names.** None.

**Files.** `src/core/tiers.ts` (the list); `src/core/wasm-codegen.ts` (new); `src/core/host-wasm.ts`
(new: the tier's call path); `src/core/libm.ts` (new; the name is a proposal); `src/core/cpu-runtime.ts`
(`COMPONENTWISE`); `src/core/oracle.ts` and `src/core/cpu-codegen.ts` (the out-of-range
behaviour); `src/runtime/region.ts` (the memory); `src/rhi/cpu.ts` (N6); `src/compiler/ts/host-face.ts`,
`src/vite.ts` and `tshc` (the asset); `src/core/console-print.ts` (the label);
`scripts/bundle-boundary.ts`.

**Tests.** `src/core/wasm-codegen.test.ts` (the oracle's inputs, both precisions, and the
validate gate's broken module); a libm test that holds the JavaScript form and the WebAssembly
form to each other; the corpus of `gate:differential` on the tier; the compile gate's entry-call
leg on the tier; `src/compiler/ts/host-kernel.test.ts` and `host-entry.test.ts` (each tier's
reason, the required tier); a region test (a growth of a `WebAssembly.Memory`, beside the tests of `src/runtime/region.ts`); a
journey with `prefer: ['wasm']`; a journey on a page whose policy refuses WebAssembly.

**Documents.** `docs/typeshade-plan.md` (unit R2; area W's text on the gate and on threads, by
the owner's answers); `docs/roadmap.md` (the row under milestone 2 of 0138); `CHANGELOG.md`;
`reqs/` by `bun run reqs:sync`.

### Draft impact estimate

| Area               | Expected work                                                                                                                                              | Basis and uncertainty                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Encoder            | A binary encoder over the IR's `Expr` and `Stmt` unions, scalarized vectors, memory access by `Layout`, the ported helper rules, `console` imports.        | `src/core/cpu-codegen.ts` is 2 107 lines over the same IR at `9c7b1899`; the encoder is of that order. Estimate. |
| libm               | 18 routines in one source with two forms; the sweep; the tests that pin `Math` results.                                                                    | No basis for the size or the time. The accuracy work is the uncertain part (N9).                                 |
| Out-of-range       | The interpreter, the generated JavaScript and the encoder; the "operand that may be missing" analysis of `src/core/cpu-codegen.ts` loses one of its cases. | Known files. The number of tests that pin `undefined` is not counted.                                            |
| Region             | `WebAssembly.Memory` in `src/runtime/region.ts`; growth; the fallback to an `ArrayBuffer`.                                                                 | `src/runtime/region.ts` is 193 lines. Small. N2 and N7 are open.                                                 |
| Call layer         | A `'wasm'` branch in the tier loops, the staging copy, the fallback reason.                                                                                | The WebGL2 tier (`src/core/host-kernel-gl.ts`, 206 lines) is the precedent.                                      |
| Plugin and runtime | Asset emission, `instantiateStreaming`, the inline fallback, the glue.                                                                                     | Small. The bundle numbers are not measured (N5).                                                                 |
| Compatibility      | A new tier name and a new console label (additive). The out-of-range behaviour and the libm change CPU results.                                            | Known. OD-6: no release exists, so no warning release is owed.                                                   |
| Dependencies       | None at run time or at build time. A reference for the sweep of N9 is a tool, not chosen.                                                                  | Known, except the tool.                                                                                          |
| Downstream         | The site, the editor and the four libraries (What it owes downstream).                                                                                     | The downstream repositories were not searched for this revision.                                                 |
| Duration and cost  | Unknown; not estimated.                                                                                                                                    | No basis established.                                                                                            |

Decisions that must be resolved before acceptance: C1 to C4. The open questions N1 to N13 are
decided before the milestone that needs each, if the owner accepts the direction first as for
proposal 0138.

### Independent review record

Not yet reviewed. `changes/README.md` (Independent review) requires one review by an agent or a
person that did not write this proposal, before the owner decides. This revision has no such
review. The reviewer, the date, the revision reviewed, each finding and the author's answer are
recorded here when the review is done.

### Approval and plan record

This record does not yet apply. Acceptance will require:

- the independent review record above, with each finding answered;
- the owner's answers to C1 to C4, recorded in this file with their dates;
- the owner's decision on this proposal and its pull request reference;
- the approved revision of this file and its scope;
- the final rule number and surface sections against the tree at that time;
- the order of the milestones of stage 1.

The owner's eight decisions of 2026-11-10 (Owner's decisions) are answers to questions. They
are not the acceptance of this proposal. No responsibility, milestone date, duration or cost is
assigned by this draft.

### Configuration and validation record

This record does not yet apply. Delivery will require, for each milestone:

- the implementing pull requests and their commits with `Change: 0042`;
- the delivered configuration (commit, Node, Bun and browser versions);
- functional validation: the differential tests and the gates green on the delivered revision;
  the libm sweep of N9 with its reference and its result; the journey with `prefer: ['wasm']`;
  the journey on a page that refuses WebAssembly;
- the speed of the WebAssembly tier against the JavaScript CPU tier, with its machine, its
  engines and its numbers (decision D10: reported, with no threshold);
- the measurements of N5;
- document validation: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
  `python scripts/doorstop-check.py -C` clean after the rule edits;
- each deviation with its disposition, and the pending work;
- separately, each downstream repository's pin pull request with `0042` in its
  `compiler-changes.md`.

## What it owes downstream

The downstream repositories were not searched for this revision. Each item below is expected
work. Responsibilities are recorded at acceptance.

**typeshade.github.io.** The WebGPU and WebGL2 concept page's runtime copy (`runtimeP`, en and
ko) names the tier order "WebGPU, then WebGL2, then the CPU" and gains the WebAssembly tier. The
Playground's console draws a tier label from the compiler's `ConsoleTier` and needs a style for
`WASM`. The API reference's `configure` and `createDevice` entries list the fourth name. A page
that states what an out-of-range index reads on the CPU tier changes, if a search finds one.
`compiler-changes.md` records `0042` when the pin moves.

**vscode-typeshade.** The skill's host reference (`references/host.md`) names the tiers,
`configure({ prefer })` and `createDevice({ prefer })`, and gains the fourth name with one
sentence on when it runs. The tsserver fixtures that pass `prefer` take the new literal.
`compiler-changes.md` records `0042` when the pin moves.

**radiance.** A search for a test or a record that pins a CPU-tier value of a transcendental
function, and for code that relies on a read past an array's end. `compiler-changes.md` records
`0042` when the pin moves.

**typenn, typecv, typeaudio.** A test that pins a CPU-tier value of `exp`, `log`, `tanh`, `sin`,
`cos` or `pow` to the last bit is baked again against the libm. A host that compares
`device.tier` with `'cpu'` handles `'wasm'` (N8). `compiler-changes.md` records `0042` in each
when the pin moves.
