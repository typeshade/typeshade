---
id: '0130'
title: An entry point's stage is read from its types, so an author writes no stage marker; a compute entry states a workgroup size other than the default as a type
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
    what: Every page, example card, Playground starter (`playground-host-default.ts`) and generated host text that shows a stage call, a stage decorator or `workgroup_size(…)` is written again as a plain function whose types show its stage, in English and in Korean; `compiler-changes.md` records 0130 when the pin moves.
  - repo: vscode-typeshade
    what: Snippets, the skill's references and the grammar drop the stage forms; the editor's TS1206 filter is removed; `compiler-changes.md` records 0130 when the pin moves.
  - repo: radiance
    what: Every shader file that uses a stage call or a stage decorator moves to the plain form with `tshc migrate`; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typenn
    what: No stage call or stage decorator was found at review time (grep of `src/`); `compiler-changes.md` records 0130 when the pin moves.
  - repo: typecv
    what: Its shader files use the decorated form (251 stage decorators, 224 `@builtin` and 10 `@inout` parameter decorators under `src/` at review time); `tshc migrate` moves all of them to the plain form, and the about 90 non-default sizes (`@compute([1])` and others) to the size type; do not run `tshc migrate` at the current pin; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typeaudio
    what: The stage calls under `experiments/` (10 at review time) move to the plain form; `compiler-changes.md` records 0130 when the pin moves.
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0130, `status: draft` (front matter).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date and attribution          | Authored 2026-11-09 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean. The owner said that TypeShade is a language, not a library; that fixed function names such as `vertex`, `fragment` and `compute` do not belong in it; that the language should add as little as possible, so that an author learns less; and that what the compiler can decide is the compiler's work. Change 0111 D1 was decided and accepted by the owner on 2026-11-02 (`changes/0111-plain-typescript-entries.md`). This proposal records a new decision that replaces it, on the principle the owner stated on 2026-11-09. No GitHub issue is recorded.                                                                                          |
| Applicability / effectivity   | `docs/language-design.md` Rules 1.8 (new), 2.1, 6.6, 6.7, 7.6, 8.1, 8.2, 8.7 and 8.22, `reqs/`, `docs/use-typeshade-surface.md` (every section that shows an entry), `docs/dx.md` (principle 6), `docs/roadmap.md`, `README.md` (`tsconfig.shade.json`), the front end's entry detection (`src/compiler/ts/stage-call.ts`, `src/compiler/ts/decorated-form.ts` and their callers), the diagnostic messages that name a stage call, the ambient library and the diagnostic filters (`src/language-service/`), the host face, `tshc migrate`, `examples/plain-typescript.test.ts`, every `examples/**/*.shade.ts` and `journeys/` file that declares an entry, and the downstream repositories. No release version is assigned. |
| Review baseline               | `main` at `766ec8a6` (#1101), read on 2026-11-09. Measurements below were taken on that tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Review and revision authority | Pull request #1094. Git records the revisions of this file; the review and merge of #1094 record the decision. Earlier revisions on #1094 proposed `vertex<T>` return types (rejected by the owner: fixed names) and the attributes `@vertex`, `@fragment`, `@compute([…])` (revised after the independent review below, which found that the attribute form does not parse in prettier, typescript-eslint, esbuild or Bun, and that the types already carry the stage).                                                                                                                                                                                                                                                      |

## What changes

This proposal replaces decision D1 of change 0111. It keeps D2 (`builtin<N, T>` and
`location<I, T>`), D4 (`inout<T>`, `out<T>`) and D7 of change 0111.

**The design.** An entry point is a plain function declaration. The compiler reads its stage
from the attribute types it already carries, and the author writes no stage marker:

- an input `builtin<"vertex_index" | "instance_index", …>` or an output `builtin<"position", …>`
  makes a vertex entry;
- an input `builtin<"position" | "front_facing" | "sample_index" | "sample_mask" | "primitive_index", …>`,
  or a `location<…>` output with no `builtin<"position">` output, makes a fragment entry;
- an input `builtin<"global_invocation_id" | "local_invocation_id" | "local_invocation_index" | "workgroup_id" | "num_workgroups" | …>`
  makes a compute entry.

A field of a struct the entry takes or returns counts as its input or output. `builtin<…>` and
`location<…>` are entry-only types today: a function that is not an entry may not take them
(`src/compiler/ts/builtin-check.ts`). So a function whose signature carries one is an entry, and
a function whose signature carries none is not.

**Before (change 0111 D1) and after**, the example `hello-vsout`:

```ts
// before
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut { … });
export const fs = fragment(function fs(v: VsOut): FsOut { … });

// after
export function vs(i: builtin<"vertex_index", u32>): VsOut { … }
export function fs(v: VsOut): FsOut { … }
```

A compute entry, before and after:

```ts
// before
export const scale_all = compute([64, 1, 1], function scale_all(gid: builtin<"global_invocation_id", vec3u>) { … });

// after: 64 is the default size (Rule 8.7)
export function scale_all(gid: builtin<"global_invocation_id", vec3u>) { … }
```

The proposed rules, in short:

1. An entry point is a function declaration at the top of the file or of a namespace whose
   signature carries a `builtin<…>` or `location<…>` type (Rule 8.1). Its stage is the one its
   types name. Types that name two stages, or none on a function that has to be an entry, are
   refused with `TS8028` and a message that names the type to write.
2. A fragment entry's colour output is `location<0, vec4>`. A bare `vec4` return names no stage.
3. A compute entry's workgroup size is 64 unless the entry states another (Rule 8.7). The size is
   observable author knowledge: the host dispatches a compute entry in workgroups, and
   `local_invocation_id`, workgroup memory, barriers and subgroup operations depend on it. How a
   size other than the default is written is decision D2. A kernel's size is tuning (D1).
4. The stage calls `vertex(f)`, `fragment(f)`, `compute([…], f)`, `workgroup_size([…], f)` and the
   decorated form give a `TS8028` warning that names the plain form, for one migration release,
   and are refused after it (D4). `tshc migrate` rewrites both.
5. The ambient library stops declaring `vertex`, `fragment`, `compute` and `workgroup_size` as
   values after the migration release. the author-facing name lock of #1097 shows the names removed.
6. `numerics` and `diagnostic` are not in this proposal. The owner directed on 2026-11-09 that
   both be removed, by separate proposals, accepted before this one's call forms are refused, so
   that no entry is left with an option it cannot write. The `textureSampleGrad` rewrite that
   would replace `diagnostic` is an assumption of that proposal, unproven where the coordinate is
   computed inside the branch.

The emitted WGSL and GLSL ES 3.00 do not change for a migrated program.

**The principle, a new Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> The proposed text, for `docs/language-design.md` §1.8 after
Rule 1.7:

> **Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> A construct of the language is added only for what the author must state and the
> compiler cannot know or prove. What the compiler can read from the program (the stage of an
> entry from its types) is not written again. What it can decide (an optimization it can prove
> exact, a tuning parameter, a validation it can satisfy by rewriting the program) is the
> compiler's work and never an author-facing construct. What the author must state is written as
> a type of the surface on the declaration or value it describes (`builtin<…>`, `location<…>`,
> `inout<T>`, `out<T>`, and the size of D2), never as a call of a function whose only role is to
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
>   stage decorator after the migration release; the name-lock test of #1097 once it lands, which
>   shows a removed stage name.

## Why

The owner judged the stage calls excessive and asked that the language add as little as
possible. Measured on `main` at `766ec8a6` with a TypeScript AST script over
`examples/*.shade.ts` (the script reads each stage call's function and resolves the interfaces
and classes of the same file):

- 174 entries in 93 files: 81 vertex, 81 fragment, 12 compute. (The 94th listed file,
  `loop-kernel`, declares a kernel and no entry.)
- 81 of 81 vertex entries and 12 of 12 compute entries name their stage by their types.
- 79 of 81 fragment entries do. The two others (`hello-uniform` `fs`, `capsule-corp-namek-class`
  `main`) return a bare `vec4`. Under rule 2 they return `location<0, vec4>`.
- No entry's types name two stages.
- 0 of the 115 functions that are not entries carry a `builtin<…>` or `location<…>` type, so no
  existing helper becomes an entry.
- 10 of the 12 compute entries use the default size 64 (`[64, 1, 1]` or `[64]`). Two do not:
  `workgroup-tile-2d` (`[8, 8]`) and `workgroup-override` (`[WG_SIZE]`, an override).
- Downstream, typecv writes 162 `@compute([64])` and about 90 other sizes (56 `@compute([1])`,
  15 `[8]`, 7 `[32]`, named constants). A non-default size is a real need.

Measured on 2026-11-09 with `typescript@5.6.3` `tsc --strict`, prettier (repository version),
esbuild, `bun build` and `@typescript-eslint/typescript-estree` `parse()`:

| Form                                                             | tsc      | prettier | esbuild | Bun    | typescript-estree |
| ---------------------------------------------------------------- | -------- | -------- | ------- | ------ | ----------------- |
| plain function, stage from types                                 | accepted | parses   | parses  | parses | parses            |
| `export function f(this: workgroup_size<8, 8>, gid: builtin<…>)` | accepted | parses   | parses  | parses | parses            |
| `@compute([8, 8]) export function f(…)`                          | TS1206   | fails    | fails   | fails  | fails             |

**Alternatives considered:**

| Form                                                         | Notes                                                                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stage read from the types, no marker                     | Selected. Nothing new to learn; every tool parses it; nothing to filter.                                                                              |
| `@vertex export function vs(…)` (the previous revision)      | Does not parse in prettier, typescript-eslint, esbuild or Bun; needs an editor filter; TypeScript does not check the decorator's argument (Rule 1.7). |
| `export const vs = vertex(function vs(…) {…})` (change 0111) | A fixed function name; rejected by the owner.                                                                                                         |
| `export function vs(…): vertex<VsOut>`                       | A fixed type name; rejected by the owner.                                                                                                             |
| `"use vertex"` directive in the body                         | A second directive mechanism; a string the toolchain does not check.                                                                                  |

**Costs.**

- The stage is implicit: a reader learns it from the types, as WGSL readers learn a builtin's
  stage from its name. Hover on an entry shows its stage (the language service owes that).
- A fragment entry with no input and a bare `vec4` output must write `location<0, vec4>`.
- A function that must be an entry but carries no entry type is refused, with a message that
  names the type to write.

**Assumptions.** The front end can classify an entry from the written types of its signature
and of the same file's structs, and from imported structs through the existing linker. The host
face reads the stage from the classification, and the host gets the same signature.

## What it touches

- **Rule 1.8** (new): <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> the principle above.
- **Rule 2.1**: `vertex`, `fragment`, `compute` and `workgroup_size` leave the author-facing name
  set as values after the migration release; the size type of D2 (if chosen) enters it from
  WGSL's attribute name.
- **Rule 6.6**: entry inputs and outputs keep their attribute types; the TS1206 note for entries
  is removed, since no decorator remains.
- **Rule 6.7**: the list of attribute places drops the stage call and the decorator.
- **Rule 7.6**: changes only if D3 drops `!` on a local that an `out<T>` argument fills.
- **Rule 8.1**: an entry point is a function declaration whose signature carries an entry type.
- **Rule 8.2**: a fragment colour output is `location<0, vec4>`.
- **Rule 8.7**: the workgroup size is the default 64 or the size of D2.
- **Rule 8.22**: a kernel's size under D1.
- **`docs/dx.md`** principle 6 ("an explicit `@compute` entry and a workgroup shape stay
  public"): reworded to "an explicit compute entry and a workgroup shape", which this proposal
  keeps.
- **`docs/roadmap.md`**: its first rule is cited, not changed.
- **`README.md`**: the `tsconfig.shade.json` section loses its decorator settings and TS1206
  counts.
- **Diagnostic messages** that name a stage call (`builtin-check.ts`, `kernel-loops.ts`,
  `lower/function.ts`, `class-methods.ts`, `foreign-names.ts`, `module-const.ts`, `link.ts`,
  `diagnostic-directive.ts`, `host-face.ts`, and the language service's docs, completions,
  navigation and semantic tokens) name the plain form.
- **The editor**: the TS1206 filter and its coupling to TS2564 (`usesDecoratedForm`) are removed
  after the migration release, since no decorator remains; until then the filter applies only to
  the decorated form, as on `main`.
- **Surface sections**: every section that shows an entry. The list is change 0111's, confirmed
  by `tshc migrate`'s dry run at acceptance.
- **codes**: `TS8028 ATTRIBUTE_NAME` warns on, then refuses, a stage call and a stage decorator,
  and refuses types that name two stages. No code is added or removed.
- **examples**: the 94 `examples/*.shade.ts` files above, the seven in subdirectories of
  `examples/`, and the 77 `journeys/` files with stage calls (the `user journeys` check runs
  them).

### Draft impact estimate

Known: the measurements in Why. Estimated, not measured: the front end's classification, the
host face, the language service's hover (which must show the stage), `tshc migrate` in two
directions (stage calls and stage decorators to the plain form, parameter and field decorators to
types), the site's Playground starter, and each downstream repository's shader files. Duration
and cost are unknown.

**Migration order** (finding S7):

1. Freeze 0111 milestone 5 for the stage forms now: neither the stage call nor the stage
   decorator is refused before this proposal decides.
2. Accept the separate `numerics` and `diagnostic` removals.
3. Implement the classification beside the stage call, with the warning of rule 4.
4. Rewrite the examples, the journeys and the tests with `tshc migrate`.
5. Refuse the stage forms in the release after the warning.

Decisions for the owner (recommendations are the author's, not decisions):

- **D1. A kernel's workgroup size.** A kernel's size is tuning: the compiler computes the
  dispatch count itself. Recommended: the compiler chooses it, and `workgroup_size([…], f)` is
  removed. Alternative: the size type of D2 on a kernel too.
- **D2. How a compute entry states a size other than 64.**

  ```ts
  // before
  export const blur = compute([8, 8], function blur(gid: builtin<"global_invocation_id", vec3u>) { … });

  // A (recommended): a type on the function's `this`, WGSL's attribute name
  export function blur(this: workgroup_size<8, 8>, gid: builtin<"global_invocation_id", vec3u>) { … }

  // B: the attribute, on these entries only
  @compute([8, 8])
  export function blur(gid: builtin<"global_invocation_id", vec3u>) { … }
  ```

  A is a type (as D2 of change 0111 made every other attribute), every tool parses it, and
  `tsc` checks its arguments; an override is `workgroup_size<typeof WG_SIZE>`. Its cost: `this`
  is an unusual place for a reader. B is shorter but fails in prettier, typescript-eslint,
  esbuild and Bun on every file that states a size (2 examples, about 90 typecv kernels).

- **D3. The `!` of change 0111 D8.** 193 fields in 51 example files and 2 locals carry `!` only
  for `tsc`'s `strictPropertyInitialization`. The language zero-initializes a field.
  Recommended: drop `!`, and the language service sets `strictPropertyInitialization: false`
  for shader files, an option that states the language's meaning and filters no diagnostic.
  Alternative: keep `!`. Either way `examples/plain-typescript.test.ts` stops being a surface
  criterion; it stays only as a regression net with that reason stated, or is removed.
- **D4. Migration.** Recommended: one migration release with the `TS8028` warning, then refusal.
  The stage calls were never in a tagged release, so refusing them at once is also reasonable.
- **D5. Record of change 0111.** Recommended: 0111's record gains a note that D1 is replaced by
  0130, and its milestone 5 is withdrawn for the stage forms.

### Independent review record

**Revision `87d87344` (attribute form), reviewed 2026-11-09.** Superseded by this revision. This
revision needs a new independent review before the owner decides. How this revision answers each
finding:

| ID  | Finding (short)                                                                      | In this revision                                                                                              |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| B1  | Rule 1.8 called a numerical relaxation compiler work.                                | resolved: Rule 1.8 names only an optimization the compiler can prove exact.                                   | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B2  | The entry size kept while Rule 1.8 calls tuning compiler work; text contradicted D1. | resolved: rule 3 states the criterion (entry size observable; kernel size tuning); D1 and D2 are the owner's. | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B3  | The editor's TS1206 and TS2564 filters follow `usesDecoratedForm`.                   | resolved: no decorator remains, and the filter is removed after the migration release.                        |
| B4  | D8's `!` exists only for `tsc`; D3 kept a `tsc` test.                                | owner: D3.                                                                                                    |
| S1  | The attribute form fails in prettier, typescript-eslint, esbuild, Bun.               | resolved for the stage; owner for the size (D2 B would bring it back on files that state a size).             |
| S2  | TypeScript does not check a decorator's argument (Rule 1.7).                         | resolved: no decorator; the size type of D2 A is checked by `tsc`.                                            |
| S3  | Rule 2.1 not in scope.                                                               | resolved: Rule 2.1 is in the front matter and What it touches.                                                |
| S4  | The stage is inferable from the types.                                               | resolved: this is the design; measured 172 of 174 entries, the other 2 by rule 2.                             |
| S5  | Unnamed conflict with Rule 1.4 and `docs/roadmap.md`.                                | resolved: Rule 1.8's rationale names both; the criterion is in the rule text.                                 | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| S6  | Scope misses journeys, README, messages, dx.md, roadmap.                             | resolved: listed in What it touches and Applicability.                                                        |
| S7  | No migration order.                                                                  | resolved: Migration order.                                                                                    |
| S8  | typecv and typeplot counts.                                                          | resolved: typecv's entry corrected; typeplot below.                                                           |
| N4  | Record the reversal as a new decision.                                               | resolved: Request source.                                                                                     |
| N5  | The `textureSampleGrad` rewrite is unproven.                                         | resolved: rule 6 marks it an assumption of the separate proposal.                                             |

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

### Approval and plan record

This record does not yet apply. Acceptance will require: a new independent review of this
revision, the owner's decision on D1 to D5, the merge of #1094 with `status: accepted`, the
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
0130 in its `compiler-changes.md`. typeplot is not in `DOWNSTREAM_REPOS`; it writes 5 `@vertex`
and 39 `@fragment` stage decorators and 49 field decorators (24 `@builtin`, 25 `@location`),
which move the same way when it moves its pin.
