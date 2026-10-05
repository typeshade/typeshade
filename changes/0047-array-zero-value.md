---
id: '0047'
title: '`array<T, N>()` is the zero value of a fixed-size array, as WGSL''s `T()` is, in the compiler and the editor'
status: accepted
rules: []
surface:
  - 44
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The language reference's `array` entry reads the new hover sentence from FUNCTION_DOCS with no change of its own; the packing-bitcast example page shows the new line; compiler-changes.md records 0047 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's language reference (plugins/typeshade/skills/typeshade/references/language.md, the Constructors line) names `array<u32, 32>()` beside `vec3()`; compiler-changes.md records 0047 when the pin moves.
---

<!-- doc-refs: skip-file — an accepted but unimplemented proposal names tests that do not exist yet, and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Change proposal `0047`, `status: accepted`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                   |
| Date and attribution          | Written 2026-10-05, Asia/Seoul. Drafted by the repository's coding agent at the owner's direction ("#495 이슈도", after "이슈 처리 모두 승인합니다. 완료해주세요" in the same conversation), from issue [#495](https://github.com/typeshade/typeshade/issues/495), which typeshade/radiance raised.                                        |
| Applicability / Effectivity   | `"use typeshade"` source; the front end (`src/compiler/ts/lower/expression-array.ts`, and `zeroExprOf` in `src/compiler/ts/lower/class-methods.ts`); the hover text (`src/language-service/docs.ts`); surface §44; `examples/packing-bitcast.shade.ts`; the site and the editor. No backend or oracle changes. Release version unassigned. |
| Review baseline               | `origin/main` at `fd39ba3b54ae3f5570ebfb404f2350fb79b05984`.                                                                                                                                                                                                                                                                               |
| Review and revision authority | No pull request is assigned when this revision is written. Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                                                 |

## What changes

`array<T, N>()` with no arguments is the zero value of the array: every element is `T`'s zero,
as WGSL's zero-value built-in `T()` gives it
([WGSL §17.1.1](https://gpuweb.github.io/gpuweb/wgsl/#zero-value-builtin-function), whose own
example is `array<bool, 2>()`).

| Written                                        | Before                           | After                                                                          |
| ---------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `let s: array<u32, 32> = array<u32, 32>();`    | `TS8019` (expects 32, got 0)     | accepted: 32 zeros                                                             |
| `array<vec3, 4>()`, `array<S, 2>()` (struct S) | `TS8019`                         | accepted: each element its type's zero                                         |
| `array<mat2x2, 2>()`                           | `TS8019`                         | accepted: each element the zero matrix                                         |
| `array<u32, 32>(1, 2)`                         | `TS8019`                         | `TS8019`, the same sentence                                                    |
| `array<u32>()`                                 | `TS8099`, naming `array<u32, 0>` | `TS8099`, saying a runtime-sized array has no zero value and to give it a size |

The front end writes the zero out, one element at a time, as `vec3()` and `matCxR()` do today:
WGSL emits `array<u32, 32>(0u, 0u, …)`, GLSL ES 3.00 the same list, and the CPU oracle builds an
ordinary array. The editor already accepts the call: the ambient library declares
`array<T, N extends number>(...values: readonly T[])`, which takes zero values, and the
compiler's `TS8019` was the only refusal. Both halves now accept it (Rule 12.7).

**Exclusions.** A runtime-sized array has no zero value in WGSL, so `array<u32>()` stays refused.
An `f64` element has no zero literal on this path (the fp64 pass assembles it), so
`array<f64, 4>()` is refused with a sentence that says so, as `vec2f64()` is.

## Why

Radiance's BVH walk keeps two stacks of 32 `u32` per ray. Since change 0043, a local array with
no initializer is `TS8075` at its first read, which tells the author to declare it with a value.
The shortest value WGSL has is `array<u32, 32>()`, and TypeShade refused it, so radiance writes
32 zeros four times (#495, measured at e923a34 and at `main` fd39ba3).

Rule 2.1 (a) takes author-facing names from WGSL's built-in functions, and `T()` is one. Surface
§44 has the zero form of a vector and of a matrix, and not of an array.

### Alternatives considered

- **Emit WGSL's `array<u32, 32>()` as written.** Shorter WGSL, but an empty `construct` would
  have to be taught to the GLSL writer, both CPU paths and every optimizer pass that reads a
  constructor's arguments. Writing the zeros out reuses what `vec3()` and `matCxR()` already do.
- **`fill<u32, 32>(0)`.** It exists, but it is TypeShade's extension, not WGSL's spelling, and
  it is the author's to know. (Measured while writing this: `fill<u32, 32>(0)` emits `0.0`
  elements into an `array<u32, 32>`. That is a separate defect and needs its own issue.)

## What it touches

- `surface: [44]`. "The constructors" gains the array zero form beside `vec3()`.
- `rules: []`, `codes: []`, `exports: []`. `TS8019` and `TS8099` keep their numbers; the
  `TS8099` sentence for `array<T>()` changes.
- `examples: []`. `examples/packing-bitcast.shade.ts` gains one zero-valued array, so the
  compile gate reads it on Tint and WebGL2; its goldens are read as a diff (Rule 11.4).

Required functional evidence, from the tests #495 lists:

- `src/compiler/ts/convert-ctor.test.ts`: `array<u32, 32>()`, `array<vec3, 4>()`, an array of a
  struct and an array of a matrix lower to the zero value; WGSL and GLSL list the zeros; both CPU
  paths read every element as 0. `array<u32, 32>(1, 2)` keeps its `TS8019` code and text;
  `array<u32>()` and `array<f64, 4>()` are refused with their sentences (Rule 12.5).
- `src/language-service/ambient-parity.test.ts`: both halves accept `array<u32, 32>()`, and both
  refuse `array<u32, 32>(1, 2)` (Rule 12.7).
- `bun run gate:compile` on the changed example.

### Approval and plan record

The approval is the owner's go-ahead in conversation on 2026-10-05, Asia/Seoul, which asked for
#495 to be handled as the earlier issues were. The merge of this file's pull request records it;
Git holds the merge commit. No decision was left open. Responsibilities, milestones, duration
and cost were not assigned.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with `Change: 0047`;
the tests above and the compile gate green on the delivered revision; `bun run docs:impact` and
`docs:refs` clean; and, separately, the site's and the editor's pin pull requests with `0047`
recorded in their `compiler-changes.md`.

## What it owes downstream

- **typeshade.github.io.** The `array` reference entry reads `FUNCTION_DOCS.array`; the
  packing-bitcast example page reads the example. `compiler-changes.md` records `0047`.
- **vscode-typeshade.** `plugins/typeshade/skills/typeshade/references/language.md` names
  `array<u32, 32>()` among the constructors. `compiler-changes.md` records `0047`.

Each item is expected work, and each follows the pin that carries the implementation.
