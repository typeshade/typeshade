---
id: '0111'
title: The host view spells each type with the shader's own name, from a family of host types that `typeshade/runtime` exports one for one with the ambient library's value types, whose values stay the host values of Rule 8.21
status: accepted
rules:
  - '8.21'
surface:
  - 64
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
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The page that copies surface §64 (en and ko) shows the host values table with the view's spelling and the listings in the family's names; the API reference generated from the JSDoc of `typeshade/runtime` gains the family; `compiler-changes.md` records 0111 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's host reference (`references/host.md`) where it quotes a host view, and any fixture that pins a view's text, change to the family's spelling; `compiler-changes.md` records 0111 when the pin moves.
  - repo: typenn
    what: Nothing must change in its source. Its generated views change spelling on the next pin, and its host code keeps type-checking, since each family type is assignable from and to the spelling it replaces (D1 is the one stated exception); `compiler-changes.md` records 0111 when the pin moves.
  - repo: typecv
    what: Nothing must change in its source, as for typenn; `compiler-changes.md` records 0111 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a file, tests and text its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0111, `status: accepted`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02 (UTC); see Approval and plan record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-02, in Korean, reading the listing of proposal 0109: the host view should have types that match one for one what the `.shade.ts` file writes, `array<T>` among them, provided by TypeShade itself, because the spelled-out form is spread out and unpleasant to read, and `vecN` and `matCxR` should be provided as types too ("1:1로 매칭되는거요. TypeShade 자체에서 제공해야할 것 같은데요 너무 펼쳐져있어서 보기 거슬리네요. vecN, matCxR 도 타입으로 제공되어야하지 않을까 싶어요"). The agent reported a design with a prototype that type-checks, and the owner approved the drafting ("승인"). No GitHub issue is recorded.                                        |
| Applicability / effectivity   | Rule 8.21 of `docs/language-design.md` and its item in `reqs/`; `docs/use-typeshade-surface.md` §64; a new `src/runtime/host-types.ts` exported from `typeshade/runtime` and listed in `src/__api__/surface.md`; `src/compiler/ts/host-face.ts` (`argType`, `resultType`, `constType`, `structBody`, `programType` and the view's import line); `src/compiler/ts/host-face.test.ts` and every test that pins a view's text; a parity test against the ambient library (`src/language-service/ambient.ts`); the examples' generated views. The host values, their checks and `TypeError` texts (`src/core/host-values.ts`), the generated module's code, the GPU tiers and the oracle do not change. No release version is assigned. |
| Review baseline               | `main` at `800969063df86573107fc795e619cf3540853595` (the squash merge of pull request #872, proposal 0109), read on 2026-11-02.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Review and revision authority | Pull request [#876](https://github.com/typeshade/typeshade/pull/876) (branch `claude/proposal-0111-host-type-family`). Git records the revisions of this file. The review and merge of that pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                                                                                              |

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

4. **Compatibility.** A host program that type-checked against the old spelling type-checks
   against the new one: each family type is assignable from the value the old spelling named,
   and to it. D1 is the one stated exception: a result is `readonly`, so a program that wrote
   into a result tuple in place must copy it first.
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

## What it touches

- **Rule 8.21.** The sentence on how the view types a host value names the family, and a
  vector's result is a `readonly` tuple (D1). The values the rule defines do not change.
- **surface 64.** The host values table gains the column "spelled in the view as", and the
  listings of the section are written in the family's names.
- **exports.** The names of the front matter, type-only, from `typeshade/runtime`, listed in
  `src/__api__/surface.md`.
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
in typenn or typecv. Duration and cost: unknown, no basis for an estimate.

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
parity test, Rule 8.21 and §64 in pull requests whose commits say `Change: 0111`, before the
view printer of proposal 0109 is finished, or by changing that printer's spelling in the same
pull request where 0109 lands first. No milestone date is assigned. No duration or cost estimate
is established.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
pull requests with `Change: 0111` in their commits, the delivered configuration, the observed
results of the functional validation (the tests, the parity test per TypeScript version, the
journeys gate and the build) and the document validation (`bun run docs:refs`,
`bun run docs:impact`, `bun run reqs:sync`, `python scripts/doorstop-check.py -C`). Required
future evidence is not a completed result.

## What it owes downstream

- **typeshade.github.io.** The page that copies §64, in English and in Korean: the host values
  table with the view's spelling and the listings in the family's names; the API reference
  generated from the JSDoc of `typeshade/runtime` gains the family; `compiler-changes.md`
  records 0111 when the pin moves.
- **vscode-typeshade.** The skill's host reference (`references/host.md`) where it quotes a host
  view, and any fixture that pins a view's text, change to the family's spelling;
  `compiler-changes.md` records 0111 when the pin moves.
- **typenn, typecv.** Nothing must change in their source. Their generated views change spelling
  on the next pin, and their host code keeps type-checking (item 4, D1 excepted);
  `compiler-changes.md` records 0111 in each when its pin moves.
