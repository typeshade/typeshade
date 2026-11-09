---
id: '0134'
title: A written number takes its type from where the program uses it, so an author writes `1` and `4` and no cast or decimal point the compiler can work out
status: draft
rules:
  - '5.1'
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
    what: Optional cleanup of literal casts in shaders (24 grep hits at 5c3f8ce); nothing stops compiling; record 0134 in compiler-changes.md when the pin moves
  - repo: typeaudio
    what: Optional cleanup of literal casts in shaders (4 grep hits at 8bd1ab1); nothing stops compiling; record 0134 in compiler-changes.md when the pin moves
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0134, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                           |
| Date and attribution          | Drafted 2026-11-09 (UTC) by an AI agent (Claude Code) at the owner's direction. The date is the drafting date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                    |
| Request source                | The owner (Seungup) asked on 2026-11-09 which parts of the surface push the compiler's work onto the author, judged against OD-3. From the audit the owner chose item 1, numeric literals, for a proposal.                                                                                                                                                                                                                                          |
| Applicability / effectivity   | Expected: `src/compiler/ts/local-numeric-inference.ts`, `src/compiler/ts/lit-coerce.ts`, `src/compiler/ts/numeric.ts`, the module-constant lowering, the WGSL and GLSL emitters for a constant used at two types, `src/language-service/hover.ts`, `docs/language-design.md` (Rule 5.1, Rule 12.7, §14), `docs/use-typeshade-surface.md` (§12, §13), `examples/*.shade.ts` (content only), `CHANGELOG.md`, `reqs/`. No release version is assigned. |
| Review baseline               | `main` at `2cc98b8f` (merge of pull request #1113), 2026-11-09. Every measurement below was made on that commit with Bun's runtime and the tree's own `compile()` and `createTypeshadeLanguageService()`.                                                                                                                                                                                                                                           |
| Review and revision authority | Pull request #1121 (draft). Git records the revisions of this file. A merge with `status: accepted` will record the decision.                                                                                                                                                                                                                                                                                                                       |

## What changes

### Today

A written number already takes its type from many positions (Rule 5.1, Rule 5.2, surface §13):

- a declared position: `let j: i32 = -1`, `return 0` in a `u32` function, an argument, a field;
- a typed peer in an operator or a builtin call: `vi & 1` with `vi: u32` is `vi & 1u`, and
  `x * 4 - 1` with `x: f32` is `x * 4.0 - 1.0`;
- an unannotated function-local `let` or `const` whose declared uses demand one integer type
  (changes 0036 and 0037): a parameter, a typed initialization, a simple assignment.

Where nothing above decides, the literal is an `f32` (Rule 5.1, last sentence). These are the
declarations that do not decide today:

- a local whose only uses are operators: `let acc = 0; acc += x` (it is `f32` by default, and
  so happens to work), `let n = 0; n += vi` (refused, `TS8003`), `let j = 0; xs[j]` (refused,
  `TS8003 Index must be i32 or u32.`);
- a module or local `const` of a written number: `const K = 3` is `const K: f32 = 3.0`, so
  `vi * K` is refused (`TS8003`), and `vi * u32(K)` is the workaround;
- a local used beside two integer kinds or beside an integer and a float: refused.

`TS8053` (`INT_LITERAL_DEPRECATION`) warns, under `compile(src, { deprecations: true })`, on
each declaration that takes the `f32` default, because #148 decided that the default becomes
`i32` (§14, roadmap item T15, Rule 13.10).

### Proposed

1. **A local takes its type from every use the compiler can see (Rule 5.1).** An unannotated
   `let` or `const` initialized by a written number, or by an expression whose leaves are all
   written numbers, takes the one scalar type its uses demand. Rule 5.1 already counts declared
   uses. This change adds the uses that today decide nothing:
   - an operand of an arithmetic, bitwise, shift or comparison operator beside a typed peer
     (`vi + k`, `k < i`, `x * k`);
   - a compound assignment (`k += vi`, `acc += x`) and an assignment from a typed value;
   - an index (`xs[k]` demands an integer; `i32` when no use decides between `i32` and `u32`);
   - a `return` in a function with a declared result type;
   - another local that takes a type in the same way (`let it = 0; it += 1; return it / 100;`
     in an `f32` function makes `it` an `f32` through `it / 100`).

   Uses that demand two concrete types stay refused with `TS8003` and the annotation remedy,
   as Rule 5.1 says today.

2. **A `const` of a written number is a constant of no fixed type until a use gives it one
   (Rule 5.1, surface §12 and §13).** This is WGSL's abstract `const`: each use of `K` in
   `const K = 3` takes the type that the written number `3` would take in the same place. So
   `vi * K` is `vi * 3u` and `x * K` is `x * 3.0` in one function. The scope of this item is an
   integer-written initializer. A float-written initializer (`const C = 0.1`) keeps today's
   `f32` (see "Decisions to resolve before acceptance").

3. **The default stays the one #148 decided.** Where no use demands a type (an inferred return
   `function g() { return 1; }`, an unannotated class field `n = 0`, a local read only by a cast
   or by `console.log`), the literal takes the default. #148 decided that the default becomes
   `i32` with the window of Rule 13.10. This proposal does not change that decision and does not
   move its date. It reduces the set of declarations the default reaches. `TS8053` stays, and
   it warns only on a declaration that no use decides (as Rule 5.1 already says for a local
   that takes its type from declared uses). The default and its timing are Open question 2.

4. **The editor names the same type (Rule 12.7).** TypeScript types `const K = 3` as the
   literal type `3` and `let k = 0` as `number`. The ambient library's scalar brands are
   optional (`src/language-service/ambient.ts`, the head comment), so a `number` flows into
   every `f32`, `i32` and `u32` position and TypeScript's half accepts every form above. The
   compiler's `TS8003` reaches the editor through the shared analysis, as it does today (both
   halves measured below). Hover shows the compiler's type for a local (`let k: u32`). For a
   `const` of no fixed type, hover shows TypeScript's literal type (`const K: 3`) at the
   declaration, and Rule 12.7's exception for an all-literal call grows to cover it.

5. **The examples, the surface sections and the guides stop teaching casts and decimal points
   that the compiler does not need.** This item needs no rule change: the compiler accepts the
   rewritten forms today (measured below). It belongs to this proposal because it is the
   author-visible half of the same change.

### Example

Before (`examples/array-methods.shade.ts`, lines 32-36 on `main` at `2cc98b8f`):

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

Fact: the "after" text compiles on `main` at `2cc98b8f` to the same WGSL and the same GLSL ES
3.00, byte for byte, with no diagnostic in either half. Both targets emit
`let x = ((f32((vi & 1u)) * 4.0) - 1.0);` (WGSL) and `float x = ((float((vi & 1u)) * 4.0) - 1.0);`
(GLSL). Item 5 delivers this example. The stage spelling `vertex(...)` is the one on `main`.
OD-2 restores `@vertex` in its own change, and this proposal does not touch it.

The language change of items 1 to 3 shows in a declaration. Before
(`examples/block-scope.shade.ts`, line 55):

```ts
let acc = 0.;
for (let i: u32 = 0; i < 4; i++) {
  const p = f32(i) * 0.25;
  acc = acc + step(p, band) * 0.25;
}
```

After: `let acc = 0;`. Fact: today the "after" compiles to the same text with `acc: f32` by
default, and `TS8053` warns that #148 will make it an `i32`. Inference: once the default
becomes `i32` without this proposal, `acc = acc + step(p, band) * 0.25` is refused, and the
author writes `0.` again. With this proposal, `acc` is an `f32` because its use demands one,
and `TS8053` does not warn.

### The forms an author writes

| What the author means                    | Today                                  | After                                             |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| An integer beside a typed peer           | `vi & u32(1)`, `band > i32(2)`         | `vi & 1`, `band > 2` (accepted today; item 5)     |
| A float beside a typed peer              | `f32(n) * 4. - 1.`                     | `f32(n) * 4 - 1` (accepted today; item 5)         |
| A vector component                       | `vec4(x, y, 0., 1.)`                   | `vec4(x, y, 0, 1)` (accepted today; item 5)       |
| A float accumulator                      | `let acc = 0.; acc += x`               | `let acc = 0; acc += x` (item 1)                  |
| An integer accumulator                   | `let n: u32 = 0; n += vi`              | `let n = 0; n += vi` (item 1; refused today)      |
| A counter used as an index               | `let j: i32 = 0; xs[j]`                | `let j = 0; xs[j]` (item 1; refused today)        |
| A named constant used at two types       | `const K = 3; vi * u32(K)` and `x * K` | `const K = 3; vi * K` and `x * K` (item 2)        |
| A literal no use decides                 | `let k = 0.` (f32), `let k = 0` (f32)  | `let k = 0.` (f32), `let k = 0` (the default, Q2) |
| An explicit type, where the author wants | `u32(1)`, `let k: u32 = 1`, `1.`       | unchanged; every form of today still compiles     |

## Why

OD-3 says that a construct exists only for what the author must state and the compiler cannot
know. A cast on a literal (`u32(1)`) and a decimal point written only to pick `f32` (`4.`) state
a type that the position already states. The compiler reads that position. For the forms of
item 5 it already acts on it. For the forms of items 1 and 2 it can, by reading the uses of the
declaration in the same function or module.

### Measured facts

Each row names its method. All measurements ran on `main` at `2cc98b8f`, 2026-11-09, Bun's
runtime, `compile(src, { deprecations: true })` and `createTypeshadeLanguageService()` from the
tree. The scripts were scratch files and are not committed.

| #   | Kind      | Finding                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | fact      | `examples/` holds 102 `*.shade.ts` files. 101 compile alone. `imported-noise.shade.ts` needs a `readDocument` (`TS8072`) and was left out of F2 to F4.                                                                                                                                                                                                                                                         |
| F2  | fact      | Code lines (comments excluded) hold 62 casts of an integer-written literal, `u32(N)` or `i32(N)`, on 57 lines in 27 files. Removing every one gives byte-identical WGSL and GLSL in all 27 files, no `compile()` error and no editor error.                                                                                                                                                                    |
| F3  | fact      | Also removing each trailing decimal point (`4.` to `4`) and each `f32(N)` changes 744 lines in 92 files. WGSL and GLSL stay byte-identical, with no error in either half. `TS8053` warnings go from 1 to 45.                                                                                                                                                                                                   |
| F4  | fact      | Also removing `.0` (`4.0` to `4`) changes 1160 lines in 93 files, with the same result. `TS8053` warnings go from 1 to 60. The 60 are unannotated declarations, most of them accumulators and counters (`let acc = 0`, `let it = 0`, `let sum = 0`) and four module constants in `capsule-corp-namek-class.shade.ts` (`const WIN_N = 12`).                                                                     |
| F5  | inference | From F3 and F4: the casts and most decimal points in the examples are style that the compiler has not needed since surface §13 landed. The comment at `examples/array-literal-ramp.shade.ts:44-45` ("until then a bare `2` here is an f32") is out of date: `band > 2` and `band = 2` compile.                                                                                                                 |
| F6  | inference | From F4: the 59 new `TS8053` lines are where #148's `i32` default would refuse or change a program once the author drops the decimal point. Item 1 decides most of them from their uses. The exact remainder is not measured; it needs the implementation.                                                                                                                                                     |
| F7  | fact      | Refused today in both halves with the same `TS8003`: `let n = 0; n += vi`; `let j = 0; j = j + 1; xs[j]` (`Index must be i32 or u32.`); `const K = 3; vi * K` at module scope; `const k = 1; i + k`.                                                                                                                                                                                                           |
| F8  | fact      | Editor hover today: `const m = vi & 1` is `const m: u32`; `const x = f32(vi & 1) * 4 - 1` is `const x: f32`; `let k = 1` passed to `h(a: u32)` is `let k: u32`; `const k = 1` with no deciding use is `const k: f32`. The editor reports no TypeScript error for any form above.                                                                                                                               |
| F9  | fact      | Literal-only arithmetic folds with ECMAScript doubles today: `const h = 1 / 2; return f32(i) * h;` emits `f32(i) * 0.5`. `const q: i32 = 3 / 2` is refused (`TS8003 … i32 and f32`). Surface §12 states the same for `f64(1 / 3)`, the JavaScript value.                                                                                                                                                       |
| F10 | fact      | `const C = 0.1` at module scope beside an `f64` operand emits `vec2<f32>(C, 0.0)` with `C: f32`, the `f32` value of 0.1. The written `x * 0.1` on an `f64` `x` carries the full double (Rule 5.2).                                                                                                                                                                                                             |
| F11 | fact      | `TS8053` shipped in `0.1.0` (`CHANGELOG.md`, the `[0.1.0] - 2026-09-29` section). The package version on `main` is `0.1.0`. So the first step of Rule 13.10 for #148 is published.                                                                                                                                                                                                                             |
| F12 | fact      | Downstream grep of `u32(N)` / `i32(N)` in `*.ts` and `*.md`: typecv 24 hits at `5c3f8ce`, typeaudio 4 at `8bd1ab1`, typenn 0 at `3a7d66c`, radiance 0 at `3e4efb3`, vscode-typeshade 2 at `db3f417`, typeplot 130 at `9f20c12` (typeplot is not in `DOWNSTREAM_REPOS`). `TS8053` is named in vscode-typeshade (4 lines) and in the site (apps/typeshade/src/lib/error-codes.ts in typeshade/web at `990ec50`). |

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
  declared uses to operator, index, compound-assignment and return uses, with propagation
  between locals; a constant of no fixed type at module and function scope, emitted as WGSL's
  `const K = 3;` or inlined per use, and inlined per use in GLSL ES 3.00, which has no
  abstract constant; a hover spelling; tests on both halves.
- Compatibility: inference, checked on the cases of F7 and F9 only. Item 1 decides only
  declarations whose integer uses are refused today, or whose float uses already take the `f32`
  default. So a program that compiles today computes the same values. Item 2 changes a value
  only beside an `f64` operand, for an integer above 2^24, which the `f32` default rounds today.
  The full answer needs the implementation and the example goldens (Rule 13.9).
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
T15) and is listed under Open question 2, not recommended here.

### Recommendation

Option B. It rests on:

- **OD-3**: the type of a literal is something the compiler can know from the program. The
  author stops writing casts and decimal points for it. The language gains no construct: no
  name, no code, no form. One rule (5.1) widens what the compiler reads.
- **OD-1**: whether TypeScript's own checker gives `1` the type `number` is not a criterion for
  the language. The editor shows the compiler's type (Rule 12.7), as it does for every local
  today.

It keeps the recorded #148 default and does not decide Open question 1.

## Owner's decisions

- **OD-3** (the language stays small; the compiler's work is not pushed onto the author). The
  proposal removes a reason to write a cast or a decimal point, and adds nothing an author
  writes.
- **OD-1** (TypeShade is a language of its own). The typing of a written number is the
  language's, read by its own compiler and language service, and not TypeScript's `number`.
- **OD-4** (show the owner what changes). The examples and the table above show each form
  before and after, and the options carry their costs.
- **OD-2** is not touched.

The proposal reverses no entry.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, no diagnostic code and no surface form.
It widens Rule 5.1 so that the compiler, not the author, decides the type of a written number
from its uses. The compiler can do this because every use it adds is in the same function or
module, with a type the front end already computes for `TS8003`. The parts the compiler cannot
decide are a declaration that no use decides (it takes the default, Open question 2) and the
arithmetic of a literal-only expression (Open question 1).

## Open questions for the owner

Two principles or rules point different ways on each question below. This draft does not choose.

### Q1. The arithmetic of an expression of written numbers

- Side 1, the ECMAScript value: Rule 1.3 makes the CPU oracle give "ECMAScript's result for a
  form borrowed from ECMAScript", and Rule 2.1 (b) lists a literal and an operator among the
  forms borrowed from ECMAScript. Surface §12 folds `f64(1 / 3)` to the JavaScript value. Today
  `1 / 2` folds to `0.5` (F9).
- Side 2, WGSL's abstract arithmetic: §1.8 keeps "the arithmetic of a borrowed WGSL type" WGSL's,
  and Rule 5.1's rationale is "WGSL's abstract-integer rule". In WGSL, `const h = 1 / 2;` is an
  AbstractInt, and its value is `0`.
- One example: `const h = 1 / 2; return f32(i) * h;`. Side 1 gives `f32(i) * 0.5`, as today.
  Side 2 gives `f32(i) * 0.0`, and a program that compiles today computes something else, so it
  needs the window of Rule 13.10 and a warning.
- Item 2 needs this answer, because a `const` of no fixed type keeps its initializer unfolded
  until a use gives it a type.

### Q2. The type of a written number that no use decides

- Side 1, `i32`: #148, decided by the maintainer and recorded in §14 and roadmap item T15; WGSL
  concretizes an AbstractInt to `i32`; `TS8053` shipped in `0.1.0` (F11) as step one of
  Rule 13.10.
- Side 2, `f32`: the surface's history (Rule 5.1's rationale), and "ordinary TypeScript first"
  (`docs/roadmap.md`): a TypeScript reader expects `function g() { return 1; }` and `x * g()`
  to work.
- Side 3, a refusal (Option C): the author states the type, which OD-3 counts against.
- One example: `function g() { return 1; } … return x * g();` with `x: f32`. `i32` refuses it
  (`i32` beside `f32`, `TS8003`); `f32` emits `x * g()` with `g() -> f32`; a refusal asks for
  `function g(): f32`.
- With item 1, this default reaches far fewer lines than #148 measured (F6). The owner may want
  to confirm that #148 still holds at that size. This draft keeps #148 as recorded.

## What it touches

- **Rule 5.1**: widened as items 1 to 3 say. Its "Enforced by" adds the new tests.
- **Rule 12.7**: the exception for an all-literal call also covers the hover of a `const` of no
  fixed type (item 4).
- **Surface §12**: a module `const` of an integer-written number is a constant of no fixed type
  (item 2).
- **Surface §13**: rewritten for items 1 to 3; the snippets drop needless casts and decimal
  points (item 5); the paragraph on the #148 window names the smaller set of declarations.
- **`docs/language-design.md` §14**: the #148 row describes the narrower reach of the default.
  It is not a `**Rule**` paragraph.
- **Codes**: none added, removed or renumbered. `TS8003` keeps its role for conflicting uses.
  `TS8053` keeps its number and its text, and warns on fewer declarations. It retires when #148's
  flip lands, as Rule 13.10 already requires.
- **Examples**: the set of `examples/*.shade.ts` does not change. Their text drops needless
  casts and decimal points (F2 to F4); every golden stays byte-identical for item 5.
- **Exports and names**: none.

Required evidence at implementation (not yet applicable): tests that read both halves on one
source for each row of the forms table (`compile()` emit or `TS8003`, editor `getDiagnostics`
and `getHover`); a Tint measurement of a WGSL `const` of no fixed type used at two types; the
compile gate on both targets; `src/language-service/expression-parity.test.ts` with no new
divergence; the example goldens re-baked and reviewed.

### Draft impact estimate

- Known: item 5 touches about 1160 lines in 93 example files (F4) and moves no emitted byte.
- Known: no export, name or code changes.
- Estimate: item 1 is an extension of an existing pass with its tests, about the size of change 0037. Basis: change 0037 added assignment and member contexts to the same inference.
- Estimate: item 2 is new work in the module-constant lowering and both emitters. Size unknown.
- Unknown: how many of the 60 `TS8053` lines of F4 item 1 decides (F6).
- Downstream: the site and the editor rewrite text; typecv and typeaudio may drop casts. No
  downstream program stops compiling (inference from the compatibility note of Option B).

Decisions to resolve before acceptance:

1. Open questions Q1 and Q2.
2. Whether item 2 also covers a float-written `const` (`const C = 0.1`). Including it makes a
   `const` beside an `f64` carry the full double, as the written number does (F10). That
   changes a value a program computes today, so it would take the window of Rule 13.10 and a
   warning code. This draft leaves it out of scope.
3. Whether item 5 ships in its own pull request before items 1 to 4. It needs no rule change
   and moves no emitted byte.

### Independent review record

Not yet performed. An agent or a person that did not write this proposal reviews it against
`changes/README.md` (Independent review) before the owner decides.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on Q1 and Q2 and
on the decisions above, the independent review, and a merge of this file with
`status: accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require the implementation pull requests with
`Change: 0134`, the tests and gates listed under "What it touches", and the re-baked goldens.

## What it owes downstream

Expected work (draft):

- **typeshade.github.io** (repository typeshade/web): the language reference text on literals,
  the `TS8053` entry in apps/typeshade/src/lib/error-codes.ts, and each snippet that writes a
  cast or a decimal point only to type a literal. Record 0134 in `compiler-changes.md`.
- **vscode-typeshade**: plugins/typeshade/skills/typeshade/references/language.md lines
  205-214 at `db3f417` say that "an index and arithmetic decide nothing" and that `let i = 0` is
  an `f32`; both change. The `TS8053` row of references/diagnostics.md names fewer
  declarations. Record 0134 in `compiler-changes.md`.
- **typecv** and **typeaudio**: no program stops compiling. Dropping casts is optional cleanup.
  Record 0134 in `compiler-changes.md` when the pin moves.
- **radiance** and **typenn**: no grep hit (F12); nothing is owed beyond the record of the id
  if a later pin requires it.
- **typeplot** is not in `DOWNSTREAM_REPOS`; it holds 130 hits (F12) and owes nothing under
  this process.
