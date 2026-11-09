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
names: []
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
  - loop-struct-array
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
    what: Snippets, the skill's references and the grammar show the stage attributes; its tsserver tests (`FALSE_POSITIVE_CODES`, `plugin-cases.ts` line 48) follow the narrowed TS1206 filter, which lives in this repository (`src/language-service/diagnostics.ts`); its tsserver plugin reads the user's tsconfig, so D3 holds there with `strictPropertyInitialization: false`, which `tshc init` writes; `compiler-changes.md` records 0130 when the pin moves.
  - repo: radiance
    what: It already writes `@compute`, `@vertex` and `@fragment` (4, in `packages/radiance/src/kernels/trace.shade.ts` and `scripts/probes/hit-sphere.shade.ts`) and has no stage call; it owes the move of 5 `@builtin` and 1 `@location` parameter decorators to types (change 0111); `compiler-changes.md` records 0130 when the pin moves. <!-- doc-refs: skip — paths in the radiance repository -->
  - repo: typenn
    what: No stage call or stage decorator was found at review time (grep of `src/`); `compiler-changes.md` records 0130 when the pin moves.
  - repo: typecv
    what: Its shader files already use the stage decorators (251 under `src/` at review time), which this change keeps; it still owes the move of its 224 `@builtin` and 10 `@inout` parameter decorators to types (change 0111), which `tshc migrate` does; do not run a `tshc migrate` from before 0130's implementation (its pin `78a9060f` has none, and 0111's codemod would rewrite the stages to calls); `compiler-changes.md` records 0130 when the pin moves.
  - repo: typeaudio
    what: The stage calls under `experiments/` (15 at review time, 6 of them inside template strings in `experiments/07-sound-match/` (5 in `program.ts`, 1 in `refusals.ts`), which `tshc migrate` cannot rewrite and the author edits by hand) move to the attribute form; `compiler-changes.md` records 0130 when the pin moves.
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0130, `status: draft` (front matter).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Authored 2026-11-09 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean. The owner said that the examples' change from `@vertex` to `vertex(…)` (change 0111 D1) was not intended; that TypeShade is a language, not a library, with its own directive and compiler; that `@vertex`, `@fragment` and `@compute` are to be attributes; and that TypeShade borrows TypeScript's syntax and is not a language that uses it as it is, as Vue and React (JSX) are not ("타입스크립트 문법을 차용한거지 그대로 쓰는 언어가 아니라니까요… vue, react도 똑같은데"). No GitHub issue is recorded.                                                                                                      |
| Applicability / effectivity   | `docs/language-design.md` Rules 1.7, 1.8 (new), 2.1, 6.6, 6.7, 7.6, 8.1, 8.7, 8.22 and 8.25, `reqs/`, `docs/use-typeshade-surface.md` (every section that shows an entry), `docs/dx.md` (cited, not changed), `docs/roadmap.md` (one sentence added to its first rule), the front end's entry detection (`src/compiler/ts/stage-call.ts` and its consumers), the ambient library and the editor's diagnostic filter (`src/language-service/`), the host face, `tshc migrate`, `examples/plain-typescript.test.ts`, `journeys/`, `README.md` (`tsconfig.shade.json`), every `examples/**/*.shade.ts` that declares an entry, and the downstream repositories. No release version is assigned. |
| Review baseline               | `main` at `71887632` (#1104, 0131 accepted), read on 2026-11-09; the Rule 6.7 text below is written against the text 0131 leaves. Earlier revisions were read against `415b276a`, `766ec8a6` and `79c76d48`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Review and revision authority | Pull request #1094. Git records the revisions; the review and merge of #1094 record the decision. Revision history on this pull request: `vertex<T>` return types (rejected by the owner); stage attributes `@vertex` (`87d87344`, reviewed); stage inference from types (`19ccafee`, `3b20a19c`, reviewed once; superseded, see Independent review record); stage attributes again (this revision).                                                                                                                                                                                                                                                                                         |

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

@workgroup_size([128]) // optional: without it the compiler chooses the size
export function k(a: array<f32>) { … }
```

**D3, before and after:**

```ts
// before (change 0111 D8)
class VsOut { pos!: builtin<"position", vec4>; uv!: location<0, vec2>; }
let q!: vec2; split(p, q);

// after
class VsOut { pos: builtin<"position", vec4>; uv: location<0, vec2>; }
let q: vec2; split(p, q);
```

**The principle, a new Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> The proposed text, for `docs/language-design.md` §1.8 after
Rule 1.7:

> **Rule 1.8.** <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> A construct of the language is written in the language's own syntax: the
> directive, a type of the surface, or an attribute `@name` or `@name(…)` on the declaration it
> marks. A construct that marks a function, its stage or its dispatch is an attribute `@name` or
> `@name(…)` on the function's declaration. A construct that describes a value that flows in or
> out (a parameter, a field, a result, a binding) is part of its type. A construct must not be
> written as a call of a function whose only role is to carry it. A construct exists only for
> what the author must state and the compiler cannot know or prove; an optimization the compiler
> can prove exact, a tuning parameter and a validation the compiler can satisfy by rewriting the
> program are the compiler's work. Where the compiler chooses a tuning parameter by default, an
> attribute may let the author state it explicitly, as `@workgroup_size([n])` does for a kernel
> (Rule 8.22): the default is the compiler's choice, and the attribute is an override, never a
> requirement. TypeShade borrows TypeScript's
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
>   meaning; a call whose only role is to mark its argument does not carry it. Rule 1.7, as
>   amended below, holds: the language service keeps an attribute as a form TypeScript parses,
>   drops TypeScript's grammar report on it, and checks its content with the compiler's own check
>   of that form (The editor, below). `docs/roadmap.md`'s first rule,
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

- **Rule 1.7**, replacement of the rule paragraph and of its Rationale (its Derives from gains
  "change `0130`", and its Enforced by stays): "Every form the surface takes beyond
  TypeScript must be one the language service can give TypeScript's checker so that the checker
  serves the editor (Rule 12.7): projected to valid TypeScript, or kept as a form TypeScript
  parses, whose grammar report the language service drops and whose content it checks with the
  compiler's own check of that form (a stage attribute, Rule 8.1, or `@workgroup_size`, Rule
  8.22). This is the language service's
  work: the source is not required to be valid TypeScript, and no TypeScript tool's acceptance of
  the source is a criterion (Rule 1.8). A form neither path can carry is not added. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
  Rationale: "As the language borrows TypeScript's forms and extends a few (`Array<T, N>`, the
  stage attributes), the language service keeps TypeScript's checker only while every extension
  has a TypeScript form it can be read as, projected or kept as TypeScript parses it. A checker of
  TypeShade's own would be a second implementation of the language; calling the compiler's own
  check of a kept form is not one."
- **`docs/roadmap.md`, "Ordinary TypeScript first"**, one sentence added after its first
  sentence: "It means TypeScript's way of writing, what a TypeScript developer already writes; it
  does not mean that TypeScript's toolchain accepts the file, since TypeShade is a language of its
  own (`docs/language-design.md` §1.8)."

**The other amended rules, full replacement texts.** Each text below replaces the named part
whole; a sentence of today's rule that is not shown and not named as kept is removed.

- **Rule 2.1**, a paragraph added after item (c): "An attribute name with
  which a stage or a dispatch is written (`vertex`, `fragment`, `compute`, `workgroup_size`) is
  an author-facing name reached as a decorator (2.1(a)); `@compute([…])` folds WGSL's `@compute`
  and `@workgroup_size` into one TypeShade spelling." An undeclared name in an attribute's
  extents is `TS8037` in both halves, not `TS8022`, as today; this proposal states it and does not
  change it. Its Enforced by gains, after the `TS8022`/`TS8004`/`TS8002` clause: "except inside the
  extents of `@compute([…])` or `@workgroup_size([…])`, where a name nothing declares is `TS8037`,
  in the compiler and in the editor alike (Rule 8.7)".
- **Rule 6.6**, replacement of the two sentences that begin "An entry I/O struct may be a
  `class`…" and "The decorated form, `@builtin("...")`…" (the sentences before them stay): "An entry I/O struct may be a
  `class`, an `interface` or a `type` (Rule 6.9), and a field of one carries its attribute in its
  type and takes no initializer and no `!`; a written `!` is accepted and changes nothing, and the
  language service sets `strictPropertyInitialization: false` in the TypeShade program, since an
  entry I/O field is filled by the stage that produces it, not by an initializer. No decorator is written on a parameter or a field:
  `@builtin("...")` or `@location(n)` there stays accepted with a `TS8028` warning until the
  release that refuses it (change 0111, D5), and the language service hides TypeScript's TS1206 on
  it only while `compile()` warns." Its Rationale is replaced by: "An implicit stage input hides a
  dependency, and WGSL refuses an entry I/O member with no attribute. An input or an output is a
  value that flows in or out, so its attribute is part of its type (Rule 1.8)." <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> In its Enforced
  by, "and `examples/plain-typescript.test.ts` (a plain `tsc --strict` over every example)" is
  replaced by "and the language-service check that reports no TS1206 and no TS2564 on any example",
  and the bare-parameter example becomes `@fragment export function fs(p: vec4): vec4 { … }`.
- **Rule 6.7**, replacement of its second, third and fourth sentences (every sentence after the
  list of names), and of the rationale (the first sentence, the list of names as 0131 leaves it,
  stays): "A stage is an attribute on the entry's
  function declaration (`@vertex`, `@fragment`, `@compute([x, y?, z?])`, Rule 8.1), and a kernel's
  size the optional attribute `@workgroup_size([n])` (Rule 8.22); `builtin` and `location` are
  types and `interpolate`, `invariant` and `blend_src` their options (Rule 6.6), and `inout` and
  `out` are the types `inout<T>` and `out<T>` (Rule 8.25); if proposal 0132 is not accepted,
  `diagnostic` is the attribute `@diagnostic(…)` on the entry's function declaration. Every other
  WGSL attribute is inferred
  by the compiler. The calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and
  `workgroup_size([…], f)` are accepted for one release with a `TS8028` warning that names the
  attribute and `tshc migrate`, and are refused after it (change 0130, D4); the decorators
  `@builtin`, `@location`, `@interpolate`, `@invariant`, `@blend_src`, `@inout` and `@out` on a
  parameter or a field stay as change 0111 D5 says; a decorator outside the list must be refused."
  Rationale: "A misspelled attribute or stage name would otherwise silently stop a function being
  an entry point. The attributes keep WGSL's names (change 0100, change 0111 Amendment 1); a
  stage marks a function, so it is an attribute on the function's declaration, and an input or an
  output is a value, so its attribute is part of its type (Rule 1.8)." <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> In its Enforced by,
  `src/compiler/ts/stage-call.ts` "for the stage calls and their options" becomes "for the stage
  calls during the warning release", `src/compiler/ts/stage-call.test.ts` is read as pinning the
  stage calls "during the warning release", and the message `"@workgroup_size" is WGSL's attribute,
written here as compute's first argument: compute([64], f) or compute([8, 8], f).` becomes
  `"@workgroup_size" is WGSL's attribute, written here as @compute's argument: @compute([64]) or
@compute([8, 8]); on a kernel function, @workgroup_size([n]).`
- **Rule 7.6**, replacement of the two sentences after the first (from "A local that an `out<T>`
  argument fills first…" to "…TS2454 at the call."): "A local that an `out<T>` argument fills first
  is declared without `!` (`let q: vec2; project(p, q);`); a written `!` is accepted and changes
  nothing in the check, which still refuses a read of `q` that no assignment and no `out<T>`
  argument comes before (`TS8075`) (change 0130, D3)." In its Derives from, "change `0111`
  (D8)" becomes "change `0111` (D8, replaced by change `0130`, D3)".
- **Rule 8.1**, replacement of the whole rule paragraph, its Rationale and the `TS8035` message:
  "An entry point is a function declaration at the top of the file or of a namespace, exported or
  not, with exactly one stage attribute written before the declaration: `@vertex export function
vs(…)`, `@fragment …`, or `@compute([x, y?, z?]) …`. The order `export @vertex function` is
  accepted and means the same. An entry takes its declaration's name, so `export default` on an
  entry is accepted for one release with a `TS8028` warning ("an entry takes its declaration's
  name; write `export function k`") and is refused after it (change 0130, D4). A bare `@compute` and `@compute()` take the default size (Rule 8.7). An
  entry written as a `const`, an arrow function or a function expression, and an entry method on a
  class, must be refused; the stage calls of change 0111 are accepted for one release with a
  warning (Rule 6.7)." Rationale: "`this` is not a GPU instance, and an entry has no receiver. The
  stage marks the function, so it is the language's attribute on the declaration (Rule 1.8)." <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
  `TS8035`'s message becomes: `A decorator has no place on "C.k"; an entry is a function
declaration with a stage attribute, "@vertex export function vs(…) { … }".` Enforced by:
  the front end's entry reading in `src/compiler/ts/source-file.ts` and `decorated-form.ts`, pinned
  by `src/compiler/ts/stage3.test.ts` (both orders, a namespace entry, `export default` warned, then refused) and
  `src/language-service/new-entry-forms.test.ts`; `TS8035`. Its Derives from: "change `0111` (D1,
  replaced by change `0130`); change `0130`".
- **Rule 8.7**, unchanged except in its Enforced by, where the `TS8037` message becomes `compute
takes an array of one to three whole numbers, "@compute([64, 1, 1])"; "{ workgroup: [64, 1, 1] }"
is not a workgroup shape.`
- **Rule 8.22**, its first sentence's phrase "a function declaration or a `const` a
  `workgroup_size([n], f)` call initializes (change 0111)" becomes "a function declaration", and
  its paragraph that begins "A kernel function may be written `export const scale =
workgroup_size([128], …`" is replaced whole by: "A kernel function's workgroup size is the
  compiler's choice: in this version 64 for a loop that does not reduce, 256 (the tree, Rule 7.2)
  for one that reduces, and the group's size in a fused group (F7, Rule 11.13). The optional
  attribute `@workgroup_size([n])`, `n` one positive whole number or one `u32` or `i32` module
  constant in an array literal (read as Rule 8.7 reads `@compute`), states the size for each
  accepted loop that does not reduce; on a function with a loop that reduces it is refused
  (`TS8077`), and on a function that is neither a kernel function nor an entry it is refused
  (`TS8028`), and on an entry it is refused with the message of Rule 6.7; an override name is no
  extent in this version. The size changes the time a loop
  takes, not the bits it writes, since each element is written from its own index `i`. A better
  default, per device or per workload, is compiler work and needs no proposal." In its Enforced
  by, "`src/compiler/ts/stage-call.ts` for `workgroup_size([n], f)`" becomes "the front end's
  decorator reading for `@workgroup_size([n])`, pinned by `src/compiler/ts/stage3.test.ts` (the
  attribute's emit, `TS8077` on a function with a loop that reduces, `TS8028` on a function that is
  neither a kernel function nor an entry)", and its Derives from gains "change `0067`; change
  `0130` (D1)". All its other paragraphs stay. This proposal adds
  no new choice of size: the defaults named are today's (`KERNEL_WORKGROUP = 64` in
  `src/core/kernel-tree.ts`, `KERNEL_TREE = 256`, `src/core/fuse-group.ts`).
- **Rule 8.25**, its Rationale's clause "written as the parameter's type, `inout<T>` or `out<T>`,
  which a plain `tsc --strict` accepts where it refuses a decorator on a parameter of a function
  (change 0111)" becomes "written as the parameter's type, `inout<T>` or `out<T>`, since a
  parameter is a value that flows in and out (Rule 1.8)"; its sentence "The decorated form," <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
  `@inout x: T` and `@out x: T`, stays accepted until the release after the migration release
  (change 0111, D5)" stays.

The proposed rules, in short:

1. An entry point is a function declaration at the top of the file or of a namespace with
   exactly one stage attribute: `@vertex`, `@fragment` or `@compute([x, y?, z?])` (Rule 8.1).
   A bare `@compute` takes the default size, 64 (Rule 8.7). An extent is a positive integer
   literal, an integer module constant or a `u32` override name, as Rule 8.7 says today.
2. A kernel function's size is the compiler's choice by default. The author may state it with
   the optional attribute `@workgroup_size([n])` on the declaration, in place of the
   `workgroup_size([n], f)` call (Rule 8.22, D1). The size stays reachable (`docs/dx.md`
   principle 6) and is never required.
3. Entry inputs and outputs keep the types of change 0111; no decorator on a parameter or a field
   (Rule 6.6). D3: the `!` on an entry I/O field and on a local an `out<T>` argument fills is no
   longer written. The TypeShade program (`typeshadeCompilerOptions`,
   `src/language-service/host.ts` lines 64-76; its script set at line 222) sets `strict: true`
   and no override today, and TS2564 is dropped only by the `usesDecoratedForm` filter
   (`src/language-service/diagnostics.ts` line 1156). This proposal's implementation will set
   `strictPropertyInitialization: false` there, since an entry I/O field is filled by the stage
   that produces it, not by an initializer. The `README.md` `tsconfig.shade.json` (lines 206-207) and `tshc init`
   (`src/cli/init.ts` lines 194-195) already write that option and stay. A local's `let q!` is TS2454, which the language service already drops in
   every shader file (`src/language-service/diagnostics.ts` lines 1297-1308). A written `!` stays
   accepted, since it is valid TypeScript; `tshc migrate` removes it (it adds it today,
   `src/cli/migrate.ts` lines 157-198), and the 52 examples that carry `!:` drop it (51 with
   entry I/O fields or `out<T>` locals, and `loop-struct-array` with `!` on a non-entry class;
   measured on `71887632`).
4. The calls `vertex(f)`, `fragment(f)`, `compute([…], f)` and `workgroup_size([…], f)` give a
   `TS8028` warning that names the attribute for one migration release (D4), and are refused
   after it. `tshc migrate` rewrites them.
5. A stage attribute on anything but a function declaration at the top of the file or of a
   namespace (a method, an arrow function, a local function, an overload signature), two stage
   attributes on one function, and `@compute` with a fourth, zero or non-integer extent are
   refused with `TS8028` or `TS8037` as today, with messages that name the attribute. An entry
   written as a `const` or an arrow function, allowed by Rule 8.1 today, is removed with the
   call forms. An entry written `export default` (`@compute([8]) export default function k(…)`,
   which compiles today with only the decorated-form warning) gets a `TS8028` warning for one
   release, "an entry takes its declaration's name; write `export function k`", and is refused
   after it, as the call forms are.
6. The attribute names `vertex`, `fragment`, `compute` and `workgroup_size` stay author-facing
   names (Rule 2.1(a), an attribute reached as a decorator). The ambient library declares them
   with decorator signatures, as before change 0111, so the author-facing name set
   (`src/__api__/author-names.md`, lines 90, 127, 291 and 295) keeps the same names. For the
   warning release the ambient library keeps both overload sets (`ambient.ts` lines 1655-1671);
   the call overloads leave with the refusal.
7. `numerics` and `diagnostic` are not in this proposal: proposals 0131 (#1104) and 0132
   (#1105) remove them. Both are implemented before this proposal's codemod runs, so no entry is
   left with an option it cannot write (Interaction with 0131 and 0132).

The emitted WGSL and GLSL ES 3.00 do not change for a migrated program.

### The editor (Rule 1.7, Rule 12.7)

TypeScript does not type-check a decorator on a function declaration: it reports TS1206 and
checks nothing in its argument. It still answers references, rename, go-to-definition, quick info
and completion inside the attribute (measured with TypeScript 5.6.3 on
`@compute([WG, "x", undefinedName])`: `findReferences` and `findRenameLocations` on `WG` include
the occurrence in the attribute). The language service therefore:

1. Keeps the attribute as written in the virtual file it gives TypeScript, so references,
   rename, definition and completion inside it stay TypeScript's.
2. Runs the compiler's own check of the attribute's name and extents, and reports `TS8028` or
   `TS8037` where `compile()` does. This is not a second checker of the language (Rule 1.7's
   rationale): it calls the compiler's check.
3. Drops TS1206 only on a stage attribute or `@workgroup_size` on a function declaration at the
   top of the file or of a namespace. The filter no longer depends on `usesDecoratedForm` and no
   longer hides TS2564 (D3 handles field initialisation). It keeps hiding TS1206 on a parameter
   or field decorator only while `compile()` warns on one (Rule 6.6, as proposed).
4. Narrows the guard of `src/language-service/navigation.ts` lines 42-56 now, to go-to-definition
   on the identifier of a decorator that is not a call (`@vertex`, `@fragment`, a bare
   `@compute`): the one position where TypeScript 5.6.3 and 6.0.2 throw a `Debug Failure`
   (measured by the review of `cfe20e9a`). Rename, references, quick info and definition at
   `compute` and at `WG` inside `@compute([WG])` work on both versions; a test pins both.

A test reads both halves on each case (`src/language-service/ambient-parity.test.ts` shape),
including a rename of an override used in `@compute([WG])` that leaves `compile()` accepting the
renamed program.

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

### Final rule texts for the owner (summary)

- **Rule 1.7**: a form beyond TypeScript is either projected to valid TypeScript or kept as a form
  TypeScript parses and checked by the compiler's own check; the source need not be valid
  TypeScript, and no TypeScript tool's acceptance is a criterion.
- **Rule 1.8** (new): a construct is the language's own syntax; a stage or dispatch is an <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
  attribute, a value's attribute is its type; no marker calls; a construct only for what the
  compiler cannot know; a tuning default is the compiler's, an attribute may override it; tool
  acceptance is not a criterion.
- **Rule 2.1**: `vertex`, `fragment`, `compute`, `workgroup_size` are author-facing names reached
  as decorators; `@compute([…])` folds WGSL's two attributes.
- **Rule 6.6**: entry I/O carries attributes in types; fields take no `!`, and a written `!` is
  accepted and changes nothing; parameter and field decorators warn until refused.
- **Rule 6.7**: stages and `@workgroup_size` are attributes on declarations; the stage calls warn
  for one release, then are refused.
- **Rule 7.6**: an `out<T>` local is declared without `!`.
- **Rule 8.1**: an entry is a function declaration with one stage attribute; both `export` orders;
  `const`, arrow and function-expression entries refused except the stage calls, which warn for one
  release; `export default` warns for one release, then is refused.
- **Rule 8.7**: unchanged except that the `TS8037` message names `@compute([64, 1, 1])`.
- **Rule 8.22**: a kernel's size is the compiler's choice (today's defaults); `@workgroup_size([n])`
  optionally states it for non-reducing loops.
- **Rule 8.25**: its rationale reads the qualifiers as types under Rule 1.8, not under plain `tsc`. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->

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

### Costs of the owner's decisions

Recorded as costs, not as reasons to change the design (`docs/owner-decisions.md`, Precedence):

- **OD-1.** Every entry is TS1206 in a plain `tsc` and in an editor without the TypeShade
  plugin. prettier, typescript-eslint, esbuild, `bun build` and Node's type stripping cannot
  parse the files; the project owes a formatter path, a lint path and loaders (Tooling owed by
  the project). Until then `*.shade.ts` stays unformatted (`.prettierignore`). Template-string
  shaders in typeplot (25) and typeaudio (6) are migrated by hand, and no tool checks them.
- **OD-2.** Downstream migrates twice in about a month (0111 to calls, 0130 back): typeaudio 15
  entries, the site in English and Korean, 101 examples, 77 journeys, the tests. Arrow and
  `const` entries go. The language service needs the projection above and a two-halves rename
  test. Two overload sets stay in the ambient library for one release.
- **OD-3.** A kernel's size is a construct the compiler could choose; it stays as an optional
  override, with the compiler's choice as the default (D1). 0130's refusal step waits on 0131 and
  0132 being implemented.
- **OD-4.** Each decision is shown to the owner with its options and costs before it is taken.

## Owner's decisions

This proposal rests on `OD-1` (a language of its own; tool acceptance is not a criterion), `OD-2`
(stages are `@vertex`, `@fragment` and `@compute`), `OD-3` (the compiler chooses a kernel's size by
default; no construct the compiler can replace is required) and `OD-4` (the decisions below were
shown and taken in the conversation). It reverses no entry.

## Why the compiler cannot do it

- **The stage.** The author states it (`OD-2`). The compiler does not infer it.
- **A compute entry's size.** It is observable: `local_invocation_id`, the extent of workgroup
  memory, barriers and the host's workgroup count depend on it, so the compiler never changes a
  stated size. A bare `@compute` takes Rule 8.7's documented default, 64, which reflection
  reports.
- **A kernel's size.** The compiler can choose it, and does by default (D1). The optional
  `@workgroup_size([n])` lets the author state it; nothing requires it.

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
- **Rule 8.22**: a kernel's size is the compiler's choice by default (today's 64, 256 for a reduction, the group's in a fused group); `@workgroup_size([n])` is an optional override; `TS8077` as today.
- **Rule 8.25**: its rationale stops arguing from a plain `tsc` (Rule 1.8). <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
- **`src/language-service/host.ts`**: `typeshadeCompilerOptions` gains `strictPropertyInitialization: false` (D3).
- **`docs/use-typeshade-surface.md` preamble** (lines 8-24, the summary and the "Shader stage" table, outside any numbered section): shows the attributes.
- **Entries written as a `const`, an arrow function or a function expression**: removed with the call forms (Rule 8.1).
- **Surface sections**: every section that shows an entry (the list is change 0111's, to be
  confirmed by `tshc migrate`'s dry run at acceptance).
- **codes**: `TS8028` warns on, then refuses, the call forms, and stops warning on the stage
  attributes; `TS8037` and the other messages that name the call form name the attribute
  (`builtin-check.ts`, `kernel-loops.ts`, `lower/function.ts`, `class-methods.ts` and its
  `TS8035` message,
  `foreign-names.ts`, `module-const.ts`, `link.ts`, `diagnostic-directive.ts`, `host-face.ts`,
  and the language service's `docs`, `completions`, `navigation` and `semantic-tokens`). No code is
  added or removed.
- **examples**: the 94 `examples/*.shade.ts` files that contain a stage call; 7 more under
  `examples/hosts/` and `examples/passes/` that `scripts/changes.ts` does not track.
- **Also**: `journeys/` (77 files with stage calls, run by the required `user journeys` check);
  `README.md` (`tsconfig.shade.json`: its stage-call text and TS1206 counts change; its
  `strictPropertyInitialization: false` stays, correct under D3); `examples/plain-typescript.test.ts` (it stops being a
  surface criterion: with TS1206 and TS2564 out of its assertion nothing is left, so it is
  replaced by a test that the language service reports no TS1206 or TS2564 on any example).
- **Also**: `AUTHORING.md` (lines 13-17 and 179-182 teach the stage calls); `src/cli/init.ts`
  lines 194-195 (the tsconfig `tshc init` writes; its `strictPropertyInitialization: false` stays); `changes/0111-plain-typescript-entries.md`
  (D5's note and the milestone-5 freeze); the stage-call consumers `src/compiler/ts/semantic.ts`,
  `source-file.ts` and `lower/closures.ts` (`numerics.ts` is left to 0131); `journeys/_harness.mjs`
  (`TSC_DOCUMENTED`, which already tolerates TS1206); `README.md` lines 223-235 (its count of 217
  TS1206 across 72 files). Surface §78 (numerics) is left to 0131.
- **Positions**: an entry's diagnostic span starts at its first decorator
  (`src/compiler/ts/lower/function.ts` line 2880), so any golden with positions moves.

### Draft impact estimate

Known, measured at the baselines named above:

- 94 example files carry a stage call; 0 examples use `workgroup_size(`; 16 lines in 9 test files
  use `workgroup_size([` (none in `journeys/`).
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

- **D1. A kernel's size.** The owner answered, in the question form: "유지하되, 기본적으류는
  컴파일러가 크기를 정하도록" (keep it, but by default let the compiler choose the size). The
  spelling `@workgroup_size([n])` was confirmed by "승인". The attribute is optional; without it
  the compiler chooses (Rule 8.22, as proposed). This resolves the conflict between Rule 1.8, <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
  `OD-3` and `docs/dx.md` principle 6 that the review of `b601699f` raised.
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
2. Proposals 0131 and 0132 are implemented, so no stage call is left with an option.
3. Implement the attributes as the decided form, the narrowed editor filter and projection, and
   split `tshc migrate` (stage calls to attributes; parameter and field decorators to types).
4. Migrate the examples, the tests, `journeys/` and the documents; template strings are edited by
   hand.
5. One release warns on the call forms; the next refuses them.

### Interaction with 0131 and 0132

- 0131 (accepted, merged in #1104) removes `numerics`; 0132 (#1105, head `1ba17624`) removes
  `diagnostic` and refuses a written `@diagnostic(…)` or `{ diagnostic }` at once (`TS8028`, an
  error in both halves) in its one implementing change, with no warning release: the owner changed
  0132's decision 5 to "바로 거부로 변경" on 2026-11-09 after it was found that 0.1.0 was never
  published (no tag, no GitHub release, npm lists only 0.0.0). The order is: (1) 0131 is
  implemented; (2) 0132 lands as one change, deletes `diagnostic-directive.ts`, moves the remaining
  options parser to `stage-call.ts`, and `TS8028` says a stage call takes no options; (3) 0130's
  codemod runs after 0132's `tshc migrate` deletion step. Both are implemented before 0130's
  codemod runs:
  `tshc migrate` cannot place a `{ numerics }` or `{ diagnostic }` option on an attribute.
- A pre-0111 `@diagnostic(…)` decorator, which `src/compiler/ts/decorated-form.ts` lines 113-117
  still reads, follows 0132: refused at once in 0132's implementing change.
- 0132 (#1105) has all its decisions decided (refused at once); it is being revised after the
  follow-up review of its new parts, and its acceptance is pending. If 0132 is not accepted, `diagnostic` is written
  `@diagnostic(…)` on the entry, the pre-0111 form that `src/compiler/ts/decorated-form.ts` lines
  113-117 still reads, and Rule 6.7 keeps it in its list. 0130's codemod runs after 0132's
  `tshc migrate` deletion step, in the same run.
- 0132's decision on the rewrite was taken with "proved exact" read as this proposal's Rule 1.8 <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->
  wording; this revision keeps that wording.

### Independent review record

#### Diff check of revision `5ea5aef2`

Reviewer: a Claude Code agent that did not write this proposal, on 2026-11-09, against
`origin/main` `c8fe704f`. Scope: the merged texts of the amended rules, the owner summary and the
`cfe20e9a` findings marked fixed. Verdict: not ready until K1 and K2 are fixed; then a short
re-check of the changed rule texts is enough. This revision answers each item:

| ID  | Finding                                                                             | Status                                                                                                            |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| K1  | Rule 6.7's fourth sentence (decorated forms refused) survived the replacement.      | fixed: the replacement covers every sentence after the list of names.                                             |
| K2  | Rule 8.1 refused `export default` with no warning release, against proposed rule 5. | fixed: warned for one release, then refused, in the rule, its Enforced by and the summary.                        |
| F1  | Rule 6.6's sentence count was wrong.                                                | fixed: the two replaced sentences are named by their first words.                                                 |
| F2  | Rule 6.6 and proposed rule 3 cited Rule 7.6 for field zero-initialisation.          | fixed: the field is filled by the stage that produces it.                                                         |
| F3  | A plain-`tsc` sentence survived in Rule 7.6.                                        | fixed: the two sentences after the first are replaced; Derives from marks D8 replaced.                            |
| F4  | Rule 8.7 had no new `TS8037` message.                                               | fixed: the message names `@compute([64, 1, 1])`; Rule 8.7 is in the summary.                                      |
| F5  | The 0132 fallback was not in Rule 6.7's text.                                       | fixed: the conditional clause is in the replacement.                                                              |
| F6  | Rule 8.22's Enforced by pinned the call form.                                       | fixed: `stage3.test.ts`; Derives from gains 0067 and 0130 (D1); an entry is refused with Rule 6.7's message (N2). |
| F7  | Rule 2.1's `TS8037` exception had no text.                                          | fixed: added to its Enforced by; placed as a paragraph after item (c) (N3).                                       |
| F8  | Rule 1.7's companion text was a reading note.                                       | fixed: explicit Rationale replacement; Derives from gains 0130; the rule names `@workgroup_size`.                 |
| N1  | `stage-call.test.ts` holds only through the warning release.                        | fixed.                                                                                                            |
| N4  | Rule 8.1's Derives from kept 0111 D1 as current.                                    | fixed.                                                                                                            |
| N5  | The language-service test file is unnamed.                                          | open: owed at implementation.                                                                                     |
| N6  | Extra fourth cells in review tables.                                                | fixed: the comments moved inside the third cell.                                                                  |

**This revision answers the review of `cfe20e9a` below.** That review said that after these
fixes "it is ready for the owner without another full review. A diff check of the rule texts is
enough."

#### Independent review of revision `cfe20e9a`

Reviewer: a Claude Code agent that did not write this revision, run on 2026-11-09 with
`docs/owner-decisions.md` as constraints. Revision reviewed: `cfe20e9a`. Verdict: not yet ready;
fix B1, B2, S1-S8, then a diff check of the rule texts.

| ID    | Finding                                                                                                                                                                                                                                                      | Status                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1    | Rule 1.7 as proposed requires a projection to valid TypeScript, but the editor keeps the attribute and checks it with the compiler's check: no projection exists.                                                                                            | Fixed: Rule 1.7's replacement text names both paths; Rule 1.8's rationale cites it. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->  |
| B2    | The proposed texts of Rules 6.6, 6.7, 7.6, 8.1 and 8.22 only added sentences; surviving sentences (`!` required by plain `tsc`, decorated stages refused, `compute([64,1,1], f)`, the plain-`tsc` rationales, the old messages) would contradict the design. | Fixed: full replacement texts, each naming what it replaces and what stays.                                                                            |
| S1    | D3 said `typeshadeCompilerOptions` sets `strictPropertyInitialization: false`; it sets `strict: true` and no override.                                                                                                                                       | Fixed: stated as owed work; `host.ts` in What it touches; README and `tshc init` already write the option and stay.                                    |
| S2    | Rule 8.22's "compiler's choice" did not name the choice.                                                                                                                                                                                                     | Fixed: 64, 256 for a reduction, the group's size in a fused group; no new heuristic.                                                                   |
| S3    | Editor item 4 kept a guard that blocks the rename test item 1 requires.                                                                                                                                                                                      | Fixed: the guard narrows now to definition on a non-call decorator identifier; a test pins TS 5.6.3 and 6.0.2.                                         |
| S4    | `export default` entries become refused without a plan.                                                                                                                                                                                                      | Fixed: a `TS8028` warning for one release, then refusal (item 5).                                                                                      |
| S5    | No fallback if 0132 is not accepted.                                                                                                                                                                                                                         | Fixed: `@diagnostic(…)` on the entry stays in Rule 6.7's list; the codemod runs after 0132's deletion step.                                            |
| S6    | Stale review baseline.                                                                                                                                                                                                                                       | Fixed: `71887632`; Rule 6.7 written against the text 0131 leaves.                                                                                      |
| S7    | `loop-struct-array` carries `!` and was not listed.                                                                                                                                                                                                          | Fixed: listed; 52 files measured (51 entry I/O or `out<T>`, 1 non-entry class).                                                                        |
| S8    | "Only the author knows" an entry size contradicted the default 64.                                                                                                                                                                                           | Fixed: the compiler never changes a stated size; a bare `@compute` takes the documented default.                                                       |
| Notes | Rule 2.1 wording; `TS8037` for an unknown name; surface preamble; Rule 8.25 rationale; the doubled comment; `names: []`; vscode-typeshade and D3.                                                                                                            | Fixed: each applied; `'8.25'` added to `rules`; the radiance entry keeps one skip marker, now with its true reason (paths in the radiance repository). |

#### Superseded review notice

The review of `b601699f` below was answered by `cfe20e9a`.

#### Independent review of revision `b601699f`

Reviewer: a Claude Code agent that did not write this revision, run by the author on 2026-11-09
under `changes/README.md` (Independent review), with `docs/owner-decisions.md` as constraints.
Revision reviewed: `b601699f`. Verdict: revise before the owner decides.

| ID    | Finding                                                                                                                             | Status                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | Rule 1.8's "declaration → attribute, value → type" contradicts `builtin<>`, `location<>` and `inout<T>` on parameters and fields.   | fixed: the criterion now names a function, its stage or its dispatch (attribute) and a value that flows in or out (type). <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B2    | D1 (keep the kernel size) against Rule 1.8 and `OD-3`; asked only to confirm the spelling.                                          | decided by the owner: optional attribute, the compiler's choice by default (D1). <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->                                          |
| B3    | Removing the attribute from the virtual file breaks rename of an override in `@compute([WG])`; TypeScript answers references there. | fixed: the attribute is kept in the virtual file; the compiler's check reports TS8028/TS8037; a two-halves rename test is required.                                                         |
| S1    | No `Why the compiler cannot do it` section.                                                                                         | fixed, with `Owner's decisions`.                                                                                                                                                            |
| S2    | Parameter and field decorators are warnings, not refusals; the filter must keep hiding their TS1206 while `compile()` warns.        | fixed: The editor, item 3; Rule 6.6 as proposed.                                                                                                                                            |
| S3    | D3 does not cover locals; per-file option wording.                                                                                  | fixed: item 3 and D3 before/after.                                                                                                                                                          |
| S4    | Proposed text of each amended rule missing.                                                                                         | fixed: The other amended rules.                                                                                                                                                             |
| S5    | Both overload sets during the warning release.                                                                                      | fixed: item 6.                                                                                                                                                                              |
| S6    | Order: 0131 and 0132 must be implemented, not accepted.                                                                             | fixed: Migration order and Interaction.                                                                                                                                                     |
| S7    | radiance, typeplot, typeaudio, typecv, vscode-typeshade downstream text.                                                            | fixed: front matter and What it owes downstream.                                                                                                                                            |
| S8    | Scope: AUTHORING.md, `tshc init`, 0111, consumers, harness, README, plain-typescript test.                                          | fixed: What it touches.                                                                                                                                                                     |
| Notes | 16 test lines in 9 files; §78; diagnostic spans; Rule 1.8 vs §1.8; `@compute` folds `@workgroup_size`; author names kept.           | fixed in the text, except the naming of Rule 1.8 inside §1.8, which stays (noted). <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->                                        |
| Costs | The review's costs of OD-1 to OD-4.                                                                                                 | recorded: Costs of the owner's decisions.                                                                                                                                                   |

**Revisions `19ccafee` and `3b20a19c` (stage inference) are superseded.** The owner rejected
tool parseability as a criterion on 2026-11-09 ("타입스크립트 문법을 차용한거지 그대로 쓰는
언어가 아니라니까요… vue, react도 똑같은데"), and inference existed to meet it. Their review
(R-*) is kept below as history.

Status in this revision of the findings on revision `87d87344` (attribute form):

| ID  | Finding (short)                                                               | Status in this revision                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Rule 1.8 called a numerical relaxation compiler work.                         | fixed: "an optimization the compiler can prove exact". <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->                                                                |
| B2  | The entry size against "tuning is compiler work".                             | fixed: an entry's size is author knowledge (the host's workgroup count, `local_invocation_id`, workgroup memory, barriers); a kernel's size is public by `docs/dx.md` principle 6 (D1). |
| B3  | The editor's TS1206 and TS2564 filters follow `usesDecoratedForm`.            | fixed in the text: the filter is narrowed and decoupled (The editor, item 3); implementation owes the two-halves test.                                                                  |
| B4  | D8's `!` exists only for `tsc`.                                               | decided: D3 drops it.                                                                                                                                                                   |
| S1  | prettier, typescript-eslint, esbuild, Bun reject the form.                    | decided: not a criterion (Rule 1.8); listed as owed tooling. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->                                                          |
| S2  | No projection; TypeScript does not check the attribute's argument (Rule 1.7). | fixed in the text: the language service's projection and own check (The editor).                                                                                                        |
| S3  | Rule 2.1 not in scope.                                                        | fixed: item 6; Rule 2.1 in the front matter.                                                                                                                                            |
| S4  | The stage is inferable from the types.                                        | decided: rejected with the inference revisions.                                                                                                                                         |
| S5  | Unnamed conflict with Rule 1.4 and `docs/roadmap.md`.                         | fixed: Rule 1.8's rationale reads both; the criterion "declaration → attribute, value → type" is in the rule text. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->    |
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

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                               | Status                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Rule 1.8 listed "a numerical relaxation" as compiler work; a relaxation changes results, so the compiler cannot apply one by itself (0107, `docs/dx.md`, `docs/compiler-owns-performance.md`).                                                                                                                                                                        | fixed: the parenthesis now says "an optimization it can prove exact". The removal of `numerics` stays a separate proposal. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| B2  | `@compute([8, 8])` is kept while Rule 1.8 calls a tuning parameter compiler work. The size is author knowledge where it is observable (host workgroup count, `local_invocation_id`, workgroup memory, barriers, subgroups); a kernel's size is tuning. Items 2 and 6 and What it touches disagree with D1. `docs/dx.md` principle 6 keeps "a workgroup shape" public. | owner: the criterion and D1. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->                                                                                               |
| B3  | The editor's TS1206 and TS2564 filters both follow `usesDecoratedForm` (`src/language-service/diagnostics.ts`, `src/compiler/ts/decorated-form.ts`): a file with `@vertex` loses TS2564 and the parameter-decorator TS1206.                                                                                                                                           | open: What it touches will require the filter narrowed to a stage attribute on a module function, decoupled from TS2564, with a two-halves test.                                             |
| B4  | 0130 keeps 0111 D8 (`!` on fields and `let q!`), which exists only for plain `tsc`, while Rule 1.8 says plain `tsc` is not a criterion. D3 keeps a plain-`tsc` test.                                                                                                                                                                                                  | owner: a new decision on D8 and on D3. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->                                                                                     |
| S1  | A decorator on a function declaration is a parse error in prettier, `@typescript-eslint/typescript-estree`, esbuild, Bun and Node's type stripping; the costs above named only `tsc` and the editor. This repository's and typecv's `.prettierignore` already exclude decorated shader files.                                                                         | owner: this cost against the language's own syntax (`CLAUDE.md`, principle conflicts).                                                                                                       |
| S2  | No projection of an attribute exists, only a filter; TypeScript does not check a decorator expression on a function declaration, so Rule 1.7 is not met for the stage argument.                                                                                                                                                                                       | owner: a projection in the language service, or an exception to Rule 1.7. The overclaim is fixed.                                                                                            |
| S3  | Item 7 meets Rule 2.1: an attribute name the ambient library does not declare is outside the author-facing set.                                                                                                                                                                                                                                                       | open: add Rule 2.1 and the surface-names test to the scope.                                                                                                                                  |
| S4  | The stage can be inferred from the attribute types in most entries; only a compute entry without a builtin, and the size, are ambiguous.                                                                                                                                                                                                                              | owner: inference with a marker only where the compiler cannot know, or a marker on every entry.                                                                                              |
| S5  | Rule 1.8 conflicts with Rule 1.4 and `docs/roadmap.md` ("ordinary TypeScript first") without naming it, and its "attribute vs type" criterion is only in the rationale.                                                                                                                                                                                               | open: cite both, move the criterion into the rule. <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->                                                                         |
| S6  | Scope misses `journeys/` (77 files), `README.md` `tsconfig.shade.json`, the diagnostic messages that name the call form, `docs/dx.md` and `docs/roadmap.md`.                                                                                                                                                                                                          | open.                                                                                                                                                                                        |
| S7  | No migration order with 0111 milestone 5, the `numerics` and `diagnostic` removals, and a split `tshc migrate`.                                                                                                                                                                                                                                                       | open.                                                                                                                                                                                        |
| S8  | typecv still owes 224 `@builtin` and 10 `@inout` parameter decorators; typeplot writes 44 stage decorators.                                                                                                                                                                                                                                                           | open.                                                                                                                                                                                        |
| N1  | The factual basis is otherwise correct (decorated form compiles with TS8028; 94 + 7 examples).                                                                                                                                                                                                                                                                        | noted.                                                                                                                                                                                       |
| N2  | The §64 claim holds only with the documented setup.                                                                                                                                                                                                                                                                                                                   | fixed.                                                                                                                                                                                       |
| N4  | The request source should record the reversal as a new decision, not as an unintended outcome.                                                                                                                                                                                                                                                                        | open.                                                                                                                                                                                        |
| N5  | The `textureSampleGrad` rewrite of item 9 is unproven when the coordinate is computed inside the branch.                                                                                                                                                                                                                                                              | open: an assumption for the separate proposal.                                                                                                                                               |

#### Independent review of revision `19ccafee`

Reviewer: a Claude Code agent that did not write this revision, run on 2026-11-09. Verdict:
revise before the owner decides. The reviewer re-measured with its own script: 174 entries in 93
example files, 172 inferable. The text overclaims that every entry is inferable.

| ID   | Finding                                                                                                                                                                                                                                                                                                                                                           | Status                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| R-B1 | Counting a struct's fields makes helpers entries: `examples/twin-structs.shade.ts` `shade(o: FsIn): vec4` and four typeplot functions returning `SceneLayer` would become fragment entries. Proposed rule: an entry is a function the module does not call, whose every parameter carries an entry type, and whose types name one stage.                          | fixed: rule 1's three conditions; 0 helpers classified as entries in five corpora                                            |
| R-B2 | A compute entry with no builtin input has no type to infer from: typecv 56 of 254 compute entries, 6 journeys, 3 typeaudio entries (all size 1). Proposed: a stated workgroup size is also the compute stage marker.                                                                                                                                              | decided (owner): rule 3, a size-carrying builtin parameter                                                                   |
| R-B3 | `location`-only inputs with a bare `vec4` output are vertex in `journeys/engine/shadow.shade.ts` and fragment in `capsule-corp-namek-class`; 5 of typeplot's 15 fragments cannot be inferred. Proposed: a bare result follows the stage the inputs name; an entry whose inputs name no stage writes its output's attribute.                                       | decided (owner): rule 2                                                                                                      |
| R-B4 | Rule 2 as written would rewrite 54 of 81 fragments that return a bare `vec4`; the 79/81 count assumes the bare result stays legal.                                                                                                                                                                                                                                | fixed: bare results with fragment inputs stay legal (54 entries untouched)                                                   |
| R-S1 | `this: workgroup_size<…>` makes an unbound host call a TS2684 error; tsc does not check `workgroup_size<0>`, a read of `this`, or a non-literal size; an override gets a second spelling (`typeof WG_SIZE` beside `array<f32, WG_SIZE>`); a `this` parameter only to carry a size is close to what Rule 1.8 forbids. Option C: the size in the builtin's options. | decided (owner): D2, the builtin's options <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds -->                 |
| R-S2 | A beginner's `export function fs(): vec4` becomes a silent helper; the failure appears later at the host.                                                                                                                                                                                                                                                         | fixed: rules 4 and 7                                                                                                         |
| R-S3 | The classifier must be syntactic and shared by `compile()` and the language service (the aliases erase the attribute); four more consumers of `stageCallOf` are missing from the scope.                                                                                                                                                                           | fixed: One classifier; the classifier's consumers in What it touches                                                         |
| R-S4 | Stage-neutral builtins (`subgroup_*`), `frag_depth`/`sample_mask` outputs, fragments with no output, arrow entries, overloads, `export default`, re-exports need a sentence each.                                                                                                                                                                                 | fixed: the stage-neutral builtins, the outputs, Other forms                                                                  |
| R-S5 | Downstream counts: typeaudio 15 stage calls (6 in template strings), typeplot 25 of 44 in template strings that `tshc migrate` cannot rewrite; journeys not measured.                                                                                                                                                                                             | fixed: Why and the downstream entries                                                                                        |
| R-S6 | D1 (remove a kernel's size) conflicts with `docs/dx.md` principle 6 ("a workgroup shape stays public").                                                                                                                                                                                                                                                           | decided (owner): D1 keeps the kernel size; a Rule 1.8 debt <!-- doc-refs: skip — Rule 1.8 is the rule this proposal adds --> |
| R-N2 | The table above overclaims S4 and B3 as resolved.                                                                                                                                                                                                                                                                                                                 | fixed: the table above                                                                                                       |

### Approval and plan record

This record does not yet apply. Acceptance will require: a new independent review of this
revision with its findings answered, the merge of #1094 with `status: accepted`, and the
milestones above.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits with
`Change: 0130`; the emit goldens unchanged for every migrated example; both halves read on the
attributes, the call forms' warning and refusal, and the projection's checks
(`src/language-service/ambient-parity.test.ts` shape); and the document audit of the rules, the
surface document and `reqs/`.

## What it owes downstream

Each repository in `downstream` moves its stage calls to attributes with `tshc migrate` when it
moves its pin past the implementation (template strings by hand), and records 0130 in its
`compiler-changes.md`. typeplot is not in `DOWNSTREAM_REPOS`. It writes the stage decorators today
(5 `@vertex`, 39 `@fragment`) and owes nothing for the stages; it still owes the move of 24
`@builtin` and 25 `@location` parameter decorators to types (change 0111), 25 lines of them in
template strings that `tshc migrate` cannot rewrite.
