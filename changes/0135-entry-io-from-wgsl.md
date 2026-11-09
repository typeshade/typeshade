---
id: '0135'
title: An entry's built-in value takes its type from WGSL, and a user-defined input or output takes its location from the compiler, so an author writes builtin<"vertex_index"> and uv: vec2
status: draft
rules:
  - '6.6'
  - '6.8'
  - '8.2'
surface:
  - 3
  - 7
  - 53
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Rewrite the TS8029 page of src/lib/error-codes.ts (its "neither builtin nor location" case leaves; the compute case stays), the TS8003 entry for a built-in value's type, and the guide and reference pages that say every entry I/O field must carry builtin<…> or location<…>; regenerate the example pages; record 0135 in compiler-changes.md
  - repo: vscode-typeshade
    what: Rewrite the skill's references/language.md (line 420 at db3f417, every IO field carries a location or a builtin) and references/diagnostics.md (the TS8029 row) to the inferred forms, and record 0135 in compiler-changes.md when the pin moves
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0135, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-09, in Korean. The owner asked which parts of the supported surface push onto the author work that the language or the compiler should do, judged against `OD-3`. From an audit of the surface, the owner chose two items of entry I/O for this proposal: the type written in `builtin<"vertex_index", u32>`, and the number written in `location<0, vec2>`. No GitHub issue is recorded.                                                                                                                                                                                                                                                                                       |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rules 6.6, 6.8 and 8.2 and §2.3 (prose, not a rule), `docs/use-typeshade-surface.md` §3, §7 and §53, `reqs/`, `src/compiler/ts/attribute-types.ts`, `src/compiler/ts/builtin-check.ts`, `src/compiler/ts/structs.ts`, `src/compiler/ts/lower/function.ts` (the entry I/O checks and `checkStructBuiltinFields`), `src/compiler/ts/source-file.ts` (the interstage check), `src/core/passes/lint/rules/interstage-io.ts`, `src/language-service/ambient.ts` (the `builtin` type), `src/cli/migrate.ts`, `CHANGELOG.md`, and the examples (edited, none added or removed). The emitted WGSL, the emitted GLSL ES 3.00, `reflect()` and the manifest keep their shapes. No release version is assigned. |
| Review baseline               | `main` at `2cc98b8f` (merge of pull request #1113), 2026-11-09. Every count and every measurement below was made on that commit unless the row says otherwise. Change 0130 is `accepted` and not yet implemented on this commit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Review and revision authority | Pull request #1123 (draft). Git records the revisions of this file. The merge of that pull request with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## What changes

The examples in this proposal are written in the final form of change 0130 (accepted, not yet
implemented on `2cc98b8f`): an entry is `@vertex export function vs(…)`, and a field of an I/O
struct takes no `!`. Only the entry I/O types differ between "before" and "after".

### Item 1: a built-in value takes its type from WGSL

Today a built-in value is written `builtin<N, T>`, and `T` is required. WGSL fixes `T` for every
built-in value but one (`WGSL_BUILTIN_TYPES` in `src/core/sot.ts`: 17 of the 18 names of
`WgslBuiltinName`). The compiler already knows the answer and checks the author against it:
`builtin<"vertex_index", f32>` is `TS8003 Builtin "vertex_index" is "u32"; this declares it "f32".`
(`checkBuiltinType`, `src/compiler/ts/builtin-check.ts`). The IR builder already omits it:
`builtin('vertex_index')` in `src/core/sot.ts` reads the type from the same table.

Proposed:

- `builtin<N>` means the value WGSL defines for `N`, of the type WGSL gives it.
  `vi: builtin<"vertex_index">` is a `u32` to the compiler and to the editor.
- `builtin<N, T>` stays accepted. `T` is checked as today, with the same `TS8003` sentence.
- `clip_distances` is the one name whose type the author chooses (`array<f32, N>`, N from 1 to 8),
  so it keeps its second argument. `builtin<"clip_distances">` is refused with `TS8003`, in a new
  sentence: `Builtin "clip_distances" has no single type: write builtin<"clip_distances", array<f32, N>> with N from 1 to 8.`
- An options argument stays the third argument. A built-in value that takes an option writes its
  type: `builtin<"position", vec4, { invariant: true }>` (decision D1.3).

### Item 2: a user-defined input or output takes its location from the compiler

Today every field of an entry I/O struct, and every user-defined entry parameter, carries
`location<n, T>`; a field without it is `TS8029` (`STRUCT_FIELD_MISSING_ATTR`):
`Struct "VsOut" field "uv" is used as a vertex output but has neither a builtin<…> nor a location<…> type: WGSL requires every entry output struct member to declare one.`

Proposed:

- An entry input or output that carries no `builtin<…>` is a user-defined input or output, and the
  compiler gives it its location. `uv: vec2` in a vertex output struct is a value passed between
  stages.
- Where it stands decides what it is, as WGSL already decides:

  | Where the value stands                                  | What it is             | Its location (decision D2)                                                     |
  | ------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
  | A vertex entry's parameter, or a field of one           | A vertex attribute     | Its index in declaration order: the order Rule 6.8 already packs the buffer in |
  | A vertex entry's result field, a fragment entry's input | A value between stages | One location for each name in the program, chosen by the compiler              |
  | A fragment entry's result, or a field of it             | A render target        | Its index in declaration order (a bare result is location 0, as today)         |
  | A compute entry's parameter or a field of one           | Refused, as today      | none: `TS8029`, `a compute shader reads its work from resources …` (kept)      |

- `location<n, T>` stays accepted. A written `n` is the location. The values the compiler numbers
  take the lowest locations that no written `n` holds, in the order above.
- A value between stages is linked by its name. GLSL ES 3.00 already links a varying by name, and
  the compiler already refuses two names at one location for that reason
  (`interstageMismatches`, `src/core/passes/lint/rules/interstage-io.ts`). The number adds nothing
  that the name does not say.
- `interpolate` and `blend_src` stay options of `location<n, T, O>`. A value that states an option
  writes its location (decision D2.3).
- `reflect()` (`vertex.attributes[].location`, `entries[].io`) and the manifest report each
  location, written or given, in the fields they report today.

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

| Form                                                                               | Today                                                              | After                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `builtin<N>` for every `N` but `clip_distances`                                    | `TS8002` and TypeScript TS2707                                     | accepted, the type WGSL gives `N`                                   |
| `builtin<N, T>` with WGSL's `T`                                                    | accepted                                                           | accepted, unchanged                                                 |
| `builtin<N, T>` with another `T`                                                   | `TS8003`                                                           | `TS8003`, the same sentence                                         |
| `builtin<"clip_distances">`                                                        | `TS8002` and TS2707                                                | `TS8003`, a new sentence naming `array<f32, N>`                     |
| `builtin<"position", vec4, { invariant: true }>`                                   | accepted                                                           | accepted, unchanged (D1.3)                                          |
| an entry I/O struct field with no attribute type, in a vertex or fragment entry    | `TS8029`                                                           | accepted, a user-defined input or output                            |
| a bare vertex entry parameter with no attribute type (`vs(p: vec2)`)               | no front-end word; WGSL that Tint refuses; a GLSL `TS8015` warning | accepted, a vertex attribute                                        |
| a bare fragment entry parameter with no attribute type (`fs(uv: vec2)`)            | as above                                                           | accepted, a value between stages linked by its name                 |
| such a field or parameter of a type that cannot cross (`bool`, a matrix, a struct) | `TS8029`                                                           | `TS8003`, the sentence a `location<n, bool>` has today              |
| such a field or parameter on a compute entry                                       | `TS8029`, "neither … nor …"                                        | `TS8029`, the compute sentence that a `location<…>` there has today |
| `location<n, T>` and `location<n, T, O>`                                           | accepted                                                           | accepted, unchanged; `n` is the location                            |

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
  (Rule 6.6, "Enforced by": `nothing at the front end for a bare parameter`). Measured: `@vertex
export function vs(p: vec2): vec4` compiles to `fn vs(p: vec2<f32>)`, which WGSL refuses, with a
  `TS8015` GLSL warning only. After this proposal the same source is a valid vertex attribute.

### Alternatives

Each item has a decision with options; each option names its cost. No option reverses an entry of
`docs/owner-decisions.md`.

**D1. A built-in value's type.**

- D1.1 (recommended). `T` is optional; a written `T` stays accepted with no warning; the examples,
  the surface document and `tshc migrate` write the short form. Cost: one name has two spellings
  (`builtin<"vertex_index">` and `builtin<"vertex_index", u32>`). Nothing is refused that compiles
  today.
- D1.2. `T` is optional; a written `T` gets a warning that names the short form, and a later
  release refuses it. Cost: about 197 example lines, the downstream repositories' entries and the
  site's pages migrate before that release; a warning message is added (Rule 12.5). Benefit: one
  spelling in the end, which `OD-3` ("가능한 다 없애는게 맞아요") favours.
- D1.3 (sub-decision). Where the options argument goes when `T` is omitted. Recommended: an author
  who writes an option writes `T` (`builtin<"position", vec4, { invariant: true }>`). Cost: one
  example line keeps `vec4`. The alternative, options in the second position
  (`builtin<"position", { invariant: true }>`), needs the editor to tell a type from an options
  object; the same test for `location` failed (D2.3), and it is not proposed.
- D1.0 (no change). Cost: the author keeps copying a table the compiler holds (`OD-3`).

**D2. A user-defined input's or output's location.**

- D2.1 (recommended). The compiler gives every user-defined input and output its location: a
  vertex attribute and a render target by declaration order, a value between stages by name.
  `location<n, T>` stays accepted, and a written `n` holds. Cost: reordering the fields of a vertex
  input struct or a fragment result struct renumbers them. For the vertex input, reordering already
  moves every offset (Rule 6.8, `VertexAttr` in `src/core/reflect.ts`: "Reordering inputs can
  change their offsets"). For the fragment result, it moves which `targets[i]` the runtime pairs
  with each output (`targetsOf`, `src/runtime/program.ts`). A host that builds its own
  `GPUVertexState` or colour attachments must read `reflect()`. The runtime and the compile gate
  already read `a.location` from the layout.
- D2.2. The compiler gives a location only to a value between stages. A vertex attribute and a
  render target keep a required `location<n, T>`, since a host binds each by its number. Cost: the
  author learns two rules by position, and still numbers each field of a fragment result struct
  (about 20 example files write `color: location<0, vec4>` in a `Color` struct). Benefit: a
  host-facing number never moves when the author reorders fields.
- D2.0 (no change). Cost: the author numbers what the compiler counts, and the compiler refuses
  the program when the number and the name disagree (`OD-3`).
- Not proposed: remove `location` entirely. A sampling option (`interpolate: ["perspective",
"centroid"]`), a dual-source pair (`blend_src`) and a render target with a gap (locations 0 and 2)
  would need a new name to carry them, against `OD-3`.
- D2.3 (sub-decision). An option without a number. Recommended: an option is written on
  `location<n, T, O>`, with its number. Measured: a location form without a number,
  `location<T, O>`, cannot be told apart from `location<n, T>` in the editor. In a scratch
  `tsc --strict` check, `type location<A, B = never, C = {}> = A extends number ? B : A` read
  `location<f32, { interpolate: "flat" }>` as the options object, because `f32` is a `number` to
  TypeScript. Cost: an author states a number to state a sampling; 1 example line
  (`examples/id-pick.shade.ts:33`) writes one.

**How the compiler numbers a value between stages (inside D2.1, the compiler's choice).**
One location per name across the program, so every vertex and fragment pair a host can draw links:
a program is one module (surface §68: "The file a compile starts from and every shader file it
imports … are one program"), and the runtime pairs entries of one program by name (`RenderState`,
`src/runtime/program.ts`). The numbers are the compiler's choice and the same for the same source;
`reflect()` reports them. A program whose distinct names exceed the target's inter-stage limit is
refused in one sentence that names the limit. Estimate: no example is near it (the highest written
location in the examples is 1).

### Assumptions

- The runtime and every host of the examples bind vertex attributes and render targets through the
  layout the compiler reports (fact for `src/runtime/program.ts:1673`, `src/runtime/gl-draw.ts:476`
  and `scripts/compile-gate.ts:382`, which read `a.location` or `input.location`). A downstream host
  that hard-codes a `shaderLocation` was not found (0 files in typeaudio, typenn, typecv, typeplot,
  radiance and vscode-typeshade, at the local commits named under "What it owes downstream").
- No example has more than one vertex entry or one fragment entry (measured: 0 of 114). The
  per-name numbering is chosen so that this does not matter.

### Conflicts

None found that this proposal resolves by itself.

- Rule 6.6 derives from WGSL's requirement that "each user-defined input and output must have an
  explicitly specified IO location". The emitted WGSL keeps an explicit location on each one. The
  requirement binds the emitted module, not the TypeShade source (Rule 1.1 lets a rule record the
  difference, and `OD-1`: TypeShade is a language of its own).
- Rule 6.6's rationale, "an implicit stage input hides a dependency", stays true: the input is
  still an explicit parameter or field. Only its number becomes the compiler's.
- Change 0130's Rule 1.8 says that a construct that describes a value flowing in or out is part of <!-- doc-refs: skip — Rule 1.8 is the rule change 0130 adds, not yet on main -->
  its type. A built-in value keeps its `builtin<N>` type. A user-defined value carries no construct
  at all, which the same rule allows ("A construct exists only for what the author must state and
  the compiler cannot know or prove").

## Owner's decisions

- `OD-3` is the entry this proposal rests on. Both items remove what the author writes for the
  compiler: a type the compiler reads from WGSL's table, and a number the compiler can count and
  already checks against a name.
- `OD-1`: TypeShade's source is not WGSL; the emitted WGSL keeps WGSL's explicit attributes, and
  the source needs only what the author must state.
- `OD-2`: not touched. The entries keep `@vertex`, `@fragment` and `@compute([…])` (change 0130).
- `OD-4`: the example above and the options with their costs are shown before the owner decides.

This proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, no rule, no diagnostic code and no
surface form. It makes two type arguments optional (a default for `T` in `builtin<N, T>`, and an
unattributed form of a user-defined input or output). The section's question is answered in
reverse under "Why": the compiler can do both, so the author stops doing them.

The one place where the author still states something is answered here, since the owner decides
D2. A host binds a vertex attribute and a render target by its number (`targets[i]` in
`RenderState`, `shaderLocation` in a `GPUVertexState`). The compiler can choose that number. It
cannot know whether a host outside the runtime has fixed one. D2.1 lets the declaration order fix
it and keeps `location<n, T>` for a host that needs a fixed number; D2.2 keeps it required.

## What it touches

- `rules` 6.6: the sentence "every parameter and every field of an entry I/O struct must carry its
  attribute in its type" becomes "a built-in value carries `builtin<N>`, whose type WGSL gives, or
  `builtin<N, T>`; every other input or output is user-defined, and the compiler gives it its
  location, which `location<n, T>` may state"; the position table above, the numbering of D2 and
  the options sentence (D1.3, D2.3) are added; "Derives from" adds change `0135`; "Enforced by"
  loses the `TS8029` "neither … nor …" item and the "nothing at the front end for a bare
  parameter" item, and gains the parity test (below).
- `rules` 6.8: "its `@location` inputs tightly packed in the order written" adds "and numbered in
  that order unless a `location<n, T>` states the number".
- `rules` 8.2: "a fragment entry returns one `location<0, T>` value, a struct of render targets, or
  nothing" becomes "returns one value at location 0, a struct of render targets, or nothing"; the
  vertex position sentence writes `builtin<"position">`.
- `docs/language-design.md` §2.3 (prose, not a rule): adds that the type is WGSL's and is read from
  the same list.
- `surface` 3: the entry I/O text and its examples, with the short forms.
- `surface` 7: the diagnostics table: the `TS8029` "neither … nor …" row leaves; the
  `clip_distances` sentence of `TS8003` is added.
- `surface` 53: the integer-varying text says that a field with no attribute is a varying too, and
  its examples write the short forms where no option is written.
- `codes`: none added, removed or renumbered. Two sentences change (Rule 12.5): `TS8029` loses its
  "neither … nor …" sentence (the compute sentence stays), and `TS8003` gains the
  `clip_distances` sentence. `TS8002` stops being reached by `builtin<N>`.
- `examples`: none added or removed. The implementation rewrites the I/O types of the examples to
  the short forms (estimate: about 197 lines in about 100 files for item 1, 106 lines in 72 files
  for item 2).
- `exports`: none. `EntryIoField.location` and `VertexAttr.location` keep their types; their doc
  comments say "the location, written or given by the compiler".
- `names`: none.

### Measured facts

Every row was measured on `main` at `2cc98b8f`, on 2026-11-09, with Bun 1.4.4, unless the row
says otherwise. Scratch scripts lived outside the tree.

| Fact or inference | What                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fact              | `builtin<"vertex_index">` today: compiler `TS8002 Type arguments are not supported yet (got "builtin<...>").`; editor TypeScript `2707 Generic type 'builtin' requires between 2 and 3 type arguments.` and the same `TS8002` (`createTypeshadeLanguageService().getDiagnostics`).                                  |
| Fact              | `builtin<"vertex_index", f32>` and `builtin<"vertex_index", i32>`: `TS8003 Builtin "vertex_index" is "u32"; this declares it "f32".` (and `"i32"`) in both halves.                                                                                                                                                  |
| Fact              | A `VsOut` field `uv: vec2` used by a vertex and a fragment entry: two `TS8029` diagnostics, one per use, in both halves.                                                                                                                                                                                            |
| Fact              | Over 114 `examples/**/*.shade.ts`, every compile clean: 172 render entries; every written location equals its index in declaration order (0 of 226 entry I/O lists differ); 67 vertex and fragment pairs share one struct, 2 use a fragment struct that holds a subset (`clip-planes`, `capsule-corp-namek-class`). |
| Fact              | Highest written location in the examples: 1 (4 lines); 107 code lines write `location<0`.                                                                                                                                                                                                                           |
| Fact              | `examples/hello-vsin.shade.ts`: `reflect().vertex` is `{ attributes: [{ name: "position", location: 0, offset: 0 }, { name: "uv", location: 1, offset: 12 }], arrayStride: 20 }`, and `entries[].io` lists each input and output with `location` or `builtin`.                                                      |
| Fact              | GLSL ES 3.00 emit of `hello-vsin`: vertex attributes are `layout(location = N) in`, the varying is `out vec2 uv;` / `in vec2 uv;` with no location, and the colour is `layout(location = 0) out vec4 color;`.                                                                                                       |
| Fact              | A bare fragment result already takes `@location(0)` and a bare `vec4` vertex result `@builtin(position)` (`src/compiler/ts/lower/function.ts`, the entry signature): the compiler gives those attributes today.                                                                                                     |
| Fact              | Editor projection: `type builtin<N, T = (N extends "vertex_index" ? u32 : …), O = {}> = T` accepts `builtin<"vertex_index">` and `builtin<"position", vec4, { invariant: true }>` under `tsc --strict`; `location<T, O>` cannot be told from `location<n, T>` (D2.3).                                               |
| Inference         | After the change, the WGSL and GLSL of every example are byte for byte the same as before, since the numbers the compiler gives equal the written ones in every example (row 4). The implementation proves it with `bun run bake:goldens` changing no golden.                                                       |
| Inference         | `reflect()` and the manifest keep their shapes and values for every example, for the same reason.                                                                                                                                                                                                                   |
| Estimate          | Implementation: the attribute reader and the I/O checks in the front end, the numbering, one ambient type, the parity tests, the migration of the examples and documents. Duration and cost are unknown.                                                                                                            |

### The editor (Rule 12.7)

- Today (fact): the ambient type is `type builtin<N extends …, T, O … = {}> = T`, so a missing `T`
  is TypeScript's TS2707. A field with no attribute type is plain TypeScript, and the editor shows
  the compiler's `TS8029` (the language service merges the compiler's diagnostics).
- After: `builtin`'s `T` takes a default, the type WGSL gives `N`, generated from
  `WGSL_BUILTIN_TYPES` as `WGSL_BUILTIN_NAMES` already is (no new declared name). For
  `clip_distances` the default is `never`, and the compiler's `TS8003` is the one diagnostic.
  Nothing is needed for a field with no attribute: TypeScript accepts it, and the compiler stops
  reporting it.
- Owed tests, both halves on the same source: `builtin<"vertex_index">` accepted with hover `u32`;
  `builtin<"clip_distances">` refused with the one `TS8003`; a `VsOut` with `uv: vec2` accepted
  and emitted as `@location(0)`; a bare `bool` field refused with `TS8003`; rows added to
  `src/language-service/ambient-parity.test.ts`.
- Recommended, not required: hover on a user-defined field shows the location the compiler gave
  it, so the author can see the number the host reads (`OD-4`'s spirit for authors).

### Host-facing reports

- `reflect().vertex`, `reflect().entries[].io`, `packModule()` and the manifest: no shape change.
  The `location` they report is the written or the given one (Rule 6.8 and Rule 11.10 still hold:
  one layout engine reads the IR the front end wrote).
- A host that reads these keeps working. A host that hard-codes a location and lets the compiler
  number a field it reorders binds the wrong slot (D2.1's cost).

### Draft impact estimate

- Known: no source that compiles today is refused. No emit, report or code changes for a program
  that writes every location and every type.
- Known: rules 6.6, 6.8 and 8.2 and surface §3, §7 and §53 are rewritten; `reqs/` follows
  (`bun run reqs:sync`).
- Estimate: the front-end work is local to the attribute reader, the I/O checks and the
  interstage check; the backends and `reflect()` read the IR and do not change. Duration and cost
  are unknown.
- Required validation evidence at implementation (not yet applicable): `bun run bake:goldens`
  with no golden changed after the examples move to the short forms; the parity rows above;
  `examples/emit-reflection-conformance.test.ts` and `src/core/manifest.test.ts` green; the
  compile gate (`bun run gate:compile`) green; a test for each row of "Every form that changes" in
  both halves; `bun run reqs:sync` and `python scripts/doorstop-check.py -C`; `bun run docs:impact`
  and `bun run docs:refs`.
- Decisions to resolve before acceptance: D1 (D1.1 or D1.2), D2 (D2.1 or D2.2), and the questions
  below.

### Open questions for the owner

1. D2: is a render target's index and a vertex attribute's index something the author states, or
   the compiler's? D2.1 (recommended) lets declaration order decide and keeps `location<n, T>` as
   an explicit form. D2.2 keeps the number required for these two positions.
2. D1: a written `T` that WGSL fixes: accepted for good (D1.1, recommended), or warned and later
   refused (D1.2)?

No two principles or rules were found that point different ways on this proposal.

### Independent review record

Not yet performed. Before the owner decides, an agent or a person that did not write this proposal
reviews it against `changes/README.md` (Independent review) and the record is written here.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on D1 and D2, the
independent review record above with each finding answered, and the merge of this file with
`status: accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementing pull requests (each commit
with `Change: 0135`), the delivered configuration and the validation evidence listed under "Draft
impact estimate".

## What it owes downstream

Measured on the local clones on 2026-11-09 (not fetched): typecv `5c3f8ce`, typenn `3a7d66c`,
typeaudio `8bd1ab1`, radiance `3e4efb3`, vscode-typeshade `db3f417`, typeplot `9f20c12` (not in
`DOWNSTREAM_REPOS`), web `990ec50` (`apps/typeshade` is the site, `typeshade.github.io` in
`DOWNSTREAM_REPOS`).

- typeshade.github.io: `src/lib/error-codes.ts` <!-- doc-refs: skip — a path in the site repository --> has entries for `TS8029` and `TS8003` whose text
  changes; its guide and reference pages state the old requirement; the example pages are generated
  from `examples/`. Record 0135 in `compiler-changes.md`.

- vscode-typeshade: in the skill <!-- doc-refs: skip — paths in the editor repository -->
  `plugins/typeshade/skills/typeshade/references/language.md` <!-- doc-refs: skip — a path in the editor repository -->
  (line 420, every IO field carries a location or a builtin, `TS8029`) and
  `references/diagnostics.md` <!-- doc-refs: skip — a path in the editor repository --> (the `TS8029` row). Record 0135 in `compiler-changes.md` when the pin moves.
- radiance, typenn, typecv, typeaudio: nothing owed. No source that compiles today is refused. Each
  may drop the written types and numbers when it moves to change 0130's forms (typeaudio writes 19
  `builtin<…>` lines; the others write the decorated form `@builtin(…)` on a pinned older
  compiler).
- typeplot (not in `DOWNSTREAM_REPOS`): nothing owed, for the same reason.
