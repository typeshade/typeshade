---
id: '0130'
title: An entry point is a function declaration with one stage attribute, `@vertex`, `@fragment` or `@compute([x, y?, z?])`, written in the language's own syntax and not as a call of a fixed function name
status: draft
rules:
  - '1.7'
  - '1.8'
  - '2.1'
  - '6.6'
  - '6.7'
  - '7.6'
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
    what: Every page, example card, Playground starter (`playground-host-default.ts`) and generated host text that shows a stage call or `workgroup_size(…)` is written again with the stage attribute, in English and in Korean; `compiler-changes.md` records 0130 when the pin moves.
  - repo: vscode-typeshade
    what: Snippets, the skill's references and the grammar show the stage attributes; the editor's TS1206 filter is narrowed to a stage attribute on a module function and decoupled from TS2564; `compiler-changes.md` records 0130 when the pin moves.
  - repo: radiance
    what: Every shader file that uses a stage call moves to the attribute form with `tshc migrate`; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typenn
    what: No stage call or stage decorator was found at review time (grep of `src/`); `compiler-changes.md` records 0130 when the pin moves.
  - repo: typecv
    what: Its shader files already use the stage decorators (251 under `src/` at review time), which this change keeps; it still owes the move of its 224 `@builtin` and 10 `@inout` parameter decorators to types (change 0111), which `tshc migrate` does; do not run `tshc migrate` at the current pin; `compiler-changes.md` records 0130 when the pin moves.
  - repo: typeaudio
    what: The stage calls under `experiments/` (15 at review time, 6 of them inside template strings in the sound-match experiment's program file, which `tshc migrate` cannot rewrite and the author edits by hand) move to the attribute form; `compiler-changes.md` records 0130 when the pin moves.
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0130, `status: draft` (front matter).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Date and attribution          | Authored 2026-11-09 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean. The owner said that the examples' change from `@vertex` to `vertex(…)` (change 0111 D1) was not intended; that TypeShade is a language, not a library, with its own directive and compiler; that `@vertex`, `@fragment` and `@compute` are to be attributes; and that TypeShade borrows TypeScript's syntax and is not a language that uses it as it is, as Vue and React (JSX) are not ("타입스크립트 문법을 차용한거지 그대로 쓰는 언어가 아니라니까요… vue, react도 똑같은데"). No GitHub issue is recorded.                                                                                                |
| Applicability / effectivity   | `docs/language-design.md` Rules 1.7, 1.8 (new), 2.1, 6.6, 6.7, 7.6, 8.1, 8.7 and 8.22, `reqs/`, `docs/use-typeshade-surface.md` (every section that shows an entry), `docs/dx.md` (cited, not changed), `docs/roadmap.md` (one sentence added to its first rule), the front end's entry detection (`src/compiler/ts/stage-call.ts` and its consumers), the ambient library and the editor's diagnostic filter (`src/language-service/`), the host face, `tshc migrate`, `examples/plain-typescript.test.ts`, `journeys/`, `README.md` (`tsconfig.shade.json`), every `examples/**/*.shade.ts` that declares an entry, and the downstream repositories. No release version is assigned. |
| Review baseline               | `main` at `79c76d48` (#1098), read on 2026-11-09. Earlier revisions of this file were read against `415b276a` and `766ec8a6`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Review and revision authority | Pull request #1094. Git records the revisions; the review and merge of #1094 record the decision. Revision history on this pull request: `vertex<T>` return types (rejected by the owner); stage attributes `@vertex` (`87d87344`, reviewed); stage inference from types (`19ccafee`, `3b20a19c`, reviewed once; superseded, see Independent review record); stage attributes again (this revision).                                                                                                                                                                                                                                                                                   |

## What changes

This proposal replaces decision D1 of change 0111. It keeps the rest of change 0111: entry
inputs and outputs carry `builtin<N, T>` and `location<I, T>` types (D2), and `inout<T>` and
`out<T>` are types (D4).

**Before (change 0111 D1):**

```ts
export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): VsOut { … });
export const fs = fragment(function fs(i: VsOut): location<0, vec4> { … });
export const blur = compute([8, 8], function blur(gid: builtin<"global_invocation_id", vec3u>) { … });
export const k = workgroup_size([128], function k(a: array<f32>) { … });
```

**After:**

```ts
@vertex
export function vs(vi: builtin<"vertex_index", u32>): VsOut { … }

@fragment
export function fs(i: VsOut): location<0, vec4> { … }

@compute([8, 8])
export function blur(gid: builtin<"global_invocation_id", vec3u>) { … }

@workgroup_size([128])
export function k(a: array<f32>) { … }
```

**The principle, a new Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> The proposed text, for `docs/language-design.md` §1.8 after
Rule 1.7:

> **Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> A construct of the language is written in the language's own syntax: the
> directive, a type of the surface, or an attribute `@name` or `@name(…)` on the declaration it
> marks. A construct that marks a declaration is an attribute; a construct that marks a value is a
> type. A construct must not be written as a call of a function whose only role is to carry it.
> A construct exists only for what the author must state and the compiler cannot know or prove;
> an optimization the compiler can prove exact, a tuning parameter and a validation the compiler
> can satisfy by rewriting the program are the compiler's work. TypeShade borrows TypeScript's
> syntax and is not TypeScript: whether a TypeScript tool (`tsc`, a formatter, a linter, a
> bundler) accepts a form is not a criterion for the surface, and the tooling for the language's
> own syntax is the project's work, as it is for Vue single-file components and JSX.
>
> - Rationale: a `"use typeshade"` file is a program in the TypeShade language, and its own
>   compiler and language service read it (Rule 3.1). A call of a fixed function name presents a
>   construct as a library API. Change 0111 D1 measured the surface against a plain `tsc` and
>   replaced `@vertex` with `vertex(f)`; later revisions of this proposal measured it against
>   prettier, typescript-eslint, esbuild and Bun and proposed to infer the stage. The owner
>   rejected both criteria on 2026-11-09. Rule 1.4 still holds where an ECMAScript form carries the
>   meaning; a call whose only role is to mark its argument does not carry it. Rule 1.7 holds by
>   the language service's projection of an attribute (below). `docs/roadmap.md`'s first rule,
>   "ordinary TypeScript first", reads as: borrow TypeScript's spelling for what TypeScript can
>   say, and write the rest in the language's own syntax.
> - Derives from: `changes/0130-stage-attributes.md`; the owner's direction of 2026-11-09.
> - Enforced by: review (Rule 13.1); the independent review of each proposal
>   (`changes/README.md`); `TS8028 ATTRIBUTE_NAME` on a stage call after the migration release.

**Rule 1.7 and the roadmap's first rule, made unambiguous.** Two sentences let agents read "the
source must be valid TypeScript" into the surface. Change 0111 and the inference revisions of this
proposal both read them that way, against §1.8's existing statement "TypeShade is a language of
its own" (`docs/language-design.md` §1.8). The owner fixed this reading on 2026-11-09 ("이걸 내가
처음부터 잡고 문서에 다 써놓았는데 왜 자꾸 이렇게 바뀌는건지… 해결해야해요"); the decision is also
entered in the owner-decision register (separate pull request). This proposal amends both:

- **Rule 1.7**, proposed text: "Every form the surface takes beyond TypeScript must be one the
  language service can project to valid TypeScript for the editor's checker, so that TypeScript's
  checker serves the editor (Rule 12.7). The projection is the language service's work: the
  source is not required to be valid TypeScript, and no TypeScript tool's acceptance of the source
  is a criterion for the surface (Rule 1.8). A form no projection can carry is not added." <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
- **`docs/roadmap.md`, "Ordinary TypeScript first"**, one sentence added after its first
  sentence: "It means TypeScript's way of writing, what a TypeScript developer already writes; it
  does not mean that TypeScript's toolchain accepts the file, since TypeShade is a language of its
  own (`docs/language-design.md` §1.8)."

The proposed rules, in short:

1. An entry point is a function declaration at the top of the file or of a namespace with
   exactly one stage attribute: `@vertex`, `@fragment` or `@compute([x, y?, z?])` (Rule 8.1).
   A bare `@compute` takes the default size, 64 (Rule 8.7). An extent is a positive integer
   literal, an integer module constant or a `u32` override name, as Rule 8.7 says today.
2. A kernel function's size other than the default is the attribute `@workgroup_size([n])` on
   its declaration, in place of the `workgroup_size([n], f)` call (Rule 8.22). The size stays
   public (`docs/dx.md` principle 6).
3. Entry inputs and outputs keep the types of change 0111; no decorator on a parameter or a field
   (Rule 6.6). D3: the `!` on an entry I/O field and on a local an `out<T>` argument fills is no
   longer written; the language service sets `strictPropertyInitialization: false` for shader
   files, which states the language's zero-initialisation (Rule 7.6).
4. The calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and `workgroup_size([…], f)` give a
   `TS8028` warning that names the attribute for one migration release (D4), and are refused
   after it. `tshc migrate` rewrites them.
5. A stage attribute on anything but a function declaration at the top of the file or of a
   namespace (a method, an arrow function, a local function, an overload signature), two stage
   attributes on one function, and `@compute` with a fourth, zero or non-integer extent are
   refused with `TS8028` or `TS8037` as today, with messages that name the attribute.
6. The attribute names `vertex`, `fragment`, `compute` and `workgroup_size` stay author-facing
   names (Rule 2.1(a), an attribute reached as a decorator). The ambient library declares them
   with decorator signatures, as before change 0111, so the author-facing name set
   (`src/__api__/author-names.md`) keeps the same names.
7. `numerics` and `diagnostic` are not in this proposal: proposals 0131 (#1104) and 0132
   (#1105) remove them. Both are accepted before this proposal's call forms are refused, so no
   entry is left with an option it cannot write.

The emitted WGSL and GLSL ES 3.00 do not change for a migrated program.

### The editor (Rule 1.7, Rule 12.7)

TypeScript does not type-check a decorator on a function declaration; it reports TS1206 and
checks nothing in its argument. The language service therefore projects the attribute:

1. In the virtual file it gives TypeScript, the language service removes the attribute from the
   declaration.
2. It checks the attribute's name and arguments itself, with the compiler's own check, and
   reports `TS8028` or `TS8037` where `compile()` does.
3. Its TS1206 filter covers only a stage attribute or `@workgroup_size` on a function declaration
   at the top of the file or of a namespace. It no longer depends on `usesDecoratedForm`, it no
   longer hides TS2564 (D3 handles field initialisation), and it does not hide TS1206 on a
   parameter or field decorator, which change 0111 still refuses.

Hover, completion and navigation on an attribute name come from the same check. A test reads both
halves on each case (`src/language-service/ambient-parity.test.ts` shape).

### Tooling owed by the project

A decorator on a function declaration is outside TypeScript's grammar. Measured on 2026-11-09:
prettier, `@typescript-eslint/typescript-estree`, esbuild, `bun build` and Node's type stripping
reject it; `tsc` reports TS1206. This repository's and typecv's `.prettierignore` already
exclude decorated shader files. Under Rule 1.8 this is not a reason to change the surface. It is <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
work the project owes, as Vue and JSX tooling is:

- a formatter path for `*.shade.ts` (a prettier plugin or a `tshc fmt` command);
- a lint path (a parser wrapper for typescript-eslint, or `tshc lint`);
- the bundler path: the Vite plugin already replaces a shader module before esbuild reads it;
  other bundlers and runtimes that load a `.shade.ts` directly need the same treatment.

Each item gets its own record later. None blocks this proposal.

## Why

TypeShade is a language with its own directive and its own compiler. A stage is part of what a
program means, as it is in WGSL. A call of a function named `vertex` presents it as a library
API: the author must know a fixed name, and the entry carries its own name twice
(`const vs = vertex(function vs …)`).

Change 0111 chose the call because a plain `tsc` gives TS1206 on a decorator of a function
declaration. That measures the file against a tool that does not read the language; a plain
`tsc` does not accept a shader file whole anyway, because its vector arithmetic is an operator
TypeScript does not overload, and a host project's `tsc` reads the generated host view, not the
source, with the documented setup (surface §64).

**Alternatives considered:**

| Form                                                                                                        | Notes                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vertex export function vs(…)`                                                                             | Selected. The language's attribute, as in WGSL.                                                                                                                                                |
| `export const vs = vertex(function vs(…) {…})` (change 0111)                                                | A fixed function name; rejected by the owner.                                                                                                                                                  |
| `export function vs(…): vertex<VsOut>`                                                                      | A fixed type name; rejected by the owner.                                                                                                                                                      |
| The stage inferred from the entry's types, a size on a builtin's options (revisions `19ccafee`, `3b20a19c`) | Chosen to keep every TypeScript tool parsing the file; rejected by the owner, who does not take tool parseability as a criterion. It also needed a placeholder parameter on 56 typecv entries. |
| `"use vertex"` directive in the body                                                                        | A second directive mechanism for what WGSL writes as an attribute.                                                                                                                             |

**Assumptions.** The front end still compiles the decorated stage form, since change 0111's
migration period kept it (`src/compiler/ts/stage3.test.ts`; measured on `415b276a`: the
decorated `hello-vsout` compiles with TS8028 warnings and emits `@vertex` and `@fragment`).
The host face reads the stage from the attribute as it did before change 0111.

## What it touches

- <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
  **Rule 1.8** (new): the text above.
- **Rule 1.7**: amended as above: the projection is the language service's work, the source need not be valid TypeScript, and no TypeScript tool's acceptance is a criterion.
- **`docs/roadmap.md`**: one sentence in "Ordinary TypeScript first": TypeScript's way of writing, not its toolchain's acceptance.
- **Rule 2.1**: a stage attribute is an author-facing name reached as a decorator (2.1(a)).
- **Rule 6.6**: entry inputs and outputs keep their types; the TS1206 note names the narrowed filter.
- **Rule 6.7**: the list of attribute places: a stage and `workgroup_size` are attributes on a function declaration.
- **Rule 7.6**: a local that an `out<T>` argument fills first is declared without `!` (D3).
- **Rule 8.1**: an entry point is a function declaration with one stage attribute.
- **Rule 8.7**: the workgroup size is `@compute`'s argument; the call form is removed.
- **Rule 8.22**: a kernel's size is `@workgroup_size([n])`.
- **Surface sections**: every section that shows an entry (the list is change 0111's, to be
  confirmed by `tshc migrate`'s dry run at acceptance).
- **codes**: `TS8028` warns on, then refuses, the call forms, and stops warning on the stage
  attributes; `TS8037` and the other messages that name the call form name the attribute
  (`builtin-check.ts`, `kernel-loops.ts`, `lower/function.ts`, `class-methods.ts`,
  `foreign-names.ts`, `module-const.ts`, `link.ts`, `diagnostic-directive.ts`, `host-face.ts`,
  and the language service's `docs`, `completions`, `navigation` and `semantic-tokens`). No code is
  added or removed.
- **examples**: the 94 `examples/*.shade.ts` files that contain a stage call; 7 more under
  `examples/hosts/` and `examples/passes/` that `scripts/changes.ts` does not track.
- **Also**: `journeys/` (77 files with stage calls, run by the required `user journeys` check);
  `README.md` (`tsconfig.shade.json`, still describing `experimentalDecorators` and
  `strictPropertyInitialization: false`); `examples/plain-typescript.test.ts` (it stops being a
  surface criterion: it keeps only the regression net it states, without TS1206 and TS2564).

### Draft impact estimate

Known, measured at the baselines named above:

- 94 example files carry a stage call; 0 examples use `workgroup_size(`; 15 uses of
  `workgroup_size(` are in `src/` and `journeys/` tests.
- typecv: 251 stage decorators (kept), 224 `@builtin` and 10 `@inout` parameter decorators
  (moved to types under change 0111).
- typeplot: 5 `@vertex` and 39 `@fragment`, 25 of them inside template strings in
  `src/plot-source.ts`; it is not in `DOWNSTREAM_REPOS`. <!-- doc-refs: skip — a path in the typeplot repository -->
- typeaudio: 15 stage calls, 6 in template strings.

Estimated, not measured: the front end's entry detection change, the host face, the language
service's projection and filter, `tshc migrate` in both directions (stage calls to attributes;
parameter and field decorators to types), and the tooling owed above. Most of the reading code
exists from before change 0111. Duration and cost are unknown.

### Decisions

Decided by the owner on 2026-11-09, in the Claude Code session:

- **D1. A kernel's size.** Kept public (`docs/dx.md` principle 6), decided by "추천대로". Its
  spelling becomes the attribute `@workgroup_size([n])` in this revision, by the same principle as
  the stages; **the owner is asked to confirm this spelling**.
- **D2. A compute entry's size.** `@compute([x, y?, z?])`, decided by the owner's direction that
  the stages are attributes. The builtin-option spelling of `3b20a19c` is withdrawn.
- **D3. D8's `!`.** Dropped; the language service sets `strictPropertyInitialization: false` for
  shader files ("추천대로").
- **D4. Migration.** One release where the call forms compile with a `TS8028` warning, then
  refusal ("추천대로").
- **D5. Change 0111's record.** A note that 0130 replaces D1, and withdrawal of 0111's milestone 5
  for the stage forms ("추천대로").

The author's earlier recommendation to infer the stage from the types contradicted the owner's
direction and is withdrawn.

### Migration order

1. Freeze change 0111's milestone 5 for the stage forms now.
2. Proposals 0131 and 0132 are accepted, so no stage call is left with an option.
3. Implement the attributes as the decided form, the narrowed editor filter and projection, and
   split `tshc migrate` (stage calls to attributes; parameter and field decorators to types).
4. Migrate the examples, the tests, `journeys/` and the documents; template strings are edited by
   hand.
5. One release warns on the call forms; the next refuses them.

### Independent review record

**This revision needs a new independent review before acceptance.**

**Revisions `19ccafee` and `3b20a19c` (stage inference) are superseded.** The owner rejected
tool parseability as a criterion on 2026-11-09 ("타입스크립트 문법을 차용한거지 그대로 쓰는
언어가 아니라니까요… vue, react도 똑같은데"), and inference existed to meet it. Their review
(R-*) is kept below as history.

Status in this revision of the findings on revision `87d87344` (attribute form):

| ID  | Finding (short)                                                               | Status in this revision                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Rule 1.8 called a numerical relaxation compiler work.                         | fixed: "an optimization the compiler can prove exact".                                                                                                                                  | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B2  | The entry size against "tuning is compiler work".                             | fixed: an entry's size is author knowledge (the host's workgroup count, `local_invocation_id`, workgroup memory, barriers); a kernel's size is public by `docs/dx.md` principle 6 (D1). |
| B3  | The editor's TS1206 and TS2564 filters follow `usesDecoratedForm`.            | fixed in the text: the filter is narrowed and decoupled (The editor, item 3); implementation owes the two-halves test.                                                                  |
| B4  | D8's `!` exists only for `tsc`.                                               | decided: D3 drops it.                                                                                                                                                                   |
| S1  | prettier, typescript-eslint, esbuild, Bun reject the form.                    | decided: not a criterion (Rule 1.8); listed as owed tooling.                                                                                                                            | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| S2  | No projection; TypeScript does not check the attribute's argument (Rule 1.7). | fixed in the text: the language service's projection and own check (The editor).                                                                                                        |
| S3  | Rule 2.1 not in scope.                                                        | fixed: item 6; Rule 2.1 in the front matter.                                                                                                                                            |
| S4  | The stage is inferable from the types.                                        | decided: rejected with the inference revisions.                                                                                                                                         |
| S5  | Unnamed conflict with Rule 1.4 and `docs/roadmap.md`.                         | fixed: Rule 1.8's rationale reads both; the criterion "declaration → attribute, value → type" is in the rule text.                                                                      | <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| S6  | Scope misses journeys, README, messages.                                      | fixed: What it touches.                                                                                                                                                                 |
| S7  | No migration order.                                                           | fixed: Migration order.                                                                                                                                                                 |
| S8  | typecv and typeplot counts.                                                   | fixed: front matter and Draft impact estimate.                                                                                                                                          |
| N2  | §64 holds only with the documented setup.                                     | fixed (Why).                                                                                                                                                                            |
| N4  | Record the reversal as a new decision.                                        | fixed: Request source and Decisions.                                                                                                                                                    |
| N5  | The `textureSampleGrad` rewrite is unproven.                                  | moved to proposal 0132.                                                                                                                                                                 |

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
revision with its findings answered, the owner's confirmation of D1's spelling, the merge of
#1094 with `status: accepted`, and the milestones above.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits with
`Change: 0130`; the emit goldens unchanged for every migrated example; both halves read on the
attributes, the call forms' warning and refusal, and the projection's checks
(`src/language-service/ambient-parity.test.ts` shape); and the document audit of the rules, the
surface document and `reqs/`.

## What it owes downstream

Each repository in `downstream` moves its stage calls to attributes with `tshc migrate` when it
moves its pin past the implementation (template strings by hand), and records 0130 in its
`compiler-changes.md`. typeplot is not in `DOWNSTREAM_REPOS`; it writes the stage decorators today
and owes nothing for the stages.
