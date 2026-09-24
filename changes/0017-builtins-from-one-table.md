---
id: '0017'
title: Every builtin's overloads, in the compiler and in the editor, come from one table, Tint's core.def with a TypeShade overlay
status: draft
rules:
- '9.2'
- '9.6'
- '12.7'
surface:
- 49
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

<!-- doc-refs: skip-file — a proposal names the files, the fixture and the tests it will add, which this tree does not have yet -->

## What changes

Rule 12.7 says the ambient declarations are derived from the compiler's own tables and never
retyped. For WGSL's builtins that is true of their NAMES and their ARITY, and of nothing else.
The type rules of a builtin are written three times, all by hand:

| where                                                        | what it holds                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/compiler/ts/lower/expression-misc.ts`, `mathResultType` | the result type of a call, as conditions added one bug at a time (#57, #151)          |
| `src/compiler/ts/lower/math-args.ts`                         | which arguments a call takes, as a second, separate table                             |
| `SHADE_DTS` in `src/language-service/ambient.ts`             | the editor's signatures, as strings (`scalarMathOverload`, `SPECIAL_MATH_SIGNATURES`) |

0015's gate (#277) measures what that costs: 25 of the 39 groups of first divergences it lists
are a builtin's result type the editor gets wrong.

The table all three copy already exists, and this repository already reads it. Tint's `core.def`
is the overload table Chromium's WGSL front end matches every call against: every builtin
function (`fn`), value constructor (`ctor`), conversion (`conv`) and operator (`op`), each with
typed parameters and the type-parameter constraints (`match fiu32_f16: f32 | i32 | u32 | f16`).
For example:

```text
@must_use @const implicit(N: num, T: fiu32_f16)
  fn dot(vec<N, T>, vec<N, T>) -> T
@must_use implicit(T, AS: workgroup_uniform_storage, A: access)
  fn arrayLength(ptr<AS, runtime_array<T>, A>) -> u32
```

`scripts/bake-coredef-textures.ts` bakes its 184 texture rows into a fixture, and
`coredef-texture-overloads.test.ts` holds every one of them to a `compile()` witness. That suite
reads the compiler half only, which is the gap #271 fell through.

After this change:

1. **One table.** The whole of `core.def` is baked into a fixture, and a TypeShade overlay stands
   beside it. The overlay records three things:
   - each row's status: SUPPORTED, DEFERRED with a reason and an issue, or REFUSED (`f16`, `u16`,
     `i8`, `u8`, which TypeShade does not have);
   - the author spellings WGSL does not give: `Math.*` (Rule 9.4), `atan(y, x)` (Rule 9.2), and
     the `.length` of a runtime-sized array;
   - the rows of the f64 family, in `core.def`'s own row format (Rule 4.4).
2. **The compiler resolves every builtin call against it.** It uses WGSL's overload resolution,
   abstract numeric conversion rank included, to find each call's result type and to refuse a
   call no row takes. `mathResultType` and `math-args.ts` go, family by family, as the resolver
   takes each over. A refusal keeps the code and the text it has today (Rule 12.5). A text that
   has to change for a family is named in that family's pull request, which updates the tests
   that pin it.
3. **The editor's declarations are generated from it.** Each SUPPORTED row becomes one overload
   in `SHADE_DTS`. The hand-written math signatures go.
4. **Every row is held to both halves.** The texture suite widens to the whole table. For every
   SUPPORTED row, and every instance of its type parameters, a witness asserts three things on the
   same source:
   - `compile()` accepts it, and gives the call the row's result type;
   - the language service draws no error, and its type for the call is the same;
   - Tint accepts the emitted WGSL. The witnesses join the compile gate's run.

   A DEFERRED or REFUSED row is refused by both halves. The 0015 gate stays in place for what the
   table does not cover: declarations a document writes, class members, the projection.

### How a row becomes a TypeScript overload

This was measured before being proposed, on the 84 builtins the ambient library declares that
take only scalars and vectors: 146 `core.def` rows, 375 instances over `f32`, `i32`, `u32` and
`bool`. Each instance got a witness, and two encodings were generated and compared with today's
library:

| encoding                                                        | witnesses with the compiler's type    | errors on the 89 shipped programs, which all compile | 0015 builtin-result groups closed |
| --------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- | --------------------------------- |
| today's `SHADE_DTS`                                             | 291 of 375; the other 84 say `number` | 0                                                    | 0 of 25                           |
| **(a) the brands stay optional; one generic overload per row**  | **375 of 375**                        | **0**                                                | **23 of 25**                      |
| (b) the brands become required; one plain overload per instance | 375 of 375                            | 298, in 66 programs                                  | 16 of 25                          |

The encoding is **(a)**.

- **Encoding (a).** A row over `vec<N, T>` becomes one overload generic in the vector it is
  called with; the element type and the length are read off the vector's `[vecTag]`. A row over
  a scalar `T` gives each argument its own type parameter, and the result is the scalar the
  arguments carry, read by brand key. That is the way `BitcastArg` and `Vec4OfElem` already read
  one. Giving each argument its own type parameter is what keeps `smoothstep(0.3, 0.55, h)` from
  inferring `T` as the literal `0.3`, which is the reason `scalarMathOverload` exists. A hover
  shows the instantiated signature: `dot<vec3u>(a0: vec3u, a1: vec3u): u32`, and `const d: u32`.
- **Why not (b).** Making the brands required breaks every literal and every scalar arithmetic
  result, because TypeScript types both as `number`: 314 errors on the shipped programs with the
  brand change alone. The projection would have to write a type into about 4,460 places in them
  (2,817 scalar literals and 1,647 scalar arithmetic results). Even then, a `tsc` user reading
  `dist/shade.d.ts`, where there is no projection, would see every one of those errors. That is
  the failure §49 calls the worse one.

### What (a) cannot say, and what the rule says instead

A call whose arguments are all literals, such as `select(0., 0.15, c)` or `max(1., 2.)`, is one
TypeScript cannot type. `0.` and `0` are the same literal type, so no declaration can tell an
abstract float from an abstract int. The shipped programs have 56 such calls. WGSL types them as
abstract until a context concretizes them, and the editor says `number`. Rule 12.7 will say so
in words, and the 0015 gate will classify them by that rule instead of listing them. If an exact
type is ever wanted there, the projection can write it, the way it writes an unannotated
declaration's type (0015's class B). That is a later, separate change.

## Why

Each earlier fix in this area was a correct fix to the one symptom it was reported for:

- #57 and #151 each added a branch to `mathResultType`;
- #147 and #150 added machinery for the texture signatures;
- #271 fixed `.length`.

Three hand-written copies of one table drift from each other by construction, and a test of one
copy cannot see the others. Tint's table is the one Chromium runs. It is already the authority
this repository chose for textures ("WHY TINT'S TABLE AND NOT THE SPEC PROSE",
`bake-coredef-textures.ts`), and the compile gate already holds the compiler to Tint. Deriving
both halves from it turns Rule 12.7's "derived, never retyped" from a sentence into a
construction.

Alternatives considered:

- **Fix the ambient library's signatures by hand (0015's parts 3 to 5).** This closes today's 25
  groups and leaves three copies, so the next row drifts the way these did. This proposal
  supersedes those parts. The 0015 gate (#277) stays, and it measures this change as it lands.
- **Answer every editor question from the compiler's semantic model instead of TypeScript's
  checker.** This fixes what the service shows and nothing else. `typeshade check` and
  `dist/shade.d.ts`, which a `tsc` user reads directly, would still need declarations that are
  right.
- **The spec's prose instead of `core.def`.** The same reasoning as the texture fixture: the
  prose is not machine-readable. `core.def` is, and it is what a program meets on Chromium.

## What it touches

- **Rule 12.7**: its text says where the declarations come from (`core.def` and the overlay,
  through the generator), and that an all-literal call is abstract, typed `number` by the editor.
  Its "Enforced by" names the two-half conformance suite.
- **Rule 9.2**: "A builtin's signature must be WGSL's" stays. Its "Enforced by" moves from
  `math-args.ts` to the resolver and the conformance suite.
- **Rule 9.6**: the extension table's "type machinery" rows gain at most two names the generator
  needs, added by Rule 9.7: one for the scalar a call's arguments carry, and one for the vectors
  of an element. Each goes in with its reason, a `TYPESHADE_EXTENSIONS` row and a `CHANGELOG.md`
  entry. The generator reuses `VecElemOf` and `VecFor2` to `VecFor4` wherever they serve. No name
  is added that an author writes as a value (Rules 2.2 and 9.8).
- **Surface §49**: "The type the editor gives an expression" says where the builtins' types now
  come from, and states the all-literal rule.
- **No export changes.** `SHADE_DTS` stays a `string`. The resolver and the generator are
  internal.
- **No diagnostic code changes, and no example is added or removed.**

Tests that will pin it:

- `src/core/spec-conformance/coredef-overloads.test.ts` (the texture suite, widened): every row is
  claimed, and every SUPPORTED instance is read in both halves. The DEFERRED table is
  shrink-only.
- `src/language-service/expression-parity.test.ts`: its class A rows leave as each family lands,
  and all-literal calls are classified by rule.
- `src/core/spec-conformance/surface-names.test.ts`: the new machinery rows.
- The existing refusal tests of each family: `math-args` refusals, `TS8036`.

The work lands in pull requests of one family each, with `Change: 0017`, in this order:

1. the full fixture, the overlay and the widened suite, with every row DEFERRED to the family
   that will claim it;
2. the math family, which the measurement above covers;
3. derivatives, bit operations and packing;
4. atomics;
5. textures, whose rows the fixture already holds;
6. value constructors and conversions;
7. operators, whose result shapes then also drive the projection's `ERASING_OPERATORS`.

Each pull request switches the compiler and the editor for its family at once, deletes that
family's hand-written copy, and empties that family's DEFERRED rows. The last one sets
`status: implemented`.

## What it owes downstream

Nothing is removed or renamed, so `downstream` is empty.

- **typeshade.github.io**: the Playground's hover will show `u32`, `f32` and `vec3u` where it shows
  `number` today. No page states a builtin's result as `number`.
- **vscode-typeshade**: quick info passes through as it does now, and shows the new types.

Each repository sees the new types on its next compiler pin.
