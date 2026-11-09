---
id: '0130'
title: An entry point is a function declaration whose return type names its stage, `vertex<T>`, `fragment<T>` or `compute<[x, y?, z?]>`, with no wrapping call
status: draft
rules:
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
    what: Every page, example card, Playground starter (`playground-host-default.ts`) and generated host text that shows a stage call is written again with the stage in the return type, in English and in Korean; `compiler-changes.md` records 0130 when the pin moves.
  - repo: vscode-typeshade
    what: Snippets, the skill's references and the grammar follow the return-type form; `compiler-changes.md` records 0130 when the pin moves.
  - repo: radiance
    what: Every shader file moves to the return-type form with `tshc migrate`; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typenn
    what: No stage call was found at review time (grep of `src/`); `compiler-changes.md` records 0130 when the pin moves.
  - repo: typecv
    what: Its shader files still use the decorated form (251 stage decorators under `src/` at review time); `tshc migrate` moves them to the return-type form in one step; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typeaudio
    what: The stage calls under `experiments/` (10 at review time) move to the return-type form; `compiler-changes.md` records 0130 when the pin moves.
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0130, `status: draft` (front matter).                                                                                                                                                                                                                                                                                                                                                                                           |
| Date and attribution          | Authored 2026-11-09 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                            |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean, said that the examples' change from `@vertex` to `vertex(…)` was not intended, and that the stage calls `vertex`, `fragment` and `compute` are excessive while the rest of change 0111 is appropriate. Offered four forms, the owner selected the stage in the return type. No GitHub issue is recorded.                                                         |
| Applicability / effectivity   | `docs/language-design.md` Rules 6.7, 8.1, 8.7 and 8.22, `reqs/`, `docs/use-typeshade-surface.md` (every section that shows an entry), the front end's entry detection (`src/compiler/ts/stage-call.ts` and its callers), the ambient library (`src/language-service/ambient.ts`), the host face, `tshc migrate`, every `examples/**/*.shade.ts` that declares an entry, and the downstream repositories. No release version is assigned. |
| Review baseline               | `main` at `415b276a7408936cb483d05ca8bb39e797b05966` (#1092), read on 2026-11-09.                                                                                                                                                                                                                                                                                                                                                        |
| Review and revision authority | No pull request is assigned at authorship. Git records the revisions of this file; the review and merge of its pull request record the decision.                                                                                                                                                                                                                                                                                         |

## What changes

This proposal replaces decision D1 of change 0111 (the stage call). It keeps D2 (`builtin<N, T>`
and `location<I, T>`), D4 (`inout<T>`, `out<T>`), D7 and D8 of change 0111 as they are. The
goal of change 0111 stays: a `"use typeshade"` file is TypeScript that a plain `tsc --strict`
accepts.

**Before (change 0111, D1, Rule 8.1).** An entry is a `const` that a stage call initializes:

```ts
export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): VsOut { … });
export const fs = fragment(function fs(i: VsOut): location<0, vec4> { … }, {
  diagnostic: ["off", "derivative_uniformity"],
});
export const main = compute([64, 1, 1], function main(id: builtin<"global_invocation_id", vec3u>) { … });
```

**After.** An entry is a function declaration. Its written return type names the stage, and the
stage's type argument is the entry's output type:

```ts
export function vs(vi: builtin<"vertex_index", u32>): vertex<VsOut> { … }
export function fs(i: VsOut): fragment<location<0, vec4>, { diagnostic: ["off", "derivative_uniformity"] }> { … }
export function depthOnly(i: VsOut): fragment { … }                    // no colour output
export function main(id: builtin<"global_invocation_id", vec3u>): compute<[64, 1, 1]> { … }
export function grow(id: builtin<"global_invocation_id", vec3u>): compute<[typeof WG_SIZE]> { … }
export function dflt(): compute { … }                                    // the default size, 64
```

The proposed rules, in short:

1. `vertex<T, O?>` means `T`. `fragment<T = void, O?>` means `T`. `compute<S = [64], O?>` means
   `void`. `O` is the options object of change 0111 D7 (`diagnostic`, `numerics`), written as a
   type literal.
2. An entry is a function declaration at the top of the file or of a namespace. Its return type
   annotation is written, and it is a reference to `vertex`, `fragment` or `compute` (Rule 8.1).
3. A workgroup extent is a number literal type, or `typeof NAME` for an integer module constant
   or a `u32` override (Rule 8.7). The constraint `readonly [x, y?, z?]` lets `tsc` refuse a
   fourth extent.
4. A stage type written anywhere else is `TS8028`: in a type alias, a parameter, a field, a
   local function or an arrow function. The message names the place where it applies.
5. The stage call of change 0111 and the decorated form give a `TS8028` warning that names the
   new form, for one migration release, and are refused after it. `tshc migrate` rewrites both
   forms to the new form.
6. A kernel that needs a workgroup size other than the default writes `workgroup_size<[n]>` as
   its return type, in place of the `workgroup_size([n], f)` call (Rule 8.22). See D3.

The emitted WGSL and GLSL ES 3.00 do not change for a migrated program.

## Why

The owner judged the stage call excessive. The evidence in the source:

- Each entry carries its name twice, `const vs` and `function vs`, and Rule 8.1 must refuse a
  mismatch between the two.
- The entry's body sits inside a call's parentheses. The closing `});` and, with options,
  `}, { … });` are noise around the body.
- An entry is not a function declaration, so it is not hoisted, and an editor outline shows a
  `const`.
- The stage is the only attribute of change 0111 that is a value. D2 and D4 made every other
  attribute a type. A stage in the return type puts all attributes in types.

WGSL itself writes the output type next to the stage: `@vertex fn vs(…) -> VsOut`. The
return-type form keeps that pairing.

**Alternatives considered (selected by the owner on 2026-11-09):**

| Form                                                         | Plain `tsc --strict` | Notes                                                                                          |
| ------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| `export function vs(…): vertex<VsOut>`                       | accepted (measured)  | Selected. All attributes are types.                                                            |
| `@vertex export function vs(…)` (before change 0111)         | TS1206               | Shortest. Breaks the goal of change 0111; the editor keeps a TS1206 filter.                    |
| `export function vs(…) {…}` and `vertex(vs);`                | accepted             | The stage is separated from the declaration.                                                   |
| `/** @vertex */` JSDoc tag                                   | accepted             | A comment changes the program; formatters and minifiers may drop it (rejected in change 0111). |
| `export const vs = vertex(function vs(…) {…})` (change 0111) | accepted             | The current form, judged excessive.                                                            |

**Costs of the selected form.**

- The stage is in a type alias that TypeScript erases. Hover on a call of `vs` can show `VsOut`,
  not `vertex<VsOut>`. Change 0111 D2 has the same cost, and the language service reads the
  written type node for hover the same way.
- An output with no struct is longer: `fragment<location<0, vec4>>`.
- A workgroup extent that names an override needs `typeof`: `compute<[typeof WG_SIZE]>`.
- Options move from a value to a type literal. A wrong option is still a `tsc` error (measured).

**Assumptions.** The front end can read the stage, its extents and its options from the written
return type node, as it reads `builtin<…>` today. The host face reads the stage from the same
node and gives the host the same signature.

## What it touches

- **Rule 6.7**: the list of attribute places says that a stage is the return type of an entry
  and that its options are the stage type's second argument.
- **Rule 8.1**: an entry point is a function declaration whose written return type is a stage
  type; a stage type written anywhere else is refused.
- **Rule 8.7**: the workgroup extents are written as literal types or `typeof` a constant or an
  override name; the default stays 64.
- **Rule 8.22**: a kernel's workgroup size moves from the `workgroup_size([n], f)` call to the
  return type `workgroup_size<[n]>` (D3).
- **Surface sections**: every section that shows an entry. The list in the front matter is the
  list of change 0111. It is confirmed by `tshc migrate`'s dry run at acceptance (D5).
- **codes**: `TS8028 ATTRIBUTE_NAME` gains the warning and later the refusal of the stage call,
  and its decorator messages name the new form. No code is added or removed.
- **examples**: the 94 `examples/*.shade.ts` files that contain a stage call at the baseline.
  Seven more files in subdirectories of `examples/` contain one; `scripts/changes.ts` does not
  track them, and `tshc migrate` rewrites them.

### Draft impact estimate

Known, measured at the baseline:

- 94 files under `examples/` contain a stage call: 87 `fragment(`, 85 `vertex(` and 13
  `compute(` entries. Two files use the `diagnostic` option. No example uses `workgroup_size(`.
- 214 files under `src/` contain a stage call, most of them tests.
- typecv still uses the decorated form; typeaudio uses the stage call in `experiments/`.

Measured on 2026-11-09 with `typescript@5.6.3` (the version in `package.json`),
`tsc --noEmit --strict --target es2022 --lib es2022`, and a minimal ambient file that declares
the three stage types as above:

- `vertex<VsOut>`, `fragment<location<0, vec4>, { diagnostic: […] }>`, a bare `fragment` with
  an empty body, `compute<[8, 8]>`, `compute<[typeof WG_SIZE]>` with an `override<u32>`, and a
  bare `compute`: no diagnostic.
- The stage type `vertex` and the call `vertex(…)` declared in the same file: no diagnostic. A
  type and a function can share a name, so both forms can exist during migration.
- `compute<[0, 1, 2, 3]>`: TS2344. An unknown option `{ nope: 1 }`: TS2559.

Estimated, not measured: the front end's entry detection, the host face, reflection's entry
list, the language service's hover, outline and completion, `tshc migrate`, the site's
Playground starter, and each downstream repository's shader files. The work is mostly mechanical
once `tshc migrate` writes the new form. Duration and cost are unknown.

Decisions to resolve before acceptance (recommendations are the author's, not decisions):

- **D1. Arrow functions.** Recommended: only a function declaration is an entry. One spelling
  per meaning (change 0112). An arrow function with a stage return type is `TS8028`.
- **D2. Options.** Recommended: the stage type's second argument, a type literal, as shown. The
  alternative keeps a value call for an entry with options, which gives two spellings.
- **D3. `workgroup_size` for kernels.** Recommended: the return type `workgroup_size<[n]>`, for
  the same reason as the stages. The alternative leaves the call, which keeps one value-form
  attribute.
- **D4. Migration.** Recommended: one migration release where the stage call and the decorated
  form compile with a `TS8028` warning naming the new form, then refusal, as change 0111 D5.
  `tshc migrate` rewrites both forms.
- **D5. Scope of the record.** Recommended: this proposal amends Rule 8.1 and the other rules
  above, and change 0111's record gains a note that D1 is replaced by 0130. Change 0111's
  milestone 5 (refusal of the decorated form) is carried by this proposal's D4.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's decision on D1 to D5, the
merge of this pull request with `status: accepted`, the approved revision, and the milestones.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits and pull
requests with `Change: 0130`; the emit goldens unchanged for every migrated example; a plain
`tsc --strict` over every `examples/**/*.shade.ts` with no TS1206 and no TS2564
(`examples/plain-typescript.test.ts`); both halves (`compile()` and the language service) read
on the new form, its refusals and its hover (`src/language-service/ambient-parity.test.ts`
shape); and the document audit of the rules, the surface document and `reqs/`.

## What it owes downstream

Each repository in `downstream` rewrites its shader files and the pages that show an entry,
with `tshc migrate`, when it moves its pin past the implementation, and records 0130 in its
`compiler-changes.md`. The front matter names the expected work for each. typeplot is not in
`DOWNSTREAM_REPOS`; no stage call was found in it at review time.
