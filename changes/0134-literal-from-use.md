---
id: '0134'
title: A written number takes its type from where the program uses it, so an author writes `1` and `4` and no cast, decimal point or default type
status: accepted
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

<!-- doc-refs: skip-file — a proposal that names TS8053 and the files of its warning, which change 0134 retired and removed -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0134, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. Revised the same day (UTC) by the same agent after each of three independent reviews and after the owner's decisions on Q1 to Q11, all recorded below. The dates are drafting and revision dates. They are not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Request source                | The owner (Seungup) asked on 2026-11-09 which parts of the surface push the compiler's work onto the author, judged against OD-3. From the audit the owner chose item 1, numeric literals, for a proposal. The owner decided Q1 to Q11 in the same session (Decisions of the owner, below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Applicability / effectivity   | Expected compiler work: a new numeric type pass over the module (item 1), the module-constant, function-result, class-field and module-variable lowering, the WGSL and GLSL emitters, the CPU oracle's constant values, `src/compiler/ts/local-numeric-inference.ts`, `src/compiler/ts/lit-coerce.ts`, `src/compiler/ts/numeric.ts`, `src/language-service/hover.ts`. The retirement of `TS8053`: `src/compiler/ts/codes.ts` (the entry and the header list of retired codes), `scripts/numbering.ts` (`CODE_GAPS`), `src/compiler/ts/integer-literal-deprecation.ts` and its test, `src/compiler/ts/field-literal-deprecation.test.ts`, `src/compiler/ts/remedy-lines.test.ts`, `src/compiler/ts/array-literal.test.ts`, `src/compiler/ts/source-file.ts`, `src/language-service/check.ts` and `check.test.ts`, the `--deprecations` help line of `src/cli/run.ts`, the JSDoc of `CompileOptions.deprecations` and `CompileTsSourceOptions.deprecations`. Documents: `docs/language-design.md` (Rules 5.1, 5.2, 8.14, 8.19, 12.7, 13.10, §14), `docs/use-typeshade-surface.md` (§12, §13, §14, §24, §26), `docs/roadmap.md` (T15), `RELEASING.md` (§7), `docs/language-service-api.md`, `docs/benchmark-typescript.md`, `reqs/rules/RULE-1310.md`, `examples/*.shade.ts` (content only), `CHANGELOG.md` (`### Changed`, `### Removed`). No release version is assigned. |
| Review baseline               | First draft on `main` at `2cc98b8f` (merge of pull request #1113). Later revisions merged `main` into the branch at `583891d2`, `77e19b5a`, `984fa069` and `261888a9` (merge of pull request #1125). F1 to F16 were measured on `2cc98b8f` and repeated on `583891d2`, with the same results; F17 to F19 on `77e19b5a`; F20 on `984fa069`; F21 and F22 on `261888a9`. All on 2026-11-09.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
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
   initializer (`let k = 2.0`) keeps its rules, so Rule 5.5 does not change (decision Q7). The
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
   position, unless another use says `u32`. Where a known non-negative value does not fit an
   `i32` (`f | 3000000000`), the compiler takes `u32`, as item 3 takes `f32` for a value an `i32`
   cannot hold. This is the compiler's choice under OD-7, not a rule the author learns. The compiler solves all of these together, as a
   fixed point over the module. The result does not depend on source order. Uses of one value
   that demand two concrete types stay refused with `TS8003` and the annotation remedy, as Rule
   5.1 says today.

   **Division (decisions Q6, Q10 and Q11).** A `/` (and `/=`) is integer division only when one
   operand has an integer type the author wrote: a declared parameter, a builtin such as
   `vi: u32`, an annotated local, a declared field or result. So `vi / k` stays an integer
   division, as `vi / 7` is. Where the integer type of every operand came from inference (a value
   of item 1, a local of changes 0036 and 0037, a constant of item 2 that some read makes an
   integer), the `/` is refused with `TS8003`. The sentence names the two fixes: annotate the
   value (`let k: u32 = 7`, for integer division) or convert it (`f32(k) / 2`). Examples refused:
   `let k = 7; h(k); return r + k / 2;`, `let k = 7; h(k); k /= 2;`,
   `const k = 7; h(k); return f32(k / 2);`. On 2026-11-09 the owner was shown F20, which compiles
   today as `k / 2u`, and confirmed that it is refused (decision Q6). The owner decided the same
   for a `const` (decision Q10) and the rule of the declared operand (decision Q11).

   This is a new numeric type pass over the module and a change to the lowering order. It is not an extension of
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
   module calls, `export function g() { return 3; }`) takes `f32`, the compiler's choice
   (decision Q5). Reflection, the host view (change 0116) and the CPU tier read that type, as
   they do today.

2. **A `const` of a written number is a constant of no fixed type until a read gives it one
   (Rules 5.1 and 5.2, surface §12 and §13).** This is WGSL's abstract `const`. An
   integer-written constant takes `i32`, `u32`, `f32` or `f64` where it is read. A float-written
   constant (`const C = 0.1`) takes `f32` or `f64` where it is read (decision Q7), so beside an
   `f64` it carries the full double, as the written `x * 0.1` does (F10). It covers a
   module `const`, a function-local `const` and a static field that no code writes (which Rule
   8.13 already folds as a module `const`). Each read of `K` in `const K = 3` takes the type the
   written number `3` would take in the same place, including the `f64` lift of Rule 5.2. So
   `vi * K` is `vi * 3u` and `x * K` is `x * 3.0` in one function, and
   `const N = 8; for (let j = 0; j < N; j++)` compiles. A function-local `const k = 1` read at two
   types is accepted, as a module `const` is. Its edges:
   - A constant that some read makes an integer and that a `/` divides is refused, as a value
     of item 1 is (decision Q10; Division, above).
   - A cast is a read. `u32(K)` converts the written number, as `u32(3)` does. A constant of no
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
   - A constant that `f32` does not hold exactly (|K| > 2^24) is read at its exact value
     (decision Q4). Today the compiler rounds it to `f32`, and the CPU oracle records that
     rounded value. "Values that change" lists the cases.
   - A float-written constant read where nothing gives a float kind (`u32(C)`, a read that
     decides nothing) is read as the written number, as `u32(0.1)` is.

3. **There is no default type for the author (decision Q2).** Where nothing in the program
   decides a value's type, the compiler chooses one by itself. The author does not see the
   choice and has nothing to learn or write. The compiler chooses `f32` (decision Q5, OD-7), the
   type such a value has today. So item 3 changes no value and moves no golden. Its cost, a cost
   of decision Q2: past 2^24 an `f32` rounds, so a counter that nothing decides stops at 16777216.
   - The choice holds every value known at compile time. `let h = 3000000000; h += 1; return f32(h);` compiles today as an `f32` (F17). It stays an `f32`, so Rule 5.4 does not
     refuse it. Nothing compiling today is newly refused by item 3.
   - A value that no place reads (an unused local, a module variable that is only written) is an
     `f32` too, and no result can see its type.

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
   - a float-written constant, at its declaration: `const C = 0.1 (f32 or f64 where it is read)`;
   - a function its callers decide to one type: `function g(): u32`;
   - a function with two copies: at the declaration, its result in TypeShade's words
     (`function g() (u32 or f32 where it is called)`); at a call, the copy's result type;
   - a value whose `/` is refused (decision Q6): the type inference gave it (`let k: u32`), and
     the `TS8003` sentence at the `/`;
   - an imported constant or function: the compiler's type for the read in the importing file.
     Today hover falls back to TypeScript's type for an imported name, so this needs the
     language service to analyse the import as the compiler does (it has `readDocument`);
   - an exported function or constant whose type only importers decide: the language service
     analyses one file, as the compiler's single-file compile does. In the exporting file
     nothing decides, so hover shows the Q3 words for a constant and `f32` for a
     function. A copy made for an importer is visible in the importer only. Rule 12.7 holds,
     because both halves analyse the same file set.

5. **The examples, the surface sections and the guides stop teaching casts and decimal points
   that the compiler does not need.** This item needs no rule change. On today's compiler it
   moves no golden (F2 to F4). After items 1 to 3 land, the same rewrite moves goldens: for
   example `const WIN_N = 12.0` becomes `const WIN_N = 12`, a constant of no fixed type that the
   emitters inline, and `let acc = 0.` becomes `let acc = 0`, whose type follows its uses.
   Proposed default (the draft's, not an owner's decision): item 5 ships first, in its own pull
   request, on today's compiler, with the retirement of `TS8053` in the same or an earlier pull
   request: once the examples drop their decimal points, `TS8053`'s text ("will type as i32")
   would contradict decisions Q2 and Q5 on about 60 lines (F4). Reasons: its goldens stay byte-identical, so its review is about
   text only; it needs no rule; and the later items then review their own golden diffs, each
   against a known baseline. If it ships after, the rewrite is measured again and its golden diff
   is reviewed. Item 5 changes how authors write examples, so
   its implementing pull request waits for the owner's "merge" (Approval and plan record).

### Values that change

The changes below take effect at once, with no warning release (decision Q4). TypeShade has no
official release, and the published artifacts of F11 were test builds (decision Q9, OD-6). The `CHANGELOG.md` entry under `[Unreleased]`,
`### Changed`, names each change, the old value, the new value and the edit that keeps the old
one. `### Removed` names `TS8053`. Each implementing pull request that changes a value or newly refuses a program is not
approved in advance: its body shows each change before and after, and it waits for the owner's
"merge" (OD-4).

- **A constant whose value `f32` does not hold exactly (item 2, decisions Q4 and Q7).** A constant
  of no fixed type (module, function-local, or a static field that no code writes, including a
  constant computed from constants) whose ECMAScript value `f32` does not hold exactly, read
  through a cast or beside an `f64`, reads its exact value. Today the compiler rounds it to `f32`
  (F10, F13, F22):
  - `const PRIME = 2654435761; vi * u32(PRIME)` read 2654435840 and reads 2654435761.
  - `const K = 16777217; vi + u32(K)` read 16777216 and reads 16777217.
  - `const K = -16777219; i32(K)` read -16777220 and reads -16777219.
  - `class S { static K = 16777217; }` with `u32(S.K)` read 16777216 and reads 16777217.
  - `const K = 7; x * (K / 3)` with `x: f64` carried the `f32` quotient (2.3333333) and carries the
    full double of 7 / 3. `const M = K / 3;` read beside an `f64` does the same.
  - `const C = 0.1;` beside an `f64` carried the `f32` value of 0.1 and carries the full double,
    as the written `x * 0.1` does.

  To keep the old value, write the constant's type (`const K: f32 = …`).

- **A value nothing decides (item 3, decision Q5).** No change: it stays an `f32`, with today's
  values, and no golden moves (`let calls = 0` in `loop-on-cpu.shade.ts` among them, F15). A
  function result that no caller decides stays `f32`:
  `function g() { return 16777217; } … u32(g())` still reads 16777216 (F19).
- **Newly refused (Division, decisions Q6, Q10 and Q11).** A `/` or `/=` whose operands are all
  integers by inference only. Each compiles today and is refused with `TS8003` after; the fix the
  sentence names is an annotation (`let k: u32 = 7` or `const k: u32 = 7`, keeps the integer
  division) or a conversion (`f32(k) / 2`, gives 3.5). With `function h(a: u32): u32`:
  - `let k = 7; const r = h(k); return r + k / 2;` emits `k / 2u` today (F20).
  - `let k = 7; h(k); k /= 2;` emits a `u32` division today (F21).
  - `const k = 7; h(k); return f32(k / 2);` emits `3.0` today (F21).
  - `const k = 7; let j: i32 = k; return f32(k / 2) + f32(j);` emits `3.0` today (F21).
  - `const k = 7; const r = h(k); return r + k / 2;` emits `r + 3u` today (F21).
  - `const k = 7; h(k); return xs[k / 2];` emits `xs[3u]` today (F21).

  Still allowed: `let k = 7; h(k); return vi / k;` (`vi` is a declared `u32`), as today (F21).

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

| What the author means                    | Today                                  | After                                                        |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| An integer beside a typed peer           | `vi & u32(1)`, `band > i32(2)`         | `vi & 1`, `band > 2` (accepted today; item 5)                |
| A float beside a typed peer              | `f32(n) * 4. - 1.`                     | `f32(n) * 4 - 1` (accepted today; item 5)                    |
| A vector component                       | `vec4(x, y, 0., 1.)`                   | `vec4(x, y, 0, 1)` (accepted today; item 5)                  |
| A float accumulator                      | `let acc = 0.; acc += x`               | `let acc = 0; acc += x` (item 1)                             |
| An integer accumulator                   | `let n: u32 = 0; n += vi`              | `let n = 0; n += vi` (item 1; refused today)                 |
| A running maximum                        | `let m: u32 = 0; m = max(m, vi)`       | `let m = 0; m = max(m, vi)` (item 1; refused today)          |
| A counter used as an index               | `let j: i32 = 0; xs[j]`                | `let j = 0; xs[j]` (item 1; refused today)                   |
| Bit flags                                | `let f: u32 = 0; f = f \| u32(4)`      | `let f = 0; f = f \| 4` (item 1; refused today)              |
| A result the callers decide              | `function g(): u32 { return 1; }`      | `function g() { return 1; }` (item 1; refused today)         |
| A named constant used at two types       | `const K = 3; vi * u32(K)` and `x * K` | `const K = 3; vi * K` and `x * K` (item 2)                   |
| A loop bound                             | `const N: i32 = 8; … j < N`            | `const N = 8; … j < N` (item 2; refused today)               |
| A number nothing decides                 | `let k = 0.` (f32), `let k = 0` (f32)  | `let k = 0.` (f32), `let k = 0` (f32, the compiler's choice) |
| A float constant beside an `f64`         | `const C: f64 = 0.1` (else f32 value)  | `const C = 0.1` (the full double; item 2)                    |
| An integer value divided by `/`          | `let k = 7; h(k); k / 2` (integer `/`) | refused: write `let k: u32 = 7` or `f32(k) / 2` (Q6, Q11)    |
| An explicit type, where the author wants | `u32(1)`, `let k: u32 = 1`, `1.`       | unchanged; every form of today still compiles                |

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
| F20 | fact      | `function h(a: u32): u32 { return a; }` and `let k = 7; const r = h(k); return r + k / 2;` compile today: `var k: u32 = 7u;` and `(r + (k / 2u))`, integer division. Measured on `984fa069`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F21 | fact      | With `function h(a: u32): u32`, each compiles today with no diagnostic: `let k = 7; h(k); k /= 2;` (`var k: u32 = 7u`, a `u32` division); `const k = 7; h(k); return f32(k / 2);` (`return 3.0;`); `const k = 7; let j: i32 = k; return f32(k / 2) + f32(j);` (`3.0 + f32(j)`); `const k = 7; const r = h(k); return r + k / 2;` (`r + 3u`); `const k = 7; h(k); return xs[k / 2];` (`xs[3u]`); `let k = 7; h(k); return vi / k;` (`vi / k`).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F22 | fact      | `const K = 7;` with `x * (K / 3)` on `x: f64` emits `const K: f32 = 7.0;` and `vec2<f32>((K / 3.0), 0.0)`, the `f32` quotient. `const M = K / 3;` emits `const M: f32 = 2.3333333333333335;` and `vec2<f32>(M, 0.0)`. `class S { static K = 16777217; }` with `u32(S.K)` emits `const S_K: f32 = 16777217.0;`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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

The owner decided eleven questions on 2026-11-09, in the Claude Code session, in Korean. The
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
  and a refusal (Option C). The cost of this decision: the compiler's choice (`f32`, decision Q5) rounds
  past 2^24.
- **Q3, the hover at the declaration of a constant of no fixed type.** The owner chose "언어
  설명" (the language's description): at the declaration, hover shows TypeShade's own words, for
  example `const K = 3 (i32, u32, f32 or f64 where it is read)`; at a read, the compiler's type
  there. The rejected spelling was TypeScript's literal type, `const K: 3`. Its costs were that
  it is TypeScript's reading and not the language's (OD-1), and that it does not tell the author
  which types the reads take.
- **Q4, a constant that `f32` does not hold exactly.** The owner chose "바로 정확하게" (exact, at
  once). A constant above 2^24 read through a cast or beside an `f64` gives its exact value at
  once, with no warning release, because no version is published (F11; precedent 0131 and
  0132). The rejected sides were a Rule 13.10 window with a warning (4a) and a narrower item 2
  (4b). Decision Q9 confirms its basis.
- **Q5, how the compiler chooses a type that nothing decides.** The owner chose "f32 (추천)":
  option (b), `f32` wherever nothing decides. Today's values stay; no golden moves; the rounding
  past 2^24 is a cost of decision Q2. The rejected options were (a), by the operations (`i32` for
  an integer-only computation, which wraps past 2^31: `p *= 2` gives -2147483648 at n = 31 and 0
  at n ≥ 32, F18), and (c), by a proved range.
- **Q6, a value that an integer demand makes an integer and a `/` divides.** The owner chose
  "거부 (추천)": option (b), a refusal with `TS8003`, whose sentence names the fix. Example:
  `let k = 7; … xs[k]; … return f32(k / 2);` is refused. The rejected options were (a), the
  integer wins (`3`), and (c), two copies of `k`.
  On 2026-11-09 the owner was shown F20 (`function h(a: u32) {…} let k = 7; h(k);
return r + k / 2;`, which compiles today as `k / 2u`) and confirmed that it is refused (third
  review, S1).
- **Q7, the decimal point and a float-written constant.** The owner chose "상수만 확장 (추천)":
  option (c), extend item 2 only. A float-written `const` is a constant of no fixed type among
  `f32` and `f64`; `let k = 2.0` stays an `f32`, and Rule 5.5 for variables does not change. The
  rejected options were (a), keep both as today, and (b), extend items 1 and 2 to float-written
  numbers.
- **Q8, whether Q2 becomes an owner's decision entry.** The owner chose "기록" (record it). The
  session records decision Q2 as OD-7 in pull request #1132: a number's type is inferred from its
  uses; there is no default type to learn; the compiler's choice where nothing decides is `f32`;
  a value made an integer and then divided by `/` is refused.
- **Q9, whether the bundled artifacts count as published releases.** Asked about the artifacts of
  F11, the owner answered: "아직 정식 릴리즈 전이라 문제 없음 테스트용으로 한것뿐이라" (there is no
  official release yet, so there is no problem; those were only test builds). `vscode-typeshade`
  0.3.0 and `@typeshade/mcp` 0.1.x are test builds, TypeShade has no official release, and no
  warning window is owed. The session records it as OD-6 in pull request #1132. Rule 13.10 is
  amended to match (What it touches). The rejected outcome was a Rule 13.10 window for every
  value that changes.
- **Q10, a constant that an integer demand reaches and a `/` divides.** The owner chose "const도
  거부" (refuse a const too). A function-local or any other `const` that an integer demand reaches
  and that `/` divides is refused exactly as a `let` is (decision Q6).
  `function h(a: u32) {…} const k = 7; h(k); return f32(k / 2);` emits `3.0` today (F21) and is
  refused, not read as 3.5. The rejected options were the ECMAScript value 3.5 (the constant's
  abstract fold) and today's integer division.
- **Q11, when `/` is integer division.** The owner chose "선언된 정수만 허용" (allow only a declared
  integer). A `/` performs integer division only when one operand has an integer type the author
  wrote: a parameter, a builtin such as `vi: u32`, an annotated local, a field. Where the integer
  type came only from inference, the `/` is refused. `let k = 7; h(k); return vi / k;` stays
  allowed, as `vi / 7` is; `let k = 7; h(k); k /= 2;` is refused (`/=` counts as `/`). The
  rejected options were integer division for any integer operand, and refusal of every integer
  `/` that an inferred value takes part in.

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
- **OD-6** (no official release yet; test builds owe no window) and **OD-7** (a number's type is
  inferred from its uses, with no default type to learn; `f32` where nothing decides; an
  integer then divided by `/` is refused). Both are proposed in pull request #1132 and are not
  on `main` at the time of writing. The value changes take effect without a warning window on
  the basis of OD-6. Items 1 to 3 carry OD-7.
- **OD-2** and **OD-5** are not touched.

The proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, no diagnostic code and no surface form.
It retires `TS8053`. It widens Rules 5.1, 5.2, 8.14 and 8.19 so that the compiler, not the
author, decides the type of a written number from every place it reaches. The compiler can do
this because each place is in the same program, with a type the front end already computes for
`TS8003`. The owner made the design choices (Q1 to Q11).

## Open items

The owner decided every question (Q1 to Q11). Two items remain, each with a default this draft
proposes. Neither needs the owner unless the owner wants another order or scope.

1. **Untyped array-literal elements once change 0114 S2 lands** (`const a = [1, 2, 3]; a[i] * x`).
   Proposed default: S2's element type follows Rule 5.1 as this change amends it, by S2's own
   text. An untyped array literal of integer-written elements bound to a `const` has one element
   type, decided by the reads of its elements as one value of item 1, and `f32` where nothing
   decides (decision Q5). Elements read at two types are refused with `TS8003`, because an array
   has one element type. Decisions Q6 and Q7 apply to the elements: an element made an integer by
   inference and divided by `/` is refused, and float-written elements stay floats. Reasons: S2
   already defers to Rule 5.1, so no second rule is needed; and OD-7 asks for inference wherever
   a number reaches. The implementation of S2 carries the work, and S2's pull request shows the
   owner one example before and after (OD-4).
2. **Item 5 ships first.** Proposed default: yes, in its own pull request, on today's compiler,
   with the retirement of `TS8053` in the same or an earlier pull request (item 5 gives the
   reasons). That pull request waits for the owner's "merge" (Approval and plan record).

## What it touches

- **Rule 5.1**: rewritten as items 1 to 3 and the division rule of item 1 say. Its last sentence ("Where no integer type is
  established, the literal must be an `f32`") and the paragraph "The default is _open_" are
  replaced by the compiler's choice of item 3 (`f32`, decision Q5) and the
  refusal of decision Q6. Its "Enforced by" adds the new tests.
- **Rule 5.2**: a read of a constant of no fixed type takes a typed peer's kind, as a written
  number does, including the `f64` lift (item 2).
- **Rule 5.5**: unchanged (decision Q7).
- **Rule 8.14**: its second sentence ("a written number is an `f32` by Rule 5.1") changes: a field
  initialized by an integer-written number takes its type from its uses (item 1).
- **Rule 8.19**: new text for a result that its callers decide, with one copy per result type and
  its naming (item 1).
- **Rule 8.9**: unchanged; the copies of Rule 8.19 are named as its instances are.
- **Rule 12.7**: the editor shows the compiler's type for a local, a field, a function's result
  and each read of a constant of no fixed type, and TypeShade's words at a declaration
  (decision Q3), as item 4 lists.
- **Rule 13.10**: only the edits the retirement of `TS8053` needs. Its "Derives from" and
  "Enforced by" name #148 and `src/compiler/ts/integer-literal-deprecation.test.ts`, which go. A
  test keeps `Verifies: Rule 13.10`: it asserts that `deprecations: true` moves no emitted byte and
  reports no warning on a program today. `reqs/rules/RULE-1310.md` follows. The sentence that no
  window is owed before the first official release (OD-6) is not part of this change. The
  session's coordinator opens it as its own pull request after #1132, with "official release"
  defined by an identifier there.
- **Surface §12**: a module `const` of a written number is a constant of no fixed type
  (integer-written: any scalar where read; float-written: `f32` or `f64` where read).
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
  casts and decimal points (item 5, with the order condition stated there). No golden moves
  for item 3 (decision Q5).
- **Names**: none.

Required evidence at implementation (not yet applicable): tests that read both halves on one
source for each row of the forms table (`compile()` emit or `TS8003`, editor `getDiagnostics`
and `getHover`); a test for each place of item 1; a test for each edge of item 2 (a cast, a
constant from a constant, an imported constant, a loop bound, a constant above 2^24 at its exact
value); a test for each case of item 3 (`f32` where nothing decides) and for F17; a test of the division rule in both halves, for each case of F20 and F21 and for `vi / k`; a test for a
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

Decisions to resolve before acceptance: none. The two open items have proposed defaults (Open
items). The proposal is ready for acceptance on the owner's go-ahead.

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
   asks the owner about the scope (decided: Q7 (c)).
6. The exclusions of changes 0036 and 0037 were not cited. Fixed: "Answers to changes 0036 and
   0037" below.
7. Item 2 edges were missing. Fixed: item 2 lists them; the loop bound is the second example.
8. Under Q1 Side 1, WGSL's own `const` would compute Side 2. Fixed: item 2 requires the emitters
   to fold or inline every read.
9. The text both kept #148 and asked the owner to confirm it. Superseded by decision Q2.
10. Bitwise and shift operators were not covered. Fixed: item 1 counts them.
11. Untyped array literal elements (0114 S2). Fixed: Open items, item 1, with a proposed
    default.
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

After the second review, the owner decided Q5 to Q9.

**Third review.** Reviewer: an AI agent (Claude Code) that did not write this proposal, run by
the session's coordinator. Date: 2026-11-09. Revision reviewed: commit `9f00704c`. The owner
answered the review's two questions the same day (Q10, Q11). Each finding and the author's
answer:

- **B1 (blocking).** A function-local `const` that an integer demand reaches escaped the `/`
  refusal through item 2. Resolved by decision Q10: item 1's division rule covers a constant, F21
  lists the cases, "Values that change" lists them as newly refused, and "Answers to changes 0036
  and 0037" says a function-local `const` leaves their inference.
- **S1.** The owner had not seen F20. Fixed: the owner was shown F20 and confirmed the refusal
  (decision Q6); item 1 cites that in place of "because the reason is the same".
- **Q11 (owner question).** When `/` is integer division. Decided: only with an operand of a type
  the author wrote (decision Q11); item 1 states it; `vi / k` stays allowed and `k /= 2` is
  refused (F21).
- **S3.** The constant rows of "Values that change" were narrower than item 2. Fixed: one row for
  every constant of no fixed type whose ECMAScript value `f32` does not hold exactly, with the
  measured examples (F22).
- **S4.** An integer of no kind as `i32` could fail to hold a known value. Fixed: the compiler
  takes `u32` for a known non-negative value above the `i32` range, stated as its choice under
  OD-7.
- **S5.** Approval of the implementing pull requests. Fixed: each one that changes a value or
  newly refuses a program is not approved in advance ("Values that change", Approval and plan
  record).
- **S6.** The OD-6 sentence of Rule 13.10 belongs to its own change. Fixed: removed from this
  proposal; only the edits for the retirement of `TS8053` stay. The session's coordinator opens
  that pull request after #1132.
- **N1.** Hover wording was missing for three cases. Fixed: item 4 adds a float-written constant,
  a function its callers decide to one type, and a refused `/`.
- **N2.** Stale rows and order. Fixed: Date and attribution and Review baseline rows refreshed; F19
  before F20; Q1 to Q11 in order; the broken wrap in item 1 joined.
- **N4.** `scripts/changes.ts` gives no signal on a proposal-only diff ("no proposal needed").
  Kept as a check that ran; reported as not useful for this diff.
- **Open items.** Fixed: the S2 default says an array has one element type (read at two types is
  refused), that decisions Q6 and Q7 apply to elements, and that S2's pull request shows the owner
  an example; the item 5 default retires `TS8053` first or with item 5.

The revision that answers the third review has not been reviewed independently.

### Answers to changes 0036 and 0037

Changes 0036 and 0037 excluded these, and surface §13 states them:

- "Compound assignments and circular inference supply no demand." Item 1 lifts the first: a
  compound assignment beside a typed value states the value's type as a simple assignment does.
  A cycle still supplies no demand by itself: item 1 solves all values as one fixed point, and a
  cycle that reaches no typed peer goes to the compiler's choice of item 3, independent of
  source order.
- "This is not general inference through arithmetic" (change 0037). That was a scope limit, with
  no rule behind it. Item 1 is that general inference.
- "A module constant … keep[s] [its] existing rules." Item 2 changes that rule for a module
  constant of a written number.
- A function-local `const` initialized by an integer-written literal leaves the inference of
  changes 0036 and 0037: it becomes a constant of no fixed type (item 2). A `/` over it follows
  the division rule of item 1 (decision Q10).
- "Where no integer type is established, the `f32` default remains" (changes 0036 and 0037).
  Item 3 replaces the default with the compiler's choice, `f32` (decision Q5).
- Loop induction variables, explicit annotations, casts and float-written initializers keep
  their rules, as in 0036 and 0037.

### Approval and plan record

Accepted. The owner (Seungup) approved acceptance in the Claude Code session on 2026-11-09, in
Korean ("승인"), after the before and after forms and the decisions were shown (OD-4). The
approval is recorded by the merge of pull request #1121 with `status: accepted`; the approved
revision is this file as merged. Duration and cost are not estimated. The
owner's decisions on Q1 to Q11 are recorded under "Decisions of the owner". Item 5 changes how
authors write examples. Its implementing pull request is therefore not approved in advance, even
after acceptance: its body shows one example before and after, and it waits for the owner's
"merge" (`CLAUDE.md`, Merging). Each implementing pull request that changes a value or newly
refuses a program is not approved in advance either: its body shows each change before and
after, and it waits for the owner's "merge" (OD-4).

### Amendment A1. The owner's decisions on five questions of the implementation (2026-11-10)

The implementing agent measured 47 forms on `main` at `d238dc27`, in both halves, and found no
difference from "Today". It then found five places where this text has two readings, or leaves
a choice open. The owner decided each in the Claude Code session on 2026-11-10, after one
example of each option was shown (`OD-4`). Each decision is the agent's recommendation.

- [decision, owner, 2026-11-10] "x / N은 허용". A `/` on a constant of no fixed type. Item 2's
  edge says "a constant that some read makes an integer and that a `/` divides is refused". The
  Division paragraph says a `/` is refused "where the integer type of every operand came from
  inference". The Division paragraph holds. With `const N = 8;` that a loop bound reads as an
  integer, `x / N` with `x` a declared `f32` compiles as float division, and `N` is an `f32` at
  that read. `const HALF = N / 2;` is refused (`TS8003`): no operand has a declared type. The
  cost is recorded: an author who divides a loop-bound constant by a written number writes
  `const N: i32 = 8` or `f32(N)`. Item 2's edge sentence is read with this limit.
- [decision, owner, 2026-11-10] "쓰임에서 추론". The counter of an open `for` (change 0136).
  This text says loop induction variables keep their rules, and change 0136 says the
  integer-literal counter follows this proposal's rule. For a counted `for` the two agree, and
  nothing changes: an `i32`, or a `u32` against a `u32` bound. For a `for` that is not counted,
  the counter is a value of item 1 and takes its type from its uses (`OD-7`): in
  `let a = 0; for (let j = 0; ; j++) { a += j; if (a > x) { break; } }`, `j` is an `f32`. The
  tests of change 0136 that pin an `i32` counter on an open `for` are rewritten to this rule.
- [decision, owner, 2026-11-10] "사본마다 추론". A function whose `return` is a value of item
  1 and whose callers ask for two types. Rule 8.19's new text gives one copy for each result
  type. Each copy infers its own locals: in `function g() { let k = 0; k += 1; return k; }`,
  called as `vi + g()` and as `x * g()`, `k` is a `u32` in one copy and an `f32` in the other,
  and both calls compile (`OD-3`). The hover on `k` (item 4) names each type the copies give
  it.
- [decision, owner, 2026-11-10] "f32 선언 유지". The emitted text of a module constant of no
  fixed type. The compiler keeps the declaration `const K: f32 = 3.0;` and the name at each
  `f32` read, as today, and writes the value at a read of another type (`vi * 3u`, a cast, an
  `f64` read). The text never carries WGSL's untyped `const K = 3;`. A golden changes only
  where a row of "Values that change" applies.
- [decision, owner, 2026-11-10] "별도 PR로 옮기기". Item 5 beyond `examples/*.shade.ts`. The
  shader sources of `journeys/` and of `examples/hosts`, `examples/lib` and `examples/passes`
  (683 sites in 81 files at the measurement) move to the forms of item 5 in a pull request of
  their own, each file with the emit it had before. A literal whose respelling changes the
  emit stays as written (`f32(0.1)` in `journeys/f64-module-constants/constants.shade.ts`).
  Sources written inside tests stay as they are.
- Affects: no front-matter field. Rules 5.1, 8.14 and 8.19 and surface §13, §14, §24 and §26,
  which the front matter declares, carry these readings when items 1 to 3 are implemented.
- Status: `status: accepted` does not change.

### Configuration and validation record

The change is delivered in parts. `status: accepted` stays until every part is delivered and
audited. Each block below records one implementing pull request.

**Part 1, the retirement of `TS8053`.** Pull request #1170, merged into `main` as `c9eea6ee`.
The code, its reporter and its two test files are removed. `src/compiler/ts/deprecation-window.test.ts`
verifies Rule 13.10 with no window open.

**Part 2, item 5 for `examples/*.shade.ts`.** Pull request #1174, merged into `main` (merge
commit `814496ae`). 94 files, 1166 lines. Each file compiled to the same WGSL and GLSL ES 3.00
and the same diagnostics, in both halves, before and after. No golden changed.

**Part 3, item 2, a constant of no fixed type.** Pull request #1184.

- Delivered: Rules 5.1 and 5.2, surface §12 and §13, `src/compiler/ts/abstract-const.ts`, the
  tests of `src/compiler/ts/abstract-const.test.ts` (both halves) and the journey
  `journeys/untyped-constants/` (WebGPU, WebGL2 and the CPU oracle). `CHANGELOG.md`,
  `### Changed`, names each value.
- [fact, measured 2026-11-10 on `main` at `0a095a24` and on the branch] The CPU oracle has two
  precisions. In `'f32'` precision, which the gates hold against a device, it read each row of
  "Values that change" at the `f32` rounding before part 3 (16777216, 2654435840, the `f32`
  quotient, the `f32` value of 0.1) and reads the exact value after it, as that section says.
  In `'f64'` precision (`compile().eval`) a read of a module constant by its name carried the
  double the author wrote before part 3 too (`ConstDecl.cpuValue`), so those rows read the same
  value there before and after. Two rows move in `'f64'` precision: `const C = 0.1; const D:
f64 = C;` read 0.10000000149011612 and reads 0.1, and `const K = 4294967295; u32(K)` read
  4294967040 and reads 4294967295. An earlier note in this record and in pull request #1184
  said that the oracle's values do not move; that was measured in `'f64'` precision only and
  was wrong as written. The approved text is not rewritten.
- [decision, owner, 2026-11-10] "캐스트도 세기". A cast is a read for the division rule. A
  conversion `i32(K)` or `u32(K)` of a constant of no fixed type reads it as an integer, as an
  argument of that type does. So `const K = 7; return f32(u32(K)) + f32(K / 2);` is refused
  with `TS8003`, in the sentence of the rule. `f32(K)` and `f64(K)` do not make the constant an
  integer, and `f32(K) / 2` is the edit the sentence names. Implemented in part 3. A conversion
  of arithmetic over the constant counts too (`u32(K + 1)`). A conversion of the quotient
  itself (`u32(K / 2)`) is that quotient's own read, not another one.
- [decision, owner, 2026-11-10] "별도 PR로 결함 수정". `const K = 1e38;` with `f64(K) * 4.` is
  newly refused: `f64(K)` is the written `f64(1e38)`, and the front end folds the product to a
  double that the emulation cannot hold (`TS8015`, as the written form does on `main`). Part 3
  goes on as it is: the constant behaves as the written number. The fold is a defect of its
  own, and it is fixed in its own pull request under an issue that the session's coordinator
  files. `src/core/passes/fp64-lower.test.ts` writes the type of its two `1e38` constants.
- [decision, owner, 2026-11-10] "거부". A `/` that reaches such a constant through an
  operator, a builtin, a conditional or a derived constant is refused for the same reason as
  the direct `k / 2`: `(k % 4) / 2`, `max(k, 1) / 2`, `abs(k) / 2`, `(x > 0 ? k : 1) / 2`,
  `(k | 1) / 2`, `const m = k * 2; … m / 4`, `const m = k; m / 2`. No program changes its value
  silently through a division. Implemented in part 3.
- [decision, owner, 2026-11-10] "규칙대로 두고 기록". Arithmetic other than `/` keeps Rule 5.1:
  with `function h(a: u32): u32`, `const k = 7; h(k); f32(k - 8)` was 4294967295 and is -1, and
  `f32(k * 1000000000)` was a wrapped `u32` and is 7000000000, as the written number gives.
  These rows are added to "Values that change" by this record and by the `CHANGELOG.md` entry.
- [decision, owner, 2026-11-10] "편집기를 컴파일러에 맞춤". A read in another file counts. With
  `export const K = 7;` and `x * (K / 2)` in a library and `vi * K` in the file that imports
  it, `compile()` of the importing file refuses the `/` in the library file, and the editor
  shows the same `TS8003` there (Rule 12.7): `checkDocuments` over the two documents, and the
  language service while the importing document is open. Implemented in part 3.
- The independent review of pull request #1184 at `827bc9e1` (2026-11-10) found F3 to F12, all
  inside the approved text. Each is fixed in part 3 with a test that reads both halves: a
  float-written counter against a constant bound keeps its `f32` (F3); a float-written constant
  is never an integer read (F4); the quotient's own read is not another read (F5); a bitwise
  compound assignment, a typed constant, a derived constant, a conversion of arithmetic and a
  texture level count as integer reads (F6); the sentence names one edit that compiles (F7);
  `k % 8` takes the type of its read (F8); a declared `f64` position is tested (F9); the oracle
  note is corrected (F10); the hover deviation names its rule (F12). F11 is open, below.
- Open, not decided: a compound assignment `q += K * 2` with a `u32` `q` compiles (`6u`), and
  the written `q += 3 * 2` is refused on `main` and on the branch. The constant goes through
  the retarget that a binary operand takes; the written tree through an older path of the
  compound assignment that takes one literal only.
- Open, not decided (item 1's ground): `const k = 7; h(k); let y = k; … y / 2` was an integer
  division (3) and is 3.5, because `let y = k` is neither a written number nor a constant. The
  approved text does not say whether a `let` initialized by a constant is a value of item 1.
- Deviations of part 3, each open for the audit at the end:
  - Hover is not changed: a declaration and every read still show `const K: f32`, also at a
    read the compiler types `u32`. Until item 4 is delivered this is a deviation from Rule 12.7
    ("The language service and the compiler must name one vocabulary") and from the `getHover`
    row of `docs/language-service-api.md` (line 485: "the COMPILER's type for every name the
    front end declared in this document"). Item 4 is its own part.
  - The refusal sentence names one edit, where "Proposed" says that it names the two fixes. One
    of the two does not compile in some positions (the review, F7), so the sentence names the
    one that does: the constant's type where an integer position reads the quotient, the
    constant converted elsewhere.
  - `%` is read through a constant of no fixed type (`xs[k % 8]`), which compiled before; the
    written `xs[7 % 8]` stays refused, on `main` and on the branch.
  - An exported constant of no fixed type keeps its `f32` declaration in reflection, the
    manifest and the host view. The estimate of item 2 (the host view spells it `number`) is
    neither implemented nor measured.
  - A position that reads a written number through a check that part 3 did not reach reads the
    constant as an `f32`, as on `main`. Such a program stays refused; it computes no other
    value.
  - Rule 5.1's sentence "the literal must be an `f32`" stays for an unannotated `let`, a field
    and a function's result until items 1 and 3 are delivered.

Not delivered yet: items 1 and 3, item 4, the document part of item 5, item 5 for `journeys/`
and the helper sources of `examples/` (Amendment A1), and the audit.

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
