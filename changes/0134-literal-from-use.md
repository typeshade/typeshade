---
id: '0134'
title: A written number takes its type from where the program uses it, so an author writes `1` and `4` and no cast, decimal point or default type
status: draft
rules:
  - '5.1'
  - '5.2'
  - '12.7'
  - '13.10'
surface:
  - 12
  - 13
exports: []
exports-removed: []
codes:
  - TS8053
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: Rewrite the literal-typing text of the language reference; remove the TS8053 entry in apps/typeshade/src/lib/error-codes.ts; rewrite every playground or guide snippet that writes `u32(1)` or `0.` only to type a literal; record 0134 in compiler-changes.md
  - repo: vscode-typeshade
    what: Rewrite the literal-typing bullets of plugins/typeshade/skills/typeshade/references/language.md (lines 205-214 at db3f417) and remove the TS8053 row of references/diagnostics.md; record 0134 in compiler-changes.md
  - repo: typecv
    what: Optional cleanup of literal casts in shaders (24 grep hits at 5c3f8ce); review each module constant above 2^24, whose value becomes exact; record 0134 in compiler-changes.md when the pin moves
  - repo: typeaudio
    what: Optional cleanup of literal casts in shaders (4 grep hits at 8bd1ab1); review each module constant above 2^24, whose value becomes exact; record 0134 in compiler-changes.md when the pin moves
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0134, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. Revised 2026-11-09 (UTC) by the same agent after the independent review, and again after the owner's decisions on Q1, Q2 and Q4, all recorded below. The dates are drafting and revision dates. They are not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                    |
| Request source                | The owner (Seungup) asked on 2026-11-09 which parts of the surface push the compiler's work onto the author, judged against OD-3. From the audit the owner chose item 1, numeric literals, for a proposal. The owner decided Q1, Q2 and Q4 in the same session (Decisions of the owner, below).                                                                                                                                                                                                                                                                                                                                                                                         |
| Applicability / effectivity   | Expected: `src/compiler/ts/local-numeric-inference.ts`, `src/compiler/ts/lit-coerce.ts`, `src/compiler/ts/numeric.ts`, `src/compiler/ts/integer-literal-deprecation.ts` and its tests (removed), `src/compiler/ts/codes.ts`, the module-constant lowering, the function and class-field lowering, the WGSL and GLSL emitters, the CPU oracle's constant values, `src/language-service/hover.ts`, `docs/language-design.md` (Rules 5.1, 5.2, 12.7, 13.10, §14), `docs/use-typeshade-surface.md` (§12, §13), `docs/roadmap.md` (T15), `RELEASING.md` (§7), `docs/language-service-api.md`, `examples/*.shade.ts` (content only), `CHANGELOG.md`, `reqs/`. No release version is assigned. |
| Review baseline               | First draft on `main` at `2cc98b8f` (merge of pull request #1113). Revisions on `main` at `583891d2` (merge of pull request #1120), merged into the branch. Every measurement below was repeated on `583891d2` on 2026-11-09 with Bun's runtime and the tree's own `compile()` and `createTypeshadeLanguageService()`, with the same results.                                                                                                                                                                                                                                                                                                                                           |
| Review and revision authority | Pull request #1121 (draft). Git records the revisions of this file. A merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

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
  (`TS8003 … cannot compare i32 and f32`);
- a function with no declared result that returns a written number:
  `function g() { return 1; }` is `fn g() -> f32`, so `vi + g()` is refused (`TS8003`).

`TS8053` (`INT_LITERAL_DEPRECATION`) warns, under `compile(src, { deprecations: true })`, on
each declaration that takes the `f32` default. Its text says the declaration "will type as
i32", because #148 decided that the default becomes `i32` (§14, roadmap item T15, Rule 13.10).

### Proposed

1. **A number takes its type from every place it reaches (Rule 5.1).** This applies to an
   unannotated `let`, `const`, module variable or class field initialized by an integer-written
   literal, or by an expression whose leaves are all integer-written literals, and to the result
   of a function with no declared result type that returns such a value. A float-written
   initializer (`let k = 2.0`) keeps its rules, so Rule 5.5 does not change. The compiler reads
   these places, added to the declared uses of Rule 5.1:
   - an operand of an arithmetic or comparison operator beside a typed peer (`vi + k`,
     `k < i`, `x * k`): the peer's type;
   - an operand of a bitwise or shift operator (`f | 4`, `k << 2`): the typed peer's integer
     type, or an integer when no operand has a type;
   - an index (`xs[k]`): an integer;
   - a compound assignment (`k += vi`, `acc += x`) and an assignment from a typed value;
   - a `return` in a function whose result type is declared;
   - an argument passed to a declared parameter (as today), and a value received from a function
     whose result the callers decide: `function g() { return 1; }` takes the type `vi + g()`
     gives it. Callers that demand two types get one copy of `g` for each type, as the compiler
     already makes one copy of a generic function for each set of argument types (surface §30);
   - another value that takes its type in the same way. For example,
     `let it = 0; it += 1; return it / 100;` in an `f32` function makes `it` an `f32` through
     `it / 100`.

   The compiler solves all of these together, as a fixed point over their demands. The result
   does not depend on source order. Uses of one local or one field that demand two concrete
   types stay refused with `TS8003` and the annotation remedy, as Rule 5.1 says today.

2. **A `const` of an integer-written number is a constant of no fixed type until a use gives it
   one (Rules 5.1 and 5.2, surface §12 and §13).** This is WGSL's abstract `const`. Each read of
   `K` in `const K = 3` takes the type the written number `3` would take in the same place,
   including the `f64` lift of Rule 5.2. So `vi * K` is `vi * 3u` and `x * K` is `x * 3.0` in one
   function, and `const N = 8; for (let j = 0; j < N; j++)` compiles. Its edges:
   - A cast is a use. `u32(K)` converts the written number, as `u32(3)` does. A constant of no
     fixed type therefore never needs the choice of item 3.
   - A `const` initialized from such constants and written numbers (`const M = K * 2`) is one
     too. Its value is the ECMAScript value of the expression (decision Q1).
   - The compiler folds or inlines every read. The WGSL and GLSL text carry only concrete
     values, never WGSL's own untyped `const K = 3;` with `K / 2` left to WGSL. Otherwise the GPU
     would compute WGSL's abstract arithmetic (`1 / 2` is `0`) while the CPU oracle computes the
     ECMAScript value (`0.5`).
   - An exported constant read by another `"use typeshade"` module takes, at each read, the
     type the read gives it. The host view of change 0116 spells it `number`, with no phantom
     scalar name. This is an estimate; the implementation checks reflection and the manifest.
   - A constant that `f32` does not hold exactly (|K| > 2^24) is read at its exact value, at
     once (decision Q4). Today the compiler rounds it to `f32`, and the CPU oracle records that
     rounded value. "Values that change" lists the cases.
   - A float-written initializer (`const C = 0.1`) keeps today's `f32`; see "Decisions to
     resolve before acceptance".

3. **There is no default type (decision Q2).** Where nothing in the program decides a value's
   type, the compiler chooses one by itself. The author does not see the choice and has nothing
   to learn or write. The choice follows the ECMAScript value of decision Q1:
   - A value that no place reads (an unused local, a module variable that is only written) can
     take either type. No result can see it. The compiler takes `i32`.
   - A value whose computation stays inside the integers (`+`, `-`, `*`, `%`, bitwise, shift,
     comparison, read only by a cast) takes `i32`. Its results equal the ECMAScript values up to
     2^31, and ECMAScript's own bitwise operators work on 32-bit signed integers. `f32` equals
     them only up to 2^24.
   - A value that a `/` or `**` reaches, or that meets a non-integer, takes `f32`. For example,
     `let k = 7; let h = k / 2; return u32(f32(h) * 2.);` keeps `h = 3.5`, which is the
     ECMAScript value, as today. An `i32` would give `3`.
   - Where it can be seen: only out of range. An `i32` result above 2^31 wraps, and an `f32`
     result above 2^24 rounds; ECMAScript keeps a double. A value the compiler knows at compile
     time is checked against Rule 5.4, as today. A value only known at run time is not. The
     choice above is the one closest to the ECMAScript value in each case.

   This supersedes #148's decision that the default becomes `i32`. `TS8053` loses its subject
   and is retired: no declaration "types as f32 today" and "will type as i32", so no warning
   has a true text. The number is not reused (the convention in the header of
   `src/compiler/ts/codes.ts`). The option `compile(src, { deprecations: true })` and
   `tshc check --deprecations` stay, as the mechanism of Rule 13.10 for a later window, and
   report nothing until one opens.

4. **The editor names the same type (Rule 12.7).** TypeScript types `const K = 3` as the
   literal type `3` and `let k = 0` as `number`. The ambient library's scalar brands are
   optional (`src/language-service/ambient.ts`, the head comment), so a `number` flows into
   every `f32`, `i32` and `u32` position, and TypeScript's half accepts every form above. The
   compiler's `TS8003` reaches the editor through the shared analysis, as it does today (F7).
   Hover shows the compiler's type for a local, a field and a function's result
   (`let k: u32`, `function g(): u32`). At each read of a constant of no fixed type, hover shows
   the compiler's type for that read (`K: u32` in `vi * K`). The spelling at the declaration is
   Q3, the one open question.

5. **The examples, the surface sections and the guides stop teaching casts and decimal points
   that the compiler does not need.** This item needs no rule change: the compiler accepts the
   rewritten forms today (F2 to F4). It belongs here because it is the author-visible half of the
   same change. It changes how authors write examples, so its implementing pull request waits
   for the owner's "merge" (Approval and plan record).

### Values that change

No release is published (F11), so no user upgrades across these changes, and the owner decided
on 2026-11-09 that they take effect at once, with no warning release (decision Q4, and Q2 for
item 3). The precedent is change 0131, item 7: a construct that was never released is changed
without a window. The `CHANGELOG.md` entry under `[Unreleased]`, `### Changed`, names each
change, the old value, the new value and the edit that keeps the old one:

- A module or local `const` of an integer-written number that `f32` does not hold exactly, read
  through a cast or beside an `f64` (F13). `const PRIME = 2654435761; vi * u32(PRIME)` read
  2654435840 and reads 2654435761 (`vi * 2654435761u`). `const K = 16777217; vi + u32(K)` read
  16777216 and reads 16777217. `const K = -16777219; i32(K)` read -16777220 and reads -16777219.
  To keep the old value, write `const K: f32 = …`.
- A local, field or module variable initialized by an integer-written number that nothing
  decides and whose computation stays inside the integers: an `f32` today, an `i32` after.
  Its values are the same up to 2^24. Above 2^24 the `f32` rounds and the `i32` is exact, so a
  counter (`let c = 0; … c += 1; return f32(c);`) that passes 16777216 now counts on, as
  ECMAScript does. To keep the old type, write `let c: f32 = 0`.
- In `examples/`, the one such declaration is `let calls = 0` in `loop-on-cpu.shade.ts`, a
  module variable that is only written (F15). Its emitted type moves from `f32` to `i32`; no
  result reads it.

The CPU oracle's recorded values move with the emitted values, so the GPU and the oracle still
agree.

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

| What the author means                    | Today                                  | After                                                   |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| An integer beside a typed peer           | `vi & u32(1)`, `band > i32(2)`         | `vi & 1`, `band > 2` (accepted today; item 5)           |
| A float beside a typed peer              | `f32(n) * 4. - 1.`                     | `f32(n) * 4 - 1` (accepted today; item 5)               |
| A vector component                       | `vec4(x, y, 0., 1.)`                   | `vec4(x, y, 0, 1)` (accepted today; item 5)             |
| A float accumulator                      | `let acc = 0.; acc += x`               | `let acc = 0; acc += x` (item 1)                        |
| An integer accumulator                   | `let n: u32 = 0; n += vi`              | `let n = 0; n += vi` (item 1; refused today)            |
| A counter used as an index               | `let j: i32 = 0; xs[j]`                | `let j = 0; xs[j]` (item 1; refused today)              |
| Bit flags                                | `let f: u32 = 0; f = f \| u32(4)`      | `let f = 0; f = f \| 4` (item 1; refused today)         |
| A result the callers decide              | `function g(): u32 { return 1; }`      | `function g() { return 1; }` (item 1; refused today)    |
| A named constant used at two types       | `const K = 3; vi * u32(K)` and `x * K` | `const K = 3; vi * K` and `x * K` (item 2)              |
| A loop bound                             | `const N: i32 = 8; … j < N`            | `const N = 8; … j < N` (item 2; refused today)          |
| A number nothing decides                 | `let k = 0.` (f32), `let k = 0` (f32)  | `let k = 0.` (f32), `let k = 0` (the compiler's choice) |
| An explicit type, where the author wants | `u32(1)`, `let k: u32 = 1`, `1.`       | unchanged; every form of today still compiles           |

## Why

OD-3 says that a construct exists only for what the author must state and the compiler cannot
know. A cast on a literal (`u32(1)`) and a decimal point written only to pick `f32` (`4.`) state
a type that the position already states. A default type that the author must learn (`f32`
today, `i32` under #148) is a rule the compiler can replace by reading the program. The compiler
reads the positions. For the forms of item 5 it already acts on them. For the forms of items 1
to 3 it can, by reading every place a number reaches.

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
| F6  | inference | From F4: the 59 new `TS8053` lines are where a fixed default decides the type once the author drops the decimal point. Item 1 decides most of them from their uses, and item 3 the rest. The split is not measured; it needs the implementation.                                                                                                                                                               |
| F7  | fact      | Refused today in both halves with the same `TS8003`: `let n = 0; n += vi`; `let j = 0; j = j + 1; xs[j]` (`Index must be i32 or u32.`); `let f = 0; f = f \| 4`; `const K = 3; vi * K` at module scope; `const k = 1; i + k`; `const N = 8; … for (let j = 0; j < N; j++)`; `function g() { return 1; }` with `vi + g()`.                                                                                      |
| F8  | fact      | Editor hover today: `const m = vi & 1` is `const m: u32`; `const x = f32(vi & 1) * 4 - 1` is `const x: f32`; `let k = 1` passed to `h(a: u32)` is `let k: u32`; `const k = 1` with no deciding use is `const k: f32`. The editor reports no TypeScript error for any form above.                                                                                                                               |
| F9  | fact      | Literal-only arithmetic folds with ECMAScript doubles today: `const h = 1 / 2; return f32(i) * h;` emits `f32(i) * 0.5`. `const q: i32 = 3 / 2` is refused (`TS8003 … i32 and f32`). `let h = 3 / 2; h += i;` with `i: i32` is refused (`TS8003 … += f32 and i32`). Surface §12 states the ECMAScript value for `f64(1 / 3)`.                                                                                  |
| F10 | fact      | `const C = 0.1` at module scope beside an `f64` operand emits `vec2<f32>(C, 0.0)` with `C: f32`, the `f32` value of 0.1. The written `x * 0.1` on an `f64` `x` carries the full double (Rule 5.2).                                                                                                                                                                                                             |
| F11 | fact      | No published release exists. npm lists only the placeholder `0.0.0` for `typeshade` (`npm view typeshade versions`); the repository has no tag and no GitHub release (`gh api repos/typeshade/typeshade/releases` returns 0). Only `CHANGELOG.md` and `package.json` name `0.1.0`. So no published release carries `TS8053`, and step one of #148's window never started.                                      |
| F12 | fact      | Downstream grep of `u32(N)` / `i32(N)` in `*.ts` and `*.md`: typecv 24 hits at `5c3f8ce`, typeaudio 4 at `8bd1ab1`, typenn 0 at `3a7d66c`, radiance 0 at `3e4efb3`, vscode-typeshade 2 at `db3f417`, typeplot 130 at `9f20c12` (typeplot is not in `DOWNSTREAM_REPOS`). `TS8053` is named in vscode-typeshade (4 lines) and in the site (apps/typeshade/src/lib/error-codes.ts in typeshade/web at `990ec50`). |
| F13 | fact      | A module constant above 2^24 is rounded to `f32` today, also through a cast: `const PRIME = 2654435761; vi * u32(PRIME)` emits `const PRIME: f32 = 2654435761.0;`, whose `f32` value is 2654435840. `const K = 16777217; vi + u32(K)` emits `const K: f32 = 16777217.0;` (the `f32` value is 16777216). Both carry `TS8053` today.                                                                             |
| F14 | fact      | A local that nothing decides is an `f32` today: `let k = 7; let h = k / 2; return u32(f32(h) * 2.);` emits `var k: f32 = 7.0; var h: f32 = (k * 0.5);` (`h` is 3.5). `let c = 0; … c += 1; return f32(c);` emits `var c: f32 = 0.0;`. Both carry `TS8053`.                                                                                                                                                     |
| F15 | fact      | With the examples as they are on `main`, the only `TS8053` is `let calls = 0` in `examples/loop-on-cpu.shade.ts`, a module variable that `tally` writes with `calls += 1` and that no result reads.                                                                                                                                                                                                            |
| F16 | fact      | `TS8053` is the only warning `deprecations: true` reports today (`reportIntegerLiteralDeprecations` in `src/compiler/ts/source-file.ts`). An unannotated parameter is refused (`TS8002 Parameter "a" requires a TypeShade type annotation.`), so a value reaches a function only through a declared parameter.                                                                                                 |

### Alternatives

**Option A: item 5 only.** Rewrite the examples, surface §13 and the guides to the forms the
compiler accepts today. Change no rule.

- Cost to the author: the forms of F7 stay refused, and a default type stays to learn.
- Cost to the compiler: none beyond the text.
- OD check: reverses no entry. It meets OD-3 for the forms of item 5 only.

**Option B (chosen in its parts by the owner's decisions): items 1 to 5.**

- Cost to the author: nothing new to learn, and one rule less (the default type). The forms of
  F7 compile. An author who wants another type annotates, as today.
- Cost to the compiler: an extension of `src/compiler/ts/local-numeric-inference.ts` from
  declared uses to operator, index, compound-assignment, return and caller uses, across
  functions, module variables and class fields, solved as a fixed point; one copy of a function
  for each result type its callers demand; a constant of no fixed type whose reads the compiler
  types and folds one by one; the choice of item 3; a per-read hover; the removal of `TS8053`
  and its tests; tests on both halves.
- Compatibility: the values of "Values that change" move, at once, as the owner decided.
  Otherwise item 1 decides only declarations whose integer uses are refused today, or whose
  float uses already take `f32` (inference, checked on the cases of F7, F9 and F14).
- OD check: rests on OD-3 and OD-1 (below). Reverses no entry.

**Option C: refuse a written number that no use decides.** The owner's decision Q2 (no default,
the compiler chooses) rules it out. It is kept here as the record of the alternative.

## Decisions of the owner

The owner decided three questions on 2026-11-09, in the Claude Code session, in Korean. The
choices below are the owner's; the coordinator of the session relayed them.

- **Q1, the arithmetic of an expression of written numbers.** The owner chose "ECMAScript: 0.5".
  `1 / 2` is `0.5`. The compiler folds every literal-only expression with ECMAScript semantics.
  Under item 2 the emitters fold or inline, and never leave `K / 2` to WGSL.
  `let h = 3 / 2; h += i;` stays refused, because 1.5 does not fit an `i32`. The rejected side
  was WGSL's abstract arithmetic (`1 / 2` is `0`; §1.8, the rationale of Rule 5.1).
- **Q2, the type of a written number that no use decides.** The owner chose "자동추론으로"
  (automatic inference), and confirmed it as: the compiler infers a number's type from every
  place it reaches, including a function's result from its callers and a value passed on to
  where it is received; where truly nothing decides (for example an unused value), the
  compiler picks one silently, without asking the author; there is no default type the author
  has to learn. Items 1 and 3 carry this decision. It supersedes #148's `i32` default and
  retires `TS8053`. The rejected sides were a fixed `i32` default (#148), a fixed `f32` default
  and a refusal (Option C).
- **Q4, a constant that `f32` does not hold exactly.** The owner chose "바로 정확하게" (exact, at
  once). A constant above 2^24 read through a cast or beside an `f64` gives its exact value at
  once, with no warning release, because no version is published (F11; precedent 0131 and
  0132). The rejected sides were a Rule 13.10 window with a warning (4a) and a narrower item 2
  (4b).

## Owner's decisions

- **OD-3** (the language stays small; the compiler's work is not pushed onto the author). The
  proposal removes a reason to write a cast or a decimal point and removes the default type an
  author had to learn. It adds nothing an author writes.
- **OD-1** (TypeShade is a language of its own). The typing of a written number is the
  language's, read by its own compiler and language service, and not TypeScript's `number`.
- **OD-4** (show the owner what changes). The examples, the table of forms and "Values that
  change" show each change before and after.
- **OD-2** and **OD-5** are not touched.

The proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, no diagnostic code and no surface form.
It retires `TS8053`. It widens Rules 5.1 and 5.2 so that the compiler, not the author, decides
the type of a written number from every place it reaches. The compiler can do this because each
place is in the same program, with a type the front end already computes for `TS8003`. One
design choice for the owner remains: the declaration hover (Q3).

## Open question for the owner

### Q3. The hover at the declaration of a constant of no fixed type

- Spelling 1, TypeScript's literal type: `const K: 3`. It is what TypeScript's checker says
  today, and it shows that `K` has no fixed type.
- Spelling 2, the language's own words: for example
  `const K = 3 (no fixed type: i32, u32, f32 or f64 where it is read)`. OD-1 makes the
  language's reading, not TypeScript's, the one the editor shows. It is a new phrase that the
  site and the editor document.
- Both read the same at each use: the compiler's type for that read (item 4).

## What it touches

- **Rule 5.1**: rewritten as items 1 to 3 say. Its last sentence ("Where no integer type is
  established, the literal must be an `f32`") and the paragraph "The default is _open_" are
  replaced by the compiler's choice of item 3. Its "Enforced by" adds the new tests.
- **Rule 5.2**: a read of a constant of no fixed type takes a typed peer's kind, as a written
  number does, including the `f64` lift (item 2).
- **Rule 5.5**: unchanged, because items 1 and 3 cover integer-written initializers only.
- **Rule 12.7**: the editor shows the compiler's type for a local, a field, a function's result
  and each read of a constant of no fixed type, and the declaration spelling of Q3.
- **Rule 13.10**: its "Derives from" and "Enforced by" name #148 and
  `src/compiler/ts/integer-literal-deprecation.test.ts` as the first window. Both go. The rule
  text stays, for a later window.
- **Surface §12**: a module `const` of an integer-written number is a constant of no fixed type
  (item 2).
- **Surface §13**: rewritten for items 1 to 3; the snippets drop needless casts and decimal
  points (item 5); the paragraph "A window is open on the default (#148 …)" and its `TS8053`
  snippet go.
- **`docs/language-design.md` §14**: the #148 row leaves, because the decision is made. It is not
  a `**Rule**` paragraph.
- **`docs/roadmap.md` T15** and **`RELEASING.md` §7** (the open-window row): rewritten to say that
  change 0134 replaced the default and closed the window, and why (F11).
- **`docs/language-service-api.md`**: the two lines that name `TS8053` go.
- **Codes**: `TS8053` is retired, and its number is not reused. `TS8003` keeps its role for
  conflicting uses. No code is added.
- **Exports**: none change. `CompileOptions.deprecations`, `CompileTsSourceOptions.deprecations`
  and `CheckOptions.deprecations` stay, and report nothing until a later window opens (F16).
- **Examples**: the set of `examples/*.shade.ts` does not change. Their text drops needless
  casts and decimal points (F2 to F4); every golden stays byte-identical for item 5. The golden of
  `loop-on-cpu.shade.ts` moves for item 3 (F15).
- **Names**: none.

Required evidence at implementation (not yet applicable): tests that read both halves on one
source for each row of the forms table (`compile()` emit or `TS8003`, editor `getDiagnostics`
and `getHover`); a test for each edge of item 2 (a cast, a constant from a constant, an
imported constant, a loop bound, a constant above 2^24 at its exact value); a test for each case
of item 3 (unread, integer-closed, reached by `/`); a test for a function result decided by two
callers; a CPU-oracle test against the GPU for each folded constant; the compile gate on both
targets; `src/language-service/expression-parity.test.ts` with no new divergence; the example
goldens re-baked and reviewed; the `CHANGELOG.md` entry of "Values that change".

### Draft impact estimate

- Known: item 5 touches about 1160 lines in 93 example files (F4) and moves no emitted byte.
- Known: no export or name changes. One code, `TS8053`, is retired.
- Estimate: item 1 is larger than change 0037. It adds a fixed point over arithmetic, across
  functions, module variables and class fields, and copies of a function per result type.
  Basis: change 0037 added assignment and member contexts to the same inference and said it
  was "not general inference through arithmetic".
- Estimate: item 2 is new work in the module-constant lowering, both emitters and the CPU
  oracle. Size unknown.
- Unknown: how many of the 60 `TS8053` lines of F4 item 1 decides, and how many go to item 3
  (F6).
- Downstream: the site and the editor rewrite text and remove `TS8053`; typecv and typeaudio may
  drop casts and review their constants above 2^24.

Decisions to resolve before acceptance:

1. Open question Q3.
2. Whether item 2 also covers a float-written `const` (`const C = 0.1`). Including it makes a
   `const` beside an `f64` carry the full double, as the written number does (F10). That
   changes a value a program computes today. After decision Q4 it would need no warning
   release either, but this draft leaves it out of scope.
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
Each finding and the author's answer (revision `bd32b7c8`, then updated for the owner's
decisions):

1. **Blocking.** Item 2 changes values through a cast (`const PRIME = 2654435761; vi * u32(PRIME)`,
   `const K = 16777217`, `const K = -16777219; i32(K)`), so "no value change", "codes: none" and
   "TS8053 keeps its text" were false. Fixed: F13 records the measurement; Q4 went to the owner,
   who chose the exact value at once; "Values that change" lists each case. The item 2 versus
   item 3 conflict is resolved: a cast is a use, so a constant of no fixed type never needs the
   choice of item 3.
2. F11 was false: `0.1.0` is not published. Fixed: F11 records npm (`0.0.0` only), no tag and no
   GitHub release.
3. Q1 also bears on item 1. Fixed: the decision on Q1 states `let h = 3 / 2; h += i;` stays
   refused (F9 has the measurement).
4. Item 4 chose the declaration hover by itself, against its OD-1 citation. Fixed: item 4 gives
   the per-read hover; Q3 shows both declaration spellings and stays open.
5. Item 1's float-written initializers collided with Rule 5.5. Fixed: items 1 and 3 cover
   integer-written initializers only; Rule 5.5 is unchanged.
6. The exclusions of changes 0036 and 0037 were not cited. Fixed: "Answers to changes 0036 and
   0037" below.
7. Item 2 edges were missing. Fixed: item 2 lists the cast, a constant from a constant, an
   exported constant read by another module or the host, the loop bound (the second example)
   and the CPU oracle's recorded value.
8. Under Q1 Side 1, WGSL's own `const` would compute Side 2. Fixed: item 2 requires the
   emitters to fold or inline every read.
9. The text both kept #148 and asked the owner to confirm it. Superseded: the owner's decision
   on Q2 replaces #148's default.
10. Bitwise and shift operators were not covered. Fixed: item 1 counts them as an integer
    demand; F7 adds `let f = 0; f = f | 4`.
11. Untyped array literal elements (0114 S2) were not addressed. Fixed: decision 3 above leaves
    them out of item 1 and says why.
12. Front matter and approval. Fixed: `rules` adds `5.2` (and `13.10` after decision Q2); the
    Approval and plan record says that item 5's pull request is not approved in advance.
13. OD-5 is on `main`. Fixed: "OD-2 and OD-5 are not touched".
14. "Parts the compiler cannot decide" was the wrong frame. Fixed: "design choice for the owner".
15. The baseline moved. Fixed: the branch merged `main` at `583891d2`; every measurement was
    repeated there with the same results.

The revision after the owner's decisions (item 1 across functions, item 3, the retirement of
`TS8053`) has not been reviewed independently.

### Answers to changes 0036 and 0037

Changes 0036 and 0037 excluded these, and surface §13 states them:

- "Compound assignments and circular inference supply no demand." Item 1 lifts the first: a
  compound assignment beside a typed value states the local's type as a simple assignment does.
  A cycle still supplies no demand by itself: item 1 solves all values as one fixed point, and a
  cycle that reaches no typed peer goes to the compiler's choice of item 3, independent of
  source order.
- "This is not general inference through arithmetic" (change 0037). That was a scope limit, with
  no rule behind it. Item 1 is that general inference.
- "A module constant … keep[s] [its] existing rules." Item 2 changes that rule for an
  integer-written module constant.
- "Where no integer type is established, the `f32` default remains" (changes 0036 and 0037).
  Item 3 replaces the default with the compiler's choice.
- Loop induction variables, explicit annotations, casts and float-written initializers keep
  their rules, as in 0036 and 0037.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on Q3 and on the
decisions above, an independent review of the revision after the owner's decisions, and a merge
of this file with `status: accepted`. The owner's decisions on Q1, Q2 and Q4 are recorded under
"Decisions of the owner". Item 5 changes how authors write examples. Its implementing pull
request is therefore not approved in advance, even after acceptance: its body shows one example
before and after, and it waits for the owner's "merge" (`CLAUDE.md`, Merging).

### Configuration and validation record

This record does not yet apply. Delivery will require the implementation pull requests with
`Change: 0134`, the tests and gates listed under "What it touches", and the re-baked goldens.

## What it owes downstream

Expected work (draft):

- **typeshade.github.io** (repository typeshade/web): the language reference text on literals,
  the removal of the `TS8053` entry in apps/typeshade/src/lib/error-codes.ts, and each snippet
  that writes a cast or a decimal point only to type a literal. Record 0134 in
  `compiler-changes.md`.
- **vscode-typeshade**: plugins/typeshade/skills/typeshade/references/language.md lines 205-214
  at `db3f417` say that "an index and arithmetic decide nothing", that `let i = 0` is an `f32`
  and that the default will change to `i32`; all three change. The `TS8053` row of
  references/diagnostics.md goes. Record 0134 in `compiler-changes.md`.
- **typecv** and **typeaudio**: dropping casts is optional cleanup. A module constant above 2^24
  now reads at its exact value; review each. Record 0134 in `compiler-changes.md` when the pin
  moves.
- **radiance** and **typenn**: no grep hit (F12); nothing is owed beyond the record of the id
  if a later pin requires it.
- **typeplot** is not in `DOWNSTREAM_REPOS`; it holds 130 hits (F12) and owes nothing under
  this process.
