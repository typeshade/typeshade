---
id: '0134'
title: A written number takes its type from where the program uses it, so an author writes `1` and `4` and no cast or decimal point the compiler can work out
status: draft
rules:
  - '5.1'
  - '5.2'
  - '12.7'
surface:
  - 12
  - 13
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Rewrite the literal-typing text of the language reference, the TS8053 page in apps/typeshade/src/lib/error-codes.ts and every playground or guide snippet that writes `u32(1)` or `0.` only to type a literal; record 0134 in compiler-changes.md
  - repo: vscode-typeshade
    what: Rewrite the literal-typing bullets of plugins/typeshade/skills/typeshade/references/language.md (lines 205-214 at db3f417) and the TS8053 row of references/diagnostics.md; record 0134 in compiler-changes.md
  - repo: typecv
    what: Optional cleanup of literal casts in shaders (24 grep hits at 5c3f8ce); check each module constant above 2^24 against Q4; record 0134 in compiler-changes.md when the pin moves
  - repo: typeaudio
    what: Optional cleanup of literal casts in shaders (4 grep hits at 8bd1ab1); check each module constant above 2^24 against Q4; record 0134 in compiler-changes.md when the pin moves
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0134, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. Revised 2026-11-09 (UTC) by the same agent after the independent review recorded below. The dates are drafting and revision dates. They are not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                 |
| Request source                | The owner (Seungup) asked on 2026-11-09 which parts of the surface push the compiler's work onto the author, judged against OD-3. From the audit the owner chose item 1, numeric literals, for a proposal.                                                                                                                                                                                                                                                                                              |
| Applicability / effectivity   | Expected: `src/compiler/ts/local-numeric-inference.ts`, `src/compiler/ts/lit-coerce.ts`, `src/compiler/ts/numeric.ts`, `src/compiler/ts/integer-literal-deprecation.ts`, the module-constant lowering, the WGSL and GLSL emitters, the CPU oracle's constant values, `src/language-service/hover.ts`, `docs/language-design.md` (Rules 5.1, 5.2, 12.7, §14), `docs/use-typeshade-surface.md` (§12, §13), `examples/*.shade.ts` (content only), `CHANGELOG.md`, `reqs/`. No release version is assigned. |
| Review baseline               | First draft on `main` at `2cc98b8f` (merge of pull request #1113). Revision on `main` at `583891d2` (merge of pull request #1120), merged into the branch. Every measurement below was repeated on `583891d2` on 2026-11-09 with Bun's runtime and the tree's own `compile()` and `createTypeshadeLanguageService()`, with the same results.                                                                                                                                                            |
| Review and revision authority | Pull request #1121 (draft). Git records the revisions of this file. A merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                           |

## What changes

### Today

A written number already takes its type from many positions (Rule 5.1, Rule 5.2, surface §13):

- a declared position: `let j: i32 = -1`, `return 0` in a `u32` function, an argument, a field;
- a typed peer in an operator or a builtin call: `vi & 1` with `vi: u32` is `vi & 1u`, and
  `x * 4 - 1` with `x: f32` is `x * 4.0 - 1.0`;
- an unannotated function-local `let` or `const` initialized by an integer-written literal whose
  declared uses demand one integer type (changes 0036 and 0037): a parameter, a typed
  initialization, a simple assignment.

Where nothing above decides, the literal is an `f32` (Rule 5.1, last sentence). These
declarations do not decide today:

- a local whose only uses are operators, compound assignments or indexes:
  `let acc = 0; acc += x` (an `f32` by default, so it happens to work), `let n = 0; n += vi`
  (refused, `TS8003`), `let j = 0; xs[j]` (refused, `TS8003 Index must be i32 or u32.`),
  `let f = 0; f = f | 4` (refused, `TS8003 Bitwise "|" needs i32 or u32 operands, got f32.`);
- a module or local `const` of a written number: `const K = 3` is `const K: f32 = 3.0`, so
  `vi * K` is refused (`TS8003`) and `const N = 8; for (let j = 0; j < N; j++)` is refused
  (`TS8003 … cannot compare i32 and f32`).

`TS8053` (`INT_LITERAL_DEPRECATION`) warns, under `compile(src, { deprecations: true })`, on
each declaration that takes the `f32` default. Its text says the declaration "will type as
i32", because #148 decided that the default becomes `i32` (§14, roadmap item T15, Rule 13.10).

### Proposed

1. **A local initialized by an integer-written number takes its type from every use the
   compiler can see (Rule 5.1).** The initializer is an integer-written literal, or an
   expression whose leaves are all integer-written literals, as in changes 0036 and 0037. A
   float-written initializer (`let k = 2.0`) keeps its rules, so Rule 5.5 does not change. The
   proposal adds these uses to the declared uses of Rule 5.1:
   - an operand of an arithmetic or comparison operator beside a typed peer (`vi + k`,
     `k < i`, `x * k`): the peer's type;
   - an operand of a bitwise or shift operator (`f | 4`, `k << 2`): the typed peer's integer
     type, or `i32` when no operand has a type;
   - an index (`xs[k]`): an integer, `i32` when no other use decides between `i32` and `u32`;
   - a compound assignment (`k += vi`, `acc += x`) and an assignment from a typed value;
   - a `return` in a function whose result type is declared;
   - another local that takes its type in the same way. For example, `let it = 0; it += 1; return it / 100;` in an `f32` function makes `it` an `f32` through `it / 100`.

   The compiler solves all locals of a function together, as a fixed point over their demands.
   The result does not depend on source order. A cycle of locals that reaches no typed peer
   (`let a = 0; let b = 0; a = b; b = a;`) supplies no demand, and its locals take the default
   of item 3. Uses that demand two concrete types stay refused with `TS8003` and the annotation
   remedy, as Rule 5.1 says today.

2. **A `const` of an integer-written number is a constant of no fixed type until a use gives it
   one (Rules 5.1 and 5.2, surface §12 and §13).** This is WGSL's abstract `const`. Each read of
   `K` in `const K = 3` takes the type the written number `3` would take in the same place,
   including the `f64` lift of Rule 5.2. So `vi * K` is `vi * 3u` and `x * K` is `x * 3.0` in one
   function, and `const N = 8; for (let j = 0; j < N; j++)` compiles. Its edges:
   - A cast is a use. `u32(K)` converts the written number, as `u32(3)` does. A constant of no
     fixed type therefore never takes the default of item 3.
   - A `const` initialized from such constants and written numbers (`const M = K * 2`) is one
     too.
   - An exported constant read by another `"use typeshade"` module takes, at each read, the
     type the read gives it. The host view of change 0116 spells it `number`, with no phantom
     scalar name. This is an estimate; the implementation checks reflection and the manifest.
   - A float-written initializer (`const C = 0.1`) keeps today's `f32`; see "Decisions to
     resolve before acceptance".
   - A value change: today the compiler rounds every such constant to `f32`, and the CPU
     oracle records that rounded value. A constant that `f32` does not hold exactly
     (|K| > 2^24) is read at its written value after item 2. Q4 asks the owner how to handle
     that difference.

3. **The default stays the one #148 decided.** Where no use demands a type (an inferred return
   `function g() { return 1; }`, an unannotated class field `n = 0`, a local read only by a cast
   or by `console.log`, a cycle of item 1), the literal takes the default. Option B keeps #148 as
   recorded. Q2 shows the other sides. Item 1 makes the default reach fewer declarations.
   `TS8053` keeps its number and, for these declarations, its text. It warns only on a
   declaration that no use decides, as Rule 5.1 already says for a local that takes its type
   from declared uses.

4. **The editor names the same type (Rule 12.7).** TypeScript types `const K = 3` as the
   literal type `3` and `let k = 0` as `number`. The ambient library's scalar brands are
   optional (`src/language-service/ambient.ts`, the head comment), so a `number` flows into
   every `f32`, `i32` and `u32` position, and TypeScript's half accepts every form above. The
   compiler's `TS8003` reaches the editor through the shared analysis, as it does today (F7).
   Hover shows the compiler's type for a local (`let k: u32`). At each read of a constant of no
   fixed type, hover shows the compiler's type for that read (`K: u32` in `vi * K`). The
   spelling at the declaration is Q3.

5. **The examples, the surface sections and the guides stop teaching casts and decimal points
   that the compiler does not need.** This item needs no rule change: the compiler accepts the
   rewritten forms today (F2 to F4). It belongs here because it is the author-visible half of the
   same change. It changes how authors write examples, so its implementing pull request waits
   for the owner's "merge" (Approval and plan record).

### Example

Before (`examples/array-methods.shade.ts`, lines 32-36 on `main` at `583891d2`):

```ts
export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
});
```

After:

```ts
export const vs = vertex(function vs(vi: builtin<"vertex_index", u32>): VsOut {
  const x = f32(vi & 1) * 4 - 1;
  const y = f32(vi >> 1) * 4 - 1;
  return { pos: vec4(x, y, 0, 1), uv: vec2(x, y) };
});
```

Fact: the "after" text compiles on `main` today to the same WGSL and the same GLSL ES 3.00,
byte for byte, with no diagnostic in either half. Both targets emit
`let x = ((f32((vi & 1u)) * 4.0) - 1.0);` (WGSL) and `float x = ((float((vi & 1u)) * 4.0) - 1.0);`
(GLSL). Item 5 delivers this example. The stage spelling `vertex(...)` is the one on `main`.
OD-2 restores `@vertex` in its own change, and this proposal does not touch it.

The language change of items 1 and 2 shows in a declaration. Before (refused today, F7):

```ts
const N = 8;
export function sum(xs: array<f32, 8>): f32 {
  let a = 0.;
  for (let j = 0; j < N; j++) {
    a += xs[j];
  }
  return a;
}
```

Today the author writes `const N: i32 = 8` or `j < i32(N)`. After: the text above compiles as
written (item 2), and `let a = 0` may drop its decimal point, since `a += xs[j]` demands `f32`
(item 1).

### The forms an author writes

| What the author means                    | Today                                  | After                                                  |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| An integer beside a typed peer           | `vi & u32(1)`, `band > i32(2)`         | `vi & 1`, `band > 2` (accepted today; item 5)          |
| A float beside a typed peer              | `f32(n) * 4. - 1.`                     | `f32(n) * 4 - 1` (accepted today; item 5)              |
| A vector component                       | `vec4(x, y, 0., 1.)`                   | `vec4(x, y, 0, 1)` (accepted today; item 5)            |
| A float accumulator                      | `let acc = 0.; acc += x`               | `let acc = 0; acc += x` (item 1)                       |
| An integer accumulator                   | `let n: u32 = 0; n += vi`              | `let n = 0; n += vi` (item 1; refused today)           |
| A counter used as an index               | `let j: i32 = 0; xs[j]`                | `let j = 0; xs[j]` (item 1; refused today)             |
| Bit flags                                | `let f: u32 = 0; f = f \| u32(4)`      | `let f = 0; f = f \| 4` (item 1, `i32`; refused today) |
| A named constant used at two types       | `const K = 3; vi * u32(K)` and `x * K` | `const K = 3; vi * K` and `x * K` (item 2)             |
| A loop bound                             | `const N: i32 = 8; … j < N`            | `const N = 8; … j < N` (item 2; refused today)         |
| A literal no use decides                 | `let k = 0.` (f32), `let k = 0` (f32)  | `let k = 0.` (f32), `let k = 0` (the default, Q2)      |
| An explicit type, where the author wants | `u32(1)`, `let k: u32 = 1`, `1.`       | unchanged; every form of today still compiles          |

## Why

OD-3 says that a construct exists only for what the author must state and the compiler cannot
know. A cast on a literal (`u32(1)`) and a decimal point written only to pick `f32` (`4.`) state
a type that the position already states. The compiler reads that position. For the forms of
item 5 it already acts on it. For the forms of items 1 and 2 it can, by reading the uses of the
declaration in the same function or module.

### Measured facts

Each row names its method. All measurements ran on `main` at `2cc98b8f` and again at
`583891d2`, 2026-11-09, with Bun's runtime, `compile(src, { deprecations: true })` and
`createTypeshadeLanguageService()` from the tree. The scripts were scratch files and are not
committed.

| #   | Kind      | Finding                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | fact      | `examples/` holds 102 `*.shade.ts` files. 101 compile alone. `imported-noise.shade.ts` needs a `readDocument` (`TS8072`) and was left out of F2 to F4.                                                                                                                                                                                                                                                         |
| F2  | fact      | Code lines (comments excluded) hold 62 casts of an integer-written literal, `u32(N)` or `i32(N)`, on 57 lines in 27 files. Removing every one gives byte-identical WGSL and GLSL in all 27 files, no `compile()` error and no editor error.                                                                                                                                                                    |
| F3  | fact      | Also removing each trailing decimal point (`4.` to `4`) and each `f32(N)` changes 744 lines in 92 files. WGSL and GLSL stay byte-identical, with no error in either half. `TS8053` warnings go from 1 to 45.                                                                                                                                                                                                   |
| F4  | fact      | Also removing `.0` (`4.0` to `4`) changes 1160 lines in 93 files, with the same result. `TS8053` warnings go from 1 to 60. The 60 are unannotated declarations, most of them accumulators and counters (`let acc = 0`, `let it = 0`, `let sum = 0`) and four module constants in `capsule-corp-namek-class.shade.ts` (`const WIN_N = 12`).                                                                     |
| F5  | inference | From F3 and F4: the casts and most decimal points in the examples are style that the compiler has not needed since surface §13 landed. The comment at `examples/array-literal-ramp.shade.ts:44-45` ("until then a bare `2` here is an f32") is out of date: `band > 2` and `band = 2` compile.                                                                                                                 |
| F6  | inference | From F4: the 59 new `TS8053` lines are where #148's `i32` default would refuse or change a program once the author drops the decimal point. Item 1 decides most of them from their uses. The exact remainder is not measured; it needs the implementation.                                                                                                                                                     |
| F7  | fact      | Refused today in both halves with the same `TS8003`: `let n = 0; n += vi`; `let j = 0; j = j + 1; xs[j]` (`Index must be i32 or u32.`); `let f = 0; f = f \| 4`; `const K = 3; vi * K` at module scope; `const k = 1; i + k`; `const N = 8; … for (let j = 0; j < N; j++)`.                                                                                                                                    |
| F8  | fact      | Editor hover today: `const m = vi & 1` is `const m: u32`; `const x = f32(vi & 1) * 4 - 1` is `const x: f32`; `let k = 1` passed to `h(a: u32)` is `let k: u32`; `const k = 1` with no deciding use is `const k: f32`. The editor reports no TypeScript error for any form above.                                                                                                                               |
| F9  | fact      | Literal-only arithmetic folds with ECMAScript doubles today: `const h = 1 / 2; return f32(i) * h;` emits `f32(i) * 0.5`. `const q: i32 = 3 / 2` is refused (`TS8003 … i32 and f32`). `let h = 3 / 2; h += i;` with `i: i32` is refused (`TS8003 … += f32 and i32`). Surface §12 states the ECMAScript value for `f64(1 / 3)`.                                                                                  |
| F10 | fact      | `const C = 0.1` at module scope beside an `f64` operand emits `vec2<f32>(C, 0.0)` with `C: f32`, the `f32` value of 0.1. The written `x * 0.1` on an `f64` `x` carries the full double (Rule 5.2).                                                                                                                                                                                                             |
| F11 | fact      | No published release carries `TS8053`. npm lists only the placeholder `0.0.0` for `typeshade` (`npm view typeshade versions`); the repository has no tag and no GitHub release (`gh api repos/typeshade/typeshade/releases` returns 0). Only `CHANGELOG.md` and `package.json` name `0.1.0`. Rule 13.10 counts published releases, so step one of #148's window has not started.                               |
| F12 | fact      | Downstream grep of `u32(N)` / `i32(N)` in `*.ts` and `*.md`: typecv 24 hits at `5c3f8ce`, typeaudio 4 at `8bd1ab1`, typenn 0 at `3a7d66c`, radiance 0 at `3e4efb3`, vscode-typeshade 2 at `db3f417`, typeplot 130 at `9f20c12` (typeplot is not in `DOWNSTREAM_REPOS`). `TS8053` is named in vscode-typeshade (4 lines) and in the site (apps/typeshade/src/lib/error-codes.ts in typeshade/web at `990ec50`). |
| F13 | fact      | A module constant above 2^24 is rounded to `f32` today, also through a cast: `const PRIME = 2654435761; vi * u32(PRIME)` emits `const PRIME: f32 = 2654435761.0;`, whose `f32` value is 2654435840. `const K = 16777217; vi + u32(K)` emits `const K: f32 = 16777217.0;` (the `f32` value is 16777216). Both carry `TS8053` today.                                                                             |
| F14 | inference | From F13 and Rule 5.4: under #148's `i32` default alone, `const PRIME = 2654435761` does not fit `i32` and is refused. Item 2 reads it at its written value instead.                                                                                                                                                                                                                                           |

### Alternatives

**Option A: item 5 only.** Rewrite the examples, surface §13 and the guides to the forms the
compiler accepts today. Change no rule.

- Cost to the author: the forms of F7 stay refused. `const K = 3; vi * K` still needs
  `u32(K)`. Once #148's default lands, `let acc = 0; acc += x` is refused and the author writes
  `0.` again, so the decimal point comes back as a rule to learn.
- Cost to the compiler: none beyond the text. No rule, no code.
- OD check: reverses no entry. It meets OD-3 for the forms of item 5 only.

**Option B (recommended): items 1 to 5, with the default of #148.**

- Cost to the author: nothing new to learn. The forms of F7 compile. A declaration that no use
  decides still takes the default; an author who wants another type annotates it, as today.
- Cost to the compiler: an extension of `src/compiler/ts/local-numeric-inference.ts` from
  declared uses to operator, index, compound-assignment and return uses, solved as a fixed
  point; a constant of no fixed type at module and function scope, whose reads the compiler
  types one by one (under Q1 Side 1, the compiler also folds them; see Q1); a per-read hover;
  tests on both halves.
- Compatibility: item 1 decides only declarations whose integer uses are refused today, or
  whose float uses already take the `f32` default (inference, checked on the cases of F7 and
  F9). Item 2 changes a value for a constant that `f32` does not hold exactly, in every read,
  a cast included (F13), and in the CPU oracle's recorded value. Q4 decides how. Q1 Side 2
  would change values too.
- OD check: rests on OD-3 and OD-1 (below). Reverses no entry.

**Option C: items 1, 2, 4 and 5, and refuse a written number that no use decides.**

- Cost to the author: `let k = 0` with no deciding use is refused, and the author writes
  `let k: f32 = 0` or `0.`. That is a new refusal to learn, which OD-3 counts against.
- Cost to the compiler: a refusal and its message in both halves; a breaking change under
  Rule 13.9, since `compile()` refuses programs it accepts; it reverses the default #148
  decided, which the maintainer recorded in §14.
- OD check: reverses no OD entry, but it pushes a statement onto the author that the compiler
  could make, which OD-3 asks to avoid.

**Option B with an `f32` default.** The same as Option B, with the default kept at `f32` and
#148 withdrawn. It reverses no OD entry. It reverses the decision #148 records (§14, roadmap
T15). Q2 lists it. It is not recommended here.

### Recommendation

Option B. It rests on:

- **OD-3**: the type of a literal is something the compiler can know from the program. The
  author stops writing casts and decimal points for it. The language gains no name and no form.
  Rules 5.1 and 5.2 widen what the compiler reads.
- **OD-1**: whether TypeScript's own checker gives `1` the type `number` is not a criterion for
  the language. The editor shows the compiler's type (Rule 12.7), as it does for every local
  today.

Option B keeps #148 as recorded. It does not decide Q1, Q3 or Q4, and the front matter's
`codes` field depends on Q4.

## Owner's decisions

- **OD-3** (the language stays small; the compiler's work is not pushed onto the author). The
  proposal removes a reason to write a cast or a decimal point, and adds nothing an author
  writes.
- **OD-1** (TypeShade is a language of its own). The typing of a written number is the
  language's, read by its own compiler and language service, and not TypeScript's `number`.
- **OD-4** (show the owner what changes). The examples and the table above show each form
  before and after, and the options and open questions carry their costs.
- **OD-2** and **OD-5** are not touched.

The proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name and no surface form. Under Q4 Option
4a it may add a warning code; that code warns, and it adds nothing an author writes. The
proposal widens Rules 5.1 and 5.2 so that the compiler, not the author, decides the type of a
written number from its uses. The compiler can do this because every use it adds is in the
same program, with a type the front end already computes for `TS8003`. Four design choices for
the owner remain: the default for a declaration that no use decides (Q2), the arithmetic of a
literal-only expression (Q1), the declaration hover (Q3) and the value change of item 2 (Q4).

## Open questions for the owner

Two principles, rules or costs point different ways on each question below. This draft does
not choose.

### Q1. The arithmetic of an expression of written numbers

- Side 1, the ECMAScript value: Rule 1.3 makes the CPU oracle give "ECMAScript's result for a
  form borrowed from ECMAScript", and Rule 2.1 (b) lists a literal and an operator among the
  forms borrowed from ECMAScript. Surface §12 folds `f64(1 / 3)` to the JavaScript value. Today
  `1 / 2` folds to `0.5` (F9).
- Side 2, WGSL's abstract arithmetic: §1.8 keeps "the arithmetic of a borrowed WGSL type" WGSL's,
  and Rule 5.1's rationale is "WGSL's abstract-integer rule". In WGSL, `const h = 1 / 2;` is an
  AbstractInt, and its value is `0`.
- Example for item 2: `const h = 1 / 2; return f32(i) * h;`. Side 1 gives `f32(i) * 0.5`, as
  today. Side 2 gives `f32(i) * 0.0`; a program that compiles today computes something else, so
  it needs the window of Rule 13.10 and a warning.
- Example for item 1: `let h = 3 / 2; h += i;` with `i: i32`. Side 1 gives an `i32` local whose
  initializer is 1.5, which does not fit, so it stays refused, as `const q: i32 = 3 / 2` is
  (F9). Side 2 gives an `i32` local initialized with `1`.
- What each side asks of the emitters: under Side 1 the compiler folds or inlines every read of
  a constant of no fixed type, and the WGSL and GLSL text carry only concrete values. Emitting
  WGSL's own `const K = 3;` and leaving `K / 2` to WGSL would give Side 2 on the GPU and Side 1
  on the CPU oracle. Under Side 2 the WGSL emitter may emit an abstract `const`, and the GLSL
  emitter and the CPU oracle compute AbstractInt arithmetic themselves.

### Q2. The type of a written number that no use decides

- Side 1, `i32`: #148, decided by the maintainer and recorded in §14 and roadmap item T15; WGSL
  concretizes an AbstractInt to `i32`. The window of Rule 13.10 has not started, because no
  published release carries `TS8053` yet (F11). So the flip lands no earlier than the breaking
  release after the first published release that carries the warning.
- Side 2, `f32`: the surface's history (Rule 5.1's rationale), and "ordinary TypeScript first"
  (`docs/roadmap.md`): a TypeScript reader expects `function g() { return 1; }` and `x * g()`
  to work.
- Side 3, a refusal (Option C): the author states the type, which OD-3 counts against.
- One example: `function g() { return 1; } … return x * g();` with `x: f32`. `i32` refuses it
  (`i32` beside `f32`, `TS8003`); `f32` emits `x * g()` with `g() -> f32`; a refusal asks for
  `function g(): f32`.
- Option B keeps Side 1, as #148 records it. With item 1, Side 1 reaches far fewer lines than
  #148 measured (F6).

### Q3. The hover at the declaration of a constant of no fixed type

- Spelling 1, TypeScript's literal type: `const K: 3`. It is what TypeScript's checker says
  today, and it shows that `K` has no fixed type.
- Spelling 2, the language's own words: for example `const K = 3 (no fixed type: i32, u32, f32 or f64 where it is read)`. OD-1 makes the language's reading, not TypeScript's, the one the
  editor shows. It is a new phrase that the site and the editor document.
- Both read the same at each use: the compiler's type for that read (item 4).

### Q4. A constant that `f32` does not hold exactly (item 2)

Today the compiler rounds `const PRIME = 2654435761` to the `f32` value 2654435840, also when it
is read through a cast (F13). Item 2 reads it at its written value. Such a program compiles
before and after and computes something else. Rule 13.10 governs that kind of change.

- Option 4a, the window: a published release first warns on each affected line, then the next
  breaking release changes the value. The warning is either `TS8053` with a new text for these
  lines (for example: `"PRIME" is rounded to f32 today (2654435840); it will be read as
2654435761. Write "PRIME: f32" to keep the rounded value.`) or a new code. Either way the
  front matter's `codes` field changes, and the CHANGELOG names the edit that keeps the old
  value.
- Option 4b, a narrower item 2: item 2 covers a constant whose value `f32` holds exactly
  (|K| ≤ 2^24). A larger constant keeps today's `f32` rounding, so no read changes value and no
  code is needed. The author of `PRIME` still writes `const PRIME: u32 = 2654435761`.
- One example: `const PRIME = 2654435761; return vi * u32(PRIME);`. Today and under 4b:
  `vi * u32(PRIME)` with `PRIME: f32 = 2654435761.0` (the value 2654435840). Under 4a, after the
  window: `vi * 2654435761u`.

## What it touches

- **Rule 5.1**: widened as items 1 to 3 say. Its "Enforced by" adds the new tests.
- **Rule 5.2**: a read of a constant of no fixed type takes a typed peer's kind, as a written
  number does, including the `f64` lift (item 2).
- **Rule 5.5**: unchanged, because item 1 is limited to integer-written initializers.
- **Rule 12.7**: the editor shows the compiler's per-read type for a constant of no fixed type,
  and the declaration spelling of Q3.
- **Surface §12**: a module `const` of an integer-written number is a constant of no fixed type
  (item 2).
- **Surface §13**: rewritten for items 1 to 3; the snippets drop needless casts and decimal
  points (item 5); the paragraph on the #148 window names the smaller set of declarations and
  states that the window has not started (F11).
- **`docs/language-design.md` §14**: the #148 row describes the narrower reach of the default.
  It is not a `**Rule**` paragraph.
- **Codes**: none under Q4 Option 4b. Under Option 4a, `TS8053` gets a new text for the affected
  lines or a new code is added, and this field is updated before acceptance. `TS8003` keeps its
  role for conflicting uses.
- **Examples**: the set of `examples/*.shade.ts` does not change. Their text drops needless
  casts and decimal points (F2 to F4); every golden stays byte-identical for item 5.
- **Exports and names**: none.

Required evidence at implementation (not yet applicable): tests that read both halves on one
source for each row of the forms table (`compile()` emit or `TS8003`, editor `getDiagnostics`
and `getHover`); a test for each edge of item 2 (a cast, a constant from a constant, an
imported constant, a loop bound, a constant above 2^24); a test that a cycle of item 1 takes the
default; a CPU-oracle test against the GPU for a folded constant; the compile gate on both
targets; `src/language-service/expression-parity.test.ts` with no new divergence; the example
goldens re-baked and reviewed.

### Draft impact estimate

- Known: item 5 touches about 1160 lines in 93 example files (F4) and moves no emitted byte.
- Known: no export or name changes. Codes depend on Q4.
- Estimate: item 1 is an extension of an existing pass with its tests, larger than change 0037
  because it adds a fixed point over arithmetic. Basis: change 0037 added assignment and member
  contexts to the same inference and said it was "not general inference through arithmetic".
- Estimate: item 2 is new work in the module-constant lowering, both emitters and the CPU
  oracle. Size unknown.
- Unknown: how many of the 60 `TS8053` lines of F4 item 1 decides (F6).
- Downstream: the site and the editor rewrite text; typecv and typeaudio may drop casts and
  check their constants above 2^24 against Q4. Under Q4 Option 4b no downstream program changes
  value or stops compiling (inference).

Decisions to resolve before acceptance:

1. Open questions Q1 to Q4.
2. Whether item 2 also covers a float-written `const` (`const C = 0.1`). Including it makes a
   `const` beside an `f64` carry the full double, as the written number does (F10). That
   changes a value a program computes today, so it would take the window of Rule 13.10. This
   draft leaves it out of scope.
3. Whether item 1 reaches the elements of an untyped array literal once change 0114 S2 lands
   (`const a = [1, 2, 3]; a[i] * x`). S2 says the element type follows Rule 5.1. This draft
   leaves array elements out of item 1: S2 decides one element type for all elements, and its
   own implementation carries that work.
4. Whether item 5 ships in its own pull request before items 1 to 4. It needs no rule change
   and moves no emitted byte.

### Independent review record

Reviewer: an AI agent (Claude Code) that did not write this proposal, run by the session's
coordinator. Date: 2026-11-09. Revision reviewed: commit `39eff7be` on
`claude/clever-ramanujan-yrfjsq-proposal-0134`. The reviewer reproduced every measurement.
Each finding and the author's answer:

1. **Blocking.** Item 2 changes values through a cast (`const PRIME = 2654435761; vi * u32(PRIME)`,
   `const K = 16777217`, `const K = -16777219; i32(K)`), so "no value change", "codes: none" and
   "TS8053 keeps its text" were false. Fixed: F13 and F14 record the measurement; item 2 names
   the value change; Q4 puts the window (4a) against a narrower item 2 (4b) to the owner; the
   `codes` field states its dependence on Q4. The item 2 versus item 3 conflict is resolved: a
   cast is a use, so a constant of no fixed type never takes the default.
2. F11 was false: `0.1.0` is not published. Fixed: F11 now records npm (`0.0.0` only), no tag and
   no GitHub release; Q2 Side 1 says the window has not started.
3. Q1 also bears on item 1. Fixed: Q1 shows `let h = 3 / 2; h += i;` under both sides (F9 adds
   the measurement).
4. Item 4 chose the declaration hover by itself, against its OD-1 citation. Fixed: item 4 gives
   the per-read hover; Q3 shows both declaration spellings.
5. Item 1's float-written initializers collided with Rule 5.5. Fixed: item 1 is limited to
   integer-written initializers, as changes 0036 and 0037; Rule 5.5 is unchanged.
6. The exclusions of changes 0036 and 0037 were not cited. Fixed: "Answers to changes 0036 and
   0037" below; item 1 says how cycles resolve.
7. Item 2 edges were missing. Fixed: item 2 lists the cast, a constant from a constant, an
   exported constant read by another module or the host, the loop bound (now the second
   example) and the CPU oracle's recorded value.
8. Under Q1 Side 1, WGSL's own `const` would compute Side 2. Fixed: Q1 states what each side
   asks of the emitters and the oracle.
9. The text both kept #148 and asked the owner to confirm it. Fixed: Option B keeps #148 as
   recorded; Q2 shows the other sides.
10. Bitwise and shift operators were not covered. Fixed: item 1 counts them as an integer
    demand (`i32` when no operand has a type); F7 adds `let f = 0; f = f | 4`.
11. Untyped array literal elements (0114 S2) were not addressed. Fixed: decision 3 above leaves
    them out of item 1 and says why.
12. Front matter and approval. Fixed: `rules` adds `5.2` (Rule 5.5 is not changed, see finding
    5); the Approval and plan record says that item 5's pull request is not approved in advance.
13. OD-5 is on `main`. Fixed: "OD-2 and OD-5 are not touched".
14. "Parts the compiler cannot decide" was the wrong frame. Fixed: "design choices for the
    owner".
15. The baseline moved. Fixed: the branch merged `main` at `583891d2`; every measurement was
    repeated there with the same results.

### Answers to changes 0036 and 0037

Changes 0036 and 0037 excluded these, and surface §13 states them:

- "Compound assignments and circular inference supply no demand." Item 1 lifts the first: a
  compound assignment beside a typed value states the local's type as a simple assignment does.
  Circular inference stays without a demand: item 1 solves locals as a fixed point, and a cycle
  that reaches no typed peer takes the default of item 3, independent of source order.
- "This is not general inference through arithmetic" (change 0037). That was a scope limit,
  with no rule behind it. Item 1 is that general inference, limited to one function's locals.
- "A module constant … keep[s] [its] existing rules." Item 2 changes that rule for an
  integer-written module constant, with the value change of Q4.
- Loop induction variables, explicit annotations, casts and float-written initializers keep
  their rules, as in 0036 and 0037.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decisions on Q1 to Q4 and
on the decisions above, the independent review above, and a merge of this file with
`status: accepted`. Item 5 changes how authors write examples. Its implementing pull request is
therefore not approved in advance, even after acceptance: its body shows one example before and
after, and it waits for the owner's "merge" (`CLAUDE.md`, Merging).

### Configuration and validation record

This record does not yet apply. Delivery will require the implementation pull requests with
`Change: 0134`, the tests and gates listed under "What it touches", and the re-baked goldens.

## What it owes downstream

Expected work (draft):

- **typeshade.github.io** (repository typeshade/web): the language reference text on literals,
  the `TS8053` entry in apps/typeshade/src/lib/error-codes.ts, and each snippet that writes a
  cast or a decimal point only to type a literal. Record 0134 in `compiler-changes.md`.
- **vscode-typeshade**: plugins/typeshade/skills/typeshade/references/language.md lines 205-214
  at `db3f417` say that "an index and arithmetic decide nothing" and that `let i = 0` is an
  `f32`; both change. The `TS8053` row of references/diagnostics.md names fewer declarations.
  Record 0134 in `compiler-changes.md`.
- **typecv** and **typeaudio**: dropping casts is optional cleanup. Each module constant above
  2^24 follows Q4. Record 0134 in `compiler-changes.md` when the pin moves.
- **radiance** and **typenn**: no grep hit (F12); nothing is owed beyond the record of the id
  if a later pin requires it.
- **typeplot** is not in `DOWNSTREAM_REPOS`; it holds 130 hits (F12) and owes nothing under
  this process.
