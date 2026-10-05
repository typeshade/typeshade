---
id: '0045'
title: 'The docs and the determinism report say that an f32 holding a NaN or subnormal bit pattern has no portable `bitcast`, and that an integer word belongs in a `storage<array<u32>>` binding'
status: accepted
rules: []
surface:
  - 38
  - 44
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The reference page for `bitcast` shows the new hover sentence from FUNCTION_DOCS with no change of its own; compiler-changes.md records 0045 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's language reference (plugins/typeshade/skills/typeshade/references/language.md, the bitcast line) says to keep an integer word in a storage<array<u32>> binding; compiler-changes.md records 0045 when the pin moves.
---

<!-- doc-refs: skip-file — an accepted but unimplemented proposal names tests that do not exist yet, and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0045`, `status: accepted`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                   |
| Date and attribution          | Written 2026-10-05, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction, from issue [#479](https://github.com/typeshade/typeshade/issues/479), which typeshade/radiance raised from its design record 0001, step 2.                          |
| Applicability / Effectivity   | Surface §38 and §44; the determinism report's `bitcast` rows (`src/core/passes/determinism.ts`); the registry's comment on `bitcastU32` (`src/core/intrinsics.ts`); the hover text (`src/language-service/docs.ts`); the oracle parity test; the site and the editor. No emitted text changes. Release version unassigned. |
| Review baseline               | `origin/main` at `3f6f46b0c97b9761a4cb1d6975cf16685e7f355b`.                                                                                                                                                                                                                                                               |
| Review and revision authority | [PR #483](https://github.com/typeshade/typeshade/pull/483). Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                                |

## What changes

No target's answer changes. The documents say what each target may answer, and where to keep an
integer word so that every target answers the same.

1. Surface §44 gains a paragraph after the `bitcast` refusal. A `bitcast<u32>` of an `f32` whose
   bits are a NaN or a subnormal has no portable answer:
   - WGSL lets an implementation assume that no NaN is present, and the result is then an
     indeterminate value. It lets the intermediate value of a bit reinterpretation be flushed
     to zero ([WGSL §15.7.2](https://gpuweb.github.io/gpuweb/wgsl/#differences-from-ieee754)).
   - GLSL ES 3.00 §2.1.1 lets a driver flush any denormal to zero.
   - The CPU oracle holds an `f32` as a JavaScript number. A NaN comes back as `0x7fc00000` on
     the engines measured below. A subnormal comes back as written.

   The paragraph says to declare a binding that carries integer words as
   `storage<array<u32>>`, and not to store the words as the bits of an `f32`. That binding is
   exact on every target: GLSL reads it from an R32UI data texture (`storageFetchU32`). A
   module that targets WGSL only can also use `storage<array<vec4u>>`; the GLSL storage
   emulation refuses that element type today (measured below).

2. The determinism report (surface §38, `compile().determinism`) keeps `bitcastU32` and
   `bitcastF32` in the `exact` class. Their row gains a `note`: the answer is fixed for an `f32`
   that is finite and normal, and not for a NaN or a subnormal one.
3. The registry's comment on `bitcastU32` records the measurement below (Rule 11.2).
4. `FUNCTION_DOCS.bitcast` gains one sentence: an integer word belongs in a
   `storage<array<u32>>` binding.

**Exclusions.** The oracle does not try to keep a NaN's bits (Why, Alternatives). No refusal or
warning is added: the compiler cannot see the bits of a runtime value.

## Why

Radiance's design record 0001 stores an integer word as the bits of an `f32` in a
`storage<array<vec4>>` and reads it with `bitcast<u32>`. On the CPU oracle a word whose bits
are a NaN pattern came back as `0x7fc00000` (#479). Rule 1.3 asks whether that answer is one
WGSL permits, and Rule 11.2 asks for a measurement before a divergence is kept.

### What was measured

Measured on 2026-10-05 by the repository's coding agent, compiler at `main` 3f6f46b. The program
is the one #479 gives, `bitcast<u32>(words[i].x)` over `declare const words: storage<array<vec4>>`.
The host wrote each word through a `Uint32Array` view.

| Word         | Kind      | Oracle (bun 1.3.14 and node 22.22.0, all four modes) | WebGPU (Tint, SwiftShader) | WebGL2 (ANGLE, SwiftShader) |
| ------------ | --------- | ---------------------------------------------------- | -------------------------- | --------------------------- |
| `0x7fc00001` | quiet NaN | `0x7fc00000`                                         | `0x7fc00001`               | `0x7fc00001`                |
| `0x7fffffff` | quiet NaN | `0x7fc00000`                                         | `0x7fffffff`               | `0x7fffffff`                |
| `0xffc00005` | quiet NaN | `0x7fc00000`                                         | `0xffc00005`               | `0xffc00005`                |
| `0x7f800001` | sig. NaN  | `0x7fc00000`                                         | `0x7f800001`               | `0x7f800001`                |
| `0x3f800000` | normal    | `0x3f800000`                                         | `0x3f800000`               | `0x3f800000`                |
| `0x00000001` | subnormal | `0x00000001`                                         | `0x00000001`               | `0x00000001`                |
| `0x007fffff` | subnormal | `0x007fffff`                                         | `0x007fffff`               | `0x007fffff`                |
| `0x80000001` | subnormal | `0x80000001`                                         | `0x80000001`               | `0x80000001`                |

- Oracle: `compileModule` and `compileModuleJs`, at `f64` and `f32`, with the rows passed to
  `setBinding` as `number[][]`.
- WebGPU: Chromium 141.0.7390.37 headless, adapter "google swiftshader", the compiler's WGSL for
  `word` in a compute entry. A plain `f32` copy of the load kept every word too.
- WebGL2: the same browser, an R32F data texture read with `texelFetch` and
  `floatBitsToUint` into an RGBA32UI target, which is how the GLSL storage emulation reads a
  float array.
- A hardware GPU was not measured. SwiftShader keeps the bits; a hardware driver may flush or
  canonicalize as the two specifications allow.

A JavaScript engine can lose the bits before the oracle runs. In bun, `getFloat32` of
`0x7fc00001` followed by `setFloat32` gives `0x7fc00000`, for each of the four NaN words. The
inference is that a bun number does not hold a NaN payload at all. In node,
the same local number keeps `0x7fc00001`, and a signalling NaN comes back quieted
(`0x7f800001` gives `0x7fc00001`). ECMAScript lets the engine choose (NumericToRawBytes).

### The inference

WGSL fixes no answer for a NaN and lets a subnormal be flushed, so `0x7fc00000` is one of the
permitted answers and the oracle meets Rule 1.3. The divergence is kept and documented. A
program that needs the word back must not store it as `f32` bits on any target, so the remedy
is the binding's element type, not the oracle.

### Which binding carries a word exactly

Measured on the same date and commit, from `compile()`'s GLSL ES 3.00 for a fragment entry that
reads the binding:

| Declaration                        | GLSL ES 3.00 read                                                  | Exact on GLSL                         |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| `storage<array<u32>>`              | `usampler2D`, `_sfetchU` (R32UI)                                   | yes                                   |
| `storage<array<vec4u>>`            | refused: "storage binding 'words' has an unsupported element type" | (does not compile)                    |
| `storage<array<W>>`, `W` of `u32`s | `sampler2D`, `floatBitsToUint(_sfetch(...))` (R32F)                | no: the route this proposal documents |
| `storage<array<vec4>>` + `bitcast` | `sampler2D`, `floatBitsToUint` (R32F)                              | no                                    |

The third row is the compiler's own: the GLSL storage emulation reads a struct's `u32` field
through the bits of an R32F texel. The registry's comment on `storageFetchU32` says that route
"can legally lose values", because a small integer is a subnormal `f32` (GLSL ES 3.00 §2.1.1).
SwiftShader kept every subnormal word above, so the loss was not observed. It is a separate
defect, outside this proposal, and it needs an issue of its own.

### Alternatives considered

- **A typed-array binding value** (#479's first option). The bytes would reach the oracle, but
  the load `words[i].x` makes a JavaScript number, and in bun no number holds a NaN payload
  (measured above). Keeping the bits would mean an oracle that carries every `f32` as its bits,
  which changes `CpuValue`, an export, for a value WGSL leaves indeterminate.
- **Canonicalize on the GPU too.** A NaN check in the emitted `bitcast` would cost every call
  and would still not fix the subnormal case on a driver that flushes.
- **Document only (proposed).** It matches what WGSL and GLSL ES 3.00 say, and it names the
  binding type that is exact everywhere.

### Decisions at acceptance

- The `note` goes on the report's `bitcastU32` and `bitcastF32` rows, which stay in the `exact`
  class. No class is added.
- Surface §38's prose gains no sentence. The row's `note` is what §38 carries; the paragraph is
  §44's.

## What it touches

- `surface: [38, 44]`. §44 gains the paragraph of item 1. §38's `bitcast` rows gain the `note`
  of item 2.
- `rules: []`. The change rests on Rules 1.3 and 11.2 as they stand.
- `codes: []`, `examples: []`, `exports: []`. Nothing an author writes is refused or accepted
  differently, and no emitted text changes.

Required functional evidence, from the tests #479 lists:

- `src/core/oracle-backend-parity.test.ts`: the eight words above, written through a
  `Uint32Array`. A normal or subnormal word reads back as written; a NaN word reads back as a NaN
  pattern. On `compileModule` and `compileModuleJs`, at both precisions. The same words in a
  `storage<array<u32>>` binding read back as written.
- `src/core/passes/determinism.test.ts`: the `bitcast` rows carry the `note`.
- The GPU measurement above is retained in this file. No WebGPU test enters
  `scripts/gpu-differential.ts`: the gate leaves NaN and subnormal values out of its
  comparison on purpose.

### Draft impact estimate

Known work: one paragraph in §44, a `note` on two report rows and their test, one comment in the
registry, one hover sentence, one parity test. Duration and cost are not estimated. No emitted
text, dependency or tool changes.

### Approval and plan record

The approval is the owner's go-ahead in conversation on 2026-10-05, Asia/Seoul, which accepted
the proposal with the smaller of the two options for each decision above. The merge of
[PR #483](https://github.com/typeshade/typeshade/pull/483) records it; Git holds the merge
commit. The approved revision is this file at that merge. Responsibilities, milestones, duration and cost were not assigned.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with `Change: 0045`;
the tests above green on the delivered revision; `bun run docs:impact` and `docs:refs` clean;
and, separately, the site's and the editor's pin pull requests with `0045` recorded in their
`compiler-changes.md`.

## What it owes downstream

- **typeshade.github.io.** The reference page for `bitcast` reads `FUNCTION_DOCS.bitcast`, so it
  shows the new sentence when the pin moves, with no change of its own. `compiler-changes.md`
  records `0045`.
- **vscode-typeshade.** `plugins/typeshade/skills/typeshade/references/language.md` adds to the
  `bitcast` line: keep an integer word in a `u32` binding. `compiler-changes.md` records `0045`.
- **typeshade/radiance** is not a declared downstream repository. A comment on #479 tells it the
  answer: its `nodes`, `vertices` and `instances` words are exact on every target in
  `storage<array<u32>>` bindings, read four at a time.

Each item is expected work. None is started, and each follows the pin that carries the
implementation.
