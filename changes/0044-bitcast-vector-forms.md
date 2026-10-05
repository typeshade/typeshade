---
id: '0044'
title: '`bitcast<vecNu>(v)` and `bitcast<vecN>(v)` read the bits of a vector, one component at a time, as WGSL''s vector overload does'
status: implemented
rules: []
surface:
  - 44
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The builtins page's data (src/lib/builtin-table.ts) gives each new neutral id a category and an arity, or the build stops on it; the language reference's §44 entry and the packing-bitcast example page show the vector form; compiler-changes.md records 0044 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's language reference (plugins/typeshade/skills/typeshade/references/language.md, the bitcast line) names the vector forms; compiler-changes.md records 0044 when the pin moves.
---

<!-- doc-refs: skip-file — a proposal names ids and tests that do not exist yet, and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0044`, `status: implemented`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Written 2026-10-05, Asia/Seoul. The date is the authoring context, not an approval. Drafted by the repository's coding agent at the owner's direction, from issue [#478](https://github.com/typeshade/typeshade/issues/478), which typeshade/radiance raised from its design record 0001, step 2.                                                                                                                                         |
| Applicability / Effectivity   | `"use typeshade"` source; the front end (`src/compiler/ts/lower/expression-call.ts`), the registry (`src/core/intrinsics.ts`), the CPU oracle and its generated code (`src/core/cpu-runtime.ts`, `src/core/cpu-codegen.ts`), the ambient library and its hover text (`src/language-service/ambient.ts`, `src/language-service/docs.ts`), surface §44, the example `packing-bitcast`; the site and the editor. Release version unassigned. |
| Review baseline               | `origin/main` at `3f6f46b0c97b9761a4cb1d6975cf16685e7f355b`.                                                                                                                                                                                                                                                                                                                                                                              |
| Review and revision authority | [PR #482](https://github.com/typeshade/typeshade/pull/482). Git records revisions; the pull request's review and merge record the decision.                                                                                                                                                                                                                                                                                               |

## What changes

`bitcast` takes a vector of 2, 3 or 4 components as well as a scalar. Each component's 32 bits
are read as the target's element type, as WGSL's overload
`bitcast<vecN<T>>(e: vecN<S>) -> vecN<T>` does
([WGSL §17.2.1](https://gpuweb.github.io/gpuweb/wgsl/#bitcast-builtin)). The element types are
the two the IR carries today, `u32` and `f32`.

| Written                                  | Before   | After: WGSL                       | After: GLSL ES 3.00   |
| ---------------------------------------- | -------- | --------------------------------- | --------------------- |
| `bitcast<u32>(x)`, `x: f32`              | accepted | `bitcast<u32>(x)`, unchanged      | `floatBitsToUint(x)`  |
| `bitcast<f32>(u)`, `u: u32`              | accepted | `bitcast<f32>(u)`, unchanged      | `uintBitsToFloat(u)`  |
| `bitcast<vec4u>(v)`, `v: vec4`           | `TS8003` | `bitcast<vec4<u32>>(v)`           | `floatBitsToUint(v)`  |
| `bitcast<vec2u>(v)`, `bitcast<vec3u>(v)` | `TS8003` | `bitcast<vec2<u32>>(v)`, and vec3 | `floatBitsToUint(v)`  |
| `bitcast<vec4>(w)`, `w: vec4u`           | `TS8003` | `bitcast<vec4<f32>>(w)`           | `uintBitsToFloat(w)`  |
| `bitcast<vec2>(w)`, `bitcast<vec3>(w)`   | `TS8003` | `bitcast<vec2<f32>>(w)`, and vec3 | `uintBitsToFloat(w)`  |
| `bitcast<vec3u>(v)`, `v: vec4`           | `TS8003` | `TS8003`, a width mismatch        | (refused at the call) |
| `bitcast<vec4i>(v)`, `bitcast<i32>(x)`   | `TS8003` | `TS8003`, unchanged               | (refused at the call) |

GLSL ES 3.00's `floatBitsToUint` and `uintBitsToFloat` take a `genType` (GLSL ES 3.00 §8.3), so
the GLSL column is the scalar spelling on a vector argument. The CPU oracle applies the scalar
operation to each component, so each component equals the scalar form's answer.

A width mismatch names the one overload the target has:
`bitcast<vec3u> reads the bits of a vec3; got vec4. A bitcast reinterprets 32 bits, it does not convert: vec3u(x) is the conversion.`
The exact wording is settled in the implementing pull request and pinned by its test (Rule 12.5).
The refusal of a target type that is not one of the eight keeps code `TS8003`. Its text names
the scalar and the vector forms.

The editor accepts the same calls. The ambient library declares `bitcast` over the eight target
types, and an accepted vector form shows no `TS2344` (Rule 12.7). The hover text, `FUNCTION_DOCS.bitcast`
in `src/language-service/docs.ts`, names the vector forms. The site's reference page for
`bitcast` reads the same sentence.

**Exclusions.** The signed forms, `bitcast<i32>` and `bitcast<vecNi>`, stay refused: they need
new scalar ids in the IR, and the diagnostic already names them as a separate gap. The `f16`
forms need the `shader-f16` extension, which this surface does not have. The builder API
(`bitcastU32`, `bitcastF32` in `src/core/ir/node.ts`) gains no vector form, so no export moves.

## Why

Radiance's `layout.shade.ts` reads the four integer words of an instance from one `vec4` of a
`storage<array<vec4>>`. WGSL reads them in one call. TypeShade refused that call with `TS8003`
in both halves, and the author wrote four scalar `bitcast<u32>` calls in a `vec4u` constructor
instead (#478, measured at e923a34 and at `main` 3f6f46b).

Rule 9.2 of `docs/language-design.md` says a builtin's signature is WGSL's, checked at the
call. WGSL has the vector overload, so the surface lacks a form that WGSL gives. Surface §44
lists only the two scalar forms, so the change moves that section.

### Alternatives considered

- **Keep the scalar forms and document the constructor workaround.** This costs nothing in the
  compiler, but it leaves Rule 9.2's gap open and makes every author write four calls for one.
- **Make `bitcastU32` and `bitcastF32` take any width.** One id for each element type would
  spell its WGSL type argument from the call's result type. The registry's row functions see
  only the argument text, not the type, so the row cannot write `vec4<u32>` without a change to
  the row contract for this one builtin.
- **Six new neutral ids, `bitcastVec2U32` to `bitcastVec4F32` (proposed).** Each id has one fixed
  spelling for each target, as `quantizeToF16Vec2` to `quantizeToF16Vec4` have. The site's
  builtins page reads the registry id by id, so each new id is one new row there.

### Decisions at acceptance

- The six ids are `bitcastVec2U32`, `bitcastVec3U32`, `bitcastVec4U32`, `bitcastVec2F32`,
  `bitcastVec3F32` and `bitcastVec4F32`, after `quantizeToF16VecN`. The owner approved this
  spelling on 2026-10-05.
- The determinism report lists the vector ids under the existing `bitcast` prefix of
  `EXACT_PREFIXES` (`src/core/passes/determinism.ts`), with no change there. This is an
  inference from the prefix match; the implementing test confirms it.

## What it touches

- `surface: [44]`. The section's table gains the vector rows, and the paragraph after it gains
  the width-mismatch refusal and the new `TS8003` text.
- `rules: []`. No rule paragraph changes. The change rests on Rules 9.2, 12.5 and 12.7 as they
  stand.
- `codes: []`. `TS8003` keeps its number. Its text for an unknown target changes.
- `examples: []`. `examples/packing-bitcast.shade.ts` gains one vector `bitcast`, so the compile
  gate reads one on Tint and on WebGL2. The set of examples does not change, and its emit
  golden is re-baked and read as a diff (Rule 11.4).
- `exports: []`. The builder API does not change (Exclusions).

Required functional evidence, from the tests #478 lists:

- `src/compiler/ts/builtin-breadth.test.ts`: `bitcast<vec2u>`, `bitcast<vec3u>` and
  `bitcast<vec4u>` on a float vector, and `bitcast<vec4>` on a `vec4u`. Each lowers to WGSL's
  `bitcast<vecN<...>>` and to `floatBitsToUint` or `uintBitsToFloat`. On the CPU oracle, each
  component equals the scalar form's answer.
- The same file's test `refuses the wrong shape, naming the one overload each has`: the width
  mismatch, with code and text.
- `src/language-service/ambient-parity.test.ts`: both halves accept `bitcast<vec4u>(v)`, and both
  refuse the width mismatch. No `TS2344` on an accepted form.
- `src/core/cpu-codegen.test.ts` holds the generated code to the interpreter on the new ids in
  both precisions (Rule 11.7).
- `bun run gate:compile` on the changed example.

### Draft impact estimate

Known work: one table and one check in `expression-call.ts`, six registry rows, the hover sentence, the oracle's
runtime helpers and generated code for six ids, the ambient declaration, surface §44, one line
in the example, and the tests above. The basis is the scalar implementation of #150, which
touched the same files. Duration and cost are not estimated. No dependency or tool changes.
The change is additive: every program that compiles today compiles to the same text.

### Approval and plan record

The approval is the owner's go-ahead in conversation on 2026-10-05, Asia/Seoul, which accepted
the two decisions above as proposed. The merge of [PR #482](https://github.com/typeshade/typeshade/pull/482)
records it; Git holds the merge commit. The approved revision is this file at that merge.
Responsibilities, milestones, duration and cost were not assigned.

### Configuration and validation record

**Implementation.** [PR #487](https://github.com/typeshade/typeshade/pull/487), with
`Change: 0044`, on the base `855aa986679ee63f8104e9f763fca17699c4a044` (the merge of PR #482), by
the repository's coding agent at the owner's direction. Git holds the merge commit. Delivered: the
six ids in `src/core/intrinsics.ts`; their oracle helpers in `src/core/cpu-runtime.ts`; the
`BITCAST_ID` rows and the `TS8003` text in `src/compiler/ts/lower/expression-call.ts`; the
constraint and `BitcastArg` in `src/language-service/ambient.ts`; `FUNCTION_DOCS.bitcast`;
surface §44; the CHANGELOG entry; one vector `bitcast` in `examples/packing-bitcast.shade.ts`,
whose two goldens changed by the two new lines and a CSE of `vec2(1., 1.)`.

**Functional validation**, 2026-10-05, the session's Linux container, bun 1.3.14, node 22.22.0:
`npx vitest run`, 397 files, 8412 passed, 1 skipped, 1 todo; `bun run gate:compile` on Chromium
141.0.7390.37 headless with SwiftShader, 138 examples, failures 0. The tests read both halves:
`builtin-breadth.test.ts` (spellings, both CPU paths, refusals), `ambient-parity.test.ts` (accept
and refuse rows), `determinism.test.ts` (every width `exact`, which confirms the prefix inference).

**Document validation**, the same date: `bun run docs:impact` (review items only, each read),
`bun run docs:refs` (0 dead references), `bun run reqs:sync` (no file changed), `doorstop -C`
(exit 0), `bun scripts/changes.ts --base origin/main` (inside 0044).

**Deviations.** None from the approved text.

## What it owes downstream

- **typeshade.github.io.** `src/lib/builtin-table.ts` gives each new id a category (`casts`, as
  `bitcastU32` has) and an arity of 1; an id with no arity stops the site's build. The language
  reference's §44 entry and the `packing-bitcast` example page show the new form when the pin
  moves. `compiler-changes.md` records `0044`.
- **vscode-typeshade.** `plugins/typeshade/skills/typeshade/references/language.md` says that
  `bitcast` takes a vector of `u32` or `f32` components too. `compiler-changes.md` records `0044`.

Each item is expected work. None is started, and each follows the pin that carries the
implementation.
