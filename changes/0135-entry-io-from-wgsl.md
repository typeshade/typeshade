---
id: '0135'
title: An entry's built-in value takes its type from WGSL, and a user-defined input or output takes its location from the compiler, so an author writes builtin<"vertex_index"> and uv: vec2
status: accepted
rules:
  - '6.6'
  - '6.8'
  - '8.2'
  - '8.19'
  - '12.1'
surface:
  - 1
  - 3
  - 5
  - 7
  - 8
  - 10
  - 15
  - 16
  - 17
  - 19
  - 20
  - 23
  - 24
  - 25
  - 26
  - 33
  - 42
  - 43
  - 50
  - 53
  - 54
  - 62
  - 63
  - 64
  - 66
  - 67
  - 68
  - 69
  - 70
  - 78
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Rewrite the TS8029 page of src/lib/error-codes.ts (its "neither builtin nor location" case leaves; the compute case stays and gains the bare parameter), the TS8003 and TS8010 entries for the new sentences, and the guide and reference pages that say every entry I/O field must carry builtin<…> or location<…>; regenerate the example pages; record 0135 in compiler-changes.md
  - repo: typeaudio
    what: Only under decision D1.2, run tshc migrate on the 19 lines that write builtin<N, T> with a type WGSL fixes before the release that refuses the written type; nothing under D1.1
  - repo: vscode-typeshade
    what: Rewrite the skill's references/language.md (line 420 at db3f417, every IO field carries a location or a builtin) and references/diagnostics.md (the TS8029 row) to the inferred forms, and record 0135 in compiler-changes.md when the pin moves
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0135, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction, and revised the same day after the independent review and the owner's decision on `OD-5` (both recorded below). The dates are drafting and revision dates. They are not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean. The owner asked which parts of the supported surface push onto the author work that the language or the compiler should do, judged against `OD-3`. From an audit of the surface, the owner chose two items of entry I/O for this proposal: the type written in `builtin<"vertex_index", u32>`, and the number written in `location<0, vec2>`. No GitHub issue is recorded.                                                                                                                                                                                                                                                                                                                                                              |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rules 6.6, 6.8 and 8.2, §2.3 (prose, not a rule) and Appendix B's Rule 6.6 row, `docs/use-typeshade-surface.md` §3, §7 and §53, `reqs/`, `src/compiler/ts/attribute-types.ts`, `src/compiler/ts/builtin-check.ts`, `src/compiler/ts/structs.ts`, `src/compiler/ts/lower/function.ts` (the entry I/O checks and `checkStructBuiltinFields`), `src/compiler/ts/source-file.ts` (the interstage check), `src/core/passes/lint/rules/interstage-io.ts`, `src/language-service/ambient.ts` (the `builtin` type) and the language service's diagnostic merge, `src/cli/migrate.ts`, `CHANGELOG.md`, and the examples (edited, none added or removed). The emitted WGSL, the emitted GLSL ES 3.00, `reflect()` and the manifest keep their shapes. No release version is assigned. |
| Review baseline               | `main` at `583891d2` (merge of pull request #1120, which records `OD-5`), 2026-11-09. The measurements of the compiler were made on `2cc98b8f`, the commit before it; `583891d2` changes no file under `src/compiler/`, `src/core/` or `src/language-service/` that they read (it adds `OD-5` and part 2b of change 0120 in `src/runtime/` and the call layer). The revision after the review re-ran the new measurements on `583891d2`. Change 0130 is `accepted` and not yet implemented.                                                                                                                                                                                                                                                                                                                     |
| Review and revision authority | Pull request #1123 (draft). Git records the revisions of this file. The merge of that pull request with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## What changes

The examples in this proposal are written in the final form of change 0130 (accepted, not yet
implemented): an entry is `@vertex export function vs(…)`, and a field of an I/O struct takes no
`!`. Only the entry I/O types differ between "before" and "after".

### Item 1: a built-in value takes its type from WGSL

Today a built-in value is written `builtin<N, T>`, and `T` is required. WGSL fixes `T` for every
built-in value but one (`WGSL_BUILTIN_TYPES` in `src/core/sot.ts`: 17 of the 18 names of
`WgslBuiltinName`). The compiler already knows the answer and checks the author against it:
`builtin<"vertex_index", f32>` is `TS8003 Builtin "vertex_index" is "u32"; this declares it "f32".`
(`checkBuiltinType`, `src/compiler/ts/builtin-check.ts`). The IR builder already omits it:
`builtin('vertex_index')` in `src/core/sot.ts` reads the type from the same table.

Proposed (decision D1.2, decided by the owner on 2026-11-09, "경고 후 거부"):

- `builtin<N>` means the value WGSL defines for `N`, of the type WGSL gives it.
  `vi: builtin<"vertex_index">` is a `u32` to the compiler and to the editor.
- An option is the second argument: `builtin<"position", { invariant: true }>`.
- `clip_distances` is the one name whose type the author chooses (`array<f32, N>`, N from 1 to 8).
  It keeps its type argument: `builtin<"clip_distances", array<f32, 4>>`. `builtin<"clip_distances">`
  is refused with `TS8003`, in a new sentence:
  `Builtin "clip_distances" has no single type: write builtin<"clip_distances", array<f32, N>> with N from 1 to 8.`
- For every other name, a written type (`builtin<N, T>`, `builtin<N, T, O>`) is a migration form.
  In the release that ships this change it compiles, with a `TS8028` warning that names the short
  form and `tshc migrate`:
  `"vertex_index" has the type WGSL gives it, u32: write builtin<"vertex_index">, or run "tshc migrate".`
  A written type that is not WGSL's stays `TS8003` with today's sentence. The release after it
  refuses a written type, as change 0111 D5 does for its migration forms.

### Item 2: a user-defined input or output takes its location from the compiler

Today every field of an entry I/O struct, and every user-defined entry parameter, carries
`location<n, T>`; a field without it is `TS8029` (`STRUCT_FIELD_MISSING_ATTR`):
`Struct "VsOut" field "uv" is used as a vertex output but has neither a builtin<…> nor a location<…> type: WGSL requires every entry output struct member to declare one.`

The owner decided on 2026-11-09 that `OD-5` allows this item ("Owner's decisions", below):
`uv: vec2` with no `location<…>` is allowed, and `location<n, T>` stays for a fixed number or an
option.

Proposed (decision D2.1, decided by the owner on 2026-11-09, "모두 컴파일러"):

- An entry input or output that carries no `builtin<…>` is a user-defined input or output, and the
  compiler gives it its location, unless `location<n, T>` writes one. A written `n` is always the
  location, as today.
- Where the value stands decides what it is, as WGSL already decides, and how it is numbered:

  | Where the value stands                                                                      | What it is             | Its location when none is written                                                                                                                                                         |
  | ------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | A vertex entry's parameter, or a field of one                                               | A vertex attribute     | The lowest number no written location of that entry holds, in declaration order (the order Rule 6.8 already packs the buffer in)                                                          |
  | A field of a struct that a vertex entry returns                                             | A value between stages | The lowest number no written location of that struct holds, in declaration order. The scope is the struct, so a struct has one set of locations wherever it is used                       |
  | A fragment entry's input (a field of a struct no vertex entry returns, or a bare parameter) | A value between stages | The location the field of the same name has in the vertex results of the program. Refused (`TS8010`, new sentence) when no vertex result has the name, or two give it different locations |
  | A fragment entry's result, or a field of it                                                 | A render target        | The lowest number no written location of that entry holds, in declaration order; a bare result is location 0, as today                                                                    |
  | A compute entry's parameter or a field of one                                               | Refused, as today      | none: `TS8029`, `a compute shader reads its work from resources …`, now also for a bare parameter, which no check reports today                                                           |

- A fragment input that is a field of the same struct the vertex entry returns has that struct's
  locations; this is the common case (67 of 69 pairs in the examples).
- A value between stages is linked by its name. GLSL ES 3.00 already links a varying by name, and
  the compiler already refuses two names at one location for that reason
  (`interstageMismatches`, `src/core/passes/lint/rules/interstage-io.ts`). The number adds nothing
  that the name does not say.
- `interpolate` and `blend_src` stay options of `location<n, T, O>`. A value that states an option
  writes its location (decision D2.3).
- `reflect()` (`vertex.attributes[].location`, `entries[].io`) and the manifest report each
  location, written or given, in the fields they report today.

**The mixed case.** Today these two structs compile together (two entries of each stage):
`interface A { pos: builtin<"position", vec4>; uv: location<0, vec2>; n: location<1, vec3> }` and
`interface B { pos: builtin<"position", vec4>; n: location<0, vec3> }`. Each keeps its written
numbers after this change. If the author drops the number on `A.n`, `A.n` is 1 (the lowest number
no written field of `A` holds), and `B.n` stays 0, as written. If `B` is a fragment input and the
author drops the number on `B.n` too, `B.n` takes the location `n` has in the vertex results; with
`A` the only one, that is 1. A program-wide number per name (decision D2.1b, rejected) would
instead give one number to `n` everywhere, and a written `B.n` at 0 would collide with `A.uv`.

### The example: `examples/hello-vsout.shade.ts`

Before (0130's final form, today's I/O types):

```ts
interface VsOut {
  pos: builtin<"position", vec4>;
  uv: location<0, vec2>;
}

interface Color {
  color: location<0, vec4>;
}

@vertex
export function vs(i: builtin<"vertex_index", u32>): VsOut {
  // … the body is unchanged …
  return { pos: vec4(x, y, 0., 1.), uv: vec2(u, v) };
}

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv.x, v.uv.y, 0.2, 1.) };
}
```

After:

```ts
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}

interface Color {
  color: vec4;
}

@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  // … the body is unchanged …
  return { pos: vec4(x, y, 0., 1.), uv: vec2(u, v) };
}

@fragment
export function fs(v: VsOut): Color {
  return { color: vec4(v.uv.x, v.uv.y, 0.2, 1.) };
}
```

The emitted WGSL is the same in both cases (measured for "before" on `2cc98b8f` with `compile()`;
"after" is an inference, see "Measured facts"):

```wgsl
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut { … }

@fragment
fn fs(v: VsOut) -> Color { … }
```

The emitted GLSL ES 3.00 is the same too: the vertex stage declares `out vec2 uv;` and the
fragment stage `in vec2 uv;` and `layout(location = 0) out vec4 color;`. A varying has no
location in GLSL ES 3.00; the linker matches it by name.

### Every form that changes

"Valid WGSL today" below means that the source compiles and its WGSL passes Tint.

| Form                                                                                             | Today                                                                                                  | After                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `builtin<N>` for every `N` but `clip_distances`                                                  | `TS8002` and TypeScript TS2707                                                                         | accepted, the type WGSL gives `N`                                                                                                               |
| `builtin<N, O>`, an options object second (`builtin<"position", { invariant: true }>`)           | `TS8002 Unsupported type syntax "{ invariant: true }".` and TypeScript TS2741 (measured on `583891d2`) | accepted                                                                                                                                        |
| `builtin<N, T>` or `builtin<N, T, O>` with WGSL's `T`, `N` not `clip_distances`                  | accepted                                                                                               | accepted with a `TS8028` warning in the migration release, refused after it (D1.2)                                                              |
| `builtin<N, T>` with another `T`                                                                 | `TS8003`                                                                                               | `TS8003`, the same sentence                                                                                                                     |
| `builtin<"clip_distances">`                                                                      | `TS8002` and TS2707                                                                                    | `TS8003`, a new sentence naming `array<f32, N>`; the editor shows it alone                                                                      |
| `builtin<"clip_distances", array<f32, N>>`                                                       | accepted                                                                                               | accepted, unchanged                                                                                                                             |
| an entry I/O struct field with no attribute type, in a vertex or fragment entry                  | `TS8029`                                                                                               | accepted, numbered as the table of item 2 says                                                                                                  |
| a bare vertex entry parameter with no attribute type (`vs(p: vec2)`)                             | no front-end word; WGSL that Tint refuses; a GLSL `TS8015` warning                                     | accepted, a vertex attribute                                                                                                                    |
| a bare fragment entry parameter with no attribute type (`fs(uv: vec2)`)                          | as above                                                                                               | accepted when a vertex result has a field `uv`; otherwise `TS8010` (next row)                                                                   |
| a fragment input with no number whose name no vertex result has, or two give different locations | `TS8029` (field) or nothing (bare parameter)                                                           | `TS8010`, new sentence: `"FsIn.n" has no location and the vertex results give "n" none (or 0 in "A" and 1 in "C"): write location<n, T> on it.` |
| such a field or parameter of a type that cannot cross (`bool`, a matrix, a struct)               | `TS8029`                                                                                               | `TS8003`, the sentence a `location<n, bool>` has today                                                                                          |
| such a field on a compute entry                                                                  | `TS8029`, "neither … nor …"                                                                            | `TS8029`, the compute sentence that a `location<…>` there has today                                                                             |
| a bare compute entry parameter with no attribute type (`compute([64], function c(x: u32) {})`)   | no diagnostic; emits `fn c(x: u32)`, which Tint refuses                                                | `TS8029`, the compute sentence                                                                                                                  |
| `location<n, T>` and `location<n, T, O>`                                                         | accepted                                                                                               | accepted, unchanged; `n` is the location                                                                                                        |

No source that compiles to valid WGSL today is refused, under D1.1. Under D1.2 the release after
the migration release refuses a written built-in type that WGSL fixes. The bare compute parameter is
refused at once; today it compiles without a word to WGSL that Tint refuses.

### Exclusions

- This proposal adds no name, no rule and no diagnostic code. `builtin` and `location` are already
  author-facing names (`src/__api__/author-names.md`), and a default for a type argument is not a
  name (Rule 2.1).
- The decorated forms (`@builtin(…)`, `@location(…)` on a parameter or a field) keep what change
  0111 D5 and change 0130 give them. This proposal changes only the type forms.
- The option names, the stage rules of a built-in value (`TS8024`, `TS8025`) and the type rules of
  a value between stages do not change.

## Why

### Problem and evidence

Both items are values the compiler knows and the author must still write.

- Item 1 (fact). For 17 of 18 built-in values the type is a row of `WGSL_BUILTIN_TYPES`. The
  front end reads that row to refuse a different type. The author is required to copy it.
  Measured on `2cc98b8f`: 201 occurrences of `builtin<"…", T>` on 197 code lines of
  `examples/**/*.shade.ts` (114 files). Two name `clip_distances`, one writes an option.
- Item 2 (fact). In all 114 example files, every written location equals the index the order of
  declaration gives it (0, 1, 2 among the fields that are not built-in values): 69 vertex outputs,
  69 fragment inputs, 87 fragment outputs and 1 vertex input, 0 differences (measured with a
  script over `compile()`'s IR, see "Measured facts"). The author numbers what the compiler can
  count.
- Item 2 (fact). The number is checked against the name. A slot whose two sides carry two names is
  refused (`… GLSL ES 3.00 links a varying by name, so the two sides of a slot carry one name.`).
  So the author writes the link twice, once as a name and once as a number, and the compiler
  refuses the program when the two disagree.
- Item 2 (fact). A bare entry parameter with no attribute is not checked at the front end today
  (Rule 6.6, "Enforced by", and its Appendix B row). Measured: `@vertex export function vs(p:
vec2): vec4` compiles to `fn vs(p: vec2<f32>)`, which WGSL refuses, with a `TS8015` GLSL warning
  only; `compute([64], function c(x: u32) {})` compiles to `fn c(x: u32)` with no diagnostic at all.

### Alternatives

Each item had a decision with options; each option names its cost. The owner decided both on
2026-11-09 ("Owner's decisions"). The options not chosen are kept below as rejected alternatives.
No option reverses an entry of `docs/owner-decisions.md`.

**D1. A built-in value's type.**

- D1.2 (decided). `T` is omitted; a written `T` that WGSL fixes is a migration form, warned
  for one release and refused after it; an option moves to the second argument. Cost: about 197
  example lines, typeaudio's 19 lines, the site's pages and every downstream source that writes a
  type migrate before the refusing release (`tshc migrate` rewrites them); one warning sentence is
  added (Rule 12.5). Benefit: one spelling. Two published builds bundle a compiler,
  vscode-typeshade 0.3.0 on the Visual Studio Marketplace (compiler pin `3e1e8420`, 2026-10-27)
  and `@typeshade/mcp` 0.1.0 and 0.1.1 on npm (2026-09-23). Under `OD-6` (the owner, 2026-11-09,
  recorded in pull request #1132, not yet on `main`) they were test builds before any official
  release, so no warning release is owed because of them. The one release of warnings in D1.2 is
  the owner's choice for D1 ("경고 후 거부"), not a debt to those builds. `OD-3` says "A construct that the compiler could
  replace is removed", and the written type is such a construct.
- D1.1 (rejected). `T` is optional, and a written `T` stays accepted for good with no warning. Cost: two
  spellings for one value (`builtin<"vertex_index">` and `builtin<"vertex_index", u32>`), which
  `OD-3`'s "is removed" does not allow for a construct the compiler can replace. Benefit: no
  migration and no refusal of a source that compiles today. The first revision of this proposal
  recommended D1.1; the review (finding 8) showed the tension with `OD-3`, and this revision
  recommended D1.2, which the owner chose.
- D1.3 (inside D1.2). Where an option goes. Under D1.2 the type is gone, so an option is the second
  argument. Measured: the editor can tell an options object from a built-in type in that position.
  In the language service, a scratch alias `K<A> = A extends { readonly invariant?: true } ?
"options" : "type"` gave `"type"` for `vec4`, `u32`, `f32`, `vec3u` and `array<f32, 4>`, and
  `"options"` for `{ invariant: true }`; `bool` gave `"options"`. With `boolean` tested first,
  `K<A> = A extends boolean ? "type" : A extends { readonly invariant?: true } ? "options" : "type"`,
  all seven gave the right answer, `bool` included (measured on this branch merged with `main` at
  `77e19b5a`). The ambient `builtin` type uses that order, so
  `builtin<"front_facing">` and, in the migration release, `builtin<"front_facing", bool>` read as
  a `bool` value and not as options.
- D1.0 (no change, rejected). Cost: the author keeps copying a table the compiler holds (`OD-3`).

**D2. A user-defined input's or output's location.**

- D2.1 (decided). The compiler gives every user-defined input and output its location by the
  table of item 2: per entry for a vertex attribute and a render target, per struct for a vertex
  result, by name from the vertex results for any other fragment input. `location<n, T>` stays
  accepted, and a written `n` holds. Cost: reordering the fields of a vertex input struct or a
  fragment result struct renumbers them. For the vertex input, reordering already moves every
  offset (Rule 6.8, `VertexAttr` in `src/core/reflect.ts`: "Reordering inputs can change their
  offsets"). For the fragment result, it moves which `targets[i]` the runtime pairs with each
  output (`targetsOf`, `src/runtime/program.ts`). A host that builds its own `GPUVertexState` or
  colour attachments must read `reflect()`. The runtime and the compile gate already read
  `a.location` from the layout.
- D2.1b (a variant of D2.1, rejected). One location per name across the program. Cost,
  measured on typeplot `shaders/data.shade.ts` <!-- doc-refs: skip — a path in the typeplot repository --> at `9f20c12`: two vertex
  entries (`surfaceVertex` returns `Surface { uv@0 }`, `textVertex` returns `Letter { local@0,
code@1, size@2 }`) and nine fragment entries, each reading the struct its vertex entry returns.
  Per name, `Letter` would move to 1, 2 and 3, and the program would spend 4 of WebGPU's 16
  inter-stage locations (`maxInterStageShaderVariables`) where each pair needs at most 3. It also
  collides in the mixed case above. Per struct (D2.1), `Letter` keeps 0, 1, 2 and the limit is
  per pair.
- D2.2 (rejected). The compiler gives a location only to a value between stages. A vertex attribute and a
  render target keep a required `location<n, T>`, since a host binds each by its number. Cost: the
  author learns two rules by position, and still numbers each field of a fragment result struct
  (about 20 example files write `color: location<0, vec4>` in a `Color` struct). Benefit: a
  host-facing number never moves when the author reorders fields.
- D2.0 (no change, rejected). Cost: the author numbers what the compiler counts, and the compiler refuses
  the program when the number and the name disagree (`OD-3`).
- Not proposed: remove `location` entirely. A sampling option (`interpolate: ["perspective",
"centroid"]`), a dual-source pair (`blend_src`) and a render target with a gap (locations 0 and 2)
  would need a new name to carry them, against `OD-3`.
- D2.3 (inside D2.1, with it). An option without a number: an option is written on
  `location<n, T, O>`, with its number. Measured: a location form without a number,
  `location<T, O>`, cannot be told apart from `location<n, T>` in the editor. In a scratch
  `tsc --strict` check, `type location<A, B = never, C = {}> = A extends number ? B : A` read
  `location<f32, { interpolate: "flat" }>` as the options object, because `f32` is a `number` to
  TypeScript. Cost: an author states a number to state a sampling; 1 example line
  (`examples/id-pick.shade.ts:33`) writes one.

**What an author learns after D2.1.** Today: write `location<n, T>` on every user-defined value,
and keep the two sides of a link at one number and one name. After: write nothing, and know where a
value stands (a vertex parameter is an attribute, a vertex result field and a fragment input are
values between stages, a fragment result is a render target), which WGSL already decides. An
author who needs a number to stay fixed (a host that binds by hand, a gap between render targets)
or an option writes `location<n, T>`, and must know that the given numbers fill the places no
written one holds, in declaration order. `reflect()` and, if adopted, the editor's hover show every
number. The cost is three placement rules and one numbering rule, against one rule written on every
field today.

### Assumptions

- The runtime and every host of the examples bind vertex attributes and render targets through the
  layout the compiler reports (fact for `src/runtime/program.ts:1673`, `src/runtime/gl-draw.ts:476`
  and `scripts/compile-gate.ts:382`, which read `a.location` or `input.location`). A downstream host
  that hard-codes a `shaderLocation` was not found (0 files in typeaudio, typenn, typecv, typeplot,
  radiance and vscode-typeshade, at the local commits named under "What it owes downstream").
- No example has more than one vertex entry or one fragment entry (measured: 0 of 114). Downstream
  (measured on the local clones named under "What it owes downstream"): typeplot `data.shade.ts`
  (2 vertex, 9 fragment entries, read from the source; it does not compile on `583891d2`, since it
  calls `pow`, which change 0112 removed) and typeplot `scene-composite.shade.ts` (1 vertex, 2
  fragment entries, compiled). In both, every fragment entry reads the struct its vertex entry
  returns, so the per-struct numbering of D2.1 gives the written numbers.

### Conflicts

The points below were checked against the owner's decision on `OD-5` of 2026-11-09 (reading A,
"Owner's decisions"). None stays open.

- Rule 6.6 derives from WGSL's requirement that "each user-defined input and output must have an
  explicitly specified IO location". The emitted WGSL keeps an explicit location on each one. The
  requirement binds the emitted module, not the TypeShade source. Resolved by `OD-1` (TypeShade is
  a language of its own) and by the owner's reading A of `OD-5` (`uv: vec2` with no `location<…>`
  is allowed). Rule 1.1 lets Rule 6.6 record the difference.
- Change 0130 rewrites Rule 6.6's rationale as "An input or an output is a value that flows in or
  out, so its attribute is part of its type (Rule 1.8)." With this change a user-defined value may <!-- doc-refs: skip — Rule 1.8 is the rule change 0130 adds, not yet on main -->
  carry no attribute. Resolved by the owner's reading A: the sentence says where an attribute is
  written, not that one must be written. This proposal's Rule 6.6 text, applied after 0130's,
  reads "so its attribute, when it is written, is part of its type".
- Rule 6.6's other rationale sentence, "an implicit stage input hides a dependency", stays true:
  the input is still an explicit parameter or field. Only its number becomes the compiler's.

## Owner's decisions

- `OD-3` is the entry this proposal rests on. Both items remove what the author writes for the
  compiler: a type the compiler reads from WGSL's table, and a number the compiler can count and
  already checks against a name. D1.2 follows `OD-3`'s "A construct that the compiler could
  replace is removed".
- `OD-5`, and the owner's decision on it. `OD-5` reads: "An entry's built-in values and
  inter-stage values stay in the type: `builtin<…>` and `location<…>`." On 2026-11-09, in the
  Claude Code session, the owner chose reading A ("생략 허용 (A)"): `OD-5` chose the type form over
  the decorated form; `uv: vec2` with no `location<…>` is allowed, and `location<n, T>` stays for a
  fixed number or an option. By the same reading, item 1 is within `OD-5`: `builtin<"position">`
  without its type is still the built-in value written in the type. The question this proposal
  asked (question 3 of the first revision) is closed. The register records the same scope under
  `OD-5` since `11b6d74e` (pull request #1127).
- Decisions on this proposal, by the owner, on 2026-11-09, in the Claude Code session, in Korean:
  - D1: "경고 후 거부" (D1.2). A written type that WGSL fixes gets a `TS8028` warning for one
    release and is refused after it; an option moves to the second argument,
    `builtin<"position", { invariant: true }>`; `builtin<"clip_distances", array<f32, N>>` keeps
    its type. D1.1 and D1.0 are rejected.
  - D2: "모두 컴파일러" (D2.1). The compiler numbers every user-defined input and output, vertex
    attributes and render targets included, per entry and per struct as item 2 says;
    `location<n, T>` stays to fix a number or to carry an option. D2.1b, D2.2 and D2.0 are
    rejected.
- `OD-1`: TypeShade's source is not WGSL; the emitted WGSL keeps WGSL's explicit attributes, and
  the source needs only what the author must state.
- `OD-2`: not touched. The entries keep `@vertex`, `@fragment` and `@compute([…])` (change 0130).
- `OD-4`: the example above and the options with their costs are shown before the owner decides.
- `OD-6` (recorded in pull request #1132, not yet on `main`): nothing is released yet; the bundled
  builds were tests. It is cited where D1.2's migration is discussed.

This proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, no rule, no diagnostic code and no
surface form. It makes two type arguments optional (a default for `T` in `builtin<N, T>`, and an
unattributed form of a user-defined input or output). The section's question is answered in
reverse under "Why": the compiler can do both, so the author stops doing them.

The one place where the author still states something is answered here, since the owner decided
D2 on that question. A host binds a vertex attribute and a render target by its number (`targets[i]` in
`RenderState`, `shaderLocation` in a `GPUVertexState`). The compiler can choose that number. It
cannot know whether a host outside the runtime has fixed one. D2.1 lets the declaration order fix
it and keeps `location<n, T>` for a host that needs a fixed number; the owner chose D2.1 (D2.2,
which kept the number required, is rejected).

## What it touches

- `rules` 6.6: the sentence "every parameter and every field of an entry I/O struct must carry its
  attribute in its type" becomes "a built-in value carries `builtin<N>`, whose type WGSL gives
  (`builtin<"clip_distances", array<f32, N>>` writes its type); every other input or output is
  user-defined, and the compiler gives it its location, which `location<n, T>` may state"; the
  table of item 2, the mixed-case rule and the options sentences (D1.3, D2.3) are added; the
  rationale reads as under "Conflicts"; "Derives from" adds change `0135`; "Enforced by" loses the
  `TS8029` "neither … nor …" item and the "nothing at the front end for a bare parameter" item, and
  gains the parity tests (below).
- `rules` 6.8: "its `@location` inputs tightly packed in the order written" adds "and numbered in
  that order where no `location<n, T>` states the number".
- `rules` 8.2: "a fragment entry returns one `location<0, T>` value, a struct of render targets, or
  nothing" becomes "returns one value at location 0, a struct of render targets, or nothing"; the
  vertex position sentence writes `builtin<"position">`.
- `docs/language-design.md` §2.3 (prose, not a rule): adds that the type is WGSL's and is read from
  the same list.
- `docs/language-design.md` Appendix B, Rule 6.6 row ("an entry parameter with neither `@builtin`
  nor `@location` passes the front end … and a compute-only module gets no diagnostic"): removed,
  since a bare vertex or fragment parameter becomes valid and a bare compute parameter becomes
  `TS8029`.
- `surface` 3: the entry I/O text and its examples, with the short forms.
- `surface` 7: the diagnostics table: the `TS8029` "neither … nor …" row leaves; the bare compute
  parameter, the `clip_distances` sentence of `TS8003`, the `TS8010` sentence and the `TS8028`
  migration warning (D1.2) are added.
- `surface` 53: the integer-varying text says that a field with no attribute is a varying too, and
  its examples write the short forms where no option is written.
- `codes`: none added, removed or renumbered. Sentences change (Rule 12.5): `TS8029` loses its
  "neither … nor …" sentence (the compute sentence stays and covers a bare parameter), `TS8003`
  gains the `clip_distances` sentence, `TS8010` gains the fragment-input sentence, and `TS8028`
  gains the migration warning (D1.2). `TS8002` stops being reached by `builtin<N>`.
- `examples`: none added or removed. The implementation rewrites the I/O types of the examples to
  the short forms (estimate: about 197 lines in about 100 files for item 1, 106 lines in 72 files
  for item 2, about 300 lines in all).
- `exports`: none. `EntryIoField.location` and `VertexAttr.location` keep their types; their doc
  comments say "the location, written or given by the compiler".
- `names`: none.

**Approval of the implementation.** The implementing pull request changes how an author writes
about 300 example lines. Under `CLAUDE.md` (Merging) it is therefore not approved in advance, even
with this proposal accepted: its body shows one example before and after, and it waits for the
owner to say "merge".

### Measured facts

Every row was measured on 2026-11-09 with Bun 1.4.4, on `main` at `2cc98b8f` unless the row says
`583891d2`. Scratch scripts lived outside the tree.

| Fact or inference | What                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fact              | `builtin<"vertex_index">` today: compiler `TS8002 Type arguments are not supported yet (got "builtin<...>").`; editor TypeScript `2707 Generic type 'builtin' requires between 2 and 3 type arguments.` and the same `TS8002` (`createTypeshadeLanguageService().getDiagnostics`).                                                                             |
| Fact              | `builtin<"vertex_index", f32>` and `builtin<"vertex_index", i32>`: `TS8003 Builtin "vertex_index" is "u32"; this declares it "f32".` (and `"i32"`) in both halves.                                                                                                                                                                                             |
| Fact              | A `VsOut` field `uv: vec2` used by a vertex and a fragment entry: two `TS8029` diagnostics, one per use, in both halves.                                                                                                                                                                                                                                       |
| Fact              | Over 114 `examples/**/*.shade.ts`, every compile clean: 172 render entries; every written location equals its index in declaration order (0 of 226 entry I/O lists differ); 67 vertex and fragment pairs share one struct, 2 use a fragment struct that holds a subset (`clip-planes`, `capsule-corp-namek-class`).                                            |
| Fact              | Highest written location in the examples: 1 (4 lines); 107 code lines write `location<0`.                                                                                                                                                                                                                                                                      |
| Fact              | `examples/hello-vsin.shade.ts`: `reflect().vertex` is `{ attributes: [{ name: "position", location: 0, offset: 0 }, { name: "uv", location: 1, offset: 12 }], arrayStride: 20 }`, and `entries[].io` lists each input and output with `location` or `builtin`.                                                                                                 |
| Fact              | GLSL ES 3.00 emit of `hello-vsin`: vertex attributes are `layout(location = N) in`, the varying is `out vec2 uv;` / `in vec2 uv;` with no location, and the colour is `layout(location = 0) out vec4 color;`.                                                                                                                                                  |
| Fact              | A bare fragment result already takes `@location(0)` and a bare `vec4` vertex result `@builtin(position)` (`src/compiler/ts/lower/function.ts`, the entry signature): the compiler gives those attributes today.                                                                                                                                                |
| Fact (`583891d2`) | `compute([64], function c(x: u32) {})`: no diagnostic; the WGSL has `fn c(x: u32) {`.                                                                                                                                                                                                                                                                          |
| Fact              | Editor projection under `tsc --strict`: `type builtin<N, T = (N extends "vertex_index" ? u32 : …), O = {}> = T` accepts `builtin<"vertex_index">` and `builtin<"position", vec4, { invariant: true }>`; `location<T, O>` cannot be told from `location<n, T>` (D2.3).                                                                                          |
| Fact (`583891d2`) | In the language service, `A extends { readonly invariant?: true }` is false for `vec4`, `u32`, `f32`, `vec3u` and `array<f32, 4>`, true for `{ invariant: true }` and true for `bool`; with `boolean` tested first, every one of the seven reads right (measured on this branch merged with `main` at `77e19b5a`) (D1.3).                                      |
| Fact              | A `clip_distances` field with no type, under `tsc --strict`, and a body that writes `o.cd[0] = 1.` and reads `o.cd[1]`: a default of `never` gives `TS2322 Type 'number' is not assignable to type 'never'.` on the write; a default of `unknown` gives `TS18046 'o.cd' is of type 'unknown'.` on both.                                                        |
| Fact (`583891d2`) | Downstream multi-entry modules: typeplot `scene-composite.shade.ts` (1 vertex, 2 fragment entries, compiled) and typeplot `data.shade.ts` (2 vertex, 9 fragment entries, read from source). No other multi-entry render module in typecv, radiance, typeaudio, typenn or web among those that compile (6 of 13, 40 of 42, 5 of 6, 19 of 21, 10 of 10, 1 of 2). |
| Inference         | After the change, the WGSL and GLSL of every example are byte for byte the same as before, since the numbers the compiler gives equal the written ones in every example. The implementation proves it with `bun run bake:goldens` changing no golden.                                                                                                          |
| Inference         | `reflect()` and the manifest keep their shapes and values for every example, for the same reason.                                                                                                                                                                                                                                                              |
| Estimate          | Implementation: the attribute reader and the I/O checks in the front end, the numbering, one ambient type, the language service's merge, the parity tests, `tshc migrate`, the migration of the examples and documents. Duration and cost are unknown.                                                                                                         |

### The editor (Rule 12.7)

- Today (fact): the ambient type is `type builtin<N extends …, T, O … = {}> = T`, so a missing `T`
  is TypeScript's TS2707. A field with no attribute type is plain TypeScript, and the editor shows
  the compiler's `TS8029` (the language service merges the compiler's diagnostics).
- After: `builtin`'s second parameter takes a default, the type WGSL gives `N`, generated from
  `WGSL_BUILTIN_TYPES` as `WGSL_BUILTIN_NAMES` already is (no new declared name). A second argument
  that is an options object (D1.3) gives the same value type. For `clip_distances` with no type the
  default is `never`. TypeScript then reports `TS2322` on each write to the field (measured above);
  the language service drops TypeScript's diagnostics on a field whose `builtin<"clip_distances">`
  the compiler refused, so the compiler's `TS8003` is the one diagnostic (Rule 12.4, as the merge
  already drops TypeScript's reports inside a refused decorator).
- Nothing is needed for a field with no attribute: TypeScript accepts it, and the compiler stops
  reporting it.
- Owed tests, both halves on the same source: `builtin<"vertex_index">` accepted with hover `u32`;
  `builtin<"position", { invariant: true }>` accepted with hover `vec4`; `builtin<"clip_distances">`
  with a body that writes `out.cd[0]` refused with the one `TS8003`; a `VsOut` with `uv: vec2`
  accepted and emitted as `@location(0)`; the mixed case above; a fragment input whose name no
  vertex result has refused with the one `TS8010`; a bare `bool` field refused with `TS8003`; a bare
  compute parameter refused with `TS8029`; the `TS8028` migration warning (D1.2); rows added to
  `src/language-service/ambient-parity.test.ts`.
- Recommended, not required: hover on a user-defined field shows the location the compiler gave
  it, so the author can see the number the host reads.

### Host-facing reports

- `reflect().vertex`, `reflect().entries[].io`, `packModule()` and the manifest: no shape change.
  The `location` they report is the written or the given one (Rule 6.8 and Rule 11.10 still hold:
  one layout engine reads the IR the front end wrote).
- A host that reads these keeps working. A host that hard-codes a location and lets the compiler
  number a field it reorders binds the wrong slot (D2.1's cost).

### Draft impact estimate

- Known: no source that compiles to valid WGSL today is refused under D1.1; under D1.2 a written
  built-in type that WGSL fixes is warned in the migration release and refused in the release after
  it. No emit, report or code changes for a program that writes every location.
- Known: rules 6.6, 6.8 and 8.2, Appendix B's Rule 6.6 row and surface §3, §7 and §53 are
  rewritten; `reqs/` follows (`bun run reqs:sync`).
- Estimate: the front-end work is local to the attribute reader, the I/O checks and the
  interstage check; the backends and `reflect()` read the IR and do not change. Duration and cost
  are unknown.
- Required validation evidence at implementation (not yet applicable): `bun run bake:goldens`
  with no golden changed after the examples move to the short forms; the parity rows above;
  `examples/emit-reflection-conformance.test.ts` and `src/core/manifest.test.ts` green; the
  compile gate (`bun run gate:compile`) green; a test for each row of "Every form that changes" in
  both halves; `bun run reqs:sync` and `python scripts/doorstop-check.py -C`; `bun run docs:impact`
  and `bun run docs:refs`.
- Decisions to resolve before acceptance: none. The owner decided D1 and D2 on 2026-11-09.

### Open questions for the owner

None. Every question was answered by the owner on 2026-11-09: question 3 of the first revision
(`OD-5`, reading A), D1 (D1.2) and D2 (D2.1); "Owner's decisions" records each. No two principles or rules were found that point different ways on this proposal.

### Independent review record

Reviewer: an AI agent (Claude Code) that did not write this proposal, at the direction of the
coordinating session, on 2026-11-09. Revision reviewed: `d819c0a1`, the head of pull request #1123
when the review was made. The coordinating session relayed the findings. The answers below were
written in the revision that follows.

| #   | Finding                                                                                                                                                                                                                                                                                         | Answer                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The text assumed reading A of `OD-5` before the owner was asked.                                                                                                                                                                                                                                | Fixed: the owner chose reading A on 2026-11-09 ("생략 허용 (A)"); item 2 and "Owner's decisions" cite the decision and its date.                                                                                                        |
| 2   | Item 1 (`builtin<"position">` without its type) should be stated against `OD-5` too.                                                                                                                                                                                                            | Fixed: "Owner's decisions" states that by the same reading item 1 is within `OD-5`.                                                                                                                                                     |
| 3   | Two conflicts were resolved by the proposal itself: 0130's rewritten Rule 6.6 rationale ("its attribute is part of its type (Rule 1.8)"), and WGSL's "explicitly specified IO location" binding only the emit. <!-- doc-refs: skip — Rule 1.8 is the rule change 0130 adds, not yet on main --> | Fixed: "Conflicts" records both as resolved by the owner's reading A and `OD-1`, and gives the rationale text that follows 0130's. Neither needs a further question in the author's view; the owner may still ask.                      |
| 4   | The numbering is underspecified when written and given locations mix; with `A { uv@0, n@1 }` and `B { n@0 }`, dropping `A.n`'s number collides under one number per name.                                                                                                                       | Fixed: the table of item 2 sets the scope (per entry, per struct, by name for another fragment input), "The mixed case" works the example, and "Every form that changes" adds the `TS8010` refusal when a name has no single location.  |
| 5   | typeplot `shaders/data.shade.ts` <!-- doc-refs: skip — a path in the typeplot repository --> has two vertex and nine fragment entries; one number per name renumbers `Letter` and spends the 16 inter-stage locations across unlinked pairs. Measure downstream; consider per-pair numbering.   | Fixed: measured (Assumptions, Measured facts); the recommendation is now per struct, which keeps typeplot's numbers and limits a pair to its own struct; one number per name is D2.1b with that cost.                                   |
| 6   | A bare compute parameter gives no diagnostic today and becomes `TS8029`; qualify "no source that compiles today is refused"; list Appendix B's Rule 6.6 row.                                                                                                                                    | Fixed: the row is in "Every form that changes" (measured on `583891d2`); the claim reads "compiles to valid WGSL today"; Appendix B's row is under "What it touches".                                                                   |
| 7   | The implementing pull request changes how authors write about 300 example lines, so it is not approved in advance.                                                                                                                                                                              | Fixed: stated under "What it touches" (Approval of the implementation).                                                                                                                                                                 |
| 8   | D1.1 keeps two spellings against `OD-3` ("a construct the compiler could replace is removed").                                                                                                                                                                                                  | Fixed: the tension is shown, and the recommendation is now D1.2 (warn, then refuse a written type), with options in the second argument (measured feasible in the editor). D1.1 stays as an option with its cost.                       |
| 9   | A default of `never` for `builtin<"clip_distances">` may cascade `TS2322` on writes; consider `unknown`; test a body writing `out.cd[0]`.                                                                                                                                                       | Fixed: measured; `never` cascades on writes and `unknown` on reads and writes. The proposal keeps `never` and has the language service drop TypeScript's diagnostics on that refused field, so `TS8003` stands alone; the test is owed. |
| 10  | The baseline row names `2cc98b8f`, but the branch is on `583891d2`.                                                                                                                                                                                                                             | Fixed: the row names `583891d2` and says which measurements were made on `2cc98b8f` and why they still hold.                                                                                                                            |
| 11  | State the learning cost after D2.1 (the placement rules).                                                                                                                                                                                                                                       | Fixed: "What an author learns after D2.1".                                                                                                                                                                                              |

### Approval and plan record

Accepted. The owner (Seungup) approved acceptance in the Claude Code session on 2026-11-09, in
Korean ("0135 승인"), after the before and after forms, the options and their costs were shown
(OD-4). The approval is recorded by the merge of pull request #1123 with `status: accepted`. The
approved revision is this file as merged; the approved scope is D1.2 and D2.1, as written here. The
implementation follows in its own pull requests, each commit with `Change: 0135`. An implementing
pull request that changes how an author writes an example shows one example before and after and
waits for the owner's "merge" (`CLAUDE.md`, Merging). Duration and cost are not estimated.

### Amendment A1. The owner's decisions on the deviations of pull request #1161 (2026-11-10)

Pull request #1161 (merged into `main` as `dd407504`) delivered items 1 and 2 and recorded three
open deviations. The owner decided each in the Claude Code session on 2026-11-10, after the
options and their costs were shown (`OD-4`).

- [decision, owner, 2026-11-10] "거부 유지", on the agent's recommendation. Deviation 1: a field
  with no location that two places of its struct would give two numbers stays refused with
  `TS8010`, in the delivered sentence: `"S.a" has no location and its uses give it 1 as an input
of "v1" and 0 as an input of "v2": write location<n, T> on it.` The cost is recorded under
  `OD-3`: in this one case the author writes the number. A later change may let the compiler
  number it (one emitted struct for each numbering) without breaking a program that compiles
  today. The options "the first use fixes the numbers" and "one emitted struct for each
  numbering now" are rejected for this change.
- [decision, owner, 2026-11-10] "0135 수정안 후 옮기기", on the agent's recommendation.
  Deviation 2: the documents stop teaching the form that warns. The front matter gains Rules
  8.19 and 12.1 and the surface sections that write `builtin<N, T>` with a type that WGSL fixes
  in an example: §1, §5, §8, §10, §15, §16, §17, §19, §20, §23, §24, §25, §26, §33, §42, §43,
  §50, §54, §62, §63, §64, §66, §67, §68, §70 and §78, and §69, whose sentence says "its
  `location<n, T>` inputs". One pull request, with `Change: 0135`, moves each example to
  `builtin<N>` with `tshc migrate`'s rewrite, and drops a written location where the compiler
  gives the same number and the section does not teach the written form. No rule sentence
  changes: in Rules 8.19 and 12.1 only the examples and the "Enforced by" text that quotes the
  remedy `builtin<"position">` change. Each example compiles to the WGSL and GLSL it compiled to
  before.
- [decision, owner, 2026-11-10] "구현", on the agent's recommendation. Deviation 5: the hover on
  a user-defined input or output shows the location the compiler gave it, in both the written
  and the given case, so the author sees the number the host reads ("The editor (Rule 12.7)",
  the recommended item, is now required). One pull request, with `Change: 0135`, delivers it
  with tests that read the hover beside `reflect()`'s location for the same source.
- Affects: the front matter `rules` (8.19, 12.1) and `surface` (the 27 sections above). No code,
  name, export or example file is added. Items 1 and 2 and decisions D1.2 and D2.1 do not
  change.
- Status: `status: accepted` does not change. When both pull requests are merged, the pull
  request that finishes the work sets `implemented` (`changes/README.md`, lifecycle, step 4);
  the refusal of a written type in the release after the migration release (D1.2) is the work
  of that release.

### Configuration and validation record

The front-matter `status` stays `accepted`: the deviations below that are open wait for the
owner. This record states what pull request #1161 delivers. It was written on 2026-11-10 (UTC) by
the AI agent (Claude Code) that implemented the change, at the direction of the coordinating
session. The merge of pull request #1161 records the delivered commit; this file does not name
the hash of the commit that contains it.

**Delivered configuration.** Branch `claude/clever-ramanujan-yrfjsq-impl-0135`, based on `main`
at `b5ff3963`, with `main` at `2efdff61` merged; the checks below ran again after that merge. Tools: Bun 1.4.4, Node 22.23.4, TypeScript 5.6.3, Vitest 5.0.5, Playwright's
`chromium_headless_shell-1248` on SwiftShader, Doorstop 3.2.

**Delivered, by item of "What it touches".**

- Item 1: `src/compiler/ts/attribute-types.ts` (`attributeArgumentsOf`), `src/compiler/ts/type-map.ts`
  (the type of `builtin<N>` from `WGSL_BUILTIN_TYPES`), `src/compiler/ts/builtin-type-form.ts`
  (the `TS8028` warning, the `TS8003` of `builtin<"clip_distances">`, the one diagnostic of an
  unknown name with no type), `src/language-service/ambient.ts` (the default of `builtin`'s type,
  generated from the same table, and an options object second), `src/language-service/diagnostics.ts`
  (TypeScript's `never` reports on a refused built-in value are dropped), `src/cli/migrate.ts`.
- Item 2: `src/compiler/ts/entry-locations.ts`, called from `src/compiler/ts/source-file.ts` once
  every entry is lowered; `src/compiler/ts/lower/function.ts` (`TS8029` for a compute entry's
  user-defined input, a bare parameter included; the "neither … nor …" sentence is gone).
- Rules 6.6, 6.8 and 8.2, §2.3 and Appendix B's Rule 6.6 row of `docs/language-design.md`; surface
  §3, §7 and §53; `reqs/` (`bun run reqs:sync`; `RULE-0606`, `RULE-0608`, `RULE-0802`, `SURF-003`,
  `SURF-007` and `SURF-053` reviewed, the suspect links of `SURF-003`, `SURF-051` and `SURF-069`
  cleared after reading each section).
- Examples: 100 of the 114 `examples/**/*.shade.ts` files, 301 lines. `tshc migrate` rewrote the
  196 lines of item 1. A scratch script dropped 105 written locations of item 2, one at a time,
  and kept each only where `compile()` and `reflect()` gave the same result. One written location
  stays without an option, `FsIn.uv` in `examples/twin-structs.shade.ts`: `FsIn` is the type of a
  helper's parameter and no entry's, so only the written location puts `@location(0)` in its
  struct. `examples/id-pick.shade.ts` keeps the one location that carries an option.
- `CHANGELOG.md`, `AUTHORING.md`, `docs/language-service-api.md`, `AGENTS.md`, `src/AGENTS.md`.

**Functional validation**, run on 2026-11-10 (UTC) on the delivered configuration; the pull
request's description lists each command with its result.

- Emit identity: `compile()` over every `examples/**/*.shade.ts` before the change (on
  `b5ff3963`) and after it. The WGSL, the GLSL ES 3.00, the diagnostics and `reflect()` of all 114
  files are byte for byte the same. `bun run bake:goldens`, `bun run bake:api-surface` and
  `bun run bake:author-names` change no file.
- Both halves (Rule 12.7): `src/compiler/ts/builtin-type-form.test.ts`,
  `src/compiler/ts/entry-locations.test.ts` and the rows added to
  `src/language-service/ambient-parity.test.ts` read `compile()` (code, text, underlined text,
  emit, `reflect()`) and the language service (`getDiagnostics`, `getHover`) on the same source,
  for each row of "Every form that changes".
- Tint (Rules 12.6 and 13.3): the entry-I/O leg of `scripts/compile-gate.ts` hands Tint the WGSL
  of the three compute inputs that the front end refuses, which Tint refuses with its recorded
  messages, and judges two programs of valid neighbours as examples.
- `bun run build`, the whole `npx vitest run`, `bun run gate:compile`, `bun run gate:boundary`,
  `bun run gate:journeys`, `bun run gate:render`, `bun run gate:differential`.

**Document validation**: `bun run docs:refs`, `bun run docs:impact`, `bun scripts/changes.ts
--base origin/main`, `bun scripts/rule-citation.ts`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C -e -F`.

**Deviations from the approved text.**

| #   | Difference                                                                                                                                                                                                                                                                                                                                                                                                             | Disposition                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | The table of item 2 numbers a vertex attribute by its entry and a vertex result by its struct. It does not say what a struct gets when two places give one field two numbers (one struct as an input of two vertex entries at two offsets). The emitted struct has one set of locations. The implementation refuses the field with `TS8010`, in a sentence this proposal does not give, and asks for `location<n, T>`. | Open: the owner decides whether the refusal and its sentence hold.                    |
| 2   | Surface sections other than §3, §7 and §53, and Rules 8.19 and 12.1, write `builtin<N, T>` in their examples; the remedy of `src/compiler/ts/foreign-names.ts` that Rule 12.1 describes now names `builtin<"position">`. The front matter does not declare them, so they keep the migration form, which compiles with the warning. Surface §69 names a vertex entry's "`location<n, T>` inputs".                       | Open: an amendment that declares the sections lets a later pull request respell them. |
| 3   | The compute sentence of `TS8029` for a value with no attribute says "is a user-defined input", where the sentence for a written location says "is at a location<…>". The value is at no location, so the approved wording would be untrue (Rule 12.5).                                                                                                                                                                 | Closed: the tail of the sentence, which the proposal quotes, is unchanged.            |
| 4   | `tshc migrate` rewrites item 1 only. A written `location<n, T>` stays valid, so the command does not delete one.                                                                                                                                                                                                                                                                                                       | Closed: the examples' locations were dropped by a script and held to emit identity.   |
| 5   | The hover does not show the location the compiler gives a field. The proposal recommends it and does not require it.                                                                                                                                                                                                                                                                                                   | Open: not started. `reflect()` and the emitted WGSL show each number.                 |
| 6   | `src/core/passes/lint/rules/interstage-io.ts` is unchanged. The pass writes the location into the IR before the interstage check reads it.                                                                                                                                                                                                                                                                             | Closed.                                                                               |
| 7   | A field whose `builtin<"clip_distances">` is refused is withheld from its struct. A write and a read of it say nothing more. A `const` declared from a read of it is not declared, so a later use of that `const` is `TS8022`.                                                                                                                                                                                         | Open: the withheld-field recovery predates this change; no issue names it yet.        |
| 8   | `scripts/compile-gate.ts` gains the entry-I/O leg, which "What it touches" does not list. Rules 12.6 and 13.3 require the measurement.                                                                                                                                                                                                                                                                                 | Closed.                                                                               |

**Delivery of amendment A1, the third decision (the hover).** Written on 2026-11-10 (UTC) by
the AI agent (Claude Code) that implemented it, at the direction of the coordinating session.
Its pull request records the delivered commit and each check with its result. This record
closes deviation 5 of the table above.

- Configuration: branch `claude/clever-ramanujan-yrfjsq-0135-hover`, based on `main` at
  `d238dc27`. Tools: Bun 1.4.4, Node 22.23.4, TypeScript 5.6.3, Vitest 5.0.5, Doorstop 3.2.
- Delivered: `src/language-service/hover.ts` (`locationLine`). The hover adds one line under
  the type, where a resource binding has its `@group`/`@binding` line: what the value is, in
  the words of the table of item 2, and its location.

  | Hovered                                                              | The line under the type                                                               |
  | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
  | A field of a struct a vertex entry reads                             | `vertex attribute at @location(n)`                                                    |
  | A field of a struct a vertex entry returns or a fragment entry reads | `value between stages at @location(n)`                                                |
  | A field of a struct a fragment entry returns                         | `render target at @location(n)`                                                       |
  | A field of a struct in two of those places                           | both, joined by "and", as `vertex attribute and value between stages at @location(n)` |
  | A bare parameter of a vertex entry                                   | `vertex attribute at @location(n)`                                                    |
  | A bare parameter of a fragment entry                                 | `value between stages at @location(n)`                                                |
  | The name of a fragment entry with a bare result                      | `returns a render target at @location(0)`                                             |
  | A field that writes a location, in a struct no entry uses            | `user-defined input or output at @location(n)`                                        |
  | A built-in value, a field with no location, a value refused `TS8010` | no line                                                                               |

- The hover computes no number (Rule 12.7). It reads the IR of the language service's cached
  analysis, which `giveEntryLocations` numbered, with `ioAttrOf` and `retIoAttrOf`
  (`src/core/ir/entry-io.ts`), the reader `reflect()` uses. `entryNode` of
  `src/compiler/ts/entry-locations.ts` is exported for it. No public type changes:
  `bun run bake:api-surface` changes no file.
- Documents: surface §3, `docs/language-service-api.md`, `CHANGELOG.md`.
- Functional validation: `src/language-service/entry-location-hover.test.ts`, 15 tests. Each
  reads `compile()` (the diagnostics, the emitted `@location(n)`, `reflect()`) and the language
  service's `getHover` on the same source, and holds the hover's number to `reflect()`'s.
- Deviations from amendment A1:

  | #   | Difference                                                                                                                                                                                                             | Disposition                                                   |
  | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
  | A   | A field of a struct that another document declares shows TypeScript's quick info, as every imported symbol does, so it shows no location line. The hover joins a name to the compiler's facts by its span in one file. | Open: the owner decides whether a later change adds the line. |
  | B   | The line names what the value is ("vertex attribute", "value between stages", "render target") beside the number. Amendment A1 asks for the location only.                                                             | Open: the owner reads the wording on the pull request.        |
  | C   | A fragment entry's bare result has no declared name of its own, so its line shows on the entry's name.                                                                                                                 | Closed: the line says "returns a render target".              |

**Remaining.** The downstream work of "What it owes downstream" is not started. The refusal of a
written type in the release after the migration release (D1.2) is not part of this pull request.

## What it owes downstream

Measured on the local clones on 2026-11-09 (not fetched): typecv `5c3f8ce`, typenn `3a7d66c`,
typeaudio `8bd1ab1`, radiance `3e4efb3`, vscode-typeshade `db3f417`, typeplot `9f20c12` (not in
`DOWNSTREAM_REPOS`), web `990ec50` (`apps/typeshade` is the site, `typeshade.github.io` in
`DOWNSTREAM_REPOS`).

- typeshade.github.io: `src/lib/error-codes.ts` <!-- doc-refs: skip — a path in the site repository --> has entries for `TS8029`, `TS8003`, `TS8010` and
  `TS8028` whose text changes; its guide and reference pages state the old requirement; the example
  pages are generated from `examples/`. Record 0135 in `compiler-changes.md`.
- vscode-typeshade: in the skill <!-- doc-refs: skip — paths in the editor repository -->
  `plugins/typeshade/skills/typeshade/references/language.md` <!-- doc-refs: skip — a path in the editor repository -->
  (line 420, every IO field carries a location or a builtin, `TS8029`) and
  `references/diagnostics.md` <!-- doc-refs: skip — a path in the editor repository --> (the `TS8029` row). Record 0135 in `compiler-changes.md` when the pin moves.
- radiance, typenn, typecv, typeaudio: under D1.2, each source that writes `builtin<N, T>` with a
  type WGSL fixes migrates before the refusing release (`tshc migrate`); typeaudio writes 19 such
  lines, and the others write the decorated form `@builtin(…)` on a pinned older compiler, which
  change 0130's migration already rewrites. Under D1.1 nothing is owed. Nothing is owed for item 2.
- typeplot (not in `DOWNSTREAM_REPOS`): the same as above; its two multi-entry modules keep their
  numbers under D2.1 (Assumptions).
