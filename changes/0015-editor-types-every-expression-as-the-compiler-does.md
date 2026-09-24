---
id: '0015'
title: The editor gives every expression the type the compiler gives it, and a gate holds the two to it
status: draft
rules:
- '12.7'
surface:
- 49
exports:
- CompileTsSourceResult
exports-removed: []
codes: []
examples: []
downstream: []
---

<!-- doc-refs: skip-file — a proposal names the test it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

A `"use typeshade"` program is typed twice. The front end gives every expression a `ShaderType`
as it lowers it (`lowerExpression`). The editor's TypeScript checker gives every expression a
type from the ambient library (`SHADE_DTS` in `src/language-service/ambient.ts`). Rule 12.7
says the two name one vocabulary, and that the ambient declarations are derived from the
compiler's tables and never retyped. Nothing checks that. What is checked is narrower:

- whether the two ACCEPT the same programs (`ambient-parity.test.ts`, `ambient.test.ts`);
- whether hover gives a name the document DECLARES its compiler type (`hover.ts`, #51);
- whether the projection writes in a vector type that an operator erased (`projection.ts`,
  #162, 0004).

The type of any other expression is TypeScript's alone, and no test compares it with the
compiler's. Because the scalar brands are optional (`f32` is `number & { [f32Tag]?: true }`), a
declaration that says `number` where the compiler means `u32` is assignable everywhere. So the
drift draws no TypeScript error either. It shows only in what an author reads: the hover, a
completion list, or signature help.

#271 is the case that surfaced it. `src.length` on a runtime-sized storage array hovered as
`number`, while the compiler reads it as `arrayLength(&src)`, a `u32` (#46). The ambient
`array<T, N>` declared `length: N`, and a runtime-sized array fills `N` with its default
`number`.

To see how many more there are, the front end's type of every expression was recorded and
compared with the checker's type at the same span. The run covered every program in `examples/`
and `journeys/`: 89 programs, 19,608 expressions. Most differences are propagated. Once an
operand is `number`, everything built on it is too. So the measure is the FIRST divergence: a
property access, element access or call whose receiver and arguments agree (or are literals),
but whose own type does not. There are 224 of them, in four classes:

| class                                                 | where                                                                                                                                                                                                                        | first divergences | what the editor says                        | what the compiler says                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------- | ------------------------------------------ |
| A. a builtin's result                                 | `dot`, `length`, `distance`, `smoothstep`, `max`, `mix`, `abs`, `atan2`, `min`, `clamp`, `pow`, `select`, `sin`, `determinant`, `radians`, `sqrt`, `round`, `countOneBits`, `firstLeadingBit`, `reverseBits`, `fwidthCoarse` | 178               | `number`                                    | `f32`, `u32`, `i32` or `f64`               |
| B. an unannotated scalar the document declares        | a class field (`#width`, `dist`, `drawn`, `SIZE`, `MIN_WIDTH`, `period`), a method or function return (`next()`, `draw()`, `pick()`)                                                                                         | 24                | `number`                                    | `f32`                                      |
| C. a constructor or method that loses a type argument | `array(-1., 3., -1.)`, `xs.map(...)`, a static builder that returns `this` (`Capped.unit()`)                                                                                                                                 | 15                | `array<number>`, `array<number, 4>`, `Disc` | `array<f32, 3>`, `array<f32, 4>`, `Capped` |
| D. an array's length                                  | `src.length` on a runtime-sized storage array                                                                                                                                                                                | 7                 | `number`                                    | `u32` (fixed by #271)                      |

Class A has a cause written in the code. `SPECIAL_MATH_SIGNATURES` is "declared by hand because
`MATH_FN_ARITY` records arity only, not shape". `scalarMathOverload` declares every all-scalar
call `(…: number) => number`, to stop TypeScript inferring a literal type. Both retype what the
compiler already decides.

After this change:

1. **The front end records the type of every expression it lowers**, beside the declarations it
   already records. `CompileTsSourceResult` gains
   `expressions: readonly LoweredExpression[]`, a side table with one entry per lowered
   expression: its `start`, its `length` and its `ShaderType`, in the conventions
   `DeclaredSymbol` uses. Like `symbols`, it feeds nothing in lowering, the IR or the emitted
   text.
2. **A gate compares the two on every program the repository ships.** For each property access,
   element access and call in `examples/` and `journeys/`, it maps the checker's type to a
   `ShaderType` (by the brand keys the ambient library declares) and compares it with the
   compiler's. It reports each first divergence. A known one is listed in a table in the test,
   with the class and the issue that will close it. The gate fails on a divergence the table
   does not list, and on a listed row that no longer diverges, so the table shrinks as the
   fixes land and cannot go stale. Following `AGENTS.md#gate-discipline`, the gate first proves
   it can see a divergence: a named test feeds it a declaration that says `number` where the
   compiler says `u32`, and it must report that.
3. **The ambient library stops retyping the builtins' results (class A).** The result shape of
   each math builtin moves into a table the front end lowers from, and the ambient library
   generates its signatures from that same table. The all-scalar overload returns the scalar
   its arguments carry (a `u32` in gives a `u32` out) instead of `number`. The argument that
   decides this is read by brand key, the way `BitcastArg` and `Vec4OfElem` already read one.
   It still infers nothing from a literal, which is what `scalarMathOverload` exists to prevent.
4. **The projection writes in an unannotated scalar the front end typed (class B).** A class
   field, a method or function return, or a getter that has no annotation and whose front-end
   type is a scalar gets that type written into the text TypeScript reads. The projection
   already does this for a vector erased by an operator (0004). The trigger widens from "an
   erasing operator" to "TypeScript would infer `number` where the front end has a brand".
5. **Class C** is fixed declaration by declaration:
   - `array(...)` infers its element and its count;
   - an array method keeps its element type;
   - a static method's `this` return is the class it is called on.
6. When the table is empty, the gate reads the empty table. After that, a new first divergence
   stops the pull request that introduces it.

Hover keeps its current split: the compiler's type for a declared name, TypeScript's for
everything else. Once the gate holds, TypeScript's answer is the compiler's for every expression
the repository ships. So the fix is in the declarations, where signature help, completion and
`typeshade check` read the type too, and not in one more hover rule over the top of them.

## Why

Each earlier fix in this area closed the symptom it was reported for:

- #51 fixed a declared name's hover;
- #162 and 0004 fixed a vector erased by an operator, first in a local and then in a return;
- the eight rows of surface §49 fixed eight spellings;
- #271 fixed `.length`.

None of them could find the next one, because every test compares a verdict or a hand-picked
hover. Rule 12.7's "derived, never retyped" had no instrument, and the 224 divergences above are
what accumulated without one. CLAUDE.md's "A test reads both halves" states the same lesson for
one test at a time. This change makes it hold for every expression in every shipped program.

Alternatives considered:

- **Route every hover through the compiler's type.** This fixes what hover shows and nothing
  else. Signature help, completion after `.`, a TypeScript overload chosen on a `number`, and
  `typeshade check` would still read the retyped declaration, and the drift would have no test.
  The side table this change adds would make that routing a small follow-up, but it is not the
  fix.
- **Make the brands required**, so `number` is not assignable to `u32`. This was measured before
  (the note at `scalarBrands` in `ambient.ts`). Every unannotated literal becomes a TS2322 on a
  program that compiles, which is the failure §49 calls the worse one.
- **A hand-written row per builtin in `ambient-parity.test.ts`.** This is the per-symptom pattern
  again. It covers the rows someone thought of, and the next declaration drifts with no row.

## What it touches

- **Rule 12.7**: its "Enforced by" line names the new gate. The rule's text already requires what
  the gate checks, so the rule itself does not change.
- **Surface §49**: gains a subsection, "The type the editor gives an expression". It describes the
  gate, and it points to the gate's table as the one list of the divergences still open. The
  table is not copied into the prose.
- **Export `CompileTsSourceResult`**: reshaped by the new `expressions` field. It is additive: no
  existing field changes, and a consumer that ignores the field sees no difference. The
  `LoweredExpression` type is reached through it, as `DeclaredSymbol` is through `symbols`.
- **No diagnostic code changes, and no example is added or removed.** The gate reads the
  examples as they are.

Tests that will pin it:

- `src/language-service/expression-parity.test.ts` (new): the gate, its instrument proof and its
  known-divergence table.
- `src/compiler/ts/symbols.test.ts`: the `expressions` table records a span and a type for
  each kind of expression. It checks that a span slices to the expression's text, and that a
  refused expression is absent.
- `src/language-service/hover.test.ts`: at least one expression of each class, read in both
  halves, per CLAUDE.md's "A test reads both halves".
- `src/language-service/projection.test.ts`: the widened trigger (class B), including a
  declaration it must leave alone because TypeScript already types it right.
- `src/api-surface.test.ts` and `src/__api__/surface.md`: re-baked with the reshaped
  `CompileTsSourceResult`.

The work lands as separate pull requests, each with `Change: 0015`, and each shrinks the table:

1. the side table and the gate, with all 224 known divergences listed;
2. class A;
3. class B;
4. class C.

The last of them sets `status: implemented`.

## What it owes downstream

Nothing is removed or renamed, so `downstream` is empty.

- **typeshade.github.io**: the Playground's hover and completion will show `f32`, `u32` or
  `array<f32, 3>` where they show `number` today. No page states the old type. A search of the
  site for `length: number` and for a builtin typed `number` finds only host-side TypeScript,
  which the change does not reach.
- **vscode-typeshade**: `docs/design.md` §3 describes `CompileTsSourceResult.symbols`, and it
  stays true. The tsserver plugin maps quick info through as it does now.

Each repository sees the new types on its next compiler pin, and neither owes a change for them.
