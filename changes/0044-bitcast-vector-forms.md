---
id: '0044'
title: '`bitcast<vecNu>(v)` and `bitcast<vecN>(v)` read the bits of a vector, one component at a time, as WGSL''s vector overload does'
status: draft
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

<!-- doc-refs: skip-file — a draft proposal names ids and tests that do not exist yet, and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0044`, `status: draft`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                                                                                                                     |
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

### Unresolved decisions

- The names of the six ids. `bitcastVecNU32` and `bitcastVecNF32` follow `quantizeToF16VecN`;
  another spelling is open until acceptance.
- Whether the determinism report lists the vector ids under the existing `bitcast` prefix of
  `EXACT_PREFIXES` (`src/core/passes/determinism.ts`). The prefix matches the proposed names,
  so the inference is that no change there is needed. The implementing test confirms it.

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

This record does not yet apply. Acceptance requires: the owner's decision on the two unresolved
decisions above, recorded in this file; the actual decision and its pull request reference; and
the approved revision of this file. No responsibility, milestone, duration or cost is assigned
by this draft.

### Configuration and validation record

This record does not yet apply. Delivery requires: the implementing commits with `Change: 0044`;
the tests above and the compile gate green on the delivered revision; `bun run docs:impact` and
`docs:refs` clean; and, separately, the site's and the editor's pin pull requests with `0044`
recorded in their `compiler-changes.md`.

## What it owes downstream

- **typeshade.github.io.** `src/lib/builtin-table.ts` gives each new id a category (`casts`, as
  `bitcastU32` has) and an arity of 1; an id with no arity stops the site's build. The language
  reference's §44 entry and the `packing-bitcast` example page show the new form when the pin
  moves. `compiler-changes.md` records `0044`.
- **vscode-typeshade.** `plugins/typeshade/skills/typeshade/references/language.md` says that
  `bitcast` takes a vector of `u32` or `f32` components too. `compiler-changes.md` records `0044`.

Each item is expected work. None is started, and each follows the pin that carries the
implementation.
