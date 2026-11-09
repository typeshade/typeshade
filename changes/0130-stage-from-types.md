---
id: '0130'
title: An entry point's stage is read from its types, so an author writes no stage marker; a compute entry states a workgroup size other than the default in the options of one of its builtin parameters
status: draft
rules:
  - '1.8'
  - '2.1'
  - '6.6'
  - '6.7'
  - '7.6'
  - '8.1'
  - '8.2'
  - '8.7'
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
    what: Every page, example card, Playground starter (`playground-host-default.ts`) and generated host text that shows a stage call, a stage decorator or `workgroup_size(…)` is written again as a plain function whose types show its stage, in English and in Korean; `compiler-changes.md` records 0130 when the pin moves.
  - repo: vscode-typeshade
    what: Snippets, the skill's references and the grammar drop the stage forms; the editor's TS1206 filter is removed; `compiler-changes.md` records 0130 when the pin moves.
  - repo: radiance
    what: Every shader file that uses a stage call or a stage decorator moves to the plain form with `tshc migrate`; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typenn
    what: No stage call or stage decorator was found at review time (grep of `src/`); `compiler-changes.md` records 0130 when the pin moves.
  - repo: typecv
    what: Its shader files use the decorated form (251 stage decorators, 224 `@builtin` and 10 `@inout` parameter decorators under `src/` at review time); `tshc migrate` moves all of them to the plain form, and its non-default sizes to the `workgroup_size` option of a builtin parameter; its 56 compute entries that take no parameter gain one builtin parameter that carries the size (Rule 8.1); do not run `tshc migrate` at the current pin; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typeaudio
    what: The stage calls under `experiments/` (15 at review time, 6 of them inside template strings in the sound-match experiment's program file, which `tshc migrate` cannot rewrite and the author edits by hand) move to the plain form; `compiler-changes.md` records 0130 when the pin moves.
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0130, `status: draft` (front matter).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Date and attribution          | Authored 2026-11-09 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean. The owner said that TypeShade is a language, not a library; that fixed function names such as `vertex`, `fragment` and `compute` do not belong in it; that the language should add as little as possible, so that an author learns less; and that what the compiler can decide is the compiler's work. Change 0111 D1 was decided and accepted by the owner on 2026-11-02 (`changes/0111-plain-typescript-entries.md`). This proposal records a new decision that replaces it, on the principle the owner stated on 2026-11-09. No GitHub issue is recorded.                                                                                                                                                                                                                                                                                                                                                                               |
| Applicability / effectivity   | `docs/language-design.md` Rules 1.8 (new), 2.1, 6.6, 6.7, 7.6, 8.1, 8.2 and 8.7, `reqs/`, `docs/use-typeshade-surface.md` (every section that shows an entry), `docs/dx.md` and `docs/roadmap.md` (cited, not changed), `README.md` (`tsconfig.shade.json`), the front end's entry detection (`src/compiler/ts/stage-call.ts`, `src/compiler/ts/decorated-form.ts` and the modules that import `stage-call.ts`: `diagnostic-directive.ts`, `host-face.ts`, `link.ts`, `lower/closures.ts`, `lower/function.ts`, `module-const.ts`, `numerics.ts`, `semantic.ts`, `source-file.ts`, `src/language-service/navigation.ts` and `src/language-service/semantic-tokens.ts`), the diagnostic messages that name a stage call, the ambient library and the diagnostic filters (`src/language-service/`), the host face, `tshc migrate`, `examples/plain-typescript.test.ts`, every `examples/**/*.shade.ts` and `journeys/` file that declares an entry, and the downstream repositories. No release version is assigned. |
| Review baseline               | `main` at `766ec8a6` (#1101), read on 2026-11-09. Measurements below were taken on that tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Review and revision authority | Pull request #1094. Git records the revisions of this file; the review and merge of #1094 record the decision. Earlier revisions on #1094 proposed `vertex<T>` return types (rejected by the owner: fixed names) and the attributes `@vertex`, `@fragment`, `@compute([…])` (revised after the independent review below, which found that the attribute form does not parse in prettier, typescript-eslint, esbuild or Bun, and that the types already carry the stage). Revision `19ccafee` (stage inference with a `this: workgroup_size<…>` size) was revised after its own independent review; this revision applies the owner's decisions of 2026-11-09 on it (Decisions, below).                                                                                                                                                                                                                                                                                                                             |

## What changes

This proposal replaces decision D1 of change 0111. It keeps D2 (`builtin<N, T>` and
`location<I, T>`), D4 (`inout<T>`, `out<T>`) and D7 of change 0111.

**The design.** An entry point is a plain function declaration. The compiler reads its stage
from the attribute types it already carries, and the author writes no stage marker.

An entry point is a function declaration at the top of the file or of a namespace that meets all
three conditions:

1. the module does not call it;
2. every parameter carries an entry type, `builtin<…>` or `location<…>`, directly or through
   the fields of an entry I/O struct (Rule 6.6);
3. its types name exactly one stage.

A function the module calls, or one with a parameter that carries no entry type, is a helper,
whatever structs it takes or returns. (`examples/twin-structs.shade.ts` `shade(o: FsIn): vec4`
takes an I/O struct and is called by the entry, so it stays a helper.)

The stage is named first by the inputs:

- `builtin<"vertex_index" | "instance_index", …>` names vertex;
- `builtin<"position" | "front_facing" | "sample_index" | "sample_mask" | "primitive_index", …>`
  as an input names fragment;
- `builtin<"global_invocation_id" | "local_invocation_id" | "local_invocation_index" | "workgroup_id" | "num_workgroups", …>`
  names compute;
- `builtin<"subgroup_invocation_id" | "subgroup_size", …>` is valid in compute and fragment and
  names no stage by itself; `location<…>` inputs name no stage by themselves (a vertex buffer and
  a varying are both `location`).

When the inputs name no stage, the outputs do: a `builtin<"position", …>` or
`builtin<"clip_distances", …>` output names vertex; a `location<…>`, `builtin<"frag_depth", …>` or
`builtin<"sample_mask", …>` output names fragment.

**A bare result** (a `vec4` with no attribute type) is read by the stage the inputs name: the
position for a vertex entry, `location<0>` for a fragment entry, as Rule 8.2 reads it today. An
entry whose inputs name no stage writes its output's attribute: `builtin<"position", vec4>` or
`location<0, T>`. A fragment entry with fragment inputs and a bare `vec4` result stays as it is
(54 of the 81 example fragment entries).

**A compute entry's workgroup size** is 64 unless it states another (Rule 8.7). It states another
in the options of one of its builtin parameters, the place where `invariant` already sits:

```ts
export function blur(gid: builtin<"global_invocation_id", vec3u, { workgroup_size: [8, 8] }>) { … }
```

A compute entry that takes no builtin adds one builtin parameter that carries its size, even
when the body does not read it. That size is also its stage marker, since nothing else in its
types names compute:

```ts
// before (typecv, 56 entries written this way)
@compute([1])
export function orbPickTop(): void { … }

// after
export function orbPickTop(_: builtin<"local_invocation_index", u32, { workgroup_size: [1] }>): void { … }
```

An override extent is written by its name, `{ workgroup_size: [WG_SIZE] }`, the spelling
`array<f32, WG_SIZE>` already uses, under the same language-service filter of TS2749 on that
exact syntax (`src/language-service/diagnostics.ts`); `typeof WG_SIZE` is not a second spelling.

**Other forms.** An arrow function or a function expression is never an entry (refused with
`TS8028` when its types name a stage). An overload signature is not an entry; its implementation
is classified. A class method that carries entry types is refused, as Rule 8.1 refuses one today.
`export default function f` is classified as any declaration and keeps the name `f`; an
anonymous default export is never an entry. An entry re-exported from another file (Rule 3.9) is classified in the
file that declares it.

**One classifier.** The aliases `builtin<N, T, O> = T` and `location<I, T, O> = T` are
transparent to the TypeScript checker, so the classification is syntactic. The front end exports
one classifier over the written type nodes, the module's call graph and the linker's view of
imported structs. `compile()`, the host face, reflection and the language service's hover,
semantic tokens, navigation and diagnostics all call it (Rule 12.7).

**Before (change 0111 D1) and after**, the example `hello-vsout`:

```ts
// before
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut { … });
export const fs = fragment(function fs(v: VsOut): FsOut { … });

// after
export function vs(i: builtin<"vertex_index", u32>): VsOut { … }
export function fs(v: VsOut): FsOut { … }
```

A compute entry with the default size, before and after:

```ts
// before
export const scale_all = compute([64, 1, 1], function scale_all(gid: builtin<"global_invocation_id", vec3u>) { … });

// after: 64 is the default size (Rule 8.7)
export function scale_all(gid: builtin<"global_invocation_id", vec3u>) { … }
```

The proposed rules, in short:

1. An entry point is the function declaration the three conditions above select (Rule 8.1). Its
   stage is the one its types name, inputs first.
2. A bare result follows the stage the inputs name. An entry whose inputs name no stage writes
   its output's attribute (Rule 8.2).
3. A compute entry's workgroup size is 64, or the `workgroup_size` option of one of its builtin
   parameters (Rule 8.7). A compute entry with no builtin input adds one builtin parameter that
   carries its size. The size is observable author knowledge: the host dispatches a compute entry
   in workgroups, and `local_invocation_id`, workgroup memory, barriers and subgroup operations
   depend on it. The compiler refuses a zero or over-limit extent, a non-literal and non-override
   extent, and the option on a builtin of a vertex or fragment entry.
4. Types that name two stages are refused with `TS8028`, and the message names the stages and the
   types. An output that does not match the stage the inputs name is refused with Rule 8.2's
   existing messages (a vertex entry with no position output says so).
5. The stage calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and the stage decorators give a
   `TS8028` warning that names the plain form, for one migration release, and are refused after
   it (D4). `tshc migrate` rewrites both. A kernel's `workgroup_size([…], f)` is unchanged (D1).
6. The ambient library stops declaring `vertex`, `fragment` and `compute` as values after the
   migration release. The author-facing name lock (`src/__api__/author-names.md`, #1097) shows the
   names removed.
7. When a host imports a name that is not an entry, the host view's `never` reason names the
   types the function would need to be one, so a beginner's `export function fs(): vec4` is
   explained where it is used.
8. `numerics` and `diagnostic` are not in this proposal. The owner directed on 2026-11-09 that
   both be removed, by separate proposals (0131, #1104; 0132, #1105), accepted before this one's
   call forms are refused, so that no entry is left with an option it cannot write.

The emitted WGSL and GLSL ES 3.00 do not change for a migrated program.

**The principle, a new Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> The proposed text, for `docs/language-design.md` §1.8 after
Rule 1.7:

> **Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> A construct of the language is added only for what the author must state and the
> compiler cannot know or prove. What the compiler can read from the program (the stage of an
> entry from its types) is not written again. What it can decide (an optimization it can prove
> exact, a tuning parameter, a validation it can satisfy by rewriting the program) is the
> compiler's work and never an author-facing construct; a construct that predates this rule and
> breaks it is recorded as a debt in Appendix B until a proposal removes it. What the author must state is written as
> a type of the surface on the declaration or value it describes (`builtin<…>`, `location<…>`,
> `inout<T>`, `out<T>`, and a compute entry's `workgroup_size` option), never as a call of a function whose only role is to
> carry it, and never in a form that the TypeScript toolchain (the parser, a formatter, a linter,
> a bundler) cannot read. Whether a plain `tsc` type-checks a shader file whole is not a
> criterion: it does not, since vector arithmetic is an operator TypeScript does not overload.
>
> - Rationale: a `"use typeshade"` file is a program in the TypeShade language, read by its own
>   compiler and language service (Rule 3.1), and an author should learn as little as possible.
>   Change 0111 D1 measured the surface by `tsc` acceptance and replaced `@vertex` with
>   `vertex(f)`, a fixed function name. The attribute form it replaced does not parse in prettier,
>   typescript-eslint, esbuild or Bun. The types of change 0111 D2 already carry the stage. A
>   call whose only role is to mark its argument is not an ECMAScript spelling that carries a GPU
>   meaning (Rule 1.4); a type is the spelling `docs/roadmap.md`'s first rule ("ordinary
>   TypeScript first") allows for what TypeScript has no word for.
> - Derives from: `changes/0130-stage-from-types.md`; the owner's direction of 2026-11-09.
> - Enforced by: the independent review (`changes/README.md`); `TS8028` on a stage call or a
>   stage decorator after the migration release; the author-facing name lock
>   (`src/__api__/author-names.md`), which shows a removed stage name. Debt in Appendix B: a
>   kernel's `workgroup_size([…], f)` (a tuning parameter, kept by D1 under `docs/dx.md`
>   principle 6).

## Why

The owner judged the stage calls excessive and asked that the language add as little as
possible. Measured on 2026-11-09 with a TypeScript AST script (typescript 5.6.3) that applies
the three conditions and the stage order above to every function declaration and every function
a stage call or a stage decorator marks. It resolves struct fields by name within the corpus.

| Corpus (tree)                                        | Entries | Classified | No stage named: no input | No stage named: `location` in, bare out | Helpers | Helpers classified as entries |
| ---------------------------------------------------- | ------- | ---------- | ------------------------ | --------------------------------------- | ------- | ----------------------------- |
| `examples/*.shade.ts` (`main` `766ec8a6`, 102 files) | 174     | 172        | 1 (`hello-uniform` `fs`) | 1 (`capsule-corp-namek-class` `main`)   | 107     | 0                             |
| `examples/**` incl. subdirectories (114 files)       | 185     | 183        | 1                        | 1                                       | 131     | 0                             |
| `journeys/**/*.shade.ts` (95 files)                  | 134     | 127        | 6 compute entries        | 1 (`engine/shadow` `vs`, a vertex)      | 89      | 0                             |
| typeplot `shaders/*.shade.ts` (`9f20c12`, 13 files)  | 19      | 14         | 1 (`pick`, a fragment)   | 4 fragments                             | 178     | 0                             |
| typecv `src/**/*.shade.ts` (`4189b3c`, 37 files)     | 251     | 195        | 56 compute entries       | 0                                       | 277     | 0                             |
| typeaudio `**/*.shade.ts` (`27287bb`, 21 files)      | 9       | 9          | 0                        | 0                                       | 63      | 0                             |

- No entry's types name two stages, and no stage is classified wrongly.
- The call condition keeps `examples/twin-structs.shade.ts` `shade` a helper. The parameter
  condition keeps typeplot's `sceneLayer`, `sceneCurve`, `sceneCurveReference` and `sceneSurface`
  helpers: they return `location` structs, but they take a callback and a uniform struct.
- Every entry the inference does not reach is one of the two explicit cases: a compute entry
  with no builtin (62: 6 journeys, 56 typecv), which adds a builtin parameter that carries its
  size; or an entry whose inputs name no stage (8: 2 examples, 1 journey, 5 typeplot), which writes
  its output's attribute.
- 10 of the 12 compute entries in `examples/*.shade.ts` use the default size 64. Two do not:
  `workgroup-tile-2d` (`[8, 8]`) and `workgroup-override` (`[WG_SIZE]`, an override). Downstream,
  typecv writes 162 `@compute([64])` and about 90 other sizes; a non-default size is a real need.
- Not measured by the script: shader text inside template strings (typeaudio
  `experiments/07-sound-match/program.ts`, 6 stage calls; typeplot `src/plot-source.ts`, 25 of <!-- doc-refs: skip — a path in a downstream repository -->
  its 44 stage decorators).

Measured on 2026-11-09 with `typescript@5.6.3` `tsc --strict --noImplicitThis`, prettier
(repository version), esbuild, `bun build` and `@typescript-eslint/typescript-estree` `parse()`:

| Form                                                                      | tsc                                         | prettier | esbuild | Bun    | typescript-estree |
| ------------------------------------------------------------------------- | ------------------------------------------- | -------- | ------- | ------ | ----------------- |
| plain function, stage from types                                          | accepted                                    | parses   | parses  | parses | parses            |
| `gid: builtin<"global_invocation_id", vec3u, { workgroup_size: [8, 8] }>` | accepted; a host call `blur(v)` type-checks | parses   | parses  | parses | parses            |
| `{ workgroup_size: [1, 2, 3, 4] }`                                        | TS2344 (four extents)                       |          |         |        |                   |
| `{ workgroup_size: [WG_SIZE] }` (override)                                | TS2749, as `array<f32, WG_SIZE>` today      |          |         |        |                   |
| `export function f(this: workgroup_size<8, 8>, …)` (revision `19ccafee`)  | accepted; an unbound host call is TS2684    | parses   | parses  | parses | parses            |
| `@compute([8, 8]) export function f(…)`                                   | TS1206                                      | fails    | fails   | fails  | fails             |

`tsc` does not refuse `{ workgroup_size: [0] }`; the compiler does (rule 3).

**Alternatives considered:**

| Form                                                           | Notes                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stage read from the types; the size in a builtin's options | Selected (owner, 2026-11-09). Nothing new to learn for 172 of 174 example entries; every tool parses it; nothing to filter but the existing TS2749 one. |
| The size as `this: workgroup_size<…>` (revision `19ccafee`)    | An unbound host call is TS2684; `this` only to carry a size is close to what Rule 1.8 forbids; a second override spelling.                              | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| `@vertex export function vs(…)` (revision `87d87344`)          | Does not parse in prettier, typescript-eslint, esbuild or Bun; needs an editor filter; TypeScript does not check the decorator's argument (Rule 1.7).   |
| `export const vs = vertex(function vs(…) {…})` (change 0111)   | A fixed function name; rejected by the owner.                                                                                                           |
| `export function vs(…): vertex<VsOut>`                         | A fixed type name; rejected by the owner.                                                                                                               |
| `"use vertex"` directive in the body                           | A second directive mechanism; a string the toolchain does not check.                                                                                    |

**Costs.**

- The stage is implicit: a reader learns it from the types, as WGSL readers learn a builtin's
  stage from its name. Hover on an entry shows its stage (the language service owes that).
- 8 entries whose inputs name no stage write their output's attribute (2 examples, 1 journey, 5
  typeplot).
- 62 compute entries with no builtin add a builtin parameter that carries their size, which the
  body does not read.
- An unused parameter exists only to carry the size. It is a type on a value the language
  already has, not a new construct, but a reader can find it odd.

**Assumptions.** The front end can build the call graph and resolve imported structs through the
existing linker before it classifies. The host face reads the stage from the classifier, and the
host's signature is the function's own (no `this`).

## What it touches

- **Rule 1.8** (new): <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> the principle above, with the kernel size as an Appendix B debt.
- **Rule 2.1**: `vertex`, `fragment` and `compute` leave the author-facing name set as values
  after the migration release. `workgroup_size` stays, for kernels (D1). The option key
  `workgroup_size` adds no name.
- **Rule 6.6**: the options of `builtin<…>` gain `workgroup_size`, beside `invariant`; the TS1206
  note for entries is removed, since no decorator remains.
- **Rule 6.7**: the list of attribute places drops the stage call and the decorator, and names
  the `workgroup_size` option.
- **Rule 7.6**: `!` on a local that an `out<T>` argument fills is dropped (D3).
- **Rule 8.1**: an entry point is the function declaration the three conditions select.
- **Rule 8.2**: a bare result follows the stage the inputs name; an entry whose inputs name no
  stage writes its output's attribute.
- **Rule 8.7**: the workgroup size is 64 or the `workgroup_size` option; its refusals.
- **`docs/dx.md`** principle 6 and **`docs/roadmap.md`**'s first rule: cited, not changed. An
  explicit compute entry and a workgroup shape stay public.
- **`README.md`**: the `tsconfig.shade.json` section loses its decorator settings and TS1206
  counts.
- **Diagnostic messages** that name a stage call (`builtin-check.ts`, `kernel-loops.ts`,
  `lower/function.ts`, `class-methods.ts`, `foreign-names.ts`, `module-const.ts`, `link.ts`,
  `diagnostic-directive.ts`, `host-face.ts`, and the language service's docs, completions,
  navigation and semantic tokens) name the plain form.
- **The classifier's consumers**: every module that imports `stage-call.ts` today
  (`diagnostic-directive.ts`, `host-face.ts`, `link.ts`, `lower/closures.ts`, `lower/function.ts`,
  `module-const.ts`, `numerics.ts`, `semantic.ts`, `source-file.ts`,
  `src/language-service/navigation.ts`, `src/language-service/semantic-tokens.ts`) calls the one
  classifier.
- **The editor**: the TS1206 filter and its coupling to TS2564 (`usesDecoratedForm`) are removed
  after the migration release; `strictPropertyInitialization` is off for shader files (D3); the
  TS2749 filter covers the `workgroup_size` option's override name.
- **Surface sections**: every section that shows an entry. The list is change 0111's, confirmed
  by `tshc migrate`'s dry run at acceptance.
- **codes**: `TS8028 ATTRIBUTE_NAME` warns on, then refuses, a stage call and a stage decorator,
  and refuses types that name two stages and a misplaced or invalid `workgroup_size` option. No
  code is added or removed.
- **examples**: the 94 `examples/*.shade.ts` files above, the seven in subdirectories of
  `examples/`, and the 77 `journeys/` files with stage calls (the `user journeys` check runs
  them).

### Draft impact estimate

Known: the measurements in Why. Estimated, not measured: the classifier, the host face, the
language service's hover (which must show the stage), `tshc migrate` in two directions (stage
calls and stage decorators to the plain form, parameter and field decorators to types, a
non-default size to the option, a size-carrying parameter for an entry with no builtin), the
site's Playground starter, and each downstream repository's shader files. Shader text in
template strings is rewritten by hand. Duration and cost are unknown.

**Migration order:**

1. Freeze 0111 milestone 5 for the stage forms now: neither the stage call nor the stage
   decorator is refused before this proposal decides.
2. Accept the separate `numerics` and `diagnostic` removals (0131, 0132).
3. Implement the classifier beside the stage call, with the warning of rule 5. A function the old
   forms mark keeps its stage until the refusal, so no helper changes behaviour without a warning.
4. Rewrite the examples, the journeys and the tests with `tshc migrate`, and the template-string
   shaders by hand.
5. Refuse the stage forms in the release after the warning.

**Decisions** (the owner, 2026-11-09, in the Claude Code session, in Korean: "추천대로", "as
recommended", to the author's recommendations on the review of revision `19ccafee`):

- **D1. A kernel's workgroup size: decided, kept.** `workgroup_size([…], f)` stays as on `main`,
  outside this proposal, because removing it conflicts with `docs/dx.md` principle 6 ("a
  workgroup shape stays public"). It is recorded as a Rule 1.8 debt for a later proposal. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
- **D2. A compute entry's size: decided, the builtin's options** (rule 3), with a size-carrying
  builtin parameter for an entry that takes none. The `this` spelling of revision `19ccafee` and
  the attribute are not used.
- **D3. The `!` of change 0111 D8: decided, dropped.** 193 fields in 51 example files and 2
  locals carry `!` only for `tsc`'s `strictPropertyInitialization`; the language zero-initializes
  a field. The language service sets `strictPropertyInitialization: false` for shader files, an
  option that states the language's meaning and filters no diagnostic.
  `examples/plain-typescript.test.ts` stays only as a regression net for the entry forms, with
  that reason stated, or is removed.
- **D4. Migration: decided, one migration release** with the `TS8028` warning, then refusal.
- **D5. Record of change 0111: decided.** 0111's record gains a note that D1 is replaced by 0130,
  and its milestone 5 is withdrawn for the stage forms.
- **Bare results and inputs that name no stage** (review findings R-B3, R-B4): decided as rule 2.
- **A compute entry with no builtin** (R-B2): decided as rule 3.

### Independent review record

**This revision needs a new independent review before acceptance.** It applies the owner's
decisions of 2026-11-09 on the review of revision `19ccafee`.

**Revision `87d87344` (attribute form), reviewed 2026-11-09.** Superseded. How the later
revisions answer each finding:

| ID  | Finding (short)                                                                      | In this revision                                                                                                    |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| B1  | Rule 1.8 called a numerical relaxation compiler work.                                | resolved: Rule 1.8 names only an optimization the compiler can prove exact.                                         | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B2  | The entry size kept while Rule 1.8 calls tuning compiler work; text contradicted D1. | resolved: rule 3 states the criterion (entry size observable; kernel size tuning); D1 and D2 are the owner's.       | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B3  | The editor's TS1206 and TS2564 filters follow `usesDecoratedForm`.                   | resolved: no decorator remains, and the filter is removed after the migration release (D4, D2: no `@compute` size). |
| B4  | D8's `!` exists only for `tsc`; D3 kept a `tsc` test.                                | decided: D3 drops `!`.                                                                                              |
| S1  | The attribute form fails in prettier, typescript-eslint, esbuild, Bun.               | resolved: D2 puts the size in a builtin's options, which every tool parses.                                         |
| S2  | TypeScript does not check a decorator's argument (Rule 1.7).                         | resolved: no decorator; the `workgroup_size` option is checked by `tsc` for its shape.                              |
| S3  | Rule 2.1 not in scope.                                                               | resolved: Rule 2.1 is in the front matter and What it touches.                                                      |
| S4  | The stage is inferable from the types.                                               | resolved in this revision: inference plus two explicit cases (rules 2 and 3); `19ccafee` had overclaimed it.        |
| S5  | Unnamed conflict with Rule 1.4 and `docs/roadmap.md`.                                | resolved: Rule 1.8's rationale names both; the criterion is in the rule text.                                       | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| S6  | Scope misses journeys, README, messages, dx.md, roadmap.                             | resolved: listed in What it touches and Applicability.                                                              |
| S7  | No migration order.                                                                  | resolved: Migration order.                                                                                          |
| S8  | typecv and typeplot counts.                                                          | resolved: typecv's entry corrected; typeplot below.                                                                 |
| N4  | Record the reversal as a new decision.                                               | resolved: Request source.                                                                                           |
| N5  | The `textureSampleGrad` rewrite is unproven.                                         | resolved: rule 6 marks it an assumption of the separate proposal.                                                   |

The findings as recorded for revision `87d87344`:

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

#### Independent review of revision `19ccafee`

Reviewer: a Claude Code agent that did not write this revision, run on 2026-11-09. Verdict:
revise before the owner decides. The reviewer re-measured with its own script: 174 entries in 93
example files, 172 inferable. The text overclaims that every entry is inferable.

| ID   | Finding                                                                                                                                                                                                                                                                                                                                                           | Status                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| R-B1 | Counting a struct's fields makes helpers entries: `examples/twin-structs.shade.ts` `shade(o: FsIn): vec4` and four typeplot functions returning `SceneLayer` would become fragment entries. Proposed rule: an entry is a function the module does not call, whose every parameter carries an entry type, and whose types name one stage.                          | fixed: rule 1's three conditions; 0 helpers classified as entries in five corpora |
| R-B2 | A compute entry with no builtin input has no type to infer from: typecv 56 of 254 compute entries, 6 journeys, 3 typeaudio entries (all size 1). Proposed: a stated workgroup size is also the compute stage marker.                                                                                                                                              | decided (owner): rule 3, a size-carrying builtin parameter                        |
| R-B3 | `location`-only inputs with a bare `vec4` output are vertex in `journeys/engine/shadow.shade.ts` and fragment in `capsule-corp-namek-class`; 5 of typeplot's 15 fragments cannot be inferred. Proposed: a bare result follows the stage the inputs name; an entry whose inputs name no stage writes its output's attribute.                                       | decided (owner): rule 2                                                           |
| R-B4 | Rule 2 as written would rewrite 54 of 81 fragments that return a bare `vec4`; the 79/81 count assumes the bare result stays legal.                                                                                                                                                                                                                                | fixed: bare results with fragment inputs stay legal (54 entries untouched)        |
| R-S1 | `this: workgroup_size<…>` makes an unbound host call a TS2684 error; tsc does not check `workgroup_size<0>`, a read of `this`, or a non-literal size; an override gets a second spelling (`typeof WG_SIZE` beside `array<f32, WG_SIZE>`); a `this` parameter only to carry a size is close to what Rule 1.8 forbids. Option C: the size in the builtin's options. | decided (owner): D2, the builtin's options                                        | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| R-S2 | A beginner's `export function fs(): vec4` becomes a silent helper; the failure appears later at the host.                                                                                                                                                                                                                                                         | fixed: rules 4 and 7                                                              |
| R-S3 | The classifier must be syntactic and shared by `compile()` and the language service (the aliases erase the attribute); four more consumers of `stageCallOf` are missing from the scope.                                                                                                                                                                           | fixed: One classifier; the classifier's consumers in What it touches              |
| R-S4 | Stage-neutral builtins (`subgroup_*`), `frag_depth`/`sample_mask` outputs, fragments with no output, arrow entries, overloads, `export default`, re-exports need a sentence each.                                                                                                                                                                                 | fixed: the stage-neutral builtins, the outputs, Other forms                       |
| R-S5 | Downstream counts: typeaudio 15 stage calls (6 in template strings), typeplot 25 of 44 in template strings that `tshc migrate` cannot rewrite; journeys not measured.                                                                                                                                                                                             | fixed: Why and the downstream entries                                             |
| R-S6 | D1 (remove a kernel's size) conflicts with `docs/dx.md` principle 6 ("a workgroup shape stays public").                                                                                                                                                                                                                                                           | decided (owner): D1 keeps the kernel size; a Rule 1.8 debt                        | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| R-N2 | The table above overclaims S4 and B3 as resolved.                                                                                                                                                                                                                                                                                                                 | fixed: the table above                                                            |

### Approval and plan record

This record does not yet apply. Acceptance will require: a new independent review of this
revision (the owner decided D1 to D5 on 2026-11-09), the merge of #1094 with `status: accepted`, the
approved revision, and the milestones.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits and pull
requests with `Change: 0130`; the emit goldens unchanged for every migrated example; both halves
(`compile()` and the language service) read on the plain form, the stage shown on hover, the
refusals, and the call and decorator forms' warning (`src/language-service/ambient-parity.test.ts`
shape); prettier and typescript-estree parsing every migrated example; and the document audit of
the rules, the surface document and `reqs/`.

## What it owes downstream

Each repository in `downstream` rewrites its stage calls and stage decorators, and the pages
that show one, with `tshc migrate`, when it moves its pin past the implementation, and records
0130 in its `compiler-changes.md`. typeplot is not in `DOWNSTREAM_REPOS`; it writes 44 stage
decorators (19 entries in `shaders/*.shade.ts`, 25 inside template strings in
`src/plot-source.ts`, which `tshc migrate` cannot rewrite) and 49 field decorators (24 `@builtin`, <!-- doc-refs: skip — a path in a downstream repository -->
25 `@location`). Of its 19 file entries, 5 write their output's attribute under rule 2 (`compose`,
`drawBackdrop`, `drawLabels`, `drawSurfaceLabels`, `pick`).
