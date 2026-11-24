---
id: '0149'
title: A bool and a two-row matrix in a uniform compile, and the compiler lays out their bytes
status: accepted
rules:
  - '4.8'
  - '6.8'
surface:
  - 27
  - 40
  - 51
  - 64
exports: []
exports-removed: []
codes:
  - TS8051
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The pages that quote surface §27, §40 and §51 (en and ko) say that a bool and a two-row matrix in a uniform are refused. Search them for TS8051, "two-row" and "numeric scalars only". Each page follows the new text. compiler-changes.md records 0149
  - repo: vscode-typeshade
    what: The skill and any hover, completion or fixture text that names the TS8051 sentences for a bool or a two-row matrix follow the new text. Replace a fixture that expects those refusals with one of the refusals that remain. compiler-changes.md records 0149
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0149, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                       |
| Date and attribution          | 2026-11-24, UTC (the drafting date). An AI agent (Claude Code) drafted it for issue #1118. The orchestrating session decides each decision below, by the owner's delegation of 2026-11-24. This is attribution, not approval.                      |
| Applicability / Effectivity   | `src/compiler/ts/bindings.ts`, `src/core/reflect.ts`, `src/core/std140.ts`, `src/core/manifest.ts`, `src/core/passes/uniform-layout.ts`, the WGSL and GLSL writers, `src/rhi/cpu.ts` and `src/runtime/resource.ts`. No release is assigned (OD-6). |
| Review baseline               | `main` at `be2e83de6ba5cdaddc2b8f19a74f98061bad78fe`. Every "today" claim below was probed with `compile()` at this commit on 2026-11-24.                                                                                                          |
| Review and revision authority | The pull request that adds this file. Git records revisions. PR review and merge records establish decisions.                                                                                                                                      |

## What changes

An author can write a `bool`, a `vec2b`, a `vec3b`, a `vec4b` and a `mat2x2`, `mat3x2` or `mat4x2`
in a `uniform` binding. This covers a struct field, an array element and the whole binding. The
compiler lays out the bytes. The author states no padding and no carrier type.

Today `compile()` refuses each of them as `TS8051` (probed 2026-11-24 at `be2e83de`):

- `class P { on: bool; x: f32 }` in a `uniform`: `"P.on" is a bool; a uniform struct holds numeric scalars only (WGSL's host-shareable rule). Use u32.`
- `uniform<bool>`, and `class P { v: vec3b }` in a `uniform`: the same refusal, with `Use vec3u.` for the vector.
- `class P { k: f32; m: mat2x2<f32> }`, `uniform<mat2x2<f32>>` and `array<mat2x2<f32>, 2>` in a `uniform`: `"P.m" is in a uniform: mat2x2 in std140 is not supported — …`.

### Example before and after (OD-4)

An author writes this today.

```ts
"use typeshade";

class Style {
  gain: f32;
  enabled: u32; // the author converts: 1 or 0
  rot: mat2x4; // the author widens a mat2x2 to four rows and reads .xy
}
declare const style: uniform<Style>;

@fragment
export function fs(p: vec2): vec4 {
  const q = style.rot * vec4(p, 0., 0.);
  return style.enabled != 0 ? vec4(q.xy * style.gain, 0., 1.) : vec4(0.);
}
```

The author wants to write this, which is refused today with two `TS8051` errors.

```ts
"use typeshade";

class Style {
  gain: f32;
  enabled: bool;
  rot: mat2x2<f32>;
}
declare const style: uniform<Style>;

@fragment
export function fs(p: vec2): vec4 {
  return style.enabled ? vec4(style.rot * p * style.gain, 0., 1.) : vec4(0.);
}
```

After this change the second program compiles. The host passes `{ gain: 2, enabled: true, rot:
[c, s, -s, c] }`, the values Rule 8.21 already names: a `boolean` and a flat column-major tuple.
The host value is the same one a `storage` binding takes for a matrix. Only the bytes under it
differ, and the compiler owns them.

### What each target emits

The compiler lowers on a target as OD-9 allows. The forms below show one equal choice. The
compiler may choose another with the same bytes and the same result.

1. WGSL, `bool`: the uniform holds a `u32` word. A read becomes `(style.enabled != 0u)`. A
   `vecNb` is held as `vecNu` and read as `(v != vecNu(0u))`.
2. WGSL, `matCx2`: the uniform holds `C` columns as `vec4<f32>` (16 bytes each, the std140
   stride). A read of the matrix is `mat2x2<f32>(style.rot[0].xy, style.rot[1].xy)`. A read of
   one column is `style.rot[1].xy`.
3. GLSL ES 3.00: a std140 block lays out a `matCx2` with a 16-byte column stride natively, and
   it holds a `bool` as a 4-byte word. The struct path needs no new form. The bare-uniform path
   of change 0127 (`src/core/backends/glsl-bare-uniforms.ts`) excludes a `bool` and a two-row
   matrix today, so it changes: its block member admits both. If the compile gate
   (`gate:compile`) shows a driver that mishandles a `bool` in a block, the writer lowers it as
   `uint` as the WGSL does. Drivers other than the gate's are not probed.
4. CPU oracle: a program evaluates the host value. A `bool` stays a `bool` and a matrix stays a
   matrix. The CPU path that reads packed bytes (`src/rhi/cpu.ts`) reads the word and the padded
   column through the layout the manifest carries.
5. A whole-value read of a struct that holds one of these fields (a local, an argument, a
   return) rebuilds the author's struct from its lowered fields. A local, a parameter and a
   `storage` binding never see the lowered type. The compiler gives the uniform binding its own
   struct type for this.
6. Pass order. The lowering runs before the 16-byte array padding of §51. An `array<bool, N>`
   becomes `array<u32, N>` and then pads to `array<_Pad16_u32, N>`. An `array<mat2x2<f32>, N>`
   becomes an array of `C` columns of `vec4<f32>` per element, which is already 16 bytes a
   column, so it needs no wrapper.

### What `reflect()` and the manifest report

- A `bool` reports `type: 'bool'`, `size: 4`, `align: 4`. A `vecNb` reports the size and the
  alignment of `vecNu`.
- A `matCx2` in a uniform reports `align: 16` and `size: 16 * C`. Its column stride is 16. A field
  after it moves by the padded size. A `matCx2` in a `storage` binding keeps its stride of 8.
- `layoutOf` in `src/core/manifest.ts` returns `columnStride: 16` for the uniform matrix. A
  `bool` is `{ kind: 'scalar', type: 'u32', bool: true }`, and a `vecNb` is
  `{ kind: 'vector', size: N, type: 'u32', bool: true }`. The optional `bool` marker says that
  the word is a `bool`, which the host packer writes as `1` or `0` (D3). `PACK_SCHEMA` stays 2.
  A reader that does not know the marker decodes the word as `0` or `1`.
- `typeLayout` in `src/core/reflect.ts` no longer throws for a std140 two-row matrix.
  `src/core/std140.ts` and `twoRowStd140Reason` are removed.

### What `TS8051` keeps

`TS8051 LAYOUT` stays as the code for three shapes that the compiler does not lay out yet. Each
sentence now says "not supported yet" (D6).

1. A `bool` or a `vecNb` in a `storage` binding, until stage S2 below (D4).
2. A runtime-sized array that is not the last member of its struct.
3. A runtime-sized array in a `uniform`.

None of the three is a shape that no compilation can give a meaning. Each is open compiler work
(OD-9, OD-10, OD-11). The code, its position and its category do not change.

A struct that holds a two-row matrix and is bound as `uniform<S>` and as `storage<S>` is not
a `TS8051`. The refusal comes from `src/core/passes/uniform-layout.ts` as `TS8015 BACKEND`. It
is compile-only: the language service does not run it. The sentence is reworded "not supported
yet" (D7).

### Stage S2: a `bool` in a `storage` binding

Stage S2 gives a `bool` and a `vecNb` in `storage` the same `u32`-word layout. It follows
stage S1, which is everything above. S2 is part of this proposal and has its own pull request.
The hard part is a write. Each store converts `bool` to a word. A function that writes a field
of a struct parameter, by reference (OD-5), must convert at the store inside the callee. The
WebGL2 tier holds the word in a data texture of 32-bit words (OD-11, Rule 11.8). Until S2
merges, a `bool` in `storage` is `TS8051`, reworded "not supported yet".

## Why

The language already takes the two shapes everywhere else. A `bool` is a local, a parameter and
a return. A `mat2x2` is a `storage` field and a local. Only a uniform refuses them, for a reason
about bytes. The compiler already pads a uniform `array<f32, N>` itself (surface §51), so the
bytes the WGSL declares are the bytes `reflect()` reports. The same method holds for these two
shapes.

Rule 4.8 refuses the matrix "rather than padded", because padding "would make the emitted WGSL
disagree with the offsets `reflect()` reports". The lowering above makes the emit and
`reflect()` agree. The reason for the refusal no longer holds. Proposal 0127 kept the refusals
as its own boundaries. This proposal supersedes those two bullets of 0127 (`Keep these
boundaries`: two-row matrices and boolean uniforms).

The alternative is to leave the refusal and tell the author to write `u32` and `mat2x4`. That
puts the compiler's work on the author. OD-3 says not to.

## Owner's decisions

This proposal rests on four entries of `docs/owner-decisions.md`. It reverses none.

- **OD-3.** The compiler does the work. The author writes the type that says what is meant. No
  author-facing name, form or code is added.
- **OD-9.** The emitted bytes need not look like the source. `bool` becomes a word. A matrix
  becomes columns of `vec4`. A refusal stays only for "not implemented yet".
- **OD-11.** The WebGL2 tier gives the same result. GLSL ES 3.00 std140 needs no new form for the
  matrix and holds a `bool` as a word. No decision cites "WebGL2 has no X".
- **OD-10.** The runtime-sized array refusals that remain read "not supported yet", as OD-10
  says of a form not implemented.

Also checked, and not affected: OD-1 (no syntax changes), OD-2 (the example uses `@fragment`),
OD-4 (the example above), OD-5 (a struct is still a reference; the lowering is hidden), OD-6
(nothing is released, so the schema bump costs no migration), OD-7 and OD-8.

## Decisions

Each decision names the recommended option. The orchestrating session decides, by the owner's
delegation of 2026-11-24. Each option was checked against every entry OD-1 to OD-11.

**D1. A `bool` and a `vecNb` in a uniform are stored as `u32` words and converted at the read.**
Recommended. Checked against OD-9 and OD-11. The alternative keeps the refusal, and the author
writes `u32` and converts. This moves work to the author, which OD-3 names as the wrong
direction. OD-3 allows the choice. It does not require this form.

**D2. A two-row matrix in a uniform is stored as `C` columns of 16 bytes.** Recommended. The
alternative is to give GLSL the WGSL stride of 8 with `std140` rewritten as arrays of `vec2`. It
has no advantage: GLSL already strides 16 and the host writes one byte layout for both targets.
Checked against OD-3, OD-9, OD-11.

**D3. A `bool` in a uniform is `{ kind: 'scalar', type: 'u32', bool: true }` in `PackLayout`, with
no schema bump.** Recommended: option C below. `PACK_SCHEMA` stays 2.

| Option     | Layout of a `bool`                          | Schema | Cost                                                                                                                                                                        |
| ---------- | ------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A (bump)   | `type: 'bool'`                              | 3      | `src/runtime/program.ts` refuses every schema-2 manifest. `readNumber` in `src/rhi/cpu.ts` misdecodes a type it does not know. Every committed manifest and golden changes. |
| C (chosen) | `type: 'u32'` plus an optional `bool: true` | 2      | A new optional field. A schema-2 reader decodes the word as `0` or `1`. The host view reads the marker to write and read a `boolean`.                                       |
| B (none)   | `type: 'u32'`, no marker                    | 2      | The host view cannot tell a `bool` from a `u32` and guesses from the TypeScript type.                                                                                       |

The marker follows `b?: 1` in `src/core/host-entry.ts` (change 0138, Amendment A12). The bump is
rejected for the two costs in the table. Checked against OD-6: nothing is released, but the
runtime and the CPU path read schema 2 today. Rule 11.10 is not changed (it names the layout, not
its fields).

**D4. A `bool` in a `storage` binding gets the same `u32`-word layout, in stage S2. Until S2 it is
`TS8051`, reworded "not supported yet".** Recommended. The compiler can replace the refusal
(OD-3). The WebGL2 tier holds the word in a data texture (OD-11). Until then the sentence says
the form is not implemented (OD-9, OD-10). The hard part is a function that writes a struct
parameter (OD-5), named under stage S2. The orchestrating session decided D4 under the owner's
delegation of 2026-11-24 ("제대로 다시, 저의 의견이 사실 필요 없거든요"). It shows D4 to the owner at
merge. A `matCx2` in `storage` is not touched.

**D5. The host value does not change.** Recommended. Rule 8.21 already gives a `boolean` for a
`bool` and a flat column-major tuple for a matrix. `uniform(Cls)` in `src/runtime/resource.ts`
accepts these fields and no longer throws its "no uniform layout" `TypeError` for them. The
host editor and the runtime agree (Rule 12.7).

**D6. The three remaining `TS8051` sentences say "not supported yet".** Recommended. Checked
against OD-9 (refused only as not implemented, and the sentence says so), OD-10 and OD-11. The
code is kept so that no code is removed or renumbered. The alternative is to remove `TS8051`
and use `TS8015`. It changes a code for no gain.

**D7. One struct bound as `uniform` and as `storage` stays refused when it holds a two-row
matrix.** Recommended. The refusal exists for padded arrays (surface §51). It is `TS8015` from
`src/core/passes/uniform-layout.ts`, and it is compile-only. The new shapes join it, so this
proposal adds no new layout case. The sentence says "not supported yet" (OD-9). Lifting it is
later work.

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, rule form, code or surface form. It
removes refusals. The compiler does the whole work (OD-3). Rules 4.8 and 6.8 change because
their text states the refusal.

## What it touches

- **Rule 4.8.** The third paragraph (a two-row matrix in a uniform is refused) is removed. The
  rationale and the `Enforced by` list follow.
- **Rule 6.8.** The `Enforced by` text drops the two-row matrix and the `bool` from the layout
  checks that are `TS8051`, drops the `bool` clause (`"U.b" is a vec3b; …`) for a uniform, and
  names the new lowering. `reflect()`, the emit and the manifest
  agree byte for byte for these shapes.
- **§27.** A bool vector is host-shareable in a uniform now. The text and the example change.
- **§40.** The section "`matCx2` in a uniform block is refused" is replaced. A `matCx2` in a
  uniform is laid out with a stride of 16.
- **§51.** The table "Four shapes a struct used to hide" keeps two rows and rewords them. The
  text on `bool` and the two-row matrix describes the lowering.
- **§64.** The sentence on a class with no layout (`bool`, a two-row matrix in a uniform) drops
  both. The A12 lines of §64 (a `Buffer` of one `bool`, and the `b` marker of a result
  `Buffer<S>`) are read against the new marker in `PackLayout`, and they stay true.
- **`TS8051`.** The code stays. Its documentation in `docs/language-service-api.md` and
  `src/compiler/ts/codes.ts` and every sentence in `src/compiler/ts/bindings.ts` change.
- **Exports and Rule 11.10.** `PackLayout` is not a line of `src/__api__/surface.md`: the surface
  prints `PackBinding.layout` as `PackLayout`, by name. The bake output is expected not to
  change, so `exports` stays `[]`. The implementation runs `bun run bake:api-surface` to confirm.
  Rule 11.10 names the layout, not its fields, so it stays out of `rules`.
- **Implementation.** `bindings.ts` (`checkHostShareable`), `reflect.ts` (`typeLayout`),
  `std140.ts` (removed), `manifest.ts` (`layoutOf`), `manifest-types.ts` (`PackLayout`
  gains the optional `bool` marker; `PACK_SCHEMA` stays 2), `passes/uniform-layout.ts` (the lowering, WGSL only), the GLSL writer and its
  bare-uniform path (change 0127), `src/rhi/cpu.ts`, `src/runtime/resource.ts` and the host
  packers.

### Test plan (Rule 12.7)

Each test of a form an author can write reads both halves, with `bothTake` or `bothRefuse` of
`src/core/testing/both-halves.ts`.

1. `bothTake` on each accepted source: `bool`, `vec3b`, `mat2x2`, `mat3x2`, `mat4x2`, each as a
   field, as an array element and as a bare `uniform<T>`. `compile()` and the language service
   give no error. `getHover` on `style.enabled` shows `bool`, and on `style.rot` shows
   `mat2x2<f32>`.
2. `bothRefuse` on each remaining `TS8051`: `bool` in `storage` (until S2), a runtime array
   not last, a runtime array in a `uniform`. Both halves give `TS8051` with the same new
   sentence (Rule 12.5). A compile-only test holds the `TS8015` sentence of a struct with a
   two-row matrix bound as `uniform` and `storage`, reworded "not supported yet".
   The language service does not run it.
   `bothTake` also covers a whole-value read of a struct with a lowered field: a local, an
   argument and a return.
3. `reflect()` offsets and sizes for a struct with a `bool` after an `f32` and a `mat2x2` between
   two scalars. The values are written in the test, not computed by it.
4. The emitted WGSL passes Tint, and the GLSL passes WebGL2, both in `gate:compile`. A
   `bool` in a block is the case that is not probed yet (target 3 above).
5. A differential test (`gate:differential` or a render golden) writes `{ enabled: true, rot }`
   through the host view and reads the fields back on WebGPU, WebGL2 and the CPU. The three agree
   (Rule 13.3).
6. `src/core/manifest.test.ts` holds the manifest of an example to `reflect()`. A new example
   would be a surface change, so it is not added. The test uses a source in the test file.
7. These tests change from asserting the refusal to asserting the layout:
   `src/compiler/ts/uniform-layout-matrix.test.ts`, `uniform-layout.test.ts`,
   `bare-uniform-glsl.test.ts`, `type-spelling.test.ts`, `array-length.test.ts`,
   `unsized-array-length.test.ts`, the `0127` cases in `scripts/bare-uniform-cases.ts`, and the
   tests of `src/runtime/resource.ts` for a class with no uniform layout.
8. A WGSL emit test holds the pass order: an `array<bool, N>` emits `_Pad16_u32` and an
   `array<mat2x2<f32>, N>` emits columns of `vec4<f32>` with no wrapper.
9. A `Tint` measurement of each remaining refusal and its valid neighbours is not needed: none
   stands in for a Tint error that this proposal adds (Rule 12.6).

### Draft impact estimate

Known impact: one lowering pass for two shapes, one change to two layout functions, one optional
layout marker (no schema bump), and rewritten text in two rules and four surface sections. The host packers read
the marker. Unknown, not zero: the effort of the GLSL `bool` in a block on every WebGL2
driver, the effort of the whole-value rebuild of a struct with a lowered field, and the count of
downstream pages. No duration or cost is estimated.

Before acceptance the proposal needs: the independent review below, and the `reqs:sync` and
Doorstop work that follows an edit of Rules 4.8 and 6.8.

### Independent review record

Independent review, 2026-11-24, by an agent that did not write the proposal, at c238d9b9 (base
be2e83de). Verdict: revise. No decision reverses OD-1 to OD-11. Findings 1–8 (exports and Pack;
Rule 11.10; the optional-marker option; the both-spaces refusal is TS8015 and compile-only; the
OD-3 overclaim and D4; the GLSL bare-uniform path; surface §64 A12; whole-value reads and the
pass order) are answered in the next revision: 3 decided as option C, with no schema bump; 5
decided as storage bool in stage S2; the rest fixed.

### Approval and plan record

Accepted on 2026-11-24 by the orchestrating session, under the owner's delegation of the same
date ("제대로 다시, 저의 의견이 사실 필요 없거든요"). The accepted revision is the one that sets
`status: accepted`, after the independent review above. Scope: stages S1 and S2 as written. The
session shows D4 to the owner at merge. Responsibilities and milestones are not assigned. No
duration or cost is estimated.

### Configuration and validation record

This record does not yet apply. Delivery will require the checks of the test plan, a document
audit of the sections named above, and a record of each deviation.

## What it owes downstream

- **typeshade.github.io.** Search the pages for `TS8051`, "two-row" and "numeric scalars only".
  The pages that quote §27, §40 and §51 follow the new text, in en and ko. The pin pull request
  records 0149 in `compiler-changes.md`.
- **vscode-typeshade.** The skill, the hover text and any fixture that names the removed
  sentences follow the new text. A fixture that expects the bool or two-row refusal uses a
  remaining refusal. The pin pull request records 0149.
- **radiance, typenn, typecv, typeaudio.** Searched for `TS8051` and "two-row matrix" in the
  local checkouts of typenn and typeaudio on 2026-11-24: no match. radiance and typecv were not
  searched. A workaround that writes `u32` or `mat2x4` there may be retired when the pin moves.
  This is optional, and `downstream` lists no work for them.
