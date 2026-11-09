---
id: '0134'
title: A written number takes its type from where the program uses it, so an author writes `1` and `4` and no cast, decimal point or default type
status: draft
rules:
  - '5.1'
  - '5.2'
  - '8.14'
  - '8.19'
  - '12.7'
  - '13.10'
surface:
  - 12
  - 13
  - 14
  - 24
  - 26
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
    what: Rewrite the literal-typing bullets of plugins/typeshade/skills/typeshade/references/language.md (lines 205-214 at db3f417); remove the TS8053 row of references/diagnostics.md and the TS8053 mentions in docs/design.md (lines 607 and 612); record 0134 in compiler-changes.md
  - repo: typecv
    what: Optional cleanup of literal casts in shaders (24 grep hits at 5c3f8ce); review each module constant above 2^24, whose value becomes exact; record 0134 in compiler-changes.md when the pin moves
  - repo: typeaudio
    what: Optional cleanup of literal casts in shaders (4 grep hits at 8bd1ab1); review each module constant above 2^24, whose value becomes exact; record 0134 in compiler-changes.md when the pin moves
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0134, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. Revised 2026-11-09 (UTC) by the same agent after the first independent review, after the owner's decisions on Q1, Q2 and Q4, and after the second independent review and the owner's decision on Q3, all recorded below. The dates are drafting and revision dates. They are not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Request source                | The owner (Seungup) asked on 2026-11-09 which parts of the surface push the compiler's work onto the author, judged against OD-3. From the audit the owner chose item 1, numeric literals, for a proposal. The owner decided Q1, Q2, Q3 and Q4 in the same session (Decisions of the owner, below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Applicability / effectivity   | Expected compiler work: a new numeric type pass over the module (item 1), the module-constant, function-result, class-field and module-variable lowering, the WGSL and GLSL emitters, the CPU oracle's constant values, `src/compiler/ts/local-numeric-inference.ts`, `src/compiler/ts/lit-coerce.ts`, `src/compiler/ts/numeric.ts`, `src/language-service/hover.ts`. The retirement of `TS8053`: `src/compiler/ts/codes.ts` (the entry and the header list of retired codes), `scripts/numbering.ts` (`CODE_GAPS`), `src/compiler/ts/integer-literal-deprecation.ts` and its test, `src/compiler/ts/field-literal-deprecation.test.ts`, `src/compiler/ts/remedy-lines.test.ts`, `src/compiler/ts/array-literal.test.ts`, `src/compiler/ts/source-file.ts`, `src/language-service/check.ts` and `check.test.ts`, the `--deprecations` help line of `src/cli/run.ts`, the JSDoc of `CompileOptions.deprecations` and `CompileTsSourceOptions.deprecations`. Documents: `docs/language-design.md` (Rules 5.1, 5.2, 8.14, 8.19, 12.7, 13.10, §14), `docs/use-typeshade-surface.md` (§12, §13, §14, §24, §26), `docs/roadmap.md` (T15), `RELEASING.md` (§7), `docs/language-service-api.md`, `docs/benchmark-typescript.md`, `reqs/rules/RULE-1310.md`, `examples/*.shade.ts` (content only), `CHANGELOG.md` (`### Changed`, `### Removed`). No release version is assigned. |
| Review baseline               | First draft on `main` at `2cc98b8f` (merge of pull request #1113). Later revisions on `main` at `583891d2` and then `77e19b5a`, each merged into the branch. The measurements below were made on `2cc98b8f` and repeated on `583891d2` on 2026-11-09, with the same results. F17 to F19 were measured on `77e19b5a`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Review and revision authority | Pull request #1121 (draft). Git records the revisions of this file. A merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## What changes

### Today

A written number already takes its type from many positions (Rule 5.1, Rule 5.2, surface §13):

- a declared position: `let j: i32 = -1`, `return 0` in a `u32` function, an argument, a field;
- a typed peer in an operator or a builtin call: `vi & 1` with `vi: u32` is `vi & 1u`, and
  `x * 4 - 1` with `x: f32` is `x * 4.0 - 1.0`;
- an unannotated function-local `let` or `const` initialized by an integer-written literal whose
  declared uses demand one integer type (changes 0036 and 0037): a parameter, a typed
  initialization, a simple assignment.

Where nothing above decides, the number is an `f32` (Rule 5.1, last sentence; Rule 8.14 for a
field; Rule 8.19 for an inferred result). These do not decide today:

- a local whose only uses are operators, builtin calls, conditionals, compound assignments or
  indexes: `let acc = 0; acc += x` (an `f32` by default, so it happens to work),
  `let n = 0; n += vi`, `let j = 0; xs[j]`, `let f = 0; f = f | 4`,
  `let m = 0; m = max(m, vi)` (`TS8036`), `let k = 0; k = c ? vi : k` (refused, `TS8003`);
- a module, local or static `const` of a written number: `const K = 3` is `const K: f32 = 3.0`,
  so `vi * K` is refused and `const N = 8; for (let j = 0; j < N; j++)` is refused;
- a function with no declared result that returns a written number:
  `function g() { return 1; }` is `fn g() -> f32`, so `vi + g()` is refused.

`TS8053` (`INT_LITERAL_DEPRECATION`) warns, under `compile(src, { deprecations: true })`, on
each declaration that takes the `f32` default. Its text says the declaration "will type as
i32", because #148 decided that the default becomes `i32` (§14, roadmap item T15, Rule 13.10).

### Proposed

1. **A number takes its type from every place it reaches (Rules 5.1, 8.14 and 8.19, surface
   §13, §14, §24 and §26).** This applies to an unannotated `let`, a module variable (surface
   §24), a class field and a static field that code writes (Rule 8.14, surface §26),
   initialized by an integer-written literal or by an expression whose leaves are all
   integer-written literals, and to the result of a function with no declared result type that
   returns such a value (Rule 8.19, surface §14). A `const` is item 2. A float-written
   initializer (`let k = 2.0`) keeps its rules, so Rule 5.5 does not change (but see Q7). The
   compiler reads these places, added to the declared uses of Rule 5.1:
   - an operand of an arithmetic operator, a comparison or `==` / `===` beside a typed peer
     (`vi + k`, `k < i`, `x * k`, `k == vi`): the peer's type;
   - an argument of a builtin call beside a typed argument (`max(m, vi)`), as a written number
     takes the peer's kind in Rule 5.2: the peer's type;
   - an argument of a vector or matrix constructor (`vec3u(k, 1, 2)`): its element type;
   - an arm of a conditional (`c ? vi : k`) or of `select`: the other arm's type;
   - a field of an object literal whose struct declares the field: the field's type;
   - an operand of a bitwise or shift operator (`f | 4`, `k << 2`): the typed peer's integer
     type, or an integer of no kind when no operand has a type;
   - an index (`xs[k]`): an integer of no kind;
   - a compound assignment (`k += vi`, `acc += x`) and an assignment from a typed value;
   - a `return` in a function whose result type is declared;
   - an argument passed to a declared parameter (as today), and the result of a function whose
     callers decide it: `function g() { return 1; }` takes the type `vi + g()` gives it;
   - another value that takes its type in the same way:
     `let it = 0; it += 1; return it / 100;` in an `f32` function makes `it` an `f32` through
     `it / 100`.

   An integer of no kind is `i32`, as WGSL concretizes an AbstractInt in an integer-only
   position, unless another use says `u32`. The compiler solves all of these together, as a
   fixed point over the module. The result does not depend on source order. Uses of one value
   that demand two concrete types stay refused with `TS8003` and the annotation remedy, as Rule
   5.1 says today, except where Q6 decides otherwise for `/`. This is a new numeric type pass
   over the module and a change to the lowering order. It is not an extension of
   `src/compiler/ts/local-numeric-inference.ts`, which reads one function's declared uses.

   **A function's result decided by its callers (Rule 8.19, new text).** Rule 8.19 says today
   that a function that writes no result type takes the type of its first `return`. The new
   text says: where that `return` is a written number or a value of item 1, its callers decide
   the type. Callers that demand two types get one copy of the function for each type, each a
   function of the module with its own name. The copy's name is the function's name and the
   type, made unique against every name of the module, as the compiler already makes a generic
   instance's name unique (Rule 8.9). Rule 8.9 itself does not change: its copies are per type
   argument the author writes, and these are per result type the callers use. A function whose
   result no caller in the module decides (an exported function only the host or another
   module calls, `export function g() { return 3; }`) takes the type the choice of Q5 gives it.
   Reflection, the host view (change 0116) and the CPU tier read that type. Today it is `f32`.

2. **A `const` of an integer-written number is a constant of no fixed type until a read gives it
   one (Rules 5.1 and 5.2, surface §12 and §13).** This is WGSL's abstract `const`. It covers a
   module `const`, a function-local `const` and a static field that no code writes (which Rule
   8.13 already folds as a module `const`). Each read of `K` in `const K = 3` takes the type the
   written number `3` would take in the same place, including the `f64` lift of Rule 5.2. So
   `vi * K` is `vi * 3u` and `x * K` is `x * 3.0` in one function, and
   `const N = 8; for (let j = 0; j < N; j++)` compiles. A function-local `const k = 1` read at two
   types is accepted, as a module `const` is. Its edges:
   - A cast is a read. `u32(K)` converts the written number, as `u32(3)` does. A constant of no
     fixed type therefore never needs the choice of Q5.
   - A `const` initialized from such constants and written numbers (`const M = K * 2`) is one
     too. Its value is the ECMAScript value of the expression (decision Q1).
   - The compiler folds or inlines every read. The WGSL and GLSL text carry only concrete
     values, never WGSL's own untyped `const K = 3;` with `K / 2` left to WGSL. Otherwise the GPU
     would compute WGSL's abstract arithmetic (`1 / 2` is `0`) while the CPU oracle computes the
     ECMAScript value (`0.5`).
   - An exported constant read by another `"use typeshade"` module takes, at each read, the
     type the read gives it. The host view of change 0116 spells it `number`, with no phantom
     scalar name. This is an estimate; the implementation checks reflection and the manifest.
   - A constant that `f32` does not hold exactly (|K| > 2^24) is read at its exact value
     (decision Q4). Today the compiler rounds it to `f32`, and the CPU oracle records that
     rounded value. "Values that change" lists the cases.
   - A float-written initializer (`const C = 0.1`) keeps today's `f32` (Q7).

3. **There is no default type for the author (decision Q2).** Where nothing in the program
   decides a value's type, the compiler chooses one by itself. The author does not see the
   choice and has nothing to learn or write. How the compiler chooses has observable results
   out of range, so the rule is Q5, an open question with three options. Whatever Q5 decides:
   - The choice holds every value known at compile time. `let h = 3000000000; h += 1; return f32(h);` compiles today as an `f32` (F17). It must not become an `i32` that Rule 5.4
     then refuses. Where the chosen kind cannot hold the known value, the compiler takes `f32`,
     as today. Nothing compiling today is newly refused by item 3.
   - A value that no place reads (an unused local, a module variable that is only written) has
     no observable result in either type.

   This supersedes #148's decision that the default becomes `i32`. `TS8053` loses its subject
   and is retired: no declaration "types as f32 today" and "will type as i32", so no warning
   has a true text. The number is not reused (the header of `src/compiler/ts/codes.ts`). The
   option `compile(src, { deprecations: true })` and `tshc check --deprecations` stay, as the
   mechanism of Rule 13.10 for a later window, and report nothing until one opens.

4. **The editor names the same type (Rule 12.7).** TypeScript types `const K = 3` as the
   literal type `3` and `let k = 0` as `number`. The ambient library's scalar brands are
   optional (`src/language-service/ambient.ts`, the head comment), so a `number` flows into
   every scalar position and TypeScript's half accepts every form above. The compiler's
   `TS8003` reaches the editor through the shared analysis (F7). Expected hover, per case:
   - a local, a field, a module variable: the compiler's type (`let k: u32`), as today;
   - a constant of no fixed type, at its declaration: TypeShade's own words (decision Q3), for
     example `const K = 3 (i32, u32, f32 or f64 where it is read)`;
   - the same constant, at a read: the compiler's type for that read (`K: u32` in `vi * K`).
     `src/language-service/hover.ts` keys a type by declaration today, so this needs a table per
     reference;
   - a function with two copies: at the declaration, its result in TypeShade's words
     (`function g() (u32 or f32 where it is called)`); at a call, the copy's result type;
   - an imported constant or function: the compiler's type for the read in the importing file.
     Today hover falls back to TypeScript's type for an imported name, so this needs the
     language service to analyse the import as the compiler does (it has `readDocument`);
   - an exported function or constant whose type only importers decide: the language service
     analyses one file, as the compiler's single-file compile does. In the exporting file
     nothing decides, so hover shows the Q3 words for a constant and the Q5 choice for a
     function. A copy made for an importer is visible in the importer only. Rule 12.7 holds,
     because both halves analyse the same file set.

5. **The examples, the surface sections and the guides stop teaching casts and decimal points
   that the compiler does not need.** This item needs no rule change. On today's compiler it
   moves no golden (F2 to F4). After items 1 to 3 land, the same rewrite moves goldens: for
   example `const WIN_N = 12.0` becomes `const WIN_N = 12`, a constant of no fixed type that the
   emitters inline, and `let acc = 0.` becomes `let acc = 0`, whose type follows its uses or Q5.
   So, if item 5 ships first, its goldens are byte-identical. If it ships after, the rewrite is
   measured again and its golden diff is reviewed. Item 5 changes how authors write examples, so
   its implementing pull request waits for the owner's "merge" (Approval and plan record).

### Values that change

The changes below take effect at once, with no warning release (decision Q4). TypeShade has no
official release, and the published artifacts of F11 were test builds (decision Q9, OD-6). The `CHANGELOG.md` entry under `[Unreleased]`,
`### Changed`, names each change, the old value, the new value and the edit that keeps the old
one. `### Removed` names `TS8053`. The implementing pull request shows these changes to the owner
before the merge (OD-4).

- **A constant above 2^24 (item 2, decision Q4).** A module or local `const` of an
  integer-written number that `f32` does not hold exactly, read through a cast or beside an
  `f64` (F13). `const PRIME = 2654435761; vi * u32(PRIME)` read 2654435840 and reads 2654435761.
  `const K = 16777217; vi + u32(K)` read 16777216 and reads 16777217.
  `const K = -16777219; i32(K)` read -16777220 and reads -16777219. To keep the old value,
  write `const K: f32 = …`.
- **A value nothing decides (item 3).** These depend on Q5:
  - Under Q5 option (b), nothing changes: the value stays an `f32`, with today's values.
  - Under Q5 option (a) or (c), a value whose computation stays inside the integers becomes an
    `i32` where the compiler chooses it. Values are equal up to 2^24; between 2^24 and 2^31 the
    `i32` is exact where the `f32` rounded; past 2^31 the `i32` wraps where the `f32` rounded.
    `let p = 1; for (…n…) p *= 2; return f32(p);` gives 2147483648 today and -2147483648 at
    n = 31, and 0 at n ≥ 32, under an `i32` (F18). `3 ** 20` computed by repeated `*` gives
    -808182895 under an `i32` and 3486784512 (the `f32` value of 3486784401) today.
  - A function result decided by no caller, read through a cast:
    `function g() { return 16777217; } … u32(g())` reads 16777216 today (F19). Under (b) it
    stays 16777216. Under (a) it reads 16777217. `TS8053` does not fire on it today.
  - In `examples/`, the one such declaration is `let calls = 0` in `loop-on-cpu.shade.ts`, a
    module variable that is only written (F15). Under (a) its emitted type moves from `f32` to
    `i32` and its golden moves; no result reads it. Under (b) nothing moves.

The CPU oracle's recorded values move with the emitted values, so the GPU and the oracle still
agree.

### Example

Before (`examples/array-methods.shade.ts`, lines 32-36 on `main`):

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
| A running maximum                        | `let m: u32 = 0; m = max(m, vi)`       | `let m = 0; m = max(m, vi)` (item 1; refused today)     |
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
today, `i32` under #148) is a rule the compiler can replace by reading the program. For the
forms of item 5 the compiler already reads the positions. For the forms of items 1 to 3 it can,
by reading every place a number reaches.

### Measured facts

Each row names its method. The measurements used Bun's runtime and the tree's own
`compile(src, { deprecations: true })` and `createTypeshadeLanguageService()`. The scripts were
scratch files and are not committed.

| #   | Kind      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | fact      | `examples/` holds 102 `*.shade.ts` files. 101 compile alone. `imported-noise.shade.ts` needs a `readDocument` (`TS8072`) and was left out of F2 to F4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F2  | fact      | Code lines (comments excluded) hold 62 casts of an integer-written literal, `u32(N)` or `i32(N)`, on 57 lines in 27 files. Removing every one gives byte-identical WGSL and GLSL in all 27 files, no `compile()` error and no editor error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F3  | fact      | Also removing each trailing decimal point (`4.` to `4`) and each `f32(N)` changes 744 lines in 92 files. WGSL and GLSL stay byte-identical, with no error in either half. `TS8053` warnings go from 1 to 45.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F4  | fact      | Also removing `.0` (`4.0` to `4`) changes 1160 lines in 93 files, with the same result. `TS8053` warnings go from 1 to 60. The 60 are unannotated declarations, most of them accumulators and counters (`let acc = 0`, `let it = 0`, `let sum = 0`) and four module constants in `capsule-corp-namek-class.shade.ts` (`const WIN_N = 12`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F5  | inference | From F3 and F4: the casts and most decimal points in the examples are style that the compiler has not needed since surface §13 landed. The comment at `examples/array-literal-ramp.shade.ts:44-45` ("until then a bare `2` here is an f32") is out of date: `band > 2` and `band = 2` compile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F6  | inference | From F4: the 59 new `TS8053` lines are where a fixed default decides the type once the author drops the decimal point. Item 1 decides most of them from their uses, and item 3 the rest. The split is not measured; it needs the implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F7  | fact      | Refused today in both halves: `let n = 0; n += vi`; `let j = 0; j = j + 1; xs[j]` (`Index must be i32 or u32.`); `let f = 0; f = f \| 4`; `const K = 3; vi * K` at module scope; `const k = 1; i + k`; `const N = 8; … for (let j = 0; j < N; j++)`; `function g() { return 1; }` with `vi + g()` (each `TS8003`); `let m = 0; m = max(m, vi)` (`TS8036`); `let k = 0; k = c ? vi : k` (`TS8003 Ternary arm type mismatch`); `class S { static K = 3; }` with `vi * S.K` (`TS8003`).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F8  | fact      | Editor hover today: `const m = vi & 1` is `const m: u32`; `const x = f32(vi & 1) * 4 - 1` is `const x: f32`; `let k = 1` passed to `h(a: u32)` is `let k: u32`; `const k = 1` with no deciding use is `const k: f32`. The editor reports no TypeScript error for any form above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F9  | fact      | Literal-only arithmetic folds with ECMAScript doubles today: `const h = 1 / 2; return f32(i) * h;` emits `f32(i) * 0.5`. `const q: i32 = 3 / 2` is refused (`TS8003 … i32 and f32`). `let h = 3 / 2; h += i;` with `i: i32` is refused (`TS8003 … += f32 and i32`). Surface §12 states the ECMAScript value for `f64(1 / 3)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F10 | fact      | `const C = 0.1` at module scope beside an `f64` operand emits `vec2<f32>(C, 0.0)` with `C: f32`, the `f32` value of 0.1. The written `x * 0.1` on an `f64` `x` carries the full double (Rule 5.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F11 | fact      | What is published. npm lists only the placeholder `0.0.0` for `typeshade` (`npm view typeshade versions`); the repository has no tag and no GitHub release (`gh api repos/typeshade/typeshade/releases` returns 0). `CHANGELOG.md` has a dated heading `## [0.1.0] - 2026-09-29` that says the release carries `TS8053`, and `package.json` says `0.1.0`, but no `typeshade` 0.1.0 is on npm. Artifacts that bundle the compiler are published: `@typeshade/mcp` 0.1.0 and 0.1.1 on npm (2026-09-23), and the `vscode-typeshade` extension 0.3.0 on the Visual Studio Marketplace, with compiler pin `3e1e8420` (2026-10-27; figures given by the second reviewer). They carry the `f32` default. Neither passes `deprecations`, so `TS8053` reached no user. The owner said on 2026-11-09 that these were test builds and that TypeShade has no official release (OD-6, proposed in pull request #1132). |
| F12 | fact      | Downstream grep of `u32(N)` / `i32(N)` in `*.ts` and `*.md`: typecv 24 hits at `5c3f8ce`, typeaudio 4 at `8bd1ab1`, typenn 0 at `3a7d66c`, radiance 0 at `3e4efb3`, vscode-typeshade 2 at `db3f417`, typeplot 130 at `9f20c12` (typeplot is not in `DOWNSTREAM_REPOS`). `TS8053` is named in vscode-typeshade (4 lines) and in the site (apps/typeshade/src/lib/error-codes.ts in typeshade/web at `990ec50`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F13 | fact      | A module constant above 2^24 is rounded to `f32` today, also through a cast: `const PRIME = 2654435761; vi * u32(PRIME)` emits `const PRIME: f32 = 2654435761.0;`, whose `f32` value is 2654435840. `const K = 16777217; vi + u32(K)` emits `const K: f32 = 16777217.0;` (the `f32` value is 16777216). Both carry `TS8053` today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F14 | fact      | A local that nothing decides is an `f32` today: `let k = 7; let h = k / 2; return u32(f32(h) * 2.);` emits `var k: f32 = 7.0; var h: f32 = (k * 0.5);` (`h` is 3.5). `let c = 0; … c += 1; return f32(c);` emits `var c: f32 = 0.0;`. Both carry `TS8053`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F15 | fact      | With the examples as they are on `main`, the only `TS8053` is `let calls = 0` in `examples/loop-on-cpu.shade.ts`, a module variable that `tally` writes with `calls += 1` and that no result reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F16 | fact      | `TS8053` is the only warning `deprecations: true` reports today (`reportIntegerLiteralDeprecations` in `src/compiler/ts/source-file.ts`). An unannotated parameter is refused (`TS8002 Parameter "a" requires a TypeShade type annotation.`), so a value reaches a function only through a declared parameter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F17 | fact      | `let h = 3000000000; h += 1; return f32(h);` compiles today: `var h: f32 = 3000000000.0;`, with `TS8053`. An `i32` cannot hold 3000000000 (Rule 5.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F18 | fact      | `let p = 1; for (let j: u32 = 0; j < n; j++) { p *= 2; } return f32(p);` compiles today with `var p: f32 = 1.0;` and `TS8053`. The values under an `i32` (-2147483648 at n = 31, 0 at n ≥ 32) are WGSL's wrapping `i32` arithmetic (§1.8), not measured on a device.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F19 | fact      | `function g() { return 16777217; } … return u32(g());` compiles today: `fn g() -> f32 { return 16777217.0; }`, with no `TS8053`. `export function g() { return 3; }` emits `fn g() -> f32`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Alternatives

**Option A: item 5 only.** Rewrite the examples, surface §13 and the guides to the forms the
compiler accepts today. Change no rule.

- Cost to the author: the forms of F7 stay refused, and a default type stays to learn.
- Cost to the compiler: none beyond the text.
- OD check: reverses no entry. It meets OD-3 for the forms of item 5 only.

**Option B (chosen in its parts by the owner's decisions): items 1 to 5.**

- Cost to the author: nothing new to learn, and one rule less (the default type). The forms of
  F7 compile. An author who wants another type annotates, as today.
- Cost to the compiler: a new numeric type pass over the module and a change to the lowering
  order (item 1); one copy of a function for each result type its callers demand; a constant of
  no fixed type whose reads the compiler types and folds one by one; the choice of item 3; a
  per-reference hover table, copies and imports in the language service; the removal of
  `TS8053` and its tests; tests on both halves.
- Compatibility: the values of "Values that change" move. Otherwise item 1 decides only values
  whose integer uses are refused today, or whose float uses already take `f32` (inference,
  checked on the cases of F7, F9, F14 and F17).
- OD check: rests on OD-3 and OD-1 (below). Reverses no entry.

**Option C: refuse a written number that no use decides.** The owner's decision Q2 rules it out.
It is kept here as the record of the alternative.

## Decisions of the owner

The owner decided five questions on 2026-11-09, in the Claude Code session, in Korean. The
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
  and a refusal (Option C). The cost of this decision: how the compiler chooses has observable
  results out of range, recorded under Q5.
- **Q3, the hover at the declaration of a constant of no fixed type.** The owner chose "언어
  설명" (the language's description): at the declaration, hover shows TypeShade's own words, for
  example `const K = 3 (i32, u32, f32 or f64 where it is read)`; at a read, the compiler's type
  there. The rejected spelling was TypeScript's literal type, `const K: 3`. Its costs were that
  it is TypeScript's reading and not the language's (OD-1), and that it does not tell the author
  which types the reads take.
- **Q9, whether the bundled artifacts count as published releases.** Asked about the artifacts of
  F11, the owner answered: "아직 정식 릴리즈 전이라 문제 없음 테스트용으로 한것뿐이라" (there is no
  official release yet, so there is no problem; those were only test builds). `vscode-typeshade`
  0.3.0 and `@typeshade/mcp` 0.1.x are test builds, TypeShade has no official release, and no
  warning window is owed. The session records it as OD-6 in pull request #1132. Rule 13.10 is
  amended to match (What it touches). The rejected outcome was a Rule 13.10 window for every
  value that changes.
- **Q4, a constant that `f32` does not hold exactly.** The owner chose "바로 정확하게" (exact, at
  once). A constant above 2^24 read through a cast or beside an `f64` gives its exact value at
  once, with no warning release, because no version is published (F11; precedent 0131 and
  0132). The rejected sides were a Rule 13.10 window with a warning (4a) and a narrower item 2
  (4b). Decision Q9 confirms its basis.

## Owner's decisions

- **OD-3** (the language stays small; the compiler's work is not pushed onto the author). The
  proposal removes a reason to write a cast or a decimal point and removes the default type an
  author had to learn. It adds nothing an author writes.
- **OD-1** (TypeShade is a language of its own). The typing of a written number is the
  language's, read by its own compiler and language service, and not TypeScript's `number`.
  The declaration hover is in the language's words (decision Q3).
- **OD-4** (show the owner what changes). The examples, the table of forms and "Values that
  change" show each change before and after; the implementing pull request shows its value
  changes to the owner before the merge.
- **OD-6** (no official release yet; test builds owe no window; proposed in pull request #1132,
  not yet on `main` at the time of writing). The value changes take effect without a warning
  window on its basis.
- **OD-2** and **OD-5** are not touched.

The proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, no diagnostic code and no surface form.
It retires `TS8053`. It widens Rules 5.1, 5.2, 8.14 and 8.19 so that the compiler, not the
author, decides the type of a written number from every place it reaches. The compiler can do
this because each place is in the same program, with a type the front end already computes for
`TS8003`. The design choices for the owner are Q5 to Q8.

## Open questions for the owner

Each question has options with costs and one example. Where this draft recommends one, it names
the OD entries the recommendation rests on. The owner decides.

### Q5. How the compiler chooses a type that nothing decides (item 3)

Example: `let p = 1; for (let j: u32 = 0; j < n; j++) { p *= 2; } return f32(p);`

- **(a) By the operations.** A value whose computation stays inside the integers (`+`, `-`, `*`,
  `%`, bitwise, shift, comparison, read only by a cast) takes `i32`; a value a `/` or `**`
  reaches, or that meets a non-integer, takes `f32`; an unread value takes `i32`. Results: exact
  up to 2^31, but past 2^31 an `i32` wraps: the example gives -2147483648 at n = 31 and 0 at
  n ≥ 32, where today gives 2147483648 and the rounded powers of two. The golden of
  `loop-on-cpu.shade.ts` moves (F15). The first revision of this draft called this "closest to
  ECMAScript". That is false past 2^31.
- **(b) `f32` wherever nothing decides.** The compiler's silent choice is today's type. Results:
  today's values everywhere, no golden moves, no value change beyond Q4's. Past 2^24 an `f32`
  rounds: a counter stops at 16777216, and the example gives the `f32` powers of two (exact
  for powers of two up to 2^127). The author still learns nothing: every place that decides,
  decides.
- **(c) By the known range.** The compiler takes `i32` where it proves that every value stays
  inside the `i32` range (for example a counter bounded by a loop of known trip count), and
  `f32` otherwise. Results: exact where proved, today's values elsewhere. Costs: a range
  analysis; the type can change when an edit elsewhere makes the proof fail; the author cannot
  see why.

Recommendation: (b). An `f32` that rounds past 2^24 keeps the value within a relative error of
2^-24 of the ECMAScript value (decision Q1), where a wrapping `i32` loses the value. It moves no
value and no golden, and it adds nothing an author learns. It rests on OD-3 and on decision Q2,
which asks the compiler to choose silently. The remaining cost of Q2 under (b) is the rounding
past 2^24.

### Q6. A value that an index makes an integer and a `/` reads

Example: `let k = 7; … xs[k]; … return f32(k / 2);`

- **(a) The integer demand wins.** `k` is an `i32`, and `k / 2` is WGSL's integer division: `3`.
  This is what `let k: i32 = 7` gives today. A TypeScript reader, and the ECMAScript reading of
  Q1, expect `3.5`.
- **(b) The `/` is a demand for a float, so the two uses conflict.** The compiler refuses with
  `TS8003` and the remedy (annotate `k`, or write `f32(k) / 2`). The author states the one thing
  the compiler cannot know: whether `7 / 2` here means 3 or 3.5.
- **(c) Two copies of `k`.** The compiler keeps an `i32` for the index and an `f32` for the
  division. It is what neither TypeScript nor WGSL does, and a write to `k` must reach both.

Recommendation: (b). The compiler cannot know which division the author means, and OD-3 keeps a
construct for what the compiler cannot know. Decision Q1 reads a `/` as ECMAScript's, and a
silent `3` would contradict it. It rests on OD-3 and decision Q1.

### Q7. The decimal point as the mark of an `f32`, and a float-written constant

Examples: `let k = 2.0; return vi + k;` and `const C = 0.1; return f32(x64 * C);` with
`x64: f64`.

- **(a) Keep both as today (this draft).** A float-written number stays an `f32` wherever it is
  written in a declaration (Rule 5.5 unchanged): `vi + k` stays refused, and `C` stays the `f32`
  value of 0.1 beside an `f64` (F10). The decimal point stays a way for the author to state
  `f32`.
- **(b) Extend items 1 and 2 to float-written numbers.** `let k = 2.0` takes `u32` from
  `vi + k` (Rule 5.5 changes), and `const C = 0.1` carries the full double beside an `f64`, as
  the written `x64 * 0.1` does. The decimal point then states nothing, and the example's `C`
  changes value at once (no warning release, by the basis of Q4).
- **(c) Extend item 2 only.** A float-written `const` is a constant of no fixed type among floats
  (`f32` or `f64` where it is read); a `let` keeps Rule 5.5.

Recommendation: (c). A float-written constant beside an `f64` then computes what the written
number computes, so the author need not know that a `const` rounds. A decimal point on a `let`
still states a float, which the compiler cannot know from `let k = 2`. It rests on OD-3. Item 2
and Rule 5.2 change for (b) and (c); Rule 5.5 changes for (b).

### Q8. Whether Q2 becomes an owner's decision entry

Decision Q2 says what TypeShade is: a number has no default type that the author learns, and the
compiler decides from the program. An OD entry would hold it against a later proposal, as OD-3
holds the size of the language.

- (a) Record it as OD-6, in the owner's words, in a pull request that changes
  `docs/owner-decisions.md` only (`CLAUDE.md`, The owner's decisions).
- (b) Keep it in this proposal only.

No recommendation: an OD entry is the owner's to make.

## What it touches

- **Rule 5.1**: rewritten as items 1 to 3 say. Its last sentence ("Where no integer type is
  established, the literal must be an `f32`") and the paragraph "The default is _open_" are
  replaced by the compiler's choice of item 3 (Q5). Its "Enforced by" adds the new tests.
- **Rule 5.2**: a read of a constant of no fixed type takes a typed peer's kind, as a written
  number does, including the `f64` lift (item 2).
- **Rule 5.5**: unchanged, unless Q7 (b).
- **Rule 8.14**: its second sentence ("a written number is an `f32` by Rule 5.1") changes: a field
  initialized by an integer-written number takes its type from its uses (item 1).
- **Rule 8.19**: new text for a result that its callers decide, with one copy per result type and
  its naming (item 1).
- **Rule 8.9**: unchanged; the copies of Rule 8.19 are named as its instances are.
- **Rule 12.7**: the editor shows the compiler's type for a local, a field, a function's result
  and each read of a constant of no fixed type, and TypeShade's words at a declaration
  (decision Q3), as item 4 lists.
- **Rule 13.10**: its text gains a sentence: a window is owed only for a behaviour that an
  official release of the `typeshade` package carried, and no window is owed before the first
  one (OD-6, decision Q9). A test build that bundles the compiler is not an official release. Its
  "Derives from" and "Enforced by" name #148 and
  `src/compiler/ts/integer-literal-deprecation.test.ts`, which go. A test keeps
  `Verifies: Rule 13.10`: it asserts that `deprecations: true` moves no emitted byte and reports
  no warning on a program today. `reqs/rules/RULE-1310.md` follows.
- **Surface §12**: a module `const` of an integer-written number is a constant of no fixed type.
- **Surface §13**: rewritten for items 1 to 3; the snippets drop needless casts and decimal
  points (item 5); the paragraph "A window is open on the default (#148 …)" and its `TS8053`
  snippet go.
- **Surface §14**: an inferred result decided by its callers (the section that lists inferred
  results).
- **Surface §24**: a module variable initialized by an integer-written number takes its type
  from its uses.
- **Surface §26**: a field, and a static field, initialized by an integer-written number.
- **`docs/language-design.md` §14**: the #148 row leaves, because the decision is made. It is not
  a `**Rule**` paragraph.
- **`docs/roadmap.md` T15** and **`RELEASING.md` §7** (the open-window row): rewritten to say that
  change 0134 replaced the default and closed the window, and why (F11).
- **`docs/language-service-api.md`** (two lines) and **`docs/benchmark-typescript.md`** (line 24):
  the `TS8053` mentions go.
- **Codes**: `TS8053` is retired, and its number is not reused: `src/compiler/ts/codes.ts` (the
  entry and the header list of retired codes) and `CODE_GAPS` in `scripts/numbering.ts`.
  `TS8003` keeps its role for conflicting uses. No code is added.
- **Exports**: none change. `CompileOptions.deprecations`, `CompileTsSourceOptions.deprecations`
  and `CheckOptions.deprecations` stay, and their JSDoc stops naming `TS8053` (F16).
- **Examples**: the set of `examples/*.shade.ts` does not change. Their text drops needless
  casts and decimal points (item 5, with the order condition stated there). The golden of
  `loop-on-cpu.shade.ts` moves under Q5 (a).
- **Names**: none.

Required evidence at implementation (not yet applicable): tests that read both halves on one
source for each row of the forms table (`compile()` emit or `TS8003`, editor `getDiagnostics`
and `getHover`); a test for each place of item 1; a test for each edge of item 2 (a cast, a
constant from a constant, an imported constant, a loop bound, a constant above 2^24 at its exact
value); a test for each case of item 3 under the Q5 option chosen, and for F17; a test for a
function result decided by two callers and for one decided by none; a hover test for each case
of item 4; a CPU-oracle test against the GPU for each folded constant; the compile gate on both
targets; `src/language-service/expression-parity.test.ts` with no new divergence; the example
goldens re-baked and reviewed; the `CHANGELOG.md` entries of "Values that change".

### Draft impact estimate

- Known: item 5 touches about 1160 lines in 93 example files (F4).
- Known: no export or name changes. One code, `TS8053`, is retired.
- Estimate: item 1 is a new numeric type pass over the module and a change to the lowering
  order, so that a value's type is known before the lowering of the function that declares it.
  It is larger than change 0037, which extended a one-function inference by declared uses and
  said it was "not general inference through arithmetic". Size unknown.
- Estimate: item 2 is new work in the module-constant lowering, both emitters and the CPU
  oracle. Size unknown.
- Estimate: the language-service work of item 4 (a per-reference hover table, copies, imports)
  is new work in `src/language-service/hover.ts` and the shared analysis. Size unknown.
- Unknown: how many of the 60 `TS8053` lines of F4 item 1 decides, and how many go to item 3
  (F6).
- Downstream: the site and the editor rewrite text and remove `TS8053`; typecv and typeaudio may
  drop casts and review their constants above 2^24.

Decisions to resolve before acceptance:

1. Open questions Q5 to Q8.
2. Whether item 1 reaches the elements of an untyped array literal once change 0114 S2 lands
   (`const a = [1, 2, 3]; a[i] * x`). S2 says the element type follows Rule 5.1. This draft
   leaves array elements out of item 1: S2 decides one element type for all elements, and its
   own implementation carries that work.
3. Whether item 5 ships in its own pull request before items 1 to 4 (item 5 states what each
   order does to the goldens).

### Independent review record

**First review.** Reviewer: an AI agent (Claude Code) that did not write this proposal, run by
the session's coordinator. Date: 2026-11-09. Revision reviewed: commit `39eff7be`. The reviewer
reproduced every measurement. Each finding and the author's answer:

1. **Blocking.** Item 2 changes values through a cast (`const PRIME = 2654435761; vi * u32(PRIME)`,
   `const K = 16777217`, `const K = -16777219; i32(K)`). Fixed: F13; the owner decided Q4;
   "Values that change" lists each case. A cast is a read, so a constant of no fixed type never
   needs the choice of item 3.
2. F11 was false: `0.1.0` is not published. Fixed: F11 records npm, tags and releases (and, after
   the second review, the bundled artifacts).
3. Q1 also bears on item 1. Fixed: the decision on Q1 states `let h = 3 / 2; h += i;` stays
   refused (F9).
4. Item 4 chose the declaration hover by itself. Fixed: Q3 went to the owner, who decided it.
5. Item 1's float-written initializers collided with Rule 5.5. Fixed: integer-written only; Q7
   asks the owner about the scope.
6. The exclusions of changes 0036 and 0037 were not cited. Fixed: "Answers to changes 0036 and
   0037" below.
7. Item 2 edges were missing. Fixed: item 2 lists them; the loop bound is the second example.
8. Under Q1 Side 1, WGSL's own `const` would compute Side 2. Fixed: item 2 requires the emitters
   to fold or inline every read.
9. The text both kept #148 and asked the owner to confirm it. Superseded by decision Q2.
10. Bitwise and shift operators were not covered. Fixed: item 1 counts them.
11. Untyped array literal elements (0114 S2). Fixed: decision 2 above leaves them out and says
    why.
12. Front matter and approval. Fixed: `rules` adds `5.2`; the Approval and plan record says item
    5's pull request is not approved in advance.
13. OD-5 is on `main`. Fixed: "OD-2 and OD-5 are not touched".
14. "Parts the compiler cannot decide". Fixed: "design choices for the owner".
15. The baseline moved. Fixed: measurements repeated on `583891d2`.

**Second review.** Reviewer: an AI agent (Claude Code) that did not write this proposal, run by
the session's coordinator. Date: 2026-11-09. Revision reviewed: commit `c32d3cf1`. Each finding
and the author's answer:

- **B1 (blocking).** Item 3 made `let h = 3000000000; h += 1; return f32(h)` an `i32` that Rule
  5.4 refuses. Fixed: item 3 requires the choice to hold every known value, and takes `f32`
  otherwise; F17 records the measurement.
- **B2 (blocking, owner choice).** Item 3's rule was the author's own choice with observable
  results (`p *= 2` wraps at n = 31; `3 ** 20` gives -808182895), and "closest to ECMAScript"
  and "counts on" were false past 2^31. Fixed: Q5 presents (a) the rule, (b) `f32`, (c) by known
  range, recommends (b), and records the remaining cost as a cost of Q2; the false sentences are
  withdrawn; F18.
- **B3 (blocking).** Item 1 rewrites Rules 8.14 and 8.19 and surface §14, §24, §26. Fixed: added
  to the front matter; Rule 8.19's new text and the copy naming are described; Rule 8.9 is
  unchanged.
- **S1.** Function results were missing from "Values that change", and an exported function with
  no caller was not covered. Fixed: F19, "Values that change", and item 1 (reflection, host view,
  CPU tier read the Q5 choice).
- **S2.** Missing places and ambiguities. Fixed: item 1 adds builtin arguments, constructor
  arguments, conditional arms, object-literal fields and `==`; "an integer of no kind" is `i32`;
  a function-local `const` is item 2; a static field that no code writes is item 2, one that code
  writes is item 1.
- **S3 (owner choice).** The precedence of an integer demand and a `/`. Fixed: Q6, recommending a
  refusal.
- **S4 (correction).** The bundled artifacts were published. Fixed: F11; the owner decided Q9
  (test builds, no official release, OD-6), so decision Q4 stands. The `## [0.1.0]` heading of
  `CHANGELOG.md` does not make a release (OD-6). This proposal leaves that heading to a separate
  fix, because it is not part of this change.
- **S5.** Rule 13.10 needs a text change and keeps a test. Fixed: "What it touches", Rule 13.10,
  with the owner's answer (OD-6).
- **S6.** The applicability of the `TS8053` retirement was incomplete. Fixed: the document control
  table, "What it touches" and the vscode-typeshade downstream entry.
- **S7.** Item 5's "no golden moves" holds only before items 1 to 3. Fixed: item 5 states the
  order condition.
- **S8.** Hover gaps. Fixed: item 4 states the expected hover per case; the estimate adds the
  language-service work.
- **S9 (owner choice).** The decimal point as the `f32` mark. Fixed: Q7, with float-written
  constants.
- **N1.** Q3's spelling-1 costs. Fixed: recorded with the owner's decision.
- **N2.** Item 1 is a new type pass. Fixed: item 1 and the estimate say so.
- **N3.** Whether Q2 becomes an OD entry. Fixed: Q8.
- **N4.** The implementing pull request shows its value changes to the owner. Fixed: "Values that
  change" and the OD-4 entry.

This revision has not been reviewed independently.

### Answers to changes 0036 and 0037

Changes 0036 and 0037 excluded these, and surface §13 states them:

- "Compound assignments and circular inference supply no demand." Item 1 lifts the first: a
  compound assignment beside a typed value states the value's type as a simple assignment does.
  A cycle still supplies no demand by itself: item 1 solves all values as one fixed point, and a
  cycle that reaches no typed peer goes to the compiler's choice of item 3, independent of
  source order.
- "This is not general inference through arithmetic" (change 0037). That was a scope limit, with
  no rule behind it. Item 1 is that general inference.
- "A module constant … keep[s] [its] existing rules." Item 2 changes that rule for an
  integer-written module constant.
- "Where no integer type is established, the `f32` default remains" (changes 0036 and 0037).
  Item 3 replaces the default with the compiler's choice (Q5).
- Loop induction variables, explicit annotations, casts and float-written initializers keep
  their rules, as in 0036 and 0037.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decisions on Q5 to Q8, an
independent review of this revision, and a merge of this file with `status: accepted`. The
owner's decisions on Q1 to Q4 and Q9 are recorded under "Decisions of the owner". Item 5 changes how
authors write examples. Its implementing pull request is therefore not approved in advance, even
after acceptance: its body shows one example before and after, and it waits for the owner's
"merge" (`CLAUDE.md`, Merging). The pull request that changes values shows each change to the
owner before the merge (OD-4).

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
  references/diagnostics.md and the `TS8053` mentions in docs/design.md (lines 607 and 612) go.
  The extension 0.3.0 on the Marketplace was a test build with the `f32` default (F11, OD-6); no window is owed to its users. Record 0134
  in `compiler-changes.md`.
- **typecv** and **typeaudio**: dropping casts is optional cleanup. A module constant above 2^24
  now reads at its exact value; review each. Record 0134 in `compiler-changes.md` when the pin
  moves.
- **radiance** and **typenn**: no grep hit (F12); nothing is owed beyond the record of the id
  if a later pin requires it.
- **typeplot** is not in `DOWNSTREAM_REPOS`; it holds 130 hits (F12) and owes nothing under
  this process.
