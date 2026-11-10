---
id: '0042'
title: A kernel function, a `@compute` entry and a full-screen draw run on a WebAssembly tier between WebGL2 and the JavaScript CPU tier, in the one memory region of change 0138, with the oracle's bits on every engine
status: accepted
rules:
  - '1.3'
  - '7.2'
  - '9.4'
  - '11.1'
  - '11.7'
  - '11.8'
  - '11.11'
  - '11.13'
  - '11.20'
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
  - DeviceInfo
  - ComputeBackend
  - ComputeRunner
  - ComputeRunnerOptions
  - RejectedBackend
  - FuseReport
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The WebGPU and WebGL2 concept page's runtime copy (runtimeP, en and ko), which names the tier order; the Playground's console tier label and style for the new tier; the API reference's configure and createDevice entries; a page that states what an out-of-range index does on the CPU tier, or that compares a tier with 'cpu', if a search finds one; compiler-changes.md records 0042 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (references/host.md) where it names the tiers, configure and createDevice; the tsserver fixtures that pass prefer; compiler-changes.md records 0042 when the pin moves.
  - repo: radiance
    what: A search for a pinned CPU-tier value of a transcendental function, for a comparison of a tier with 'cpu', and for code that relies on an access past an array's end; compiler-changes.md records 0042 when the pin moves.
  - repo: typenn
    what: Tests that pin a CPU-tier value of exp, log, tanh or pow to the last bit are baked again; a comparison of device.tier with 'cpu' handles 'wasm'; compiler-changes.md records 0042 when the pin moves.
  - repo: typecv
    what: The same check as typenn; compiler-changes.md records 0042 when the pin moves.
  - repo: typeaudio
    what: The same check as typenn, for sin, cos, exp and pow; compiler-changes.md records 0042 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a future rule, files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0042`, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Date and attribution          | First written 2026-10-05 (Asia/Seoul) by the repository's coding agent at the owner's direction, from design issue [#459](https://github.com/typeshade/typeshade/issues/459). Revised twice on 2026-11-10 (UTC) by an AI agent (Claude Code) at the owner's direction: first against proposal 0138 with the owner's eight answers, then with the owner's seven further answers and the independent review. Each date is an authoring date. None is an approval date. Git authorship is not an approval signature.           |
| Request source                | The owner (Seungup). The first draft: the owner's intent "typeshade wasm" and the measurements of #459. The revisions: the owner's answers in the Claude Code session of 2026-11-10 (Owner's decisions), and Amendment A4 of proposal 0138, which requires this revision.                                                                                                                                                                                                                                                   |
| Applicability / Effectivity   | The call layer (`src/core/host-kernel.ts`, `host-entry.ts`, `host-draw.ts`, `host-compute.ts`, `resident.ts`, `tiers.ts`), the op library and the oracle (`src/core/cpu-runtime.ts`, `oracle.ts`, `cpu-codegen.ts`), a new encoder and a new libm beside them, the region (`src/runtime/region.ts`), the CPU backend of the RHI (`src/rhi/cpu.ts`), the generated module (`src/compiler/ts/host-face.ts`, `src/vite.ts`, `tshc`), `typeshade/runtime/internal`, the documents named below, and the downstream repositories. |
| Release version               | Unassigned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Review baseline               | The facts of the tree were read at `origin/main` `9c7b1899`. The branch then merged `origin/main` at `2efdff61`; the facts were not read again there. The first draft and the measurements of #459: `main` at `f637ae64251f7e49ffe42947e2371837d0bf32c6`.                                                                                                                                                                                                                                                                   |
| Review and revision authority | The first draft: [PR #460](https://github.com/typeshade/typeshade/pull/460). The revision: [PR #1162](https://github.com/typeshade/typeshade/pull/1162). Git records revisions. The review and the merge of a pull request record a decision.                                                                                                                                                                                                                                                                               |
| Earlier amendment, superseded | On 2026-10-13 the owner moved the new rule to the number 11.21 ("0042를 11.21로"). [fact] At `9c7b1899`, Rule 11.21 is the subgroup rule of proposal 0117 (`implemented`), and the last rule of §11 is Rule 11.23. The new rule takes the next free number at implementation. That number is 11.24 today. Rule 3.7 covers section numbers and codes, not rule numbers, so this is the practice of proposal 0059 and not a rule (N13).                                                                                       |

## What changes

The run layer gains a fourth tier, `'wasm'`, between `'webgl2'` and `'cpu'` in the default
order of Rule 11.8. The compiler encodes a module's IR to a WebAssembly binary at build time,
as it writes the JavaScript of the CPU tier today (Rule 11.7). The call layer runs the
asynchronous calls on it: a kernel function, a `@compute` entry's invocations and a full-screen
`@fragment` entry's pixels.

The WebAssembly tier stands beside the JavaScript CPU tier (proposal 0138, Amendment A4). The
CPU tier has two forms, and a named gate holds each form to the oracle bit for bit (decision
C5).

The memory of the tier is the one global region of proposal 0138 (R17). A resource is computed
where it lies. Stage 1 also writes an engine-independent libm for `f32` and `f64`, which the
oracle and both CPU tiers use. Stage 1 runs on the calling thread.

Nothing an author writes changes. No name, type, attribute or diagnostic code is added.

### Terms

| Term                | Meaning in this proposal                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript CPU tier | The tier named `'cpu'`: the oracle's generated JavaScript (`generateModuleJs`, Rule 11.7).                                              |
| WebAssembly tier    | The tier named `'wasm'`: the oracle's generated WebAssembly.                                                                            |
| CPU tiers           | The JavaScript CPU tier and the WebAssembly tier.                                                                                       |
| Interpreter         | The oracle's tree walk (`src/core/oracle.ts`), which the generated JavaScript is held to.                                               |
| Region              | The one global memory region of proposal 0138, R17 (`src/runtime/region.ts`, `globalRegion()`).                                         |
| Resource            | A `Buffer<T>` or a `Uniform<T>` of proposal 0138 (`zeros`, `array`, `uniform`, an exported binding), and the host copy of a `Resident`. |
| Plain data          | A typed array, an array or an object that a host passes to a call (Rule 8.21).                                                          |
| WGSL array          | An `array<T, N>`, a storage array and a kernel function's array parameter: an array whose type is borrowed from WGSL.                   |
| libm                | The routines for the functions that ECMAScript leaves to the engine and that WebAssembly has no instruction for (the list is below).    |

### Before and after, for a host

An author's `"use typeshade"` file is the same before and after. The table shows what a host
sees.

| Subject                                 | Today (`main` at `9c7b1899`)                                                                                        | After stage 1                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| What an author writes                   | A `"use typeshade"` file.                                                                                           | The same file. No change.                                                                                                                            |
| The default tier order                  | `webgpu`, `webgl2`, `cpu` (`TIERS` in `src/core/tiers.ts`).                                                         | `webgpu`, `webgl2`, `wasm`, `cpu`.                                                                                                                   |
| `prefer`                                | `configure({ prefer })` and `createDevice({ prefer })` take the three names.                                        | Both take `'wasm'` too. `prefer: ['wasm']` makes the tier required: a call that it cannot run throws an `Error` with the reason.                     |
| `prefer: ['cpu']`                       | The JavaScript CPU tier alone.                                                                                      | The same. A host that lists tiers by name gets the WebAssembly tier only when it adds `'wasm'`.                                                      |
| `device.tier`                           | `'webgpu'`, `'webgl2'` or `'cpu'`.                                                                                  | Also `'wasm'` (N8). A host that compares `device.tier` with `'cpu'` to mean "no GPU" must also compare with `'wasm'`.                                |
| A console event's tier label            | `GPU` or `CPU` (`ConsoleTier` in `src/core/console-print.ts`, surface §66).                                         | `GPU`, `WASM` or `CPU`.                                                                                                                              |
| A read past a WGSL array's end, on CPU  | `undefined`, which becomes `NaN` in arithmetic. The `NaN` shows the bug.                                            | The element at the last index, as WGSL clamps the index. The bug is silent, as it is on a GPU.                                                       |
| A write past a WGSL array's end, on CPU | The interpreter and the generated JavaScript store the value, and a later read of that index gives it back.         | The write is dropped.                                                                                                                                |
| `sin`, `exp`, `pow` and the like on CPU | The answer of the engine's `Math` (`COMPONENTWISE` in `src/core/cpu-runtime.ts`). V8 and JavaScriptCore may differ. | The answer of the libm, for `f32` and `f64`. It is the same on every engine that the gate covers. It may differ from today's answer in the last bit. |
| `Math.sin(t)` in a helper, on an `f64`  | Equal to the host's `Math.sin(t)`.                                                                                  | The libm's answer. It may differ from the host's `Math.sin(t)` in the last bit.                                                                      |
| The bits of a NaN in memory             | Not settled.                                                                                                        | The canonical quiet NaN, on the interpreter and on both CPU tiers.                                                                                   |
| A resource on a CPU tier                | Not applicable: no call takes a resource yet (proposal 0138, milestone 3).                                          | The tier reads and writes the resource's range of the region. It makes no copy.                                                                      |
| A call with plain data                  | The JavaScript CPU tier converts each array to the oracle's values for each call.                                   | The WebAssembly tier copies the bytes into the region in the layout of Rule 6.8 and writes them back in place.                                       |
| A page that refuses WebAssembly         | Not applicable.                                                                                                     | The call runs on the JavaScript CPU tier. The reason joins the list that the call's error names. The page loses speed and nothing else.              |
| A synchronous helper call (Rule 8.21)   | The JavaScript CPU tier.                                                                                            | The JavaScript CPU tier. No change.                                                                                                                  |

One example of the out-of-range change (decision D4, confirmed "유지"):

```ts
'use typeshade';
export function f(i: i32): f32 {
  let xs: array<f32, 3> = [1, 2, 3];
  xs[i] = 7;
  return xs[i] + xs[2];
}
```

[fact] For `i = 5`, the interpreter and the generated JavaScript give 10 today. The store is
`base[i] = value` (`src/core/oracle.ts`, line 545; `src/core/cpu-codegen.ts`, line 1225), so
`xs[5]` holds 7 and reads back as 7. After decision D4 the write is dropped and the read is
clamped to `xs[2]`, so the result is 6 on every tier. A program whose index is in range does
not change.

### What runs on the tier

Stage 1 runs the asynchronous calls that own a loop:

- a kernel function's body when no GPU tier takes it, and its loops;
- a `@compute` entry's dispatch: every invocation of every workgroup, in order, with the
  workgroup variables zeroed for each workgroup, as `src/core/host-entry.ts` does;
- a full-screen `@fragment` entry's pixels into the `ImageData` that the JavaScript CPU tier
  writes today.

The loop over the invocations, the iterations or the pixels runs inside the module, on the
calling thread (decision C2). A call that the tier cannot encode names its reason, and the call
falls to the JavaScript CPU tier. Stage 1 encodes no texture call, no barrier, no `Map` or `Set`
and no loop that pushes. Each of those runs on the JavaScript CPU tier where that tier runs it
today.

The synchronous helper call is never a target of this tier (decision D2).

### The numeric contract

- The module is lowered as the CPU engines lower it: `autoVars`, then the `f32` precision pass.
  `fp64Lower` does not run, since WebAssembly computes `f64` natively.
- An `f32` operation is computed in `f64` and demoted to `f32` where the IR has `__fround`.
  That is `Math.fround` after the operation, instruction for instruction.
- The five operations `+ − × ÷ sqrt` may be emitted as native `f32`. #459 (M2) measured them
  identical on 1 048 576 inputs with the edge values. The double-rounding theorem proves it
  (53 ≥ 2 · 24 + 2). The native list grows only by a proof or a sweep of that form. No other
  `f32` operation is WebAssembly's own `f32` operation.
- The libm computes each function of its list (below). The module imports nothing from the
  host's `Math`.
- A NaN is made canonical at each store to memory and at each `bitcast` (decision C3, below).
- Each helper's rule is ported, and a named test holds it (the table of decision C5, below).

### Two forms and their gates (decision C5)

[decision] The owner chose "규칙을 고침: 두 구현 + 게이트". Rule 11.7 and Rule 11.1 say today that
the CPU tier is "the oracle and not a fourth implementation". The encoder is a second
hand-written code generator, and it ports each helper's rule. So the rules are amended: the CPU
tier has two forms, the generated JavaScript and the generated WebAssembly, and a named gate
holds each form to the oracle bit for bit.

[decision, cost recorded] Two implementations must be maintained. A change to a helper's rule
is made in the interpreter, in `src/core/cpu-codegen.ts` and in the encoder.

The gates, for each ported rule. "Today" names what holds the JavaScript form at `9c7b1899`.
Whether today's inputs include each edge case was not read for this revision; the milestone in
the last column adds the missing inputs and the WebAssembly case.

| Ported rule                                                                    | Holds the JavaScript form today                                                                  | Holds the WebAssembly form                                                                                  | Milestone |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------- |
| Integer division and remainder (a zero divisor, `INT_MIN / −1`)                | `src/core/cpu-codegen.test.ts` (the integer cases); `src/core/backends/glsl-int-answers.test.ts` | `src/core/wasm-codegen.test.ts`, the same inputs, against the interpreter                                   | 1e        |
| Saturating conversions (`f32ToI32Sat` and the others, with their exact bounds) | `src/core/cpu-codegen.test.ts`; no test names `f32ToI32Sat` today                                | `src/core/wasm-codegen.test.ts`, with each bound and its two neighbours                                     | 1e        |
| The summation order of `dot`, `length`, `normalize` and `cross`                | `src/core/cpu-codegen.test.ts` (both precisions, bit for bit with the interpreter)               | `src/core/wasm-codegen.test.ts`, on inputs where another order gives other bits                             | 1e        |
| The reduction tree of Rule 7.2                                                 | `src/core/kernel-tree.test.ts`                                                                   | `src/core/wasm-codegen.test.ts` and the `'wasm'` arm of `gate:differential`                                 | 1e, 1g    |
| The libm functions                                                             | None: the functions are the engine's `Math` today                                                | The libm test (form against form) and the libm arm of `gate:differential` (engine against engine), below    | 1a        |
| NaN canonicalization                                                           | None                                                                                             | A case in `src/core/cpu-codegen.test.ts` and in `src/core/wasm-codegen.test.ts` that reads the stored bits  | 1b, 1e    |
| Out-of-range access                                                            | None for the new behaviour                                                                       | The same cases in both tests: the last index, one past it, a negative index, an array with no element (N12) | 1c, 1e    |
| Every other operation                                                          | `src/core/cpu-codegen.test.ts`; `gate:differential` (the seeded corpus against the `f32` oracle) | `src/core/wasm-codegen.test.ts` on the same inputs; the `'wasm'` arm of `gate:differential`                 | 1e, 1g    |

The named gate of the amended Rule 11.7 is the pair: `src/core/wasm-codegen.test.ts` (in Node,
with no browser) and the `'wasm'` arm of `gate:differential` (in Chromium).

### The libm (decisions D9 and C1)

[decision] D9: an engine-independent libm is part of stage 1. C1 ("f32와 f64 모두"): the libm
serves an `f32` operand and an `f64` operand.

[fact] Today the oracle computes these functions with the engine. `COMPONENTWISE` in
`src/core/cpu-runtime.ts` (lines 360 to 392) binds 17 functions to a `Math` member (`sin`,
`cos`, `tan`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `exp`,
`log`, `log2`, `atan2`, `pow`). It computes `exp2` as `2 ** x` and `ldexp` as `x * 2 ** e`. The
interpreter, the generated JavaScript and every helper read that one table.

[fact] ECMA-262 (the draft at tc39.es, read 2026-11-10) says of `Math.sin` that it returns "an
implementation-approximated Number value", and the same of the other 16 members and of
`Number::exponentiate`, which is `**`. It says of `Number::multiply` that it follows "IEEE
754-2019 binary double-precision arithmetic", and the same of add, subtract and divide. It
says of `Math.sqrt`: "Return 𝔽(the square root of ℝ(n))", which is one rounding of the exact
root. It defines `Math.fround` as a conversion to binary32 with `roundTiesToEven`.

The list of the libm is therefore 19 functions: the 17 above, `exp2` and `ldexp`. [fact] The
same file also writes `2 ** c` for an integer `c` from 0 to 32 (lines 289 to 298, the bit
fields). Milestone 1a replaces those with a shift or a table. No other engine-dependent helper
was found by a search of `src/core/cpu-runtime.ts` and `src/core/scalar-arith.ts` for `Math.`
and `**`. Other files of the op library were not searched.

[inference] The libm must replace those entries in the one table. Rule 11.7 holds the generated
code to the interpreter bit for bit. So the interpreter, the JavaScript CPU tier and the
WebAssembly tier must call the same routines.

**The source and the two forms.** [proposal]

- The libm is written once, in `"use typeshade"`, as the common modules are (Rule 11.20). The
  compiler lowers it to the IR. `src/core/cpu-codegen.ts` writes the JavaScript form from that
  IR, and the encoder writes the WebAssembly form from the same IR. The two forms are not two
  hand-written texts.
- Each function is its own module with its own export (`sin` for `f32`, `sin` for `f64`, and so
  on). A generated module imports only the routines that it calls, by name. No table holds them
  all in the op library, so a bundler drops the unused ones (decision C6).
- A routine uses only these operations: `f64` `+ − × ÷`, `sqrt`, `floor`, comparisons, `i32` and
  `u32` arithmetic and shifts, conversions between `f64` and `i32`, and constant tables.
- A routine uses no 64-bit integer. JavaScript has none without `BigInt`, and the surface has
  none. An algorithm that needs a 64-bit product is written with `u32` halves or with `f64`
  pairs, or it is not used. The cost: a published algorithm that needs `fma` or a 128-bit
  integer cannot be ported as it is.
- A routine reads the bits of an `f32` with `bitcast<u32>`, which the IR has. To read the bits
  of an `f64` it needs one compiler-internal operation that gives the high and the low `u32`
  word. The JavaScript form computes it with a `DataView` and an explicit byte order, as
  `_bitcastView` does for `f32` (`src/core/cpu-runtime.ts`, line 107). The WebAssembly form
  computes it with `i64.reinterpret_f64` and two shifts. The operation is not an author-facing
  name (Rule 9.8).
- The alternative is two hand-written texts held equal by a test. Open question N14.

**What this shows, and what the proposal promises.**

| Guarantee                                         | Status                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The same bits from both forms                     | Not by construction alone. One IR feeds both code generators, and each operation in the list above is defined exactly by ECMA-262 and by WebAssembly. The promise rests on the code generators, so a test holds it: the libm test compares the two forms on a seeded set of inputs for each function, and on every edge value. |
| The same bits on every engine                     | Promised for the engines that the gate runs: V8 in Node, JavaScriptCore in Bun and V8's WebAssembly in Chromium. For SpiderMonkey and Safari's WebAssembly the argument above stands, and no gate checks it.                                                                                                                   |
| Correctly rounded, one-argument `f32` functions   | Not promised yet. Such a function has 2³² inputs, so a sweep can check every input against a correctly rounded reference. The proposal claims "correctly rounded" for a function only after that sweep ran and found 0 differences. The sweep has not run. N9.                                                                 |
| Correctly rounded, `f32` `pow`, `atan2`, `ldexp`  | `ldexp` is exact scaling with one rounding, and the proposal promises it correctly rounded. `pow` and `atan2` have 2⁶⁴ input pairs, which no sweep covers. The proposal promises a stated bound in ULP for each, with a sampled sweep as evidence. The bound is not chosen yet. N9.                                            |
| Correctly rounded, any `f64` function             | Not promised, except `ldexp`. An `f64` function has 2⁶⁴ inputs. The proposal promises a stated bound in ULP for each, not chosen yet. N9.                                                                                                                                                                                      |
| At least as accurate as the engine's `Math` today | Not measured. The sweep of N9 reports the largest distance from the reference for the libm and for each engine's `Math`.                                                                                                                                                                                                       |

**The gate that compares engines.** [proposal] The repository holds, for each function and each
precision, a file of seeded inputs and the hash of the libm's results. A unit test checks the
JavaScript form against it in Node (V8). The libm arm of `gate:differential` checks the
JavaScript form in Bun (JavaScriptCore) and the WebAssembly form in Chromium against the same
file. [fact] That CI job runs under Bun and installs Chromium (`.github/workflows/ci.yml`,
lines 298 to 306).

**Compile-time evaluation.** [fact] Three compile-time evaluators compute a builtin:

- `evalConst` in `src/compiler/ts/loop-bound.ts` (lines 111 to 115) and
  `src/compiler/ts/module-const-f64.ts` (line 70) read the oracle's `BUILTINS` table. The
  comment says: "the value the CPU backends give the same call". They take the libm with the
  table, with no change of their own.
- `CONST_CALLS` in `src/compiler/ts/loop-bound.ts` (lines 712 to 731) stands in for Tint's
  constant checks (Rules 12.6 and 13.3). Its reference is Tint, measured on Tint in Chromium
  (#613). It is not the CPU tier, and it keeps the engine's `Math`.
- `src/core/passes/opt/const-fold.ts` folds only `EXACT_BUILTINS`, which have one correct
  answer. It does not change.

**The costs of the two decisions.**

- **CPU results change in the last bit.** A program that calls one of the 19 functions may get
  a different last bit on the JavaScript CPU tier than it gets today.
- **A helper's `Math.sin` may differ from the host's.** After C1, `Math.sin(t)` on an `f64` in a
  `"use typeshade"` function and `Math.sin(t)` in the host file may differ in the last bit.
  Rule 1.3 and Rule 9.4 record the divergence.
- **Tests that pin `Math` results.** [fact] At `9c7b1899`, 31 test files under `src/` contain a
  call of a `Math` transcendental. Examples: `src/compiler/ts/host-kernel.test.ts`,
  `host-draw.test.ts`, `src/core/kernel-tree.test.ts`, `src/common-modules.test.ts`. How many
  use the call as an expected value is not counted. Each such expectation must read the libm.
- **Goldens.** [fact] `examples/__emit-goldens__/` holds emitted text, not computed values. So
  no emit golden is expected to change. This is not verified by a run.
- **Size.** Not measured. The `f64` routines double the count. Decision C6 sets how the size is
  handled.
- **Speed.** Not measured. The engine's `Math.sin` is native code. The interpreter walks the
  libm's IR or calls its JavaScript form (N14). The validation record reports the time of each
  routine against `Math`, on Node and on Bun.
- **The GPU does not follow.** A GPU's `sin` stays the driver's (surface §38). The gates that
  compare a GPU with the oracle keep their ULP room for these functions.
- **What a user gains.** CPU results are the same on the engines that the gate covers. A test
  that passes on one engine passes on the others.

### NaN bits (decision C3)

[decision] The owner chose "저장할 때 정규화". A NaN is made canonical at each store of an `f32`
or an `f64` to memory and at each `bitcast`. The canonical NaN is the quiet NaN with a positive
sign and no payload (`0x7FC00000` for `f32`). The interpreter, the JavaScript CPU tier and the
WebAssembly tier all do it, so a host that reads a view of the region sees one bit pattern.

A check costs one comparison at each such store. The cost is not measured. Milestone 1b adds
it to the interpreter and the JavaScript CPU tier. Milestone 1e adds it to the encoder.

### Out-of-range access (decisions D4 and C4)

[decision] D4 ("두 CPU 티어 모두 GPU처럼", confirmed "유지" after the reviewer's cost): both CPU
tiers behave as the GPU does. A read past a WGSL array's end gives the element at the last
index. A write past its end is dropped.

[decision] C4 ("WGSL 배열만"): D4 covers a fixed-size array and a storage array. An ECMAScript
list keeps ECMAScript's meaning.

[fact] At `9c7b1899` every array that an author can index is a WGSL array: an `array<T, N>`, a
storage array, or a kernel function's array parameter (surface §63 says that the methods "work
on an `array<T, N>`"). The ECMAScript collections are `Map` and `Set`. `m.get(k)` is read only
where `m.has(k)` guards it, so no read of a missing key exists:

```ts
out[i] = last.has(keys[i]) ? last.get(keys[i])! : -1.; // ECMAScript's meaning, unchanged
```

[inference] So C4 changes nothing at this baseline. It binds a later form: a list that is not
a WGSL array reads `undefined` past its end, as ECMAScript does, or the compiler refuses the
read. Whether a kernel function's array parameter is a "storage array" for C4 is taken as yes
here, since it is bound as one on a GPU; N12 asks the owner to confirm it.

[inference] The interpreter takes the same behaviour, because the gate holds both forms to it.
The WebAssembly tier checks each indexed access whose index the compiler has not proved in
range. A check costs one comparison. The cost is not measured.

[decision, costs recorded]

1. The JavaScript CPU tier's present behaviour changes for a read: `undefined` today, the last
   element after.
2. It changes for a write: stored and readable today, dropped after (the example above: 10
   becomes 6).
3. An out-of-range bug becomes silent on the CPU tiers. Today the `NaN` of a read past the end
   shows it. A development-mode warning is the stated way to find such a bug. It is not part of
   this proposal: open question L1, for a later proposal.

Surface §38 gains a row. The cases this text does not settle are open question N12.

### Memory: the region is the module's linear memory

[decision] The owner chose "영역을 WASM 메모리로" on 2026-11-10. The region of proposal 0138
(R17) is the linear memory of the WebAssembly tier. One region serves every device of a page
(proposal 0138, Amendment A4).

- Each generated module imports one `WebAssembly.Memory`, the region. No module exports a
  memory of its own. The first draft gave each module its own memory; the revision removes
  that.
- A resource is a byte range of the region, laid out by Rule 6.8. The WebAssembly tier takes
  the range's offset and length at each call, and it reads and writes the resource where it
  lies. It makes no copy.
- A call with plain data copies the bytes into a staging range of the region. After the call,
  it writes the changed arrays back into the caller's arrays in place (Rule 8.23). It frees the
  staging range.
- The host copy of a `Resident` is a range of the region. So a call on a `Resident` copies
  nothing on this tier.
- A resource that lives only on a GPU device takes no range (R17).
- Scalars and vectors that a function takes by value are WebAssembly parameters, one for each
  component. A vector result is a multi-value return.

**A page that refuses WebAssembly keeps the `ArrayBuffer`.** [proposal] The region starts as
the `ArrayBuffer` of today (`src/runtime/region.ts`, resizable where the runtime has one). It
becomes a `WebAssembly.Memory` when the first module of the page compiles: the runtime makes
the memory, copies the region into it once and moves the region's generation. On a page where
no module compiles, the region never changes. Such a page keeps the growth in place of
`src/runtime/region.ts` (lines 174 to 185) and pays no detach.

**Compaction and a module's own data.** [fact] `#compact` moves every live range down and moves
the generation (`src/runtime/region.ts`, lines 159 to 170). [proposal] A module's own data is
its workgroup variables, its local arrays, its console scratch and the constant tables of the
libm routines it calls. The runtime allocates that data as one range for each instance. The
runtime passes the range's present offset to the module at each call, as it passes a resource's
offset. So the base follows a compaction. No module holds an offset between two calls. The
region does not compact or grow while a call runs, which holds on one thread (decision C2).
The alternative, a range that compaction never moves, is part of N1.

[fact] No call takes a `Buffer<T>` or a `Uniform<T>` yet: that is milestone 3 of proposal 0138.
So stage 1 delivers the mechanism (a range that a module can address) and uses it for
`Resident` arrays and for plain data. Milestone 3 of proposal 0138 then passes a resource
through the same mechanism.

`docs/typeshade-plan.md` unit R2 says "One `WebAssembly.Memory` per device owner". The
implementing pull request writes it again: one region for the page (Amendment A4 of 0138).

How the region grows once it is a `WebAssembly.Memory` is open question N2.

### The tier names, the RHI and the compute runner

[fact] `TIERS` in `src/core/tiers.ts` is the list of the tiers a call may run on. `RhiDevice`'s
`backend` (`src/rhi/rhi.ts`, line 377) is the list of the RHI's backends: `'webgpu'`,
`'webgl2'` and `'cpu'`, the software backend of change 0120.

[proposal] The two lists are different lists, and they stay different:

- `TIERS` gains `'wasm'` (milestone 1f). `Device`'s `tier`, `DeviceInfo`'s `tier`,
  `ComputeBackend` and `FuseReport`'s `tier` follow it.
- `RhiDevice`'s `backend` does not gain `'wasm'`. The WebAssembly tier is a code form of the
  software backend: a `CpuProgram` (`src/rhi/cpu-program.ts`) carries the JavaScript form and,
  where the module compiled, the WebAssembly form. A device whose `tier` is `'wasm'` holds the
  software `RhiDevice`, whose `backend` is `'cpu'`. The prerequisite pull request states in
  `src/rhi/rhi.ts` why its list is not `TIERS`.
- `RuntimeTier` (`src/runtime/runtime.ts`, line 91) is the program runtime's list. It does not
  gain `'wasm'` in stage 1.
- `createComputeRunner`'s `DEFAULT_PREFER` is `TIERS` (`src/core/compute/runner.ts`, line 198),
  so it gains `'wasm'` with the list. In stage 1 the runner does not run a portable kernel on
  the WebAssembly tier. It records `'wasm'` in `rejected` with the reason, as a
  `RejectedBackend`, and goes on to `'cpu'`. A later milestone may make it run.

[fact] The reviewer counted 36 comparisons of a tier with `'cpu'` in `src/` and `scripts/` (for
example `src/runtime/runtime.ts`, line 318, and `scripts/user-journey.ts`). A search for
`=== 'cpu'` and `!== 'cpu'` alone finds 28. The prerequisite pull request could not reproduce
the 36 and lists what it measured (Amendment A1). Each one is read in milestone 1f: it means the
JavaScript CPU tier, or it means "no GPU" and must include `'wasm'`. The same risk exists in a
downstream host (`device.tier === 'cpu'`).

### The artifact (decision D6)

- A hand-written binary encoder in the compiler (`src/core/wasm-codegen.ts`, beside
  `src/core/cpu-codegen.ts`) writes the module. It uses no binaryen, no emscripten and no new
  dependency.
- Vectors and matrices are scalarized into locals. Arrays live in the region.
- [decision] The Vite plugin and `tshc` emit the binary as a `.wasm` asset. The generated module
  loads it with `instantiateStreaming`. An inline form is the fallback for a bundler that emits
  no asset. The inline form compiles asynchronously too.
- The inline form is a choice of the build. It is not a second copy that a page falls to at run
  time.
- [proposal] When the fetch of the asset fails, the module's calls run on the JavaScript CPU
  tier, with the reason. When the response has the wrong MIME type, `instantiateStreaming`
  rejects; the loader then compiles the response's bytes with `WebAssembly.instantiate`.
- `WebAssembly.validate` is the gate's compiler for the binary. The gate feeds it a broken
  module first (AGENTS.md#gate-discipline).
- The runtime instantiates a module that the build wrote. It builds no code at run time.
- `scripts/bundle-boundary.ts` admits only local JavaScript assets today. It must admit a
  `.wasm` asset (Rule 11.11; proposal 0138, Q10).

### The bundle budget (decision C6)

[decision] The owner chose "측정 후 예산을 올림".

- Each implementing pull request measures the bundles with `scripts/bundle-boundary.ts`.
- It sets each cap of `scripts/bundle-budget.json` that moved to the measured size.
- It records the sizes in `CHANGELOG.md`, as the entries of proposal 0138's milestone 1 do.
- The libm is split so that only the functions a bundle uses enter it: one module and one
  export for each function and precision, imported by name (above). It is not one table.
- The agent reports the measured sizes to the owner when they are measured.

[fact] `scripts/bundle-budget.json` holds caps for `typeshade/runtime`, `typeshade/emit`,
`typeshade/fuse`, `typeshade/algorithms` and `typeshade/random` at `9c7b1899`.

### The two CPU tiers

The JavaScript CPU tier stays (proposal 0138, Amendment A4). It runs:

- the synchronous helper call (Rule 8.21);
- every call on a page that refuses WebAssembly, for example a page whose content security
  policy lacks `'wasm-unsafe-eval'`;
- every call of a module whose asset did not load;
- every call that the WebAssembly tier does not encode.

### Stages

Each milestone is one or more pull requests, and each leaves `main` green.

**Prerequisite, its own pull request (decision of 2026-11-10: "먼저 별도 PR").** One authority
for the tier names. [fact] `src/core/tiers.ts` already holds `TIERS`, and
`src/core/compute/runner.ts` derives `ComputeBackend` and `DEFAULT_PREFER` from it. These unions
still write the names again: `DrawTier` (`src/core/host-draw.ts`), `CallTier`
(`src/core/host-entry-program.ts`) and `FuseReport`'s `tier` (`src/core/fuse-report.ts`, two
places). The prerequisite makes each read `TIERS`. It states in `src/rhi/rhi.ts` and in
`src/runtime/runtime.ts` why `RhiDevice`'s `backend` and `RuntimeTier` are other lists. It
changes no export's shape, so it needs no proposal.

**Stage 1, this proposal.**

| Milestone | Content                                                                                                                                                                                                                  | What changes for a host                                                                                      | Needs first    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------- |
| 1a        | The libm for `f32` and `f64`, in the oracle and the JavaScript CPU tier. Rules 1.3, 9.4 and 11.24 (the libm part). The libm test, the engine gate and the sweep. The tests that pin `Math` results read the libm.        | CPU results of the 19 functions; the same on the gated engines.                                              | N9, N14        |
| 1b        | NaN canonicalization in the interpreter and the JavaScript CPU tier.                                                                                                                                                     | The bits of a stored NaN.                                                                                    | —              |
| 1c        | The out-of-range behaviour in the interpreter and the JavaScript CPU tier. Rule 11.7, surface §38.                                                                                                                       | A read and a write past a WGSL array's end.                                                                  | N12            |
| 1d        | The region becomes a `WebAssembly.Memory` when a module compiles; the JavaScript CPU tier reads it. `docs/typeshade-plan.md` unit R2 is written again.                                                                   | Nothing while no module compiles. After 1f: a growth detaches the views, and accessors make them again (N2). | N1, N2, N4, N7 |
| 1e        | The encoder (`src/core/wasm-codegen.ts`) with every ported rule, NaN canonicalization and the bounds checks; `src/core/wasm-codegen.test.ts`; the `WebAssembly.validate` gate. No call uses it yet. Rules 11.1, 11.7.    | Nothing.                                                                                                     | —              |
| 1f        | The tier `'wasm'` in `TIERS`, for a kernel function: plain data copied in and written back, a `Resident` in place, the inline form, the console label `WASM`, the fallback reason. Rules 7.2, 11.8, 11.13, 11.20, 11.24. | The default order; `prefer: ['wasm']`; `device.tier`; the console label.                                     | N8             |
| 1g        | A `@compute` entry's dispatch and a full-screen draw on the tier. Surface §67. The `'wasm'` arm of `gate:differential`.                                                                                                  | Those calls run on the tier.                                                                                 | —              |
| 1h        | The `.wasm` asset in the Vite plugin and `tshc`, `instantiateStreaming`, `scripts/bundle-boundary.ts`. The measurements of N5. Rule 11.11.                                                                               | The asset in the build output.                                                                               | N5             |

[decision] Stage 1 has no speed threshold (decision D10: "기준 없이 진행"). The work does not
stop on a 2× gate. The validation record still reports the speed of the WebAssembly tier
against the JavaScript CPU tier.

**Stage 2, a later proposal.** `f32x4` for vector lanes (#459, M3: 3× over the scalar loop).
Barriers by loop fission. Textures by a software sampler, which closes roadmap X3 for every
example. The triangle draw of a render composition (N6).

**Stage 3, a later proposal.** Workers and a shared memory (decision C2). The tier as the
comparator of the divergence report (roadmap 19). Specialization for each override value when
roadmap 23 lands.

**Roadmap placement.** The work is milestone 2 of proposal 0138. `docs/roadmap.md` gains its row
there.

### Exclusions

- No change to what an author writes, to the IR's author-facing forms, to the WGSL writer or
  to the GLSL writer.
- No synchronous call on the tier. #459 (D2) records why: the boundary costs what the arithmetic
  costs, and a browser's main thread refuses the synchronous compilation of a module over 4 KB.
- No SIMD, no texture and no barrier on the tier in stage 1.
- No worker, no thread and no shared memory in stage 1, in a browser or in Node (decision C2).
- No new dependency.
- No change to what a GPU tier computes.
- No development-mode warning for an out-of-range access (L1).

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
for each million). It cannot run four lanes at once. Each of those is what WebAssembly is for.

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
  proposal 0138, Amendment A4). The synchronous helper and the fallback need it.
- **Importing the host's `Math`.** The first draft's stage 1. The owner chose the libm (D9).
- **A libm for `f32` only.** The owner chose both precisions (C1).
- **A 2× gate.** The first draft's stage 1 gate. The owner chose no threshold (D10).
- **A worker with a shared memory in stage 1.** The owner chose the calling thread (C2).
- **Keeping "not a fourth implementation".** The owner chose to amend the rules (C5).

### Assumptions

- Each operation in the libm's list gives the same bits in every engine. ECMA-262 and
  WebAssembly define each one exactly. The gate checks V8, JavaScriptCore and V8's WebAssembly.
- A `"use typeshade"` source can express the libm with the one internal operation named above.
  This is not shown by an experiment (N14).
- The measurements of #459 still hold at `9c7b1899`. They were not repeated.

## Owner's decisions

The proposal rests on these entries of `docs/owner-decisions.md`. It reverses none of them.

- **OD-1** (a language of its own): the tier changes no syntax and asks nothing of a TypeScript
  tool.
- **OD-3** (the language stays small; the compiler's work is not pushed onto the author): the
  tier, the memory layout, the libm and the bounds checks are the compiler's and the runtime's
  work. No author-facing name is added.
- **OD-4** (show the owner what changes): the table "Before and after, for a host" and the
  example are above, and each decision below records its cost.
- **OD-6** (nothing is released yet): the change of CPU results in milestones 1a to 1c owes no
  warning release under Rules 13.9 and 13.10.

OD-2, OD-5 and OD-7 concern what an author writes. The proposal touches none of them.

**The first eight decisions**, taken on 2026-11-10 in the Claude Code session. The owner was
asked one question at a time, with options and costs.

| #   | Question                                    | The owner's words          | What it means                                                                                                                                                | Cost recorded                                                                                           |
| --- | ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| D1  | #459 D1, the tier's name                    | "'wasm'"                   | The tier is `'wasm'`. The order is `webgpu`, `webgl2`, `wasm`, `cpu`.                                                                                        | Nine exports take a fourth literal.                                                                     |
| D4  | #459 D4, out-of-range access                | "두 CPU 티어 모두 GPU처럼" | Both CPU tiers clamp a read to the last element and drop a write, as WGSL does.                                                                              | The JavaScript CPU tier's present behaviour changes for a read and for a write (below).                 |
| D2  | #459 D2, the synchronous helper             | "대상 아님"                | The synchronous helper call is never a target of this tier. It stays on the JavaScript CPU tier.                                                             | A host loop of single calls gains nothing; it moves into the shader function (#410).                    |
| D6  | #459 D6, the artifact                       | "별도 파일 + 인라인 대체"  | An emitted `.wasm` asset loaded with `instantiateStreaming`, with an inline fallback.                                                                        | The plugin and `tshc` emit an asset; `scripts/bundle-boundary.ts` changes.                              |
| D9  | #459 D9, the libm                           | "1단계에 포함"             | An engine-independent libm is part of stage 1. The owner chose this over the recommendation "a later stage".                                                 | CPU results change in the last bit; size and speed are not measured.                                    |
| D10 | #459 D10, the gate                          | "기준 없이 진행"           | No speed threshold. The owner chose this over keeping the 2× gate. The speed is still measured and reported. The roadmap placement is milestone 2 of 0138.   | The tier may land without a proven gain on some workloads. `docs/typeshade-plan.md` still names a gate. |
| D1p | #459 D1 prerequisite                        | "먼저 별도 PR"             | The tier-name unification lands as its own pull request before the first implementing pull request.                                                          | One more pull request.                                                                                  |
| M   | The relation to the region of proposal 0138 | "영역을 WASM 메모리로"     | The region of R17 is the module's linear memory. A resource is computed where it lies. Plain data is copied in and written back. One region for all devices. | Every device of a page shares wasm32's 4 GiB (Amendment A4 of 0138). Unit R2 of the plan is rewritten.  |

**The seven further decisions**, taken on 2026-11-10 in the same session, on the conflicts that
the first revision listed (C1 to C4) and on two conflicts that the independent review found
(C5, C6). Each conflict named both sources and showed one example.

| #   | Conflict                                                                                                                                                           | The owner's words               | What it means                                                                                                                                                                                                    | Cost recorded                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | The libm (D9, Rule 1.6) against Rule 1.3, "ECMAScript's result for a form borrowed from ECMAScript", for `Math.sin` on an `f64`.                                   | "f32와 f64 모두"                | The libm serves `f32` and `f64`. Rule 1.3 and Rule 9.4 are amended.                                                                                                                                              | A TypeShade function that calls `Math.sin` on an `f64` may differ from the host's `Math.sin` in the last bit. Twice the routines; their size and speed are not measured. |
| C2  | `docs/typeshade-plan.md` area W ("threads, shared memory and asynchronous calls are the default") against stage 1 with no thread and the region of 0138 (R17, A1). | "1단계는 호출한 스레드"         | Stage 1 runs on the calling thread, in a browser and in Node. Workers and a shared memory are a later stage. Area W of the plan is written again at implementation.                                              | A long call blocks the calling thread, as the JavaScript CPU tier does today.                                                                                            |
| C3  | Proposal 0138 R16 ("a NaN result is made canonical") against the numeric contract of #459 (D3), which did not settle the bits of a NaN.                            | "저장할 때 정규화"              | A NaN is made canonical at each store to memory and at a `bitcast`, on the interpreter, the JavaScript CPU tier and the WebAssembly tier.                                                                        | One comparison at each such store; not measured.                                                                                                                         |
| C4  | D4 against Rule 1.3 for an ECMAScript list, where `xs[xs.length]` is `undefined`.                                                                                  | "WGSL 배열만"                   | D4 covers a fixed-size array and a storage array. An ECMAScript list keeps ECMAScript's meaning.                                                                                                                 | Two meanings of an index past the end, if a list form is ever added.                                                                                                     |
| D4′ | The reviewer's cost of D4: today a write past the end is stored and readable on the CPU, and a read past the end becomes `NaN` and shows the bug.                  | "유지"                          | D4 stands. After it the example gives 6 where it gives 10 today, and the bug is silent on every tier.                                                                                                            | The two costs above. A development-mode warning is left to a later proposal (L1).                                                                                        |
| C5  | Rules 11.7 and 11.1 ("not a fourth implementation") against a hand-written encoder that ports each helper's rule.                                                  | "규칙을 고침: 두 구현 + 게이트" | Rules 11.7 and 11.1 are amended: the CPU tier has two forms, the generated JavaScript and the generated WebAssembly, and a named gate holds each to the oracle bit for bit.                                      | Two implementations to maintain.                                                                                                                                         |
| C6  | Rule 11.11's bundle budget against a libm and glue of unknown size.                                                                                                | "측정 후 예산을 올림"           | Each implementing pull request sets the moved caps of `scripts/bundle-budget.json` to the measured sizes and records them in `CHANGELOG.md`. The libm is split by function. The sizes are reported to the owner. | The caps rise by an amount that is not measured yet.                                                                                                                     |

Decisions of the owner that this proposal takes from proposal 0138:

- 2026-11-10, Amendment A4: "JS 옆에 병행". The WebAssembly tier stands beside the JavaScript CPU
  tier.
- 2026-11-10, Amendment A4: "전역 하나". One global region, shared by every device.
- 2026-11-09, Amendment A1: "접근자가 다시 만듦". An accessor makes its views again after a growth
  of the region.

The seven open questions of #459 are closed. No conflict is open.

## Open questions

Each question has the author's recommendation and its cost. The owner is asked each one before
the milestone that needs it starts (the table after this one).

| #   | Question                                                                                                 | Recommendation                                                                                                                                                                                                                                                                                                             | Cost of the recommendation                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | One instance for each shader module, or one for the page? Where does a module's own data live?           | One instance for each shader module. Every instance imports the one memory. A module's own data is one range, whose offset the runtime passes at each call. The alternative for that data is a range that compaction never moves.                                                                                          | No isolation between modules: a wrong offset in one module can write another module's resource. One more parameter at each call. Two copies of the runtime in one page have two regions.                                |
| N2  | How does the region grow once it is a `WebAssembly.Memory`?                                              | Only the runtime grows it, with `Memory.grow`, between calls. No module contains `memory.grow`. Each growth moves the generation, so each accessor makes its views again (A1 of 0138). The region grows by doubling. Verify `WebAssembly.Memory.prototype.toResizableBuffer()` as an option that keeps the views attached. | A `WebAssembly.Memory` never shrinks. Without a resizable buffer every growth detaches every view. Which engines have `toResizableBuffer()` is not verified. Doubling can reserve unused pages.                         |
| N4  | What happens at wasm32's 4 GiB?                                                                          | An allocation that the region cannot place throws a `RangeError` that names the resource and the region's size. `memory64` is not used.                                                                                                                                                                                    | A page's CPU-side data is limited to 4 GiB in total, across all devices (A4 of 0138). Engines may allow less; the limit of each engine is not measured.                                                                 |
| N5  | The bundle and build cost (Q10 of proposal 0138).                                                        | Measure by the plan below. Raise the caps to the measured sizes and report them to the owner (decision C6).                                                                                                                                                                                                                | The sizes may be large for a module that calls many libm routines.                                                                                                                                                      |
| N6  | How do the graphs and the render compositions of proposal 0138 (milestones 4 and 5) reach the tier?      | Through the software backend of the RHI: a `CpuProgram` carries the WebAssembly form beside the JavaScript form ("The tier names, the RHI and the compute runner"). A graph's calls run apart on the tier in stage 1, as on the JavaScript CPU tier.                                                                       | The vertex loop and the rasterizer (`src/rhi/cpu-raster.ts`) stay JavaScript in stage 1. A triangle draw would cross the boundary for each pixel, so it stays on the JavaScript CPU tier until stage 2.                 |
| N7  | A page that refuses WebAssembly: when is the refusal found?                                              | At the first compilation of each module. A failure records the reason for that module; its calls go to the JavaScript CPU tier and do not try again. The region stays an `ArrayBuffer` until a module compiles.                                                                                                            | One copy of the region at the first compilation. A page where one module compiles and another does not has both tiers in use.                                                                                           |
| N8  | Is `'wasm'` a tier that a device opens on (`createDevice({ prefer: ['wasm'] })`, `device.tier`)?         | Yes. A device opens on `'wasm'` when a probe module compiles. `device.skipped` names the reason when it does not. The JavaScript CPU tier stays the fallback of a call.                                                                                                                                                    | `Device`, `DeviceOptions` and `DeviceInfo` are reshaped. A host that compares `device.tier` with `'cpu'` must handle `'wasm'`.                                                                                          |
| N9  | The libm's accuracy claim, its bounds and its reference.                                                 | Claim the engine identity in Rule 11.24. Claim "correctly rounded" for a one-argument `f32` function only after a sweep of all 2³² inputs finds 0 differences. Give `pow`, `atan2` and every `f64` function a stated ULP bound. Run the sweep as a script outside the gates.                                               | The reference needs a correctly rounded source outside the repository's dependencies (for example the CORE-MATH C sources built by a script). The tool is not chosen. The time of a sweep is not measured.              |
| N12 | Out-of-range details.                                                                                    | An array with no element reads the zero value of its element type. An index is clamped as an unsigned number, so a negative `i32` index reads the last element. A vector or a matrix index is clamped the same way. A kernel function's array parameter is covered by D4.                                                  | "The zero value" is this proposal's choice where WGSL leaves room; a GPU may give another value, so surface §38 lists the row.                                                                                          |
| N13 | The new rule's number.                                                                                   | The next free number of §11 at implementation; 11.24 today. The implementing pull request amends the front matter first if another change took it.                                                                                                                                                                         | An amendment, if the number moves.                                                                                                                                                                                      |
| N14 | The source of the libm: one `"use typeshade"` source through both code generators, or two written texts? | One `"use typeshade"` source, with one internal operation for the bits of an `f64`. The interpreter calls the JavaScript form for these 19 functions and does not walk their IR.                                                                                                                                           | Not shown by an experiment. The interpreter then rests on `src/core/cpu-codegen.ts` for these functions, which the libm test must cover. If the surface cannot express a routine, the fallback is two texts and a test. |
| L1  | A development-mode warning for an out-of-range access on the CPU tiers.                                  | A later proposal, not this one. It would report the first out-of-range index with its line, as the divergence report of roadmap 19 reports a difference.                                                                                                                                                                   | Until then an out-of-range bug is silent on every tier.                                                                                                                                                                 |

N3, N10 and N11 of the first revision are closed: N3 by decision C2, N11 by decision C1, and N10
by the facts under "Compile-time evaluation".

**Open questions by milestone.**

| Milestone                 | Questions asked before it starts |
| ------------------------- | -------------------------------- |
| Prerequisite              | none                             |
| 1a. The libm              | N9, N14                          |
| 1b. NaN canonicalization  | none                             |
| 1c. Out-of-range          | N12                              |
| 1d. The region as memory  | N1, N2, N4, N7                   |
| 1e. The encoder           | N13                              |
| 1f. The tier for a kernel | N8                               |
| 1g. An entry and a draw   | none                             |
| 1h. The asset             | N5                               |
| Milestone 4 of 0138       | N6                               |
| A later proposal          | L1                               |

### The measurement plan for N5

Nothing below is measured yet. Each milestone that moves a number records it with its commit,
its machine and its tool versions, and the agent reports it to the owner.

1. Record the gzipped bytes of each bundle of `scripts/bundle-budget.json`, before and after.
2. Record the bytes of the `.wasm` asset of each module under `examples/`, raw and gzipped.
3. Record the bytes of each libm routine in each form, for `f32` and for `f64`.
4. Record the time that `compile()` takes with and without the encoder, over `examples/`.
5. Record the time of `instantiateStreaming` and of the inline form, in Chromium.
6. Record whether Chromium caches the compiled code of the asset on a second load.
7. Record the time of each kernel of the differential corpus at one million invocations, on the
   WebAssembly tier and on the JavaScript CPU tier, in Node and in Chromium.
8. Record the time of each libm routine against the engine's `Math`, in Node and in Bun.

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
checks, the NaN bits and the libm are the compiler's work (OD-3).

## What it touches

**Rules.** Each line says what the rule gains.

- Rule 1.3: a recorded divergence. A `Math` member whose result ECMAScript leaves to the engine
  gives the libm's result on the oracle, for `f32` and for `f64`. An index past the end of a
  WGSL array gives WGSL's permitted answer; an ECMAScript list keeps ECMAScript's.
- Rule 7.2: the reduction row names the WebAssembly tier among the tiers that fold in the tree
  order.
- Rule 9.4: one sentence. On the oracle and on both CPU tiers, a `Math` member that ECMAScript
  leaves to the engine is computed by the libm of Rule 11.24, so it may differ from the host's
  `Math` in the last bit.
- Rule 11.1: its rationale. The CPU tier has two generated forms, and a named gate holds each
  to the oracle bit for bit; "not a fourth implementation" is replaced by that statement.
- Rule 11.7: the CPU tier's two forms and their gate; their relation; the out-of-range
  behaviour; the canonical NaN; the libm in place of the engine's `Math`; the
  `'wasm-unsafe-eval'` note.
- Rule 11.8: the default order with `'wasm'`; what the tier runs; plain data copied in and
  written back; a `Resident` in the region; `'wasm'` as a device's tier (N8).
- Rule 11.11: an emitted asset may be a `.wasm` binary; the boundary check admits it; the caps
  follow the measurement (C6).
- Rule 11.13: the tier on which a `fuse` scope's calls run, and `FuseReport`'s `tier`.
- Rule 11.20: a common module's function gives the oracle's bits "on WebGPU, on WebGL2 and on
  the CPU tier" today; the sentence names the WebAssembly tier too.
- Rule 11.24 (new; the next free number at implementation): the numeric contract (the lowering,
  the demote at each rounding point, the five native operations, the ported helper rules, the
  canonical NaN), the libm (the 19 functions, the one source, the guarantee and its gate), and
  the artifact (the encoder, the asset, `WebAssembly.validate`).

**Surface.** §38: a row for the out-of-range access. §64: the tiers of a call. §65: the tiers of
a kernel. §66: the `WASM` console tier label. §67: the tiers of an entry and of a draw.

**Exports.** Each of these carries the tier union in `src/__api__/surface.md` at `9c7b1899` and
gains `'wasm'`.

- `configure`: its `prefer` option. `createDevice` takes the union through `DeviceOptions`; its
  own line of the surface does not change.
- `DeviceOptions`: its `prefer` option.
- `Device`: `tier` and the `tier` of each entry of `skipped`.
- `DeviceInfo`: `tier`.
- `ComputeBackend`, `ComputeRunner` (`backend`), `ComputeRunnerOptions` (`prefer`) and
  `RejectedBackend` (`backend`), of `typeshade/compute`.
- `FuseReport`: its `tier` fields.

No export is added. No export is removed.

**Codes, examples, names.** None.

**Files.** `src/core/tiers.ts` (the list); `src/core/wasm-codegen.ts` (new); `src/core/host-wasm.ts`
(new: the tier's call path); the libm's source and its two generated forms (new; the paths are
not chosen); `src/core/cpu-runtime.ts` (`COMPONENTWISE`, the bit fields); `src/core/oracle.ts`
and `src/core/cpu-codegen.ts` (the out-of-range behaviour, the canonical NaN);
`src/runtime/region.ts` (the memory); `src/rhi/cpu.ts` and `src/rhi/cpu-program.ts` (N6);
`src/compiler/ts/host-face.ts`, `src/vite.ts` and `tshc` (the asset); `src/core/console-print.ts`
(the label); `scripts/bundle-boundary.ts` and `scripts/bundle-budget.json`; the comparisons with
`'cpu'` in `src/` and `scripts/`.

**Tests and gates.** The table under "Two forms and their gates". Also: the libm test and the
libm arm of `gate:differential`; the compile gate's entry-call leg on the tier;
`src/compiler/ts/host-kernel.test.ts` and `host-entry.test.ts` (each tier's reason, the required
tier); a region test (the change to a `WebAssembly.Memory`, a growth, a compaction between two
calls of one module); a journey with `prefer: ['wasm']`; a journey on a page whose policy
refuses WebAssembly; a journey whose asset does not load.

**Documents.** `docs/typeshade-plan.md` (unit R2; area W's text on the gate, on threads and on
Node); `docs/roadmap.md` (the row under milestone 2 of 0138); `CHANGELOG.md`; `reqs/` by
`bun run reqs:sync`.

**An amendment owed to proposal 0138.** R16 of 0138 says: "`f32` arithmetic is WebAssembly's own
`f32`; a vector may use SIMD128". This proposal differs: an `f32` operation is computed in `f64`
and demoted, except the five proven operations, and stage 1 uses no SIMD. R16's sentence on the
canonical NaN stands, with the place fixed by decision C3. Amendment A4 of 0138 already says
that the tier is as 0042 designs it. An amendment to 0138, in its own pull request, records the
difference in R16 when this proposal is accepted. Status: not started.

### Draft impact estimate

| Area               | Expected work                                                                                                                                       | Basis and uncertainty                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Encoder            | A binary encoder over the IR's `Expr` and `Stmt` unions, scalarized vectors, memory access by `Layout`, the ported helper rules, `console` imports. | `src/core/cpu-codegen.ts` is 2 107 lines over the same IR at `9c7b1899`; the encoder is of that order. Estimate. |
| libm               | 19 routines for `f32` and 19 for `f64`, in one source; the libm test, the engine gate, the sweep; the tests that pin `Math` results.                | No basis for the size or the time. The accuracy work and N14 are the uncertain parts.                            |
| NaN                | A check at each store and each `bitcast`, in three places.                                                                                          | Known places. The time is not measured.                                                                          |
| Out-of-range       | The interpreter, the generated JavaScript and the encoder; the "operand that may be missing" analysis of `src/core/cpu-codegen.ts` loses one case.  | Known files. The number of tests that pin `undefined` or a stored write is not counted.                          |
| Region             | The change to a `WebAssembly.Memory` at the first compilation; growth; a module's own range.                                                        | `src/runtime/region.ts` is 193 lines. N1 and N2 are open.                                                        |
| Call layer         | A `'wasm'` branch in the tier loops, the staging copy, the fallback reason; each comparison with `'cpu'` read again.                                | The WebGL2 tier (`src/core/host-kernel-gl.ts`, 206 lines) is the precedent. 28 to 36 comparisons.                |
| Plugin and runtime | Asset emission, `instantiateStreaming`, the inline form, the loader's two failure paths, the glue.                                                  | Small. The bundle numbers are not measured (N5).                                                                 |
| Compatibility      | A new tier name and a new console label (additive). The out-of-range behaviour, the NaN bits and the libm change CPU results.                       | Known. OD-6: no release exists, so no warning release is owed.                                                   |
| Dependencies       | None at run time or at build time. A reference for the sweep of N9 is a tool, not chosen.                                                           | Known, except the tool.                                                                                          |
| Downstream         | The site, the editor and the four libraries (What it owes downstream).                                                                              | The downstream repositories were not searched for this revision.                                                 |
| Duration and cost  | Unknown; not estimated.                                                                                                                             | No basis established.                                                                                            |

No decision blocks acceptance. The open questions are asked before the milestone that needs
each, if the owner accepts the direction first, as for proposal 0138.

### Independent review record

- **Reviewer.** An AI agent that did not write this proposal.
- **Date.** 2026-11-10.
- **Revision reviewed.** `fecb002f`.
- **Findings and answers.**

| #   | Severity   | Finding                                                                                                                                                                                            | Answer                                                                                                                                                                                                                                      |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Blocking   | The before-and-after row for a write is false: today a write past the end is stored and readable on the interpreter and the generated JavaScript.                                                  | Fixed: the row, an example (10 becomes 6) and both costs under "Out-of-range access". Decided by the owner: D4 stands ("유지").                                                                                                             |
| 2   | Blocking   | C4's example does not compile (`const xs = [1, 2, 3]` is TS8002; `xs[5]` is TS8016).                                                                                                               | Fixed: the example uses `array<f32, 3>` and a variable index. The list case shows `m.get(k)` under `m.has(k)`, the one ECMAScript collection read of the surface.                                                                           |
| 3   | Blocking   | Rules 11.7 and 11.1 say "not a fourth implementation"; a hand-written encoder that ports each helper's rule is one.                                                                                | Decided by the owner (C5): the rules are amended to two forms and a named gate. Fixed: Rule 11.1 in `rules`, and a table that names the test for each ported rule.                                                                          |
| 4   | Blocking   | The bundle budget of Rule 11.11 is not addressed; "no budget stops the work" contradicts it.                                                                                                       | Decided by the owner (C6): the caps follow the measurement, the libm is split by function, the sizes are reported. Fixed: "The bundle budget" and N5.                                                                                       |
| 5   | Blocking   | "The same bits by construction" is not shown: the source language, how two forms come from one source, the bits of an `f64`, 64-bit multiplies, `ldexp`, `Math.sqrt`.                              | Fixed: one `"use typeshade"` source through both code generators; a `DataView` with an explicit byte order; no 64-bit integer; `ldexp` and `2 ** c` listed; ECMA-262 cited. The promise is reduced to what the gate checks. N14 stays open. |
| 6   | Should-fix | N10 misreads the compile-time evaluator: `CONST_CALLS` stands in for Tint.                                                                                                                         | Fixed: "Compile-time evaluation" keeps the Tint stand-in apart and names the two evaluators that read `BUILTINS`. N10 is closed.                                                                                                            |
| 7   | Should-fix | `exports` lacks `ComputeRunner`, `RejectedBackend` and `DeviceInfo`; `rules` lacks 11.20, 11.1, 1.3 and 9.4.                                                                                       | Fixed in the front matter and in What it touches.                                                                                                                                                                                           |
| 8   | Should-fix | N6 contradicts the prerequisite and N8 on `RhiDevice`'s `backend`; `DEFAULT_PREFER`, a portable kernel and the 36 comparisons with `'cpu'` are not addressed.                                      | Fixed: "The tier names, the RHI and the compute runner". `RhiDevice`'s `backend` is another list and does not gain `'wasm'`.                                                                                                                |
| 9   | Should-fix | Memory: (a) compaction moves a module's own ranges; (b) a page that refuses WebAssembly should not get a `WebAssembly.Memory`; (c) `toResizableBuffer()`; (d) a failed fetch or a wrong MIME type. | Fixed: (a) the offset is passed at each call; (b) the region changes at the first compilation only; (c) in N2; (d) in "The artifact".                                                                                                       |
| 10  | Should-fix | No gate compares the libm between engines.                                                                                                                                                         | Fixed: the libm arm of `gate:differential`, with Bun and Chromium, and a unit test in Node. Kept: SpiderMonkey and Safari are not gated, and the text says so.                                                                              |
| 11  | Should-fix | NaN bits need a decision and a milestone; R16 of 0138 differs.                                                                                                                                     | Decided by the owner (C3). Fixed: milestones 1b and 1e; the amendment owed to 0138.                                                                                                                                                         |
| 12  | Should-fix | The text took option (a) of C2 before the answer; Node is not addressed.                                                                                                                           | Decided by the owner (C2). Fixed: the calling thread, in a browser and in Node; the plan's area W is rewritten at implementation.                                                                                                           |
| 13  | Note       | Order: 1a needs the reference of N9; the out-of-range milestone needs N12; the region milestone changes growth, so its host column is not "Nothing".                                               | Fixed: the "Needs first" column, the table by milestone, and the host column of 1d.                                                                                                                                                         |
| 14  | Note       | Rule 3.7 covers section numbers and codes, not rule numbers.                                                                                                                                       | Fixed: "the next free number at implementation"; the document control and N13.                                                                                                                                                              |
| 15  | Note       | D4 makes an out-of-range bug silent.                                                                                                                                                               | Decided by the owner ("유지"). Recorded as a cost; the warning is L1, for a later proposal.                                                                                                                                                 |

No finding is open. The revision that answers the findings has not been reviewed again.

### Approval and plan record

- **Decision.** The owner accepted this proposal on 2026-11-10 in the Claude Code session
  ("수락 + 머지"), after the fifteen decisions of Owner's decisions and the independent review
  record. The direction is accepted now. Each open question is decided by the owner before the
  milestone that needs it starts (Open questions by milestone). The merge of pull request
  [#1162](https://github.com/typeshade/typeshade/pull/1162) with `status: accepted` records the
  acceptance.
- **Approved scope.** The front matter as it stands, the stages and the milestones of stage 1.
  The revision that answers the independent review was not reviewed a second time; the owner
  accepted it with that stated.
- **The libm's source.** Asked whether the libm is one `"use typeshade"` source or two
  hand-written texts held by a test (N14), the owner chose "먼저 작은 실험": before milestone 1a,
  one function (`sin`) is written in TypeShade and its JavaScript form and the interpreter are
  held to the same bits. The result decides N14, and is reported to the owner.
- **Responsibilities.** Implementation is not yet assigned. Each implementing pull request
  carries `Change: 0042`. The prerequisite pull request (the tier names) comes first.
- **Milestones.** Stage 1 in the order 1a to 1h. Duration and cost are not estimated. The rule
  number and the surface sections are fixed against the tree at each implementing pull request.

### Configuration and validation record

This record does not yet apply. Delivery will require, for each milestone:

- the implementing pull requests and their commits with `Change: 0042`;
- the delivered configuration (commit, Node, Bun and browser versions);
- functional validation: the tests and gates of "Two forms and their gates" green on the
  delivered revision; the libm test, the engine gate and the sweep of N9 with its reference and
  its result; the journey with `prefer: ['wasm']`; the journey on a page that refuses
  WebAssembly;
- the speed of the WebAssembly tier against the JavaScript CPU tier, with its machine, its
  engines and its numbers (decision D10: reported, with no threshold);
- the measurements of N5, the caps of `scripts/bundle-budget.json` and the `CHANGELOG.md` entry
  (decision C6);
- document validation: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
  `python scripts/doorstop-check.py -C` clean after the rule edits;
- each deviation with its disposition, and the pending work;
- separately, each downstream repository's pin pull request with `0042` in its
  `compiler-changes.md`.

## Amendments

An amendment changes the accepted text. Its pull request is proposal-only, and its merge is its
acceptance. Git holds the earlier text. The decided text stays in place, and an amendment record
sits under it.

### A1. The libm's source (N14) and its accuracy (N9); the prerequisite's count (2026-11-10)

**The experiment for N14.** [observed result] On 2026-11-10, at commit `eb6a20f9`, with Bun
1.4.4 and Node v22.23.4 and `precision: 'f32'`, `sin` for `f32` and for `f64` was written in
one `"use typeshade"` source. No pull request carries the experiment; its files are not in the
tree.

- The interpreter and the generated JavaScript gave the same bits on 4,000,079 inputs for each
  engine, with 0 differences.
- Bun and Node differed only in the bits of a NaN result that comes from a NaN input.
  Milestone 1b removes that difference.
- `f32`: every input. The largest error against an exact reference, on a sample of 20,000
  inputs for each set, was 0.5004 ULP; 4 of 20,000 results in [−100, 100) were not correctly
  rounded.
- `f64`: only |x| ≤ 1647099, because the source cannot read the bits of an `f64`. The largest
  error on the sample was 0.731 ULP. Node's `Math.sin` gave 0.764 ULP on the same sample.
- Time for one call of the generated JavaScript: 20 to 45 ns for `f64` (`Math.sin`: 24 to 36
  ns), and 53 to 217 ns for `f32` (`Math.fround(Math.sin(x))`: 21 to 71 ns). The interpreter
  that walks the IR took 2 to 6 µs.
- Not measured: the WebAssembly form, a browser engine, any function other than `sin`, a sweep
  of all 2³² inputs.

**What the compiler lacks for one source.** [fact] Each item is an internal operation of the
compiler. None is a name an author can write (OD-3).

- The bits of an `f64`: `bitcast` takes 32-bit types only.
- The conversions between an `f64` and an `i32` or a `u32`.
- `trunc`, `ceil`, `%` and `ldexp` on an `f64`.
- A path from the interpreter to the libm's JavaScript form: `sin` is bound to `Math.sin`
  today.

**Decision N14.** Asked on 2026-11-10, with the experiment's result, the owner chose "TypeShade
소스 하나": the libm is one `"use typeshade"` source through both code generators. The
alternative was two hand-written texts held equal by a test. Cost recorded: milestone 1a adds
the internal operations above first, and the `f32` path of the generated JavaScript was up to 7
times slower than `Math.sin` on Bun in the experiment.

**Decision N9, the claim.** Asked on 2026-11-10, the owner chose "1 ULP 미만을 약속": the libm
promises an error under 1 ULP for each of the 19 functions, for `f32` and for `f64`, beside the
engine identity. "Correctly rounded" is claimed for a function only later, and only after a
sweep of all its inputs finds 0 differences. `ldexp` stays correctly rounded, as the table of
"The libm" says. Cost recorded: the proposal does not claim more accuracy than an engine's
`Math`. This replaces the rows of that table that say a bound is "not chosen yet".

**Decision N9, the reference.** Asked on 2026-11-10, the owner chose "CORE-MATH를 스크립트로
빌드": the sweep's reference is the CORE-MATH C sources, fetched and built by a script outside
the gates. The alternative was a BigInt reference kept in the repository. Cost recorded: the
sweep needs a C compiler and the network, so it is a tool outside the repository's dependencies
and no gate runs it.

**The count of the prerequisite.** [observed result] The prerequisite pull request
([#1165](https://github.com/typeshade/typeshade/pull/1165), merged as `b82669fd`) searched
`src/` and `scripts/` at `1a9a490f`. It found 28 comparisons with the literal `'cpu'`: 17
compare a tier, 7 compare `RhiDevice`'s `backend` and 4 compare `caps.shaderLanguage`. It found
21 more places with a CPU arm and no `'cpu'` literal. It could not reproduce the reviewer's 36.
Milestone 1f reads the 17 and the 21; the list is in that pull request's body.

**Status.** N9 and N14 are closed. Milestone 1a has no open question.

### A2. An `f32` result is the `f64` routine's result rounded once; the split by function comes last (2026-11-10)

**What was measured.** [observed result] The first slice of milestone 1a
([#1168](https://github.com/typeshade/typeshade/pull/1168), at `9444c8b4`) delivered `sin` and
`cos` with a routine of its own for `f32` beside the `f64` routine. On Bun 1.4.4 and Node
v22.23.4:

- The largest error of the `f32` routines was 0.5009 ULP. The `f64` routine's result rounded
  once to `f32` measured 0.5000 ULP on the same sample.
- On Bun the `f32` routines took 3.4 to 5.2 times the time of `Math`. The `f64` routines took
  1.2 to 2.4 times.
- The independent review of #1168 found that a module constant in `'f32'` precision took the
  `f64` routine while a call took the `f32` routine. The two differed for 1,136 of 3,595,118
  sampled operands.
- Two functions in one table added about 3,000 gzip bytes to `typeshade/algorithms` and to
  `typeshade/random`.

**Decision, the `f32` result.** Asked on 2026-11-10, the owner chose "f64 루틴을 한 번
반올림". For each of the 19 functions the libm has one routine, on `f64`. The `f32` result is
that routine's result for the operand, rounded once to `f32`. The alternative was a routine of
its own for each precision. This replaces "`sin` for `f32`, `sin` for `f64`" in "The source and
the two forms" and "19 routines for `f32` and 19 for `f64`" in the draft impact estimate. It
keeps decision C1: the libm serves `f32` and `f64`. Cost recorded: `f32` results of #1168 at
`9444c8b4` change for about 3 operands in 10,000, and an `f32` call pays for an `f64` routine.

**Decision, the split.** Asked on 2026-11-10, the owner chose "19개가 다 생긴 뒤 분리". The
routines enter through one table until the 19 functions exist. The last slice of milestone 1a
splits them into one module and one export for each function, as "The source and the two forms"
says. Cost recorded: until that slice, a bundle that holds the op library carries every
routine that exists.

**Slices of milestone 1a.** The milestone is delivered in slices, each its own pull request:
the internal operations with `sin` and `cos` (#1168); the other 17 functions; the rule text of
Rules 1.3, 9.4 and 11.24; the split by function; the sweep against CORE-MATH.

### A3. No monotonic promise; the fdlibm notice; `exp2`; what the first seven functions measured (2026-11-10)

**Delivered so far.** [observed result] Seven of the 19 functions are on `main` at `fbd151af`:
`sin` and `cos` ([#1168](https://github.com/typeshade/typeshade/pull/1168)), `exp`, `exp2`,
`log`, `log2` and `ldexp` ([#1181](https://github.com/typeshade/typeshade/pull/1181)), and a
second method for `exp2` ([#1199](https://github.com/typeshade/typeshade/pull/1199)). Each
pull request had an independent review. No review found an operand at or above 1 ULP.

| Function     | Largest error measured for an `f64` operand | Measured by                                       |
| ------------ | ------------------------------------------- | ------------------------------------------------- |
| `sin`, `cos` | 0.794 ULP                                   | the review of #1168, about 10.8 million operands  |
| `exp`        | 0.9217 ULP                                  | the review of #1181, 7.8 million focused operands |
| `exp2`       | 0.7718 ULP                                  | #1199 after its review, 115 million operands      |
| `log`        | 0.8518 ULP                                  | the review of #1181                               |
| `log2`       | 0.8615 ULP                                  | the review of #1181                               |
| `ldexp`      | correctly rounded                           | the review of #1181, 8.4 million cases            |

Each number is the largest of a sample. None is a proved bound. An `f32` result measured at
most 0.5009 ULP before Amendment A2 and 0.5000 ULP after it.

**Decision, monotonic results.** The review of #1181 found that `exp2` was not monotonic at
two pairs of operands near −0.4973 and −0.4977, each inside 1 ULP. Asked on 2026-11-10 whether
the libm promises monotonic results as well, the owner chose "약속하지 않음". The promise stays
the engine identity and an error under 1 ULP. A step that decreases where the exact function
increases is recorded when a review finds one, and it is no defect. The alternative was to
promise it. Cost recorded: a caller that needs a monotonic function cannot rest on the libm.
[observed result] After #1199 a scan of about 366 million consecutive doubles found no such
step in `exp2`.

**Decision, the fdlibm notice.** The kernels and the coefficients of `sin`, `cos`, `exp`,
`log` and `log2` are fdlibm's, whose licence grants use "provided that this notice is
preserved". Asked on 2026-11-10 how far the notice goes, the owner chose "소스 + NOTICE + 생성
파일": the notice is in each libm source, in `NOTICE` (which the package ships), and in the
header of each baked file. The alternatives were the sources only, or a preserved comment in
each built bundle as well. Cost recorded: a minified bundle carries no notice. This is the
owner's decision and no legal advice.

**`exp2`.** The proposal named no method for `exp2`. [observed result] The first method
(#1181: the nearest integer out, the kernel of `exp` on the rest) measured up to 0.9282 ULP.
Asked on 2026-11-10, the owner chose "머지, exp2는 뒤에 개선" and then "빠진 항을 더한 뒤 머지".
The method on `main` takes the nearest half-integer out. Its kernel runs on half the range. An
odd half-step multiplies by the square root of 2, held as a head and a tail, with all four
terms of the product.

**Open, a subnormal result.** [observed result] `exp` and `exp2` round a subnormal result
twice: once in the last sum and once in the scaling. The review of #1199 measured 0.834 ULP at
most for such a result before the last change, and 0.7718 ULP after it. It is under 1 ULP.
Next action: none planned; the sweep against CORE-MATH measures it again.

**Open, compile-time refusals.** `CONST_CALLS` in `src/compiler/ts/loop-bound.ts` still reads
the engine's `Math` for the range and domain refusals of `exp`, `exp2`, `log`, `log2` and
`ldexp`. It gives no CPU value. Next action: a later slice of milestone 1a reads it.

**Two bugs that the libm work found and that are fixed.** Neither is part of this proposal.
An author's function named `__fround` was taken for the rounding step
([#1178](https://github.com/typeshade/typeshade/pull/1178)). A module constant's expression did
not round as `f32` arithmetic does in `'f32'` precision
([#1190](https://github.com/typeshade/typeshade/pull/1190)).

### A4. `pow` keeps ECMAScript's special values; what the next eleven functions measured (2026-11-10)

**Delivered so far.** [observed result] Eighteen of the 19 functions are on `main` at
`93a9e863`: `tan`, `asin`, `acos`, `atan` and `atan2`
([#1207](https://github.com/typeshade/typeshade/pull/1207)), a second kernel for `tan`
([#1214](https://github.com/typeshade/typeshade/pull/1214)), and `sinh`, `cosh`, `tanh`,
`asinh`, `acosh` and `atanh` ([#1215](https://github.com/typeshade/typeshade/pull/1215)). Each
pull request had an independent review. No review found an operand at or above 1 ULP.

| Function | Largest error measured for an `f64` operand | Measured by                                                  |
| -------- | ------------------------------------------- | ------------------------------------------------------------ |
| `tan`    | 0.6753 ULP                                  | #1214, 72 million operands; its review measured 0.6663       |
| `asin`   | 0.7283 ULP                                  | #1207, 21 million operands; its review measured 0.7274       |
| `acos`   | 0.7897 ULP                                  | the review of #1207                                          |
| `atan`   | 0.8569 ULP                                  | the review of #1207                                          |
| `atan2`  | 0.8564 ULP                                  | the review of #1207                                          |
| `sinh`   | 0.5854 ULP                                  | the review of #1215, 61.75 million `f64` operands in all six |
| `cosh`   | 0.5298 ULP                                  | the review of #1215                                          |
| `tanh`   | 0.5714 ULP                                  | the review of #1215                                          |
| `asinh`  | 0.5738 ULP                                  | the review of #1215                                          |
| `acosh`  | 0.5670 ULP                                  | the review of #1215                                          |
| `atanh`  | 0.5697 ULP                                  | the review of #1215                                          |

Each number is the largest of a sample. None is a proved bound. Before #1214 the kernel of `tan`
measured up to 0.9373 ULP (#1214, on `main` at `50234ad6`; the review of #1207 measured 0.9277).
After it, the kernel measured 0.6926 ULP.

**Decision, the special values of `pow`.** [fact] Two rules give different answers for some
pairs of `a ** b` and `Math.pow`. Rule 1.3 gives the oracle "ECMAScript's result for a form
borrowed from ECMAScript". Surface §10 and Rule 7.2 lower `a ** b` to WGSL's `pow(a, b)`. Rule
9.4 lowers a `Math` member to "the WGSL builtin of the same meaning". WGSL leaves `pow`
indeterminate for x < 0, for x = 1 with y infinite and for x infinite with y = 0. Asked on
2026-11-10, the owner first chose "측정 후 다시 결정": measure the targets first (Rule 11.2).

- [observed result] Configuration: 2026-11-10, `main` at `a86de5c3`, Chromium 153.0.8010.12.
  WebGPU ran on Dawn and Tint over SwiftShader Vulkan. WebGL2 ran on ANGLE over SwiftShader
  Vulkan. Each result was read back as bits.
- [observed result] Tint at run time and WebGL2 gave the same bits on all 18 pairs measured.
  They differ from ECMAScript on 11 special pairs:
  - `(-2) ** 3` gives 8, and `(-2) ** 0.5` gives 1.4142138.
  - `1 ** ±Infinity`, `(-1) ** Infinity`, `1 ** NaN` and `Infinity ** 0` give +Infinity.
  - `(-0) ** 3` gives +0, and `(-Infinity) ** 3` gives +Infinity.
  - `(-0) ** -1` and `0 ** -1` give 2^127.
- [observed result] They agree with ECMAScript on `(-2) ** 2`, `NaN ** 0`, `0 ** 0`,
  `(-0) ** ±2` and `Infinity ** -1`. On `2 ** 0.5` they give 1.4142138, 2 ULP from
  ECMAScript's 1.4142135.
- [observed result] The formula exp2(y × log2(x)) in `f32` differs from SwiftShader on 10 of
  the 11 special pairs, all but `(-0) ** 3`. Tint's constant evaluator refuses each pair that a
  literal can spell with x < 0, or with x = 0 and y ≤ 0. WGSL has no literal for an infinity or
  a NaN.
- [inference] So neither ECMAScript's values nor the formula gives the bits that SwiftShader
  gave. Values copied from SwiftShader would match one software driver only. GLSL ES 3.00
  (§4.5.1) lets a driver interchange +0 and -0, and Tint folds the literal `-0.0` to +0. So no
  target is held to the sign of a zero.

Asked again on 2026-11-10, the owner chose "A + GPU 차이 기록": the CPU `pow` keeps the special
values of ECMA-262 that `Math.pow` gives (Rule 1.3), and the libm's routine keeps them too. The
pull request that implements `pow` records the measured differences, as Rule 11.2 asks: a comment
on the `pow` row of `INTRINSICS` with the measured text, and a row of the determinism report
(surface §38). This widens "What it touches": surface §38 gains a row for `pow` beside the row for
the out-of-range access. The alternatives were WGSL's value where WGSL fixes one (`(-0) ** 3` +0,
`(-0) ** -1` +Infinity) and ECMAScript's elsewhere, or the values SwiftShader gave. Cost recorded:
the CPU and a GPU give different results for these pairs, as they did before. Only SwiftShader
was measured; a hardware driver may give other values.

**Side finding.** [observed result] At `main` `93a9e863`, `export const K: f32 = (-0.) ** 3.;`
emits `pow(0.0, 3.0)` in WGSL and in GLSL, and `export const Z: f32 = -0.;` emits `0.0`: a
literal loses the sign of its zero. Tint folds `-0.0` to +0, so the WGSL result does not change.
ANGLE over SwiftShader folds `pow(-0.0, 3.0)` to -0, so the GLSL text gives +0 where a signed
literal gives -0. GLSL ES 3.00 (§4.5.1) allows the two zeros to be interchanged, so both results
are permitted. Next action: none planned; it is recorded here.

**Open, `pow`.** The 19th function has no routine of the libm yet: `COMPONENTWISE.pow` is
`Math.pow`. Next action: the pull request that implements `pow` under this decision, with the
records of Rule 11.2.

**Open, compile-time refusals.** `CONST_CALLS` in `src/compiler/ts/loop-bound.ts` reads the
engine's `Math` for the range and domain refusals of `exp`, `exp2`, `log`, `log2`, `ldexp`,
`sinh`, `cosh` and `pow`, and `src/compiler/ts/lower/const-call.ts` reads `Math.pow` for the
value a refusal names. Neither gives a CPU value. This widens the open item of Amendment A3.
Next action: a later slice of milestone 1a reads them.

**Open, internal routines at run time.** `LIBM` carries the internal routines of each family
(`hyperbolic`, `lnOnePlus`, `sqrtRest`, `sumErr`, `prodErr` and the earlier kernels). Next
action: the slice that splits the libm by function (Amendment A2).

### A5. Where the record of Rule 11.2 for `pow` stands; all 19 functions delivered (2026-11-10)

**Delivered.** [observed result] `pow` is the libm's routine on `main` at `68b57a03`
([#1219](https://github.com/typeshade/typeshade/pull/1219)), with the special values Amendment A4
chose. All 19 functions of the libm are now the compiler's own routines. [observed result] The
largest `f64` error measured for `pow` is 0.8599 ULP (#1219, 54.7 million pairs; its review
measured 0.8443 on 16.9 million pairs). It is the largest of a sample, not a proved bound.

**Decision, the place of the record.** [fact] Rule 11.2 and Amendment A4 ask for "a comment on
the `pow` row of `INTRINSICS`". Rule 9.1 classifies `pow` in `PORTABLE_INTRINSICS`, and
`src/core/intrinsic-coverage.test.ts` refuses an `INTRINSICS` row for an id of that set. #1219
put the comment on the `'pow'` entry of `PORTABLE_INTRINSICS`, where `pow` is classified. Asked
on 2026-11-10, the owner chose "0042에 개정 한 줄": that entry is the place of the record for
`pow`, and the deviation of #1219 is closed. The alternatives were to change the words of Rule
11.2 now, or to move `pow` into `INTRINSICS`. Next action: the slice that writes the text of the
rules (Amendment A2) words Rule 11.2 for both sets.

## What it owes downstream

The downstream repositories were not searched for this revision. Each item below is expected
work. Responsibilities are recorded at acceptance.

**typeshade.github.io.** The WebGPU and WebGL2 concept page's runtime copy (`runtimeP`, en and
ko) names the tier order "WebGPU, then WebGL2, then the CPU" and gains the WebAssembly tier. The
Playground's console draws a tier label from the compiler's `ConsoleTier` and needs a style for
`WASM`. The API reference's `configure` and `createDevice` entries list the fourth name. A page
that states what an out-of-range index does on the CPU tier, or that compares a tier with
`'cpu'`, changes, if a search finds one. `compiler-changes.md` records `0042` when the pin moves.

**vscode-typeshade.** The skill's host reference (`references/host.md`) names the tiers,
`configure({ prefer })` and `createDevice({ prefer })`, and gains the fourth name with one
sentence on when it runs. The tsserver fixtures that pass `prefer` take the new literal.
`compiler-changes.md` records `0042` when the pin moves.

**radiance.** A search for a test or a record that pins a CPU-tier value of a transcendental
function, for a comparison of a tier with `'cpu'`, and for code that relies on an access past an
array's end. `compiler-changes.md` records `0042` when the pin moves.

**typenn, typecv, typeaudio.** A test that pins a CPU-tier value of `exp`, `log`, `tanh`, `sin`,
`cos` or `pow` to the last bit is baked again against the libm. A host that compares
`device.tier` with `'cpu'` handles `'wasm'` (N8). `compiler-changes.md` records `0042` in each
when the pin moves.
