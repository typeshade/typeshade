---
id: '0130'
title: A stage and a function's other attributes are written as the language's own attributes, `@vertex`, `@fragment`, `@compute([…])`, `@workgroup_size([…])`, `@diagnostic(…)` and `@numerics([…])`, not as calls of fixed function names
status: draft
rules:
  - '6.6'
  - '6.7'
  - '8.1'
  - '8.7'
  - '8.22'
  - '9.6'
  - '11.22'
surface:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
  - 9
  - 10
  - 13
  - 14
  - 15
  - 16
  - 17
  - 19
  - 20
  - 21
  - 22
  - 23
  - 24
  - 25
  - 26
  - 27
  - 29
  - 33
  - 38
  - 39
  - 42
  - 43
  - 49
  - 50
  - 51
  - 52
  - 53
  - 54
  - 62
  - 63
  - 64
  - 65
  - 66
  - 67
  - 68
  - 69
  - 70
  - 71
  - 76
exports: []
exports-removed: []
codes:
  - TS8028
  - TS8078
examples:
  - array-length
  - array-literal-ramp
  - array-methods
  - atomic-histogram
  - bare-position
  - bit-bump
  - bitfield-bands
  - block-scope
  - bool-select
  - capsule-corp-namek-class
  - class-builder
  - class-parts
  - class-syntax
  - clip-planes
  - closures
  - compute-reduction-twin
  - compute-sync
  - convert-grid
  - cube-array-gather
  - cube-env
  - cutout
  - default-args
  - domain-warp-twin
  - feedback-trail
  - fp64-burning-ship-twin
  - fp64-cancellation-twin
  - fp64-checker-plane-twin
  - fp64-clock-twin
  - fp64-deep-zoom-twin
  - fp64-julia-twin
  - fp64-lane-stripes
  - fp64-loran-twin
  - fp64-mandelbrot-de-twin
  - fp64-newton-twin
  - fp64-rtc-twin
  - fp64-sine-sweep-twin
  - generic-class
  - generic-helpers
  - gpu-console
  - gradient-twin
  - hello
  - hello-uniform
  - hello-uniform-struct
  - hello-vsin
  - hello-vsout
  - higher-order
  - hillshade-twin
  - id-pick
  - imported-noise
  - inferred-returns
  - integer-math
  - julia-twin
  - kaleidoscope-twin
  - loop-kernel
  - loops-over-data
  - mandelbrot-twin
  - mixin-surface
  - module-const
  - msaa-resolve
  - normal-matrix
  - null-values
  - ocean-twin
  - optional-fields
  - optional-values
  - orbit-inout
  - packed-bytes
  - packing-bitcast
  - palette-const
  - particle-step
  - path-tracer
  - pick-composite
  - plasma-twin
  - private-state
  - ray-class
  - reference-parameters
  - rng-method
  - rt-renderer-class
  - sample-branch
  - separable-blur
  - shadow-compare
  - shape-inheritance
  - starfield-twin
  - storage-texture
  - subgroup-reduce
  - textured-quad
  - tunnel-twin
  - tuple-and-brand
  - twin-structs
  - uniform-array
  - voronoi-twin
  - workgroup-override
  - workgroup-reduce
  - workgroup-scratch
  - workgroup-tile-2d
downstream:
  - repo: typeshade.github.io
    what: Every page, example card, Playground starter (`playground-host-default.ts`) and generated host text that shows a stage call, `workgroup_size(…)` or `numerics(…)` is written again with the attribute, in English and in Korean; `compiler-changes.md` records 0130 when the pin moves.
  - repo: vscode-typeshade
    what: Snippets, the skill's references and the grammar's attribute highlighting follow the attribute form; the editor's TS1206 filter covers the stage attributes; `compiler-changes.md` records 0130 when the pin moves.
  - repo: radiance
    what: Every shader file that uses a stage call moves to the attribute form with `tshc migrate`; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typenn
    what: No stage call was found at review time (grep of `src/`); `compiler-changes.md` records 0130 when the pin moves.
  - repo: typecv
    what: Its shader files still use the stage decorators (251 under `src/` at review time), which this change keeps; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typeaudio
    what: The stage calls under `experiments/` (10 at review time) move to the attribute form; `compiler-changes.md` records 0130 when the pin moves.
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0130, `status: draft` (front matter).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Date and attribution          | Authored 2026-11-09 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                   |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean, said that the examples' change from `@vertex` to `vertex(…)` was not intended. The owner said that TypeShade is a language, not a library, and that fixed function names such as `vertex`, `fragment` and `compute` do not belong in it; a `"use typeshade"` file already has its own directive and its own compiler. The owner judged the rest of change 0111 appropriate. No GitHub issue is recorded.                                                                |
| Applicability / effectivity   | `docs/language-design.md` Rules 6.6, 6.7, 8.1, 8.7, 8.22, 9.6 and 11.22, `reqs/`, `docs/use-typeshade-surface.md` (every section that shows an entry), the front end's entry detection (`src/compiler/ts/stage-call.ts`, `src/compiler/ts/numerics.ts` and their callers), the ambient library and the diagnostic filter (`src/language-service/`), the host face, `tshc migrate`, `examples/plain-typescript.test.ts`, every `examples/**/*.shade.ts` that declares an entry, and the downstream repositories. No release version is assigned. |
| Review baseline               | `main` at `415b276a7408936cb483d05ca8bb39e797b05966` (#1092), read on 2026-11-09.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Review and revision authority | Pull request #1094. Git records the revisions of this file; the review and merge of #1094 record the decision. An earlier revision on #1094 proposed `vertex<T>` return types; the owner rejected it because those are fixed names too.                                                                                                                                                                                                                                                                                                         |

## What changes

This proposal replaces decision D1 of change 0111 and the matching spelling of change 0107
(Amendment 2). It keeps the rest of change 0111: `builtin<N, T>` and `location<I, T>` (D2),
`inout<T>` and `out<T>` (D4), and no uninitialized field (D8).

**The principle.** A `"use typeshade"` file is a program in the TypeShade language. Its own
compiler and language service read it. An attribute of a function is a language attribute,
written with `@` as WGSL writes it. It is not a call of a function that the author must know by
name. A plain `tsc` does not define what the language can write.

**Before (change 0111 D1, change 0107 Amendment 2):**

```ts
export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): VsOut { … });
export const fs = fragment(function fs(i: VsOut): location<0, vec4> { … }, {
  diagnostic: ["off", "derivative_uniformity"],
});
export const main = compute([8, 8], function main(id: builtin<"global_invocation_id", vec3u>) { … });
const f = numerics(["finite-math"], function f(x: f32): f32 { … });
```

**After:**

```ts
@vertex
export function vs(vi: builtin<"vertex_index", u32>): VsOut { … }

@fragment @diagnostic("off", "derivative_uniformity")
export function fs(i: VsOut): location<0, vec4> { … }

@compute([8, 8])
export function main(id: builtin<"global_invocation_id", vec3u>) { … }

@numerics(["finite-math"])
function f(x: f32): f32 { … }
```

The proposed rules, in short:

1. An entry point is a function declaration at the top of the file or of a namespace with one
   stage attribute: `@vertex`, `@fragment` or `@compute([x, y?, z?])` (Rule 8.1). A bare
   `@compute` takes the default size, 64 (Rule 8.7).
2. A kernel's workgroup size is `@workgroup_size([n])` on its function declaration (Rule 8.22).
3. `@diagnostic(severity, rule)` is written on an entry (Rule 6.7). `@numerics([…])` is written
   on a function of the file or an entry (Rule 11.22).
4. These are the forms that change 0111 had before D1, and the spelling 0107 first accepted.
   The front end and the editor already read them during 0111's migration period.
5. Entry inputs and outputs keep the types of change 0111: no decorator on a parameter or a
   field (Rule 6.6).
6. The calls `vertex(f)`, `fragment(f)`, `compute([…], f)`, `workgroup_size([…], f)` and
   `numerics([…], f)` give a warning that names the attribute, for one migration release, and are
   refused after it (D2). `tshc migrate` rewrites them.
7. The ambient library stops declaring the call forms after the migration release, so no fixed
   function name remains for an attribute.

The emitted WGSL and GLSL ES 3.00 do not change for a migrated program.

## Why

TypeShade is a language with its own directive and its own compiler. A stage is part of what a
program means, as it is in WGSL. A call of a function named `vertex` presents it as a library
API: the author must know a fixed name, the name occupies the value namespace, and the entry
carries its own name twice (`const vs = vertex(function vs …)`).

Change 0111 chose the call because a plain `tsc` gives TS1206 on a decorator of a function
declaration. That measures the file against a tool that does not read the language. The
TypeShade language service is the editor for a `"use typeshade"` file, and it already filters
TS1206 for these attributes (0111 milestone 4, #949).

**Alternatives considered:**

| Form                                                                          | Notes                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@vertex export function vs(…)`                                               | Selected. The language's attribute, as in WGSL.                                          |
| `export const vs = vertex(function vs(…) {…})` (change 0111)                  | A fixed function name; rejected by the owner.                                            |
| `export function vs(…): vertex<VsOut>` (an earlier revision of this proposal) | A fixed type name; rejected by the owner for the same reason.                            |
| `"use vertex"` directive in the body                                          | A second directive mechanism for what WGSL writes as an attribute.                       |
| The stage inferred from the signature                                         | An exported helper and an entry cannot be told apart, and a workgroup size has no place. |

**Costs of the selected form.**

- A project's plain `tsc --noEmit` reports TS1206 on each stage attribute, as before change 0111. A project type-checks a `"use typeshade"` file with the TypeShade tooling.
- An editor without the TypeShade extension shows the attribute lines in red.

**Assumptions.** The front end still reads the decorated forms, since 0111's migration period
kept them (`src/compiler/ts/stage3.test.ts`). The host face reads the stage from the attribute
as it did before change 0111.

## What it touches

- **Rule 6.6**: the TS1206 note for entries says the stage attribute's TS1206 is filtered by the
  language service; parameters and fields keep the types.
- **Rule 6.7**: the list of attribute places says that a stage, `workgroup_size`, `diagnostic`
  and `numerics` are attributes on a function declaration.
- **Rule 8.1**: an entry point is a function declaration with a stage attribute.
- **Rule 8.7**: the workgroup size is `@compute`'s argument; the call form is removed.
- **Rule 8.22**: a kernel's size is `@workgroup_size([n])`.
- **Rule 9.6** and **Rule 11.22**: `numerics` is `@numerics([…])`, as change 0107 first accepted.
- **Surface sections**: every section that shows an entry. The list is change 0111's. It is
  confirmed by `tshc migrate`'s dry run at acceptance.
- **codes**: `TS8028 ATTRIBUTE_NAME` gives the warning, and later the refusal, of the call forms,
  and stops warning on the stage attributes. `TS8078` names `@numerics` in its message. No code
  is added or removed.
- **examples**: the 94 `examples/*.shade.ts` files that contain a stage call at the baseline.
  Seven more files in subdirectories of `examples/` contain one; `scripts/changes.ts` does not
  track them, and `tshc migrate` rewrites them.

### Draft impact estimate

Known, measured at the baseline:

- 94 files under `examples/` contain a stage call: 87 `fragment(`, 85 `vertex(` and 13
  `compute(` entries. Two files use the `diagnostic` option. No example uses `workgroup_size(`.
- 214 files under `src/` contain a stage call, most of them tests (#921 moved them).
- typecv still uses the stage decorators; typeaudio uses the stage calls in `experiments/`.
- `examples/plain-typescript.test.ts` requires no TS1206 over the examples. It must allow the
  TS1206 of a stage attribute and keep refusing TS2564 and every other TS1206.

Estimated, not measured: the front end's entry detection, the host face, the language service's
hover, outline and completion, `tshc migrate` in the reverse direction, the site's Playground
starter, and each downstream repository's shader files. Most of the reading code exists from
before change 0111. Duration and cost are unknown.

Decisions to resolve before acceptance (recommendations are the author's, not decisions):

- **D1. Scope.** Recommended: `workgroup_size` and `numerics` return to attributes with the
  stages, so that no attribute is a call of a fixed name. The alternative changes only the three
  stages.
- **D2. Migration.** Recommended: one migration release where the call forms compile with a
  `TS8028` warning naming the attribute, then refusal. Change 0111 was not released with a
  version, so the alternative refuses the call forms at once.
- **D3. Plain `tsc`.** Recommended: `examples/plain-typescript.test.ts` allows TS1206 only on a
  stage attribute line and keeps the rest of its check (D8 of change 0111).
- **D4. Record of change 0111.** Recommended: 0111's record gains a note that D1 is replaced by
  0130, and its milestone 5 (refusal of the decorated form) is withdrawn.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's decision on D1 to D4, the
merge of #1094 with `status: accepted`, the approved revision, and the milestones.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits and pull
requests with `Change: 0130`; the emit goldens unchanged for every migrated example; both halves
(`compile()` and the language service) read on the attribute forms, the call forms' warning and
refusal, and hover (`src/language-service/ambient-parity.test.ts` shape); and the document audit
of the rules, the surface document and `reqs/`.

## What it owes downstream

Each repository in `downstream` rewrites its stage calls and the pages that show one, with
`tshc migrate`, when it moves its pin past the implementation, and records 0130 in its
`compiler-changes.md`. typeplot is not in `DOWNSTREAM_REPOS`; no stage call was found in it at
review time.
