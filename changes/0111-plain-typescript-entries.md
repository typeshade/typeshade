---
id: '0111'
title: An entry point and its inputs and outputs are written in TypeScript that a plain `tsc --strict` accepts, with no decorator on a function or a parameter and no field left uninitialized
status: draft
rules:
  - '6.6'
  - '6.7'
  - '7.2'
  - '7.6'
  - '8.1'
  - '8.2'
  - '8.22'
  - '8.25'
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
  - hello-camera
  - hello-uniform-struct
  - hello-uniform
  - hello-vsin
  - hello-vsout
  - hello
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
    what: Every page, example card, Playground starter and generated host text that shows an entry point, an entry I/O struct, `@inout`, `@out` or `@workgroup_size` is written again in the new form, in English and in Korean; `compiler-changes.md` records 0111 when the pin moves. The full list is established at acceptance (D6).
  - repo: vscode-typeshade
    what: The diagnostic filter for TS1206 and the `strictPropertyInitialization` override are removed or narrowed; snippets, the skill's references and the grammar's decorator highlighting follow the new form; `compiler-changes.md` records 0111 when the pin moves.
  - repo: radiance
    what: Every shader file is migrated to the new form, by the migration tool of D5; `compiler-changes.md` records 0111 when the pin moves.
  - repo: typenn
    what: Every shader file is migrated to the new form, by the migration tool of D5; `compiler-changes.md` records 0111 when the pin moves.
  - repo: typecv
    what: Every shader file is migrated to the new form, by the migration tool of D5; `compiler-changes.md` records 0111 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names forms, rules and tools that its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0111, `status: draft`. The front matter is the identity and lifecycle authority. No approval is recorded.                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                    |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, asked whether `examples/hello-vsout.shade.ts` is code that ordinary TypeScript accepts, and directed that a form that is not ordinary TypeScript be changed. The agent measured the file with `tsc` (Evidence) and proposed this draft. The owner approved the drafting ("승인"). No GitHub issue is recorded.                                           |
| Applicability / effectivity   | `docs/language-design.md` Rules 6.6, 6.7, 8.1, 8.2, 8.22 and 8.25, `reqs/`, `docs/use-typeshade-surface.md` §3, §53, §67 and §70 and every section that shows an entry, the front end (`src/compiler/ts/`), the ambient library and the diagnostic filter (`src/language-service/`), the host face, every `examples/**/*.shade.ts` that declares an entry, and the five downstream repositories. No release version is assigned. |
| Review baseline               | `main` at `c9efde0f79df0e6b10883b87c8af21d0c72dfbc9` (the merge of pull request #870), read on 2026-11-02.                                                                                                                                                                                                                                                                                                                       |
| Review and revision authority | No pull request is assigned when this file is written. Git records the revisions of this file. The review and merge of its pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                            |

## What changes

**Before.** An entry point is a function declaration with a decorator on the function and
decorators on its parameters (Rule 6.6, Rule 6.7, surface §3):

```ts
class VsOut {
  @builtin('position') pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@builtin('vertex_index') i: u32): VsOut {
  return { pos: vec4(0, 0, 0, 1), uv: vec2(0, 0) };
}
```

A plain TypeScript compiler refuses three parts of this file (Evidence):

- `@vertex` on a function declaration is `TS1206 Decorators are not valid here`. TypeScript
  accepts no decorator on a function declaration, in standard or in legacy decorators.
- `@builtin("vertex_index")` on a parameter of a function declaration is `TS1206`. Standard
  decorators have no parameter decorator, and legacy decorators allow one only on a parameter
  of a class method or constructor.
- A field with no initializer, `pos: vec4;`, is `TS2564` under `--strict`.

The editor hides all three. `isDecoratorOnTopLevelFunction` in
`src/language-service/diagnostics.ts` drops TS1206 for an entry and its parameters, and
`typeshadeCompilerOptions()` in `src/language-service/host.ts` sets
`strictPropertyInitialization: false` and `experimentalDecorators: true`. The comment on the
filter says that no ambient declaration can remove this restriction. A `"use typeshade"` file
therefore type-checks only inside the TypeShade language service, and not under the project's
own `tsc`.

The object literal returned for a class type is not one of the three. TypeScript compares a
class with only public fields by its structure, and `tsc --strict` accepts the return.

**After.** Every form an author writes for an entry point type-checks under a plain
`tsc --strict --target es2022` with the published ambient library and no diagnostic filter:

1. **The stage** is a call that wraps the function (D1):

   ```ts
   export const vs = vertex(function vs(input: VsIn): VsOut { … });
   export const fs = fragment((v: VsOut): Color => ({ color: … }));
   export const main = compute([64], function main(id: Builtin<'global_invocation_id', vec3u>) { … });
   ```

   `compute([x, y?, z?], f)` carries the workgroup size that `@compute([…])` carries today, and
   `workgroupSize([…], f)` replaces `@workgroup_size([…])` on a kernel function (Rule 8.22).

2. **An attribute of an input or an output is a type** (D2, decided). `Builtin<N, T>` and
   `Location<I, T>` are types that mean `T`, and the compiler reads the attribute from the
   written type: `i: Builtin<'vertex_index', u32>` on a parameter and
   `uv: Location<0, vec2>` on a field. An entry I/O struct may be a `class`, an `interface` or a
   `type` (Rule 6.9), and no field needs a decorator or an initializer:

   ```ts
   interface VsOut {
     pos: Builtin<'position', vec4>;
     uv: Location<0, vec2>;
   }

   export const vs = vertex(function vs(i: Builtin<'vertex_index', u32>): VsOut {
     return { pos: vec4(0, 0, 0, 1), uv: vec2(0, 0) };
   });
   ```

   The other attributes of Rule 6.7 on an input or an output are a third type argument, an
   object type of options: `Location<0, u32, { interpolate: 'flat' }>`,
   `Builtin<'position', vec4, { invariant: true }>`, `Location<0, vec4, { blend_src: 1 }>` (D7).

3. **A field decorator on an entry I/O field is refused** after the migration period (D5), with
   the type form in the message. With D2 decided, D3 does not apply.

4. **`@inout` and `@out`** (Rule 8.25) become the types `InOut<T>` and `Out<T>` on the
   parameter (D4, decided): `function bump(x: InOut<f32>) { x += 1; }`. The call passes the
   variable itself, as it does today.

5. The editor's TS1206 filter for entries and the `strictPropertyInitialization` override are
   removed. Any TypeScript diagnostic that a plain `tsc --strict` reports on a `"use typeshade"`
   file that the compiler accepts is a defect (Rule 12.7).

Not changed: bindings (`declare const x: uniform<T>`), which `tsc` already accepts; the
emitted WGSL and GLSL ES 3.00, which stay byte for byte the same for a migrated program; the
host call shapes of surface §67.

## Why

The owner's direction is that a `"use typeshade"` file is TypeScript an ordinary toolchain
accepts. A form that only the TypeShade language service accepts breaks that in three places:

- A project's own `tsc --noEmit`, `typescript-eslint` and any bundler type check report errors
  on every entry.
- An editor without the TypeShade extension shows every entry in red.
- The language service carries filters that hide TypeScript's diagnostics, and each filter is a
  place where the editor can hide a real mistake.

Change 0100 lists "the attributes as decorators" among the forms TypeShade borrows from WGSL.
This proposal keeps the attributes and changes only their spelling, so that the borrowed form
sits inside ordinary TypeScript.

**Alternatives considered for the stage (D1):**

| Form                                               | Plain `tsc` | Notes                                                                                      |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `@vertex export function vs(…)` (today)            | TS1206      | The current form.                                                                          |
| `export const vs = vertex(function vs(…) { … })`   | accepted    | Selected (D1). A named function expression keeps the name in stack traces and in the emit. |
| `export function vs(…) {…}` and `vertex(vs);`      | accepted    | A top-level statement with no value; it separates the stage from the declaration.          |
| a static method with a method decorator on a class | accepted    | Rule 8.1 refuses an entry method; a class only to hold an entry adds a name with no use.   |
| `/** @vertex */` JSDoc tag                         | accepted    | A comment changes the meaning of the program; formatters and minifiers may drop it.        |

**Alternatives for an attribute (D2):** D2-a keeps today's field decorators, which `tsc`
already accepts, moves every parameter attribute into a struct, and needs `!` on every field
for `--strict`. D2-b removes decorators from entry I/O completely and lets an `interface`
describe entry I/O. The owner selected D2-b. Its cost: the attribute is in a type alias that
TypeScript may erase, so hover and errors can show `vec4` and not `Builtin<"position", vec4>`.
The language service reads the written type node for hover, and the implementation measures
whether the ambient library also needs a brand (Configuration and validation record).

**Assumptions.** The emit does not change for a migrated program. The host face (§67) reads the
stage from the call in place of the decorator and gives the host the same signature.

## What it touches

- **Rule 6.6**: entry inputs and outputs carry their attributes as `Builtin<…>` and `Location<…>` types (D2).
- **Rule 6.7**: the attribute names stay; the places they are written change, and a decorator
  on a function or a parameter is refused with the new form in the message.
- **Rule 7.2**: its table of divergences records that an assignment to an `InOut<T>` or
  `Out<T>` parameter reaches the caller, which TypeScript's reading of the type does not show (D4).
- **Rule 7.6**: a local that an `Out<T>` argument fills first is declared with `!` (D8).
- **Rule 8.1**: an entry point is a top-level `const` initialized by a stage call (D1).
- **Rule 8.2**: the position output is `Builtin<"position", vec4>` (D2).
- **Rule 8.22**: `@workgroup_size([…])` on a kernel function becomes `workgroupSize([…], f)`.
- **Rule 8.25**: `@inout` and `@out` become `InOut<T>` and `Out<T>` (D4).
- **Surface §3, §53, §67, §70**: the sections that define these forms. Every other section
  that shows an entry is rewritten by the migration tool (D5).
- **codes**: `TS8028 ATTRIBUTE_NAME` gains the warning of the migration release and, after it,
  the refusal of a decorator on a function, a parameter or an entry I/O field, each naming the
  new form (D5). No code is added or removed.
- **examples**: the 94 files in the front matter are rewritten (D6).

### Draft impact estimate

Known, measured at the baseline with `grep` over `examples/**/*.shade.ts` (approximate counts):

- 99 files carry `@vertex`, `@fragment` or `@compute`.
- On parameters, at the first decorator after `(` or `,`: 106 `@builtin`, 8 `@inout` and 1
  `@out`. A decorator on a following line is not in this count.
- 106 `@location` and 87 `@builtin` on class fields.

Estimated, not measured: the front end's entry detection, the host face, reflection's entry
list, the language service's hover and navigation, the site's Playground starter text
(`playground-host-default.ts` in `typeshade/web`), and each downstream repository's shader
files. The work is mostly mechanical once a migration tool exists (D5). Duration and cost are
unknown.

Decisions to resolve before acceptance:

Decided by the owner on 2026-11-02, in the Claude Code session ("승인" to the recommended
choices, confirmed in a follow-up question; D4 and D5 by a second "승인", and D6 and D7 by a third,
each to the recommendations that preceded it). This is a decision on the draft's direction, not
the acceptance of the proposal:

- **D1, decided.** The stage form is `export const vs = vertex(function vs(…) { … })`, with
  `fragment`, `compute([…], f)` and `workgroupSize([…], f)` in the same shape.
- **D2, decided.** The attribute form is D2-b, the types `Builtin<N, T>` and `Location<I, T>`.
- **D3, closed.** It applied to D2-a only.
- **D4, decided.** `@inout x: T` and `@out x: T` become the types `InOut<T>` and `Out<T>`,
  the same form as D2. A type that means `T` keeps TypeScript's local reading, where an
  assignment to a parameter does not reach the caller; today's decorator form has the same
  difference. Rule 7.2 records it as a divergence.
- **D5, decided.** Migration: one minor release where both forms compile and the old form gives
  a warning that names the new form, with a `typeshade migrate` codemod that rewrites a file;
  the old form is refused in the release after it.

- **D6, decided.** The front matter lists the 94 examples under `examples/` whose file carries a
  stage decorator, a parameter decorator, an entry I/O field decorator, `@workgroup_size` or
  `@diagnostic` at the baseline, and the 45 surface sections whose text shows one. Seven more
  files in subdirectories of `examples/` (`hosts/` and others) carry one too; `scripts/changes.ts`
  does not track them, and the codemod rewrites them. The codemod's dry run confirms the list at
  implementation.
- **D7, decided.** The option names are WGSL's, `interpolate`, `invariant` and `blend_src`.
  `@diagnostic` moves to an options argument of the stage call:
  `fragment(f, { diagnostic: ['off', 'derivative_uniformity'] })`.

Open, with the agent's recommendation:

- **D8.** A local that an `Out<T>` argument fills first. Rule 7.6 lets it be declared with no
  value, `let q: vec2; project(p, q);`, and a plain `tsc --strict` reports `TS2454` at the call
  (Evidence). Recommended: the local is written with TypeScript's definite assignment,
  `let q!: vec2;`, which `tsc --strict` accepts and which states the same fact, that a call fills
  it. With D8 so decided, the compiler will accept `!` on a local and refuse a read of such a
  local that no assignment or `Out<T>` argument fills first (`TS8075`), as Rule 7.6 does today. The alternative is to require an initializer, which
  removes the reason `Out<T>` exists.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's decision on D8;
`tsc --strict` output on the rewritten `hello-vsout`, a compute example and an `@inout` example
in the selected forms; and the front matter's examples, codes and surface lists completed from
the codemod's dry run.

### Configuration and validation record

This record does not yet apply. Delivery will require: the emit goldens unchanged for every
migrated example; `bun run test`, the compile gate (Tint and WebGL2) and the user journeys
green; a CI step that runs a plain `tsc --strict` with the published ambient library over every
`examples/**/*.shade.ts`; and `src/language-service/ambient-parity.test.ts` reading both halves
of each new form.

## Evidence

Measured on 2026-11-02 with `typescript@5.6.3` (the version in `package.json`),
`tsc --noEmit --strict --target es2022 --lib es2022`, and a minimal ambient file that declares
`vec2`, `vec4`, `f32`, `u32`, the constructors, `builtin` and `location` as standard field
decorators, `vertex` and `fragment` as functions that return their argument, and
`Builtin<N, T> = T`, `Location<I, T> = T` (with an optional third parameter for the last row), and `InOut<T> = T`:

| Source                                                                                                                                                                                           | Result                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Today's form (`@vertex` function, parameter decorator, uninitialized field)                                                                                                                      | TS1206 (2), TS2564 (1) |
| D1 with D2-a (`vertex(function …)`, field decorators with `!`)                                                                                                                                   | no diagnostic          |
| D1 with D2-b (`vertex(function …)`, `Builtin<…>` and `Location<…>` types)                                                                                                                        | no diagnostic          |
| D2-b with an options argument (`{ invariant: true }`, `{ interpolate: 'flat' }`) and D4 as `InOut<f32>`                                                                                          | no diagnostic          |
| `hello-vsout`, `array-length` (a `compute([64, 1, 1], …)` entry) and a part of `reference-parameters` (`InOut<f32>`, `Out<vec2>`, a `diagnostic` option), rewritten by hand in the decided forms | no diagnostic          |
| the same `reference-parameters` part with `let q: vec2;` filled by `Out<vec2>`                                                                                                                   | TS2454 (2) (D8)        |

`examples/hello-vsout.shade.ts` at the baseline, with the same options and with
`--experimentalDecorators`, gives TS1206 at lines 20, 21 and 39 and TS2564 on each of its three
fields. The return of an object literal for `VsOut` at line 37 gives no diagnostic.

## What it owes downstream

- **typeshade.github.io** (`typeshade/web`): the pages, the gallery and the Playground show the
  new form; the Playground's starter host text and the language service it runs follow the pin.
- **vscode-typeshade**: the diagnostic filter, snippets, grammar and skill follow the new form.
- **radiance, typenn, typecv**: their shader files are migrated with the codemod.

Each repository records 0111 in `compiler-changes.md` when its pin moves.
