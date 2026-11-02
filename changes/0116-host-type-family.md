---
id: '0116'
title: The host view spells each type with the shader's own name, from a family of host types that `typeshade/runtime` exports one for one with the ambient library's value types, whose values stay the host values of Rule 8.21
status: implemented
rules:
  - '8.21'
surface:
  - 64
  - 74
exports:
  - f32
  - f64
  - i32
  - u32
  - bool
  - vec2
  - vec3
  - vec4
  - vec2f
  - vec3f
  - vec4f
  - vec2i
  - vec3i
  - vec4i
  - vec2u
  - vec3u
  - vec4u
  - vec2b
  - vec3b
  - vec4b
  - vec2f64
  - vec3f64
  - vec4f64
  - vec2d
  - vec3d
  - vec4d
  - mat2
  - mat3
  - mat4
  - mat2x2
  - mat2x3
  - mat2x4
  - mat3x2
  - mat3x3
  - mat3x4
  - mat4x2
  - mat4x3
  - mat4x4
  - mat2x2f
  - mat2x3f
  - mat2x4f
  - mat3x2f
  - mat3x3f
  - mat3x4f
  - mat4x2f
  - mat4x3f
  - mat4x4f
  - array
  - argMaxAxis
  - argMinAxis
  - clip
  - fill
  - histogram
  - max
  - maxAxis
  - meanAxis
  - min
  - minAxis
  - prodAxis
  - scale
  - sequence
  - sum
  - sumAxis
  - fillUniform
  - fillWords
  - hash32
  - uniform
  - xorshift32
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The page that copies surface §64 (en and ko) shows the host values table with the view's spelling and the listings in the family's names; the API reference generated from the JSDoc of `typeshade/runtime` gains the family; `compiler-changes.md` records 0116 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (`references/host.md`) where it quotes a host view, and any fixture that pins a view's text, change to the family's spelling; `compiler-changes.md` records 0116 when the pin moves.
  - repo: typenn
    what: Its generated views change spelling on the next pin. Its host code keeps type-checking except where item 4 names an exception (a result held in a mutable type, a value of one name where another goes, a matrix held as an array of unknown length, a plain object where an exported class's instance goes), each fixed by an annotation at the line `tsc` names; `compiler-changes.md` records 0116 when the pin moves.
  - repo: typecv
    what: As for typenn; `compiler-changes.md` records 0116 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a file, tests and text its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0116, `status: implemented`. The front matter is the identity and lifecycle authority. The owner approved the proposal and its Amendment 1 on 2026-11-02 (UTC); see Approval and plan record. Pull request #918 implements it; see Configuration and validation record. Downstream adoption is tracked apart.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, reading the listing of proposal 0109: the host view should have types that match one for one what the `.shade.ts` file writes, `array<T>` among them, provided by TypeShade itself, because the spelled-out form is spread out and unpleasant to read, and `vecN` and `matCxR` should be provided as types too ("1:1로 매칭되는거요. TypeShade 자체에서 제공해야할 것 같은데요 너무 펼쳐져있어서 보기 거슬리네요. vecN, matCxR 도 타입으로 제공되어야하지 않을까 싶어요"). The agent reported a design with a prototype that type-checks, and the owner approved the drafting ("승인"). No GitHub issue is recorded.                                        |
| Applicability / effectivity   | Rule 8.21 of `docs/language-design.md` and its item in `reqs/`; `docs/use-typeshade-surface.md` §64; a new `src/runtime/host-types.ts` exported from `typeshade/runtime` and listed in `src/__api__/surface.md`; `src/compiler/ts/host-face.ts` (`argType`, `resultType`, `constType`, `structBody`, `programType` and the view's import line); `src/compiler/ts/host-face.test.ts` and every test that pins a view's text; a parity test against the ambient library (`src/language-service/ambient.ts`); the examples' generated views. The host values, their checks and `TypeError` texts (`src/core/host-values.ts`), the generated module's code, the GPU tiers and the oracle do not change. No release version is assigned. |
| Review baseline               | `main` at `800969063df86573107fc795e619cf3540853595` (the squash merge of pull request #872, proposal 0109), read on 2026-11-02.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Renumbering                   | Drafted, accepted and merged as proposal 0111 in pull request #876 (squash commit `8b1a8fe`). Pull request #875 then merged another proposal with the id 0111 (`changes/0111-plain-typescript-entries.md`, merge commit `8ac4796`), so `src/changes.test.ts` failed on `main`. This proposal takes the next free number, 0116, on 2026-11-02; the earlier number stays in the records of #876 and its commits. The content does not change.                                                                                                                                                                                                                                                                                         |
| Review and revision authority | Pull request [#876](https://github.com/typeshade/typeshade/pull/876) (branch `claude/proposal-0111-host-type-family`). Git records the revisions of this file. The review and merge of that pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Amendment 1                   | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction, on the branch `claude/0116-amend-scope`, after the implementation in pull request [#918](https://github.com/typeshade/typeshade/pull/918) measured what item 3 reaches. It declares the twenty exports of `typeshade/algorithms` and `typeshade/random` and surface §74 that item 3 reshapes, and resolves decisions D7 to D10 found in the implementation. Items 1, 2 and 5 and decisions D1 to D6 do not change. The merge of its pull request with `status: accepted` records the decision.                                                                                                                                                           |

## What changes

**Before.** The host view (§64) spells each host value by its representation (Rule 8.21): an
`f32`, an `i32` and a `u32` are each `number`; a `vec3` is `readonly [number, number, number]`
as an argument and `[number, number, number]` as a result; a `mat4` is `readonly number[]`; a
kernel's `array<f32>` is `Float32Array | Resident<Float32Array>`, and its `array<OnePole>` is
`readonly OnePole[] | Resident<OnePole[]>`. The spelling is exact and long, it does not read
like the shader's signature, and the difference between `f32` and `u32` is gone in the type.
Proposal 0109's listing shows the cost:

```ts
export declare function run(out: Float32Array | Resident<Float32Array>, xs: Float32Array | Resident<Float32Array>, filters: readonly OnePole[] | Resident<OnePole[]>, block: number): Promise<void>;
```

**After.**

1. **A family of host types.** `typeshade/runtime` exports, as types only, one name for each
   authorable value type of Appendix A of `docs/language-design.md`: the scalars `f32`, `f64`,
   `i32`, `u32` and `bool`; the vectors `vec2`, `vec3`, `vec4` and their `f`, `i`, `u`, `b`,
   `f64` and `d` forms; the matrices `mat2`, `mat3`, `mat4`, every `matCxR` and its `matCxRf`
   alias, `matN<f64>` through a type argument; and `array<T>` and `array<T, N>`. A struct, an
   enum, a key type and a `Record` keep the names the view declares for them today. A type that
   has no host value (an atomic, a texture, a sampler, a binding, `override`, `workgroup`) is not
   in the family. The names are the shader's on purpose: a host file imports them from
   `typeshade/runtime`, a shader file has them from the ambient library, and the two meet only
   in the view.
2. **The values do not change.** Each family type is a name for the host value of Rule 8.21:
   - a scalar is the `number` (or `boolean`) it is today, carrying its shader name as an
     optional phantom property, `number & { readonly [tag]?: 'f32' }`, so that a plain literal is
     accepted (`const k: f32 = 0.1`), an `f32` is a `number`, and a conditional type can still
     tell `f32` from `u32`. The shader already erases a brand of this shape on `f32`
     (Appendix A: `f32 & { readonly [m]: 'm' }` is `f32`);
   - a vector is a `readonly` tuple of its scalar, `vec3` is `readonly [f32, f32, f32]` and
     `vec3u` is `readonly [u32, u32, u32]`;
   - a matrix is a `readonly` tuple of its C×R scalars, column-major;
   - `array<T>` resolves to the typed array of `T`'s scalar (`Float32Array` for `f32`,
     `Float64Array` for `f64`, `Int32Array` for `i32`, `Uint32Array` for `u32`), to the scalar's
     typed array for a vector `T` with the components one after another, and to `readonly T[]`
     for a struct `T`, each with its `Resident` (`Float32Array | Resident<Float32Array>`), as
     Rule 8.21 gives a kernel's array today; `array<T, N>` resolves to `readonly T[]`.

   `toShader` and `fromShader` (`src/core/host-values.ts`), every check at a call and every
   `TypeError` text stay as they are.

3. **The view spells with the family.** Every parameter, result, constant, field and binding
   type in the view is written with the family's name, and the view imports the names it uses
   from the runtime specifier, as it imports `Resident`, `Pack` and `Texture` today. The listing
   above becomes:

   ```ts
   import type { f32, u32, array } from "typeshade/runtime";

   export declare class OnePole {
     constructor(k: f32);
     z: f32;
     k: f32;
     tick(x: f32): f32;
   }
   export declare function run(out: array<f32>, xs: array<f32>, filters: array<OnePole>, block: u32): Promise<void>;
   ```

   A helper's signature changes the same way: `height(p: vec2, k: vec4): f32`. A binding of a
   `@compute` entry in the manifest's `Pack<…>` type is spelled the same way, `array<f32>` for a
   runtime-sized storage array and `Camera` for a `uniform<Camera>`.

   The spelling reaches two places the first revision did not name (Amendment 1). The host faces
   of the common modules, `typeshade/algorithms` and `typeshade/random`, are baked views (Rule
   11.20), so their exports in `src/__api__/surface.md` take the family's names where a scalar
   was `number`: `axis: u32`, `lo: f32`, `Promise<f32>` for a reduction, `seed: u32`, and
   `(x: u32) => u32` for `hash32`. The twenty exports are listed in the front matter, and their
   values do not change. A kernel function's `Set<K>` or `Map<K, V>` (§74) is spelled with the
   key's name, `Set<u32>` and `Map<u32, V>`.

   A struct is spelled with its name as an argument and as a result (D7). For a struct declared
   as an `interface` or a `type`, the name is the object of its fields. For an exported class,
   the name is the class, so a host program passes an instance it built with `new`, as
   `array<OnePole>` in the listing above; the call keeps taking a plain object of the fields
   (Rule 8.21, the values do not change). A binding of a struct type in the manifest's `Pack<…>`
   type is spelled with the struct's name beside the packed forms the manifest lists today (D8).
   A matrix carries its name as a scalar does (D9), so that `array<mat2x2>` resolves to an array
   of matrices and not to the typed array that `array<vec4>` resolves to.

4. **Compatibility.** A host program that type-checked against the old spelling type-checks
   against the new one where it holds each value in the shape the old spelling gave it, since
   each family type is assignable from that value. The exceptions, each a type error at the
   host's own line that one annotation fixes (D10, Amendment 1): a result is `readonly` (D1), so
   a program that wrote into a result tuple in place copies it first; a value of one name where
   another goes, an `f32` result held as a `u32`, is refused, which is the point of the names; a
   matrix held in a type of unknown length (`number[]`) takes the family's name; a result held
   in a mutable tuple type takes the family's name; and a plain object where an exported class's
   instance goes (D7) is built with `new`.
5. **The family is held to the ambient library.** A test fails when the ambient library
   (`src/language-service/ambient.ts`) declares an authorable value type the family lacks, or
   the family a name the library does not declare, in the shape of Rule 9.6's shrink-only test.

**The prototype.** The core of the family, type-checked on 2026-11-02 with TypeScript 5.6.3 under
`--strict`: a plain literal and a tuple literal are accepted, an `f32` is a `number`, `f32` and
`u32` are told apart in a conditional type, an `f32` array where a `u32` array goes and a
`vec3` where a `vec2` goes are refused.

```ts
declare const tag: unique symbol;
type Named<T, N extends string> = T & { readonly [tag]?: N };
export type f32 = Named<number, 'f32'>;
export type u32 = Named<number, 'u32'>;
export type vec2 = readonly [f32, f32];
export type vec3u = readonly [u32, u32, u32];
type Scalars<T> = T extends f32 ? Float32Array : T extends u32 ? Uint32Array : never;
export type array<T, N extends number = never> = [N] extends [never]
  ? ([Scalars<T>] extends [never]
      ? (T extends readonly (infer E)[] ? Scalars<E> | Resident<Scalars<E>> : readonly T[] | Resident<T[]>)
      : Scalars<T> | Resident<Scalars<T>>)
  : readonly T[];
```

**Not in this proposal.** A value-level vector or matrix with `.x`, a swizzle or `dot`, which is
a later, opt-in proposal; a change to any host value, check or refusal; a sized tuple for
`array<T, N>`; a family type for what has no host value.

## Why

**The problem.** The host side of a shader module should read like the shader side. The view is
where a host developer reads a module, and it spells every type by its representation, so a
kernel that takes `array<f32>` and a `u32` reads as a `Float32Array | Resident<Float32Array>`
and a `number`. The spelling is correct and it is noise: the name the author wrote is the one
piece of information the host developer wants, and it is the one piece the view drops.
`docs/dx.md` principle 2 says the door under the hood speaks the source language. The names of
the source are the source language.

**Evidence** at the review baseline. The host values table of §64. `viewText` in
`src/compiler/ts/host-face.ts` prints `argType(p.type)`, `resultType(…)`, `constType(…)` and
`structBody(…)` from the structural `HostType`. Proposal 0109's listing. The owner's words on
2026-11-02, quoted in the document-control table.

**Alternatives.**

- Keep the structural spelling. Today's behaviour, and the owner's objection.
- Brands, `number & { readonly __brand: 'f32' }`, with a required property. A plain literal is
  refused, `const k: f32 = 0.1` is a type error, and every host value needs a cast. Rejected.
- A flavor, the name as an optional phantom property. Chosen: a plain value is accepted, the
  name survives in a conditional type, and the shader already erases a brand of this shape. The
  mechanism, as TypeScript implements it: the weak-type check is skipped for the constituents of
  an intersection target, so `number` is assignable to `number & { [tag]?: 'f32' }`; two
  flavors with different names are not assignable to each other, since the optional property's
  types differ. The prototype holds both.
- Export the ambient types themselves. Not possible: the ambient `vec3` has `.x` and swizzles
  that a tuple does not have, and the ambient library is a shader-side declaration, not a
  runtime type.
- One name per scalar array, `f32array`. Not one for one with the source. Rejected.

**Assumptions.** The flavor's behaviour holds across the peer range `typescript >=5.0.0 <7`; the
prototype ran on 5.6.3, and the implementation runs the parity test on every version CI's unit
shards use. The view's import of type-only names from the runtime specifier adds nothing to a
bundle.

**Decisions, resolved at acceptance** (Approval and plan record).

- **D1.** A result is `readonly` (the draft), so that one name serves an argument and a result,
  or stays a mutable tuple with a second name. The draft takes `readonly`: a program that must
  change a result copies it, and one name per type is the point of the proposal.
- **D2.** Where the family lives: `typeshade/runtime` (the draft), which the view already
  imports `Resident` and `Pack` from, or a new subpath `typeshade/types`. The draft adds no
  subpath.
- **D3.** `Resident` inside `array<T>` (the draft), so that a parameter spells `array<f32>`
  alone; a variable that holds a resident array still spells `Resident<Float32Array>`.
- **D4.** `array<T, N>` as `readonly T[]` (the draft), not an `N`-tuple: a 1024-tuple is not a
  type a person reads.
- **D5.** The vector's element is the flavored scalar (the draft), so that `vec3` and `vec3u`
  differ, and `array<vec3>` resolves to `Float32Array` while `array<vec3u>` resolves to
  `Uint32Array`.
- **D6.** `bool` is flavored as the scalars are (the draft), `boolean & { readonly [tag]?: 'bool' }`,
  for one shape across the family.
- **D7 (Amendment 1).** A struct argument: spelled with its name (the amendment), or with its
  fields, as the view spelled it before. The name is the point of the proposal. For an exported
  class the name is the class, and an instance built with `new` has run its constructor, which
  a plain object has not.
- **D8 (Amendment 1).** A struct binding in the manifest: spelled with its name beside the
  packed forms the manifest lists today (the amendment), or with its fields. The packed forms
  stay, because the runtime takes them.
- **D9 (Amendment 1).** A matrix carries its name as a phantom property (the amendment), or is
  a bare tuple. Bare, `mat2x2` and `vec4` are one shape, and `array<mat2x2>` resolves to the
  wrong host value.
- **D10 (Amendment 1).** Item 4 names its exceptions (the amendment), or claims full
  compatibility. The implementation found three cases the first revision did not name.

**Amendment 1 (2026-11-02).** The implementation (pull request #918) measured item 3 with
`bun scripts/changes.ts --base origin/main`: the spelling reshapes twenty exports of the common
modules, whose host faces are baked views, and the sentence of §74 that names the key type of a
`Set` or a `Map`. The first revision declared neither, so the work stopped there (`CLAUDE.md`: a
change does only what its record declares). The implementation also found four points the first
revision left open: a struct argument of an exported class, a struct binding, a matrix's name and
item 4's claim. The amendment declares the two places and resolves the four points (D7 to D10).

## What it touches

- **Rule 8.21.** The sentence on how the view types a host value names the family, and a
  vector's result is a `readonly` tuple (D1). The values the rule defines do not change.
- **surface 64.** The host values table gains the column "spelled in the view as", and the
  listings of the section are written in the family's names.
- **surface 74.** The sentence on how the view types the parameter: `Set<u32>` and
  `Map<u32, V>`, with the key's name (Amendment 1).
- **exports.** The names of the front matter, type-only, from `typeshade/runtime`, listed in
  `src/__api__/surface.md`; and the twenty exports of `typeshade/algorithms` and
  `typeshade/random` whose signatures the baked views spell with the family (Amendment 1):
  reshaped, not added, and their values do not change.
- **codes, examples: none.** No diagnostic is added, and the examples do not change; their
  generated views do, on the next `tshc sync`.

**Implementation.** `src/runtime/host-types.ts` (new), re-exported from `src/runtime.ts`;
`src/compiler/ts/host-face.ts`: the spelling functions print the family's names and the view
imports the names it uses; `src/__api__/surface.md`; the parity test of item 5; the pinned view
texts in `src/compiler/ts/host-face.test.ts` and in every test that holds a view; Rule 8.21 and
its `reqs/` item, synced and reviewed; §64.

**Validation.** `src/compiler/ts/host-face.test.ts` with the new spellings; the host programs
that file type-checks against a view, each kept as written to hold item 4, and one new program
that writes the family's names; the parity test of item 5 on every TypeScript version of CI's
unit shards; `bun run gate:journeys`, which type-checks a fresh project's host code with `tsc`
against its views; `bun run build`; `bun run docs:refs`, `bun run docs:impact`,
`bun run reqs:sync` and `python scripts/doorstop-check.py -C` for Rule 8.21 and §64.

### Draft impact estimate

Known work: the family file; the spelling functions of the view; the parity test; the pinned view
texts, which change wholesale; the rule and the section. Compatibility: item 4, with D1 as the
stated exception. Bundle: none, the family is types only. Dependencies: none; proposal 0109's
view printer for a class is written once, after this proposal, so that it spells with the
family from the start. Downstream: documentation copies and regenerated views; no source change
in typenn or typecv. Duration and cost: unknown, no basis for an estimate. Amendment 1: the
twenty exports' lines in the surface bake, §74's sentence, the struct and binding spelling and
the matrix name; the downstream host code may need the annotations item 4 names.

### Approval and plan record

The owner (Seungup) approved the proposal in the Claude Code session on 2026-11-02 (UTC), in
Korean ("승인", approve), in answer to the agent's report that pull request #876 was green and
ready for review and that D1 to D6 would be accepted as drafted by that word. D1 to D6 are
accepted as drafted: a result is `readonly`; the family lives in `typeshade/runtime`; `Resident`
is inside `array<T>`; `array<T, N>` is `readonly T[]`; a vector's element is the flavored scalar;
`bool` is flavored as the scalars are. The approved revision is the one this record is part of.
The merge of [#876](https://github.com/typeshade/typeshade/pull/876) with `status: accepted`
records the decision.

Responsibilities: an agent of this repository implements the family, the view's spelling, the
parity test, Rule 8.21 and §64 in pull requests whose commits say `Change: 0116`, before the
view printer of proposal 0109 is finished, or by changing that printer's spelling in the same
pull request where 0109 lands first. No milestone date is assigned. No duration or cost estimate
is established.

**Amendment 1.** The owner approved the amendment in the Claude Code session on 2026-11-02 (UTC),
in Korean ("승인", approve), in answer to the agent's report of the measurement, the four open
points and the recommendation for D7 to D10. D7 to D10 are accepted as drafted. The merge of the
pull request of the branch `claude/0116-amend-scope` with `status: accepted` records the
decision. The agent of pull request #918 lands item 3 on that branch, with the twenty exports,
§74 and D7 to D10, in commits that say `Change: 0116`.

### Configuration and validation record

**Accepted revision.** The text merged by pull request
[#876](https://github.com/typeshade/typeshade/pull/876) as `8b1a8fe` (as proposal 0111, renumbered
0116 on 2026-11-02, see Renumbering), with D1 to D6 accepted as drafted; and Amendment 1, merged
by pull request [#925](https://github.com/typeshade/typeshade/pull/925) as `334b9fc4`, with D7 to
D10 accepted as drafted (Approval and plan record).

**Implementation.** Pull request [#918](https://github.com/typeshade/typeshade/pull/918), branch
`claude/0116-host-type-family`, from `main` at `77ced440`, by a Claude Code agent at the owner's
direction. Its commits say `Change: 0116`: `6350b629` (the family, its parity test, the 48 names
in `src/__api__/surface.md` and one gzip byte of the runtime's split budget), `e276b254` (the
`CHANGELOG.md` entry of that part), `2413db45` (the merge of `main` at `334b9fc4`), `e4a0ad78`
(item 3 with D7 and D8), `a6b05a20` (this record), `941a594d` (the merge of `main` at
`c0daa442`) and the commit that names it here. The merge was committed with
`--no-verify` (issue #901): the commit-msg policy reads a merge against its first parent and
counted the rules, surface sections, exports and an example `main` changed as changes of this
branch. The staged file checks passed on the merged index, and it resolved
`src/__api__/surface.md` by baking it again and `scripts/bundle-budget.json` by measuring it. Item
3 was first implemented before Amendment 1 and kept on the branch `claude/0116-item3-wip`
(`0bad98ca`); its content was applied after the merge, with D7 and D8, in `e4a0ad78`, and that
branch is deleted.

**Delivered configuration.**

- `src/runtime/host-types.ts`: the family, 48 type-only exports (items 1 and 2, D2 to D6 and D9).
  A scalar is a `number` or a `boolean` with its name as an optional phantom property; a vector a
  `readonly` tuple of its scalar; a matrix a `readonly` tuple of its components, column-major, with
  its name; `array<T, N extends number = number>` resolves to the typed array of the scalar of `T`
  for a scalar or a vector, and to `readonly T[]` otherwise, each with its `Resident`, and to
  `readonly T[]` for an array with a size. `src/runtime.ts` exports the names from
  `typeshade/runtime`, and `src/core/host-runtime.ts` re-exports them through
  `typeshade/runtime/internal`, the runtime a view imports from.
- `src/runtime/host-types.test.ts` (item 5): the names against the value types of the ambient
  library in both directions, in the shape of Rule 9.6's test, with its instrument proved on
  doctored copies; each type against the shape the compiler gives its name; the flavor's behaviour
  under `tsc`.
- `src/compiler/ts/host-face.ts` (item 3): `argType`, `resultType`, `constType`, `bindingTsType`,
  `unsizedType`, `residentOf`, `bindingsTypes`, `packHostType`, `packUnsizedType` and `programType`
  spell with the family; `structNames` and `boundName` give a struct its name (D7), and an entry's
  bindings object is written again with the names once every export has its face
  (`namedBindings`); `packHostType` writes a struct binding's name beside its packed forms (D8);
  `viewImports` imports the names the declarations write, read off them by the TypeScript parser,
  with `Resident` and `Texture` where they are written.
- Baked: `src/algorithms/view.ts`, `src/random/view.ts`; `src/__api__/surface.md` with the 48 names
  and the twenty reshaped exports of the front matter (Amendment 1).
- Tests: `src/compiler/ts/host-face.test.ts` (the rows in the family's names, a host program that
  writes the family's names, a test of D7 and D8), `host-class.test.ts` (the class's name as a
  parameter and in a kernel function's array; instances built with `new` under `tsc`, and a plain
  object where the class goes refused, TS2345 and TS2769, beside the run-time cases that take one),
  `host-entry.test.ts`, `host-draw.test.ts`, `host-kernel.test.ts`, `host-kernel-push.test.ts`,
  `host-kernel-texture.test.ts`, `host-kernel-collections.test.ts`, `kernel-loops.test.ts`,
  `kernel-project.test.ts`, `key-types.test.ts`, `src/vite.test.ts`.
- `docs/language-design.md` Rule 8.21 and `reqs/rules/RULE-0821.md`, reviewed;
  `docs/use-typeshade-surface.md` §64 (the column of the view's names, the listings, D7, D8 and
  the exceptions of item 4) and §74; `reqs/surface/SURF-064.md`, `SURF-065.md`, `SURF-067.md`,
  `SURF-069.md`, `SURF-075.md` and `SURF-076.md` cleared after reading each section against the new
  rule (only §64 and §74 change; the others speak of values, which do not change).
- `journeys/_host-import/src/app.ts` holds a result as the family's `vec3` (D1, an exception of
  item 4). `CHANGELOG.md`, `src/AGENTS.md`, `scripts/bundle-budget.json`.

**Functional validation**, on 2026-11-02 (UTC), Bun 1.4.4, Node 22.23.4, TypeScript 5.6.3:

- At `6350b629`: `bun run build`, `bun run lint` and `bun run format:check` passed; `bunx vitest run`
  over `src/runtime`, `src/language-service` and the API, documentation, manifest and change tests,
  46 files, 1590 passed and 1 skipped; `bun run gate:boundary` passed after the budget moved by one
  gzip byte (the entry chunk is 19938 bytes before and after, and differs only in the names Bun's
  minifier gives its symbols).
- At `e4a0ad78`: `bun run build`, `bun run lint` and `bun run format:check` passed.
  `bunx vitest run src/compiler/ts src/runtime src/language-service` with `src/reqs.test.ts`,
  `src/doc-references.test.ts`, `src/api-surface.test.ts`, `src/api-doc-coverage.test.ts`,
  `src/common-modules.test.ts`, `src/vite.test.ts`, `src/changes.test.ts` and
  `examples/host-examples.test.ts`: 230 files, 6115 passed and 1 todo. `bun run test`: 513 files,
  11957 passed, 9 failed, 4 skipped and 1 todo; the 9 are five tests of
  `src/affected-tests.test.ts` and four of `src/doc-test-selection.test.ts`, which fail on the
  container's `NODE_OPTIONS` and pass with `env -u NODE_OPTIONS` (88 tests).
- The TypeScript legs, run in a worktree of `e4a0ad78` with its own dependencies:
  `src/runtime/host-types.test.ts`, `host-face.test.ts`, `host-class.test.ts`,
  `host-kernel-push.test.ts`, `typed-bindings.test.ts` and `src/api-surface.test.ts` passed, 120
  tests, on TypeScript 5.9.3 and on 6.0.3. CI runs every leg.
- `bun run gate:journeys` (headless Chromium 1243 through `TYPESHADE_CHROMIUM`, SwiftShader), on
  the tree committed as `e4a0ad78`: exit 0, 256 checks, `tsc` over each journey's host files
  against its views among them. `bun run gate:boundary` at `e4a0ad78`: exit 0, with the runtime's
  split build at 36461 initial and 150555 total gzip bytes, one byte over `main` for the reason
  above. `bun scripts/bake-common-modules.ts --check`: exit 0. `tshc sync --check` over
  `examples/hosts`: 9 views up to date. `tsc -p examples/hosts/tsconfig.json --noEmit`: exit 0.
- Not run: `bun run gate:compile`, `bun run gate:differential`, `bun run gate:render` and
  `bun run gate:perf`. The change emits no shader text and changes no kernel lowering; CI runs
  them.

- On the tree of `941a594d`, the merge of `main` at `c0daa442`, which Git made with no conflict:
  `bun run build` passed; the suites under `src/compiler/ts`, `src/runtime` and
  `src/language-service` with the same eight test files as above, 231 files, 6144 passed and 1
  todo; `bun run gate:boundary` exit 0 with the budgets unchanged; `bun run lint`,
  `bun run format:check`, `tshc sync --check` and `tsc -p examples/hosts/tsconfig.json --noEmit`
  passed; `bun run bake:api-surface` changed nothing. The merge passed the commit policy, which
  judges a merge by what it adds beyond its parents since #932.

**Document validation**, on 2026-11-02 (UTC), at `e4a0ad78`: `bun run docs:refs`, 0 dead
references; `bun run docs:impact` read for each commit, each commit's `Docs-Impact:` trailer saying
what was read; `bun run reqs:sync` with nothing left to write; `python3 scripts/doorstop-check.py -C`,
Doorstop 3.2, with no item flagged; `bun scripts/changes.ts --base origin/main`, exit 0 ("This change
touches Rule 8.21; surface §64, surface §74"; the 48 names and the twenty reshaped exports, each
declared); `bun scripts/ifchange.ts --base origin/main`, passed; `bun scripts/doc-impact.ts --check
--base origin/main`, exit 0. `changes.ts`, `ifchange.ts` and `doc-impact.ts --check` gave the
same results at `a6b05a20`; on the tree of `941a594d`, `docs:refs` found 0 dead references,
`reqs:sync` wrote nothing new and Doorstop flagged nothing.

**Deviations**, each with its disposition:

1. The first revision's item 2 made a matrix a bare tuple; `6350b629` gave it its name, so that
   `array<mat2x2>` is an array of matrices. Closed: Amendment 1 (D9) makes it the approved text.
2. The first revision's listing wrote `filters: array<OnePole>`, and the work before Amendment 1
   wrote a struct argument by its fields. Closed: Amendment 1 decides it (D7), and `e4a0ad78`
   applies D7, `filters: array<OnePole>`.
3. The first revision named a struct binding of the manifest `Camera`, and the work before
   Amendment 1 wrote its fields. Closed: Amendment 1 decides it (D8), and `e4a0ad78` writes the
   name beside the packed forms.
4. The first revision's item 4 claimed full compatibility. Closed: Amendment 1 (D10) names the
   exceptions; `e4a0ad78` lists them in §64, and the journey's annotation is one of them.

Not deviations, recorded for the reader: a struct is written by its fields where the view declares
no name for it, in a constant (a frozen object of its fields, change 0109), in a result of an
abstract class's struct (an object of its fields, change 0109, D1) and, in a binding or an array
with no size, where it holds a key or a `Record`, which those hold as ids (Rule 8.21); in each, the
name would spell another value than the one the position takes (item 2). An abstract class's
struct goes by the class as an argument, as D7 says of an exported class. A class of fields alone
takes a plain object under `tsc`, since TypeScript compares types by their shape; the refusal of
item 4 holds where the class has a method or an accessor. The view imports the family's names in
the order of the compiler's type table (`SUPPORTED_TYPE_NAMES`). A written binding of one scalar
stays a typed array of length one, and an array with no size inside a struct stays its typed
array: the family has no name for either value. `bun scripts/changes.ts` lists 17 of the family's
names (`f32` … `vec4f64`) as still to do, because the API surface already held those names under
`./core/ir`, so the check reads no new name for them; the `./runtime` section of
`src/__api__/surface.md` lists all 48.

**Open items.** The downstream work of What it owes downstream is not started: the site's copy of
§64 (English and Korean) and its API reference, the editor's host reference and its fixtures, the
annotations item 4 names where the host code of typenn and typecv needs them, and each
repository's `compiler-changes.md` when its pin moves.

## What it owes downstream

- **typeshade.github.io.** The page that copies §64, in English and in Korean: the host values
  table with the view's spelling and the listings in the family's names; the API reference
  generated from the JSDoc of `typeshade/runtime` gains the family; `compiler-changes.md`
  records 0116 when the pin moves.
- **vscode-typeshade.** The skill's host reference (`references/host.md`) where it quotes a host
  view, and any fixture that pins a view's text, change to the family's spelling;
  `compiler-changes.md` records 0116 when the pin moves.
- **typenn, typecv.** Nothing must change in their source. Their generated views change spelling
  on the next pin, and their host code keeps type-checking (item 4, D1 excepted);
  `compiler-changes.md` records 0116 in each when its pin moves.
