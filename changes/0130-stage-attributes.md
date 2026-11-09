---
id: '0130'
title: A stage and a function's other attributes are written as the language's own attributes, `@vertex`, `@fragment` and `@compute([…])`, not as calls of fixed function names
status: draft
rules:
  - '1.8'
  - '6.6'
  - '6.7'
  - '8.1'
  - '8.7'
  - '8.22'
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
    what: Every page, example card, Playground starter (`playground-host-default.ts`) and generated host text that shows a stage call or `workgroup_size(…)` is written again with the attribute, in English and in Korean; `compiler-changes.md` records 0130 when the pin moves.
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

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0130, `status: draft` (front matter).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date and attribution          | Authored 2026-11-09 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                 |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean, said that the examples' change from `@vertex` to `vertex(…)` was not intended. The owner said that TypeShade is a language, not a library, and that fixed function names such as `vertex`, `fragment` and `compute` do not belong in it; a `"use typeshade"` file already has its own directive and its own compiler. The owner judged the rest of change 0111 appropriate. No GitHub issue is recorded.                              |
| Applicability / effectivity   | `docs/language-design.md` Rules 1.8 (new), 6.6, 6.7, 8.1, 8.7 and 8.22, `reqs/`, `docs/use-typeshade-surface.md` (every section that shows an entry), the front end's entry detection (`src/compiler/ts/stage-call.ts` and its callers), the ambient library and the diagnostic filter (`src/language-service/`), the host face, `tshc migrate`, `examples/plain-typescript.test.ts`, every `examples/**/*.shade.ts` that declares an entry, and the downstream repositories. No release version is assigned. |
| Review baseline               | `main` at `415b276a7408936cb483d05ca8bb39e797b05966` (#1092), read on 2026-11-09.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Review and revision authority | Pull request #1094. Git records the revisions of this file; the review and merge of #1094 record the decision. An earlier revision on #1094 proposed `vertex<T>` return types; the owner rejected it because those are fixed names too.                                                                                                                                                                                                                                                                       |

## What changes

This proposal replaces decision D1 of change 0111. It keeps the rest of change 0111: `builtin<N, T>` and `location<I, T>` (D2),
`inout<T>` and `out<T>` (D4), and no uninitialized field (D8).

**The principle, a new Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> The proposed text, for `docs/language-design.md` §1.8 after
Rule 1.7:

> **Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> A construct of the language is written in the language's own syntax: the
> directive, a type of the surface, or an attribute `@name` or `@name(…)` on the declaration it
> marks. A construct must not be written as a call of a function whose only role is to carry it.
> A stage (`@vertex`, `@fragment`, `@compute`) is written as an attribute. A construct is added only for
> what the author must state and the compiler cannot know; what the compiler can decide (an
> optimization it can prove exact, a tuning parameter, a validation it can satisfy by
> rewriting the program) is the compiler's work and never an
> author-facing construct. Whether a plain `tsc` accepts a form is not a criterion for the surface.
>
> - Rationale: a `"use typeshade"` file is a program in the TypeShade language. Its own
>   compiler and language service read it (Rule 3.1). A call of a fixed function name presents a
>   construct as a library API: the author must know the name, the name takes a place in the value
>   namespace, and the declaration is wrapped. Change 0111 D1 measured the surface against a
>   plain `tsc`, a tool that does not read the language, and replaced `@vertex` with
>   `vertex(f)`; a plain `tsc` still does not accept a shader file whole, since vector
>   arithmetic is an operator TypeScript does not overload, and a host project's `tsc` reads the
>   generated host view, not the source (surface §64). This rule prevents that criterion. The types of an entry's inputs and outputs
>   (`builtin<N, T>`, `location<I, T>`, `inout<T>`, `out<T>`) mark a value and stay types (Rule 6.6,
>   Rule 8.25). How the editor keeps TypeScript's checker for an attribute is open (independent review, S2)
>   (Rule 1.7, Rule 12.7).
> - Derives from: `changes/0130-stage-attributes.md`; the owner's direction of 2026-11-09.
> - Enforced by: review (Rule 13.1); `TS8028 ATTRIBUTE_NAME` on a call form after the migration
>   release.

**Before (change 0111 D1):**

```ts
export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): VsOut { … });
export const fs = fragment(function fs(i: VsOut): location<0, vec4> { … });
export const main = compute([8, 8], function main(id: builtin<"global_invocation_id", vec3u>) { … });
```

**After:**

```ts
@vertex
export function vs(vi: builtin<"vertex_index", u32>): VsOut { … }

@fragment
export function fs(i: VsOut): location<0, vec4> { … }

@compute([8, 8])
export function main(id: builtin<"global_invocation_id", vec3u>) { … }

```

The proposed rules, in short:

1. An entry point is a function declaration at the top of the file or of a namespace with one
   stage attribute: `@vertex`, `@fragment` or `@compute([x, y?, z?])` (Rule 8.1). A bare
   `@compute` takes the default size, 64 (Rule 8.7).
2. A kernel's workgroup size follows D1: the compiler chooses it, or `@workgroup_size([n])`
   on its function declaration (Rule 8.22).
3. `diagnostic` is not in this proposal (item 9).
4. The stage attributes are the forms that change 0111 had before D1.
   The front end and the editor already read them during 0111's migration period.
5. Entry inputs and outputs keep the types of change 0111: no decorator on a parameter or a
   field (Rule 6.6).
6. The calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and `workgroup_size([…], f)` give a
   warning that names the attribute, for one migration release, and are
   refused after it (D2). `tshc migrate` rewrites them.
7. The ambient library stops declaring the call forms after the migration release, so no fixed
   function name remains for an attribute.
8. `numerics` is not in this proposal. The owner directed on 2026-11-09 that it be removed, not
   respelled, because a numerical relaxation is the compiler's work (Rule 1.8). <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> A separate
   proposal removes the `numerics(…)` call, the stage calls' `numerics` option, Rule 11.22 and
   `TS8078`. That proposal is accepted before this one's call forms are refused, so that no entry
   is left with an option it cannot write.
9. `diagnostic` is not in this proposal either. The owner directed on 2026-11-09 that it be
   removed. Its one use, `derivative_uniformity`, accepts an implicit-LOD sample or a derivative
   in non-uniform control flow. The compiler can satisfy that rule itself: it computes the
   derivatives before the branch, in uniform flow, and samples with `textureSampleGrad` inside
   it. A separate proposal removes the `diagnostic` option and the attribute, adds that rewrite,
   and keeps `TS8052` for a case the rewrite cannot reach. It is accepted before this one's call
   forms are refused, for the reason in item 8.

The emitted WGSL and GLSL ES 3.00 do not change for a migrated program.

## Why

TypeShade is a language with its own directive and its own compiler. A stage is part of what a
program means, as it is in WGSL. A call of a function named `vertex` presents it as a library
API: the author must know a fixed name, the name occupies the value namespace, and the entry
carries its own name twice (`const vs = vertex(function vs …)`).

Change 0111 chose the call because a plain `tsc` gives TS1206 on a decorator of a function
declaration. That measures the file against a tool that does not read the language, and the
goal could not be reached: a plain `tsc` does not accept a shader file whole, because its vector
arithmetic is an operator TypeScript does not overload (§64). A host project's `tsc` never reads
the source; it reads the generated host view (§64). The TypeShade language service is the editor
for a `"use typeshade"` file. It filters TS1206 on the decorated form only as a migration shim, coupled to TS2564 (0111
milestone 4, #949). So change 0111 D1 gave up the language's attribute and gained no file that a
plain `tsc` accepts.

**Alternatives considered:**

| Form                                                                          | Notes                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@vertex export function vs(…)`                                               | Selected. The language's attribute, as in WGSL.                                          |
| `export const vs = vertex(function vs(…) {…})` (change 0111)                  | A fixed function name; rejected by the owner.                                            |
| `export function vs(…): vertex<VsOut>` (an earlier revision of this proposal) | A fixed type name; rejected by the owner for the same reason.                            |
| `"use vertex"` directive in the body                                          | A second directive mechanism for what WGSL writes as an attribute.                       |
| The stage inferred from the signature                                         | An exported helper and an entry cannot be told apart, and a workgroup size has no place. |

**Costs of the selected form.**

- No new cost reaches a host project. Its `tsconfig.json` excludes `*.shade.ts`, and its `tsc`
  reads the generated host view (`*.shade.typeshade.ts`) in place of the source
  (`docs/use-typeshade-surface.md` §64), with the documented setup (`moduleSuffixes` and the views `tshc sync` writes). A shader project is checked with `tshc check`. The `tsconfig.shade.json` path in `README.md` runs plain `tsc` over shader sources (independent review, S6).
- A plain `tsc` run directly over a shader source reports TS1206 on each function attribute.
  It already reports errors on such a file without this change: §64 says that ordinary `tsc`
  does not accept a shader file whole, because its vector arithmetic is an operator TypeScript
  does not overload.
- An editor without the TypeShade extension shows the attribute lines in red. It already shows
  the vector arithmetic in red, for the same reason.

**Assumptions.** The front end still reads the decorated forms, since 0111's migration period
kept them (`src/compiler/ts/stage3.test.ts`). The host face reads the stage from the attribute
as it did before change 0111.

## What it touches

- <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
  **Rule 1.8** (new): a construct of the language is written in its own syntax, never as a call
  of a function whose only role is to carry it; a plain `tsc` is not a criterion for the surface.
- **Rule 6.6**: the TS1206 note for entries says the stage attribute's TS1206 is filtered by the
  language service; parameters and fields keep the types.
- **Rule 6.7**: the list of attribute places says that a stage is an attribute on a function
  declaration (and `workgroup_size` too under D1 option B).
- **Rule 8.1**: an entry point is a function declaration with a stage attribute.
- **Rule 8.7**: the workgroup size is `@compute`'s argument; the call form is removed.
- **Rule 8.22**: a kernel's size is `@workgroup_size([n])`.
- **Surface sections**: every section that shows an entry. The list is change 0111's. It is
  confirmed by `tshc migrate`'s dry run at acceptance.
- **codes**: `TS8028 ATTRIBUTE_NAME` gives the warning, and later the refusal, of the call forms,
  and stops warning on the stage attributes. No code is added or removed.
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

- **D1. A kernel's `workgroup_size`.** A kernel's workgroup size is a tuning parameter, which
  Rule 1.8 makes the compiler's. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> Option A: the compiler chooses it and `workgroup_size([…], f)`
  is removed, by a separate proposal with `numerics`. Option B: it returns to the attribute
  `@workgroup_size([n])` in this proposal. No example uses it at the baseline. The author's
  recommendation is A.
- **D2. Migration.** Recommended: one migration release where the call forms compile with a
  `TS8028` warning naming the attribute, then refusal. Change 0111 was not released with a
  version, so the alternative refuses the call forms at once.
- **D3. Plain `tsc`.** Recommended: `examples/plain-typescript.test.ts` allows TS1206 only on a
  function attribute line and keeps the rest of its check (D8 of change 0111). Surface §64's
  sentence "its entry forms are plain TypeScript (change 0111)" is corrected with it.
- **D4. Record of change 0111.** Recommended: 0111's record gains a note that D1 is replaced by
  0130, and its milestone 5 (refusal of the decorated form) is withdrawn.

### Independent review record

Reviewer: a Claude Code agent that did not write this proposal, run by the author on
2026-11-09 under `changes/README.md` (Independent review). Revision reviewed: commit `87d87344`.
Verdict: revise before acceptance. Status of each finding: **fixed** in this revision,
**open** (to fix in the next revision), or **owner** (needs the owner's decision).

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                               | Status                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Rule 1.8 listed "a numerical relaxation" as compiler work; a relaxation changes results, so the compiler cannot apply one by itself (0107, `docs/dx.md`, `docs/compiler-owns-performance.md`).                                                                                                                                                                        | fixed: the parenthesis now says "an optimization it can prove exact". The removal of `numerics` stays a separate proposal.                       | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B2  | `@compute([8, 8])` is kept while Rule 1.8 calls a tuning parameter compiler work. The size is author knowledge where it is observable (host workgroup count, `local_invocation_id`, workgroup memory, barriers, subgroups); a kernel's size is tuning. Items 2 and 6 and What it touches disagree with D1. `docs/dx.md` principle 6 keeps "a workgroup shape" public. | owner: the criterion and D1.                                                                                                                     | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B3  | The editor's TS1206 and TS2564 filters both follow `usesDecoratedForm` (`src/language-service/diagnostics.ts`, `src/compiler/ts/decorated-form.ts`): a file with `@vertex` loses TS2564 and the parameter-decorator TS1206.                                                                                                                                           | open: What it touches will require the filter narrowed to a stage attribute on a module function, decoupled from TS2564, with a two-halves test. |
| B4  | 0130 keeps 0111 D8 (`!` on fields and `let q!`), which exists only for plain `tsc`, while Rule 1.8 says plain `tsc` is not a criterion. D3 keeps a plain-`tsc` test.                                                                                                                                                                                                  | owner: a new decision on D8 and on D3.                                                                                                           | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| S1  | A decorator on a function declaration is a parse error in prettier, `@typescript-eslint/typescript-estree`, esbuild, Bun and Node's type stripping; the costs above named only `tsc` and the editor. This repository's and typecv's `.prettierignore` already exclude decorated shader files.                                                                         | owner: this cost against the language's own syntax (`CLAUDE.md`, principle conflicts).                                                           |
| S2  | No projection of an attribute exists, only a filter; TypeScript does not check a decorator expression on a function declaration, so Rule 1.7 is not met for the stage argument.                                                                                                                                                                                       | owner: a projection in the language service, or an exception to Rule 1.7. The overclaim is fixed.                                                |
| S3  | Item 7 meets Rule 2.1: an attribute name the ambient library does not declare is outside the author-facing set.                                                                                                                                                                                                                                                       | open: add Rule 2.1 and the surface-names test to the scope.                                                                                      |
| S4  | The stage can be inferred from the attribute types in most entries; only a compute entry without a builtin, and the size, are ambiguous.                                                                                                                                                                                                                              | owner: inference with a marker only where the compiler cannot know, or a marker on every entry.                                                  |
| S5  | Rule 1.8 conflicts with Rule 1.4 and `docs/roadmap.md` ("ordinary TypeScript first") without naming it, and its "attribute vs type" criterion is only in the rationale.                                                                                                                                                                                               | open: cite both, move the criterion into the rule.                                                                                               | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| S6  | Scope misses `journeys/` (77 files), `README.md` `tsconfig.shade.json`, the diagnostic messages that name the call form, `docs/dx.md` and `docs/roadmap.md`.                                                                                                                                                                                                          | open.                                                                                                                                            |
| S7  | No migration order with 0111 milestone 5, the `numerics` and `diagnostic` removals, and a split `tshc migrate`.                                                                                                                                                                                                                                                       | open.                                                                                                                                            |
| S8  | typecv still owes 224 `@builtin` and 10 `@inout` parameter decorators; typeplot writes 44 stage decorators.                                                                                                                                                                                                                                                           | open.                                                                                                                                            |
| N1  | The factual basis is otherwise correct (decorated form compiles with TS8028; 94 + 7 examples).                                                                                                                                                                                                                                                                        | noted.                                                                                                                                           |
| N2  | The §64 claim holds only with the documented setup.                                                                                                                                                                                                                                                                                                                   | fixed.                                                                                                                                           |
| N4  | The request source should record the reversal as a new decision, not as an unintended outcome.                                                                                                                                                                                                                                                                        | open.                                                                                                                                            |
| N5  | The `textureSampleGrad` rewrite of item 9 is unproven when the coordinate is computed inside the branch.                                                                                                                                                                                                                                                              | open: an assumption for the separate proposal.                                                                                                   |

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
