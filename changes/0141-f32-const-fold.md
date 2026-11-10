---
id: '0141'
title: A module constant of type `f32` is folded as `f32` arithmetic computes it, so the constant is the value of the same expression in a function
status: draft
rules:
  - '6.3'
surface:
  - 12
exports: []
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: A search of the pages, the Playground starters and the reference notes for a quoted literal of a folded `f32` module constant (an emitted `const NAME: f32 = <number>;` whose initializer is arithmetic); each one found is emitted again. compiler-changes.md records 0141 when the pin moves.
  - repo: radiance
    what: A search for a test or a record that pins the emitted literal or the CPU value of an `f32` module constant whose initializer is arithmetic; compiler-changes.md records 0141 when the pin moves.
  - repo: typenn
    what: The same search as radiance; compiler-changes.md records 0141 when the pin moves.
  - repo: typecv
    what: The same search as radiance; compiler-changes.md records 0141 when the pin moves.
  - repo: typeaudio
    what: The same search as radiance; compiler-changes.md records 0141 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0141, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                |
| Date and attribution          | Drafted 2026-11-10 (UTC) by an AI agent (Claude Code) at the direction of the session's coordinator. The date is the date of authorship. It is not an approval date.                                                                                                                                                     |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-10, in Korean: "B: 접기를 f32 연산처럼". The owner was shown a survey of the fold with three options, and chose option B. The survey's measurements are repeated in this document.                                                                              |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rule 6.3, `docs/use-typeshade-surface.md` §12, `src/compiler/ts/loop-bound.ts`, `src/compiler/ts/module-const.ts`, their tests, and two emit goldens. Targets: WGSL, GLSL ES 3.00 and the CPU oracle. No export, diagnostic code or example changes. No release version is assigned. |
| Review baseline               | `main` at `2fc20c99`. Each line number in this document was read at that commit.                                                                                                                                                                                                                                         |
| Review and revision authority | No pull request was assigned when this text was written; the pull request that carries this file is the review record. Git records the revisions. The review and the merge of that pull request record the decision.                                                                                                     |

## What changes

Nothing changes in what an author writes. One number changes: the value of a module constant of
type `f32` whose initializer is arithmetic.

### The example

```ts
"use typeshade";
const X: f32 = 0.0117;
const Y: f32 = X * 3.0;

export function inFunction(): f32 {
  return X * 3.0;
}
```

Two `f32` values are in play. They are neighbours, 1 ULP apart.

- (a) 0.035100001841783524: the `f64` product 0.0117 × 3.0, rounded once to `f32`.
- (b) 0.035099998116493225: the `f32` product of `f32(0.0117)` and `f32(3.0)`, rounded to
  nearest.

| Where the value of `Y` is read                                                   | Today (`2fc20c99`)               | After this change                                |
| -------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------ |
| The emitted WGSL                                                                 | `const Y: f32 = 0.0351;`         | A literal whose `f32` value is (b) (question Q3) |
| The emitted GLSL ES 3.00                                                         | `const float Y = 0.0351;`        | A literal whose `f32` value is (b)               |
| `Y` on the CPU oracle and the CPU tier, `'f32'` precision                        | (a)                              | (b)                                              |
| `Y` on a GPU, from the emitted literal                                           | (a)                              | (b)                                              |
| `inFunction()` on the CPU, `'f32'` precision                                     | (b)                              | (b), no change                                   |
| `inFunction()` on a GPU (`return (X * 3.0);` is emitted)                         | (b) [measured on Tint and ANGLE] | (b), no change                                   |
| What Tint computes for the WGSL an author would write, `const Y: f32 = X * 3.0;` | (b) [measured]                   | (b): the emitted literal now agrees with it      |
| What ANGLE computes for `const float Y = X * 3.0;`                               | (b) [measured]                   | (b): the emitted literal now agrees with it      |

So today the constant is one value on every backend, and that value is not the value of the same
expression in a function. After the change the two agree.

### The proposed rule, in short

1. A module constant whose type is `f32` and whose initializer the front end folds to one value
   is folded with `f32` arithmetic: each `+`, `-`, `*`, `/` and `%` whose type is `f32`, and each
   unary minus on an operand that is not a literal, reads its operands as `f32` values and rounds
   its result to `f32`, to nearest with ties to even.
2. An earlier constant of type `f32` that the initializer reads contributes its value as an
   `f32`.
3. The scope is the scalar `f32` module constant that Rule 6.3 says "must fold to one value". A
   vector, array, matrix or struct constant keeps its expression, as today, and each target and
   the CPU evaluate that expression (the CPU as `f32` arithmetic since #1190). A constant whose
   initializer calls a builtin keeps its expression too, as today.
4. An `f64` initializer keeps Rule 6.3's second paragraph without change. That paragraph already
   requires this rounding for an `f32` operation inside an `f64` initializer.
5. An integer operation keeps its fold. It is already folded "the way the hardware performs it"
   (`src/compiler/ts/loop-bound.ts:51`, #154).
6. A literal is not rounded by the fold. A refusal that asks whether a written number fits its
   type reads the number as written (Diagnostics that read a folded value, below).
7. An initializer made of literals only is question Q1: two readings are possible, and this
   draft does not choose.

### The proposed text of Rule 6.3

One sentence is added after the first sentence of Rule 6.3. The wording of the part in brackets
depends on Q1.

> A scalar `f32` initializer folds as `f32` arithmetic computes it: each operation whose type is
> `f32` reads its operands as `f32` values and rounds its result to `f32`, to nearest, and an
> earlier scalar constant of type `f32` contributes its `f32` value[; an operation whose
> operands are all written numbers is computed at double precision and converted once], so the
> constant is the value that the same expression has in a function.

The rationale gains one sentence:

> An `f32` initializer folds as the targets compute a constant expression of type `f32` (measured
> on Tint and on ANGLE), so the one value is also the value of the expression.

The first sentence, "a scalar must fold to one value carried at double precision for the oracle
and at the target's precision for emit", stands. The double that the oracle carries for an `f32`
constant is then an `f32` value held in a double.

### The proposed text of surface §12

After "A scalar one folds to a single value at declaration" (`docs/use-typeshade-surface.md:1024`),
one paragraph and one example:

> A scalar `f32` constant folds as `f32` arithmetic computes it, operation by operation. So
> `const Y: f32 = X * 3.0` is the value that `X * 3.0` has in a function, on the CPU and on a
> GPU. Before change 0141 the fold computed in double precision and rounded once, and the two
> could differ in the last bit.

### Exclusions

- No syntax, no name, no diagnostic code and no example changes.
- A constant with a builtin call, a vector, an array, a matrix and a struct constant are emitted
  as today.
- The `f64` constant's evaluator (`src/compiler/ts/module-const-f64.ts`) does not change.
- The trip count of a loop, a constant index and each range refusal keep their answers, except
  where a section below says otherwise.
- The const-fold pass over function bodies (`src/core/passes/opt/const-fold.ts`) is question Q2.

## Why

### The measurements

[measured] 2026-11-10, Bun 1.4.4, Playwright's Chromium headless shell 156.0.8078.4
(SwiftShader), `main` at `18c2ed7e`; the front end's results were read again at `2fc20c99`.

Tint. A scratch script launched the gates' Chromium (`scripts/gate-browser.ts`), compiled one
WGSL module with a compute entry on WebGPU, wrote the values to a storage buffer and read the
buffer back.

| WGSL                                                        | Value read back |
| ----------------------------------------------------------- | --------------- |
| `const YC: f32 = X * 3.0;` with `const X: f32 = 0.0117;`    | (b)             |
| `const YL: f32 = 0.0351;` (today's emit)                    | (a)             |
| `const YA = 0.0117 * 3.0;` (abstract float, then converted) | (a)             |
| `x * 3.0` at run time, `x` a uniform that holds 0.0117      | (b)             |
| `f32(0.0117) * 3.0`                                         | (b)             |

ANGLE. The same Chromium, WebGL2, a vertex shader with transform feedback, `precision highp
float`.

| GLSL ES 3.00                                               | Value read back |
| ---------------------------------------------------------- | --------------- |
| `const float YC = X * 3.0;` with `const float X = 0.0117;` | (b)             |
| `const float YL = 0.0351;` (today's emit)                  | (a)             |
| `u.x * 3.0` at run time                                    | (b)             |

TypeShade at `2fc20c99`, `compile()` and the CPU oracle in `'f32'` precision:

| Source                                         | Emitted WGSL                                                 | CPU value                     |
| ---------------------------------------------- | ------------------------------------------------------------ | ----------------------------- |
| `const Y: f32 = X * 3.0;`                      | `const Y: f32 = 0.0351;`                                     | (a)                           |
| `const L: f32 = 0.0117 * 3.0;`                 | `const L: f32 = 0.0351;`                                     | (a)                           |
| `const U = 0.0117 * 3.0;`                      | `const U: f32 = 0.0351;`                                     | (a)                           |
| `const V: vec2 = vec2(X * 3.0, 0.0117 * 3.0);` | `const V: vec2<f32> = vec2<f32>((X * 3.0), (0.0117 * 3.0));` | `V.x` is (b)                  |
| `return X * 3.0;` in a function                | `return (X * 3.0);`                                          | (b)                           |
| `return 0.0117 * 3.0;` in a function           | `return 0.0351;`                                             | (b), while the literal is (a) |

### What the specifications say

- [fact] WGSL (the editor's draft source, `wgsl/index.bs` of `gpuweb/gpuweb`, read 2026-11-10,
  sections "Floating Point Evaluation", "Floating Point Accuracy" and "Floating Point
  Conversion"). The correctly rounded result for a type T is x when x is in T; otherwise "the
  smallest value in T greater than x, or the largest value in T less than x". `x * y`, `x + y`
  and `x - y` are "Correctly rounded". "No rounding mode is specified. An implementation may
  round an intermediate result up or down." On conversion: "If X lies between two adjacent
  finite values in T, then XOut is one of those two values."
- [inference] The exact product of `f32(0.0117)` and 3 lies between (b) and (a). WGSL permits
  both for `const Y: f32 = X * 3.0;`. Today's literal is a permitted value, and so is (b). The
  change moves the constant from one permitted value to the one that Tint and ANGLE compute.
- [fact] GLSL ES 3.00. The Khronos registry refused the download of the specification twice
  in this session (HTTP 403, by WebFetch and by `curl`). This document quotes no sentence of
  it. The statement about GLSL ES 3.00 rests on the ANGLE measurement only.

### What the rules say today

- [fact] Rule 6.3 (`docs/language-design.md:487`): "A top-level `const` is a module constant: a
  scalar must fold to one value carried at double precision for the oracle and at the target's
  precision for emit, and a vector, array, or struct must carry a constant-foldable expression
  every backend evaluates." It does not say in which arithmetic an `f32` initializer is computed.
- [fact] Rule 6.3's second paragraph (`docs/language-design.md:488`), for an `f64` initializer:
  "explicit `f32` conversions and `f32` arithmetic or builtin calls round their operands and
  results to `f32` at each operation or call". So `const D: f64 = f64(X * 3.0)` already folds
  `X * 3.0` as `f32` arithmetic, and `const Y: f32 = X * 3.0` does not.
- [fact] Its rationale (`docs/language-design.md:491`): "a module constant must be one value on
  every backend".
- [fact] Surface §12 (`docs/use-typeshade-surface.md:1024`): "A scalar one folds to a single
  value at declaration". No sentence of Rule 6.3 or of §12 promises that a constant equals the
  same expression in a function.
- [fact] Rule 1.3 (`docs/language-design.md:54`): the oracle gives "WGSL's result for a form
  borrowed from WGSL … and, where WGSL leaves room (§11), one of the permitted answers".

### Where the fold is

- [fact] `collectModuleConsts` takes the scalar path at `src/compiler/ts/module-const.ts:862`:
  `const folded = foldConstValue(init, scope);`.
- [fact] `foldConstValue` (`src/compiler/ts/loop-bound.ts:138`) calls `foldConstNumber`
  (`src/compiler/ts/loop-bound.ts:23`). A float operation there is a JavaScript `f64` operation
  with no rounding. A literal and an earlier constant are read at `f64`.
- [fact] The criterion for a literal in the emit is `containsCall(init)`
  (`src/compiler/ts/module-const.ts:877`): an initializer that calls nothing gives
  `{ wgslValue: value, cpuValue: value }`, and each writer emits the literal; an initializer that
  calls anything, at any depth, keeps `valueExpr` (line 975), and each writer emits the whole
  expression.

### Alternatives

The survey gave the owner three options. The owner chose B on 2026-11-10: "B: 접기를 f32
연산처럼".

| Option                                                   | What an author sees                                                                                             | Cost                                                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Leave it                                              | A constant can differ by 1 ULP from the same expression in a function, on every tier. The difference is silent. | None in the compiler. The difference stays.                                                                                                                                                       |
| B. Fold as `f32` arithmetic (this proposal)              | A constant is the value of the same expression in a function, on the CPU and in the emitted literal.            | Rule 6.3 and §12 change. A literal of such a constant can move by 1 ULP in the emit. The front end models `f32` arithmetic in one more place. Refusals that read the fold are read again (below). |
| C. Do not fold `f32` arithmetic, and emit the expression | The same as B on a target that rounds to nearest.                                                               | The target computes the constant, and WGSL lets a driver round either way, so "one value on every backend" is no longer the compiler's to keep. Every such constant changes its emitted text.     |

Why B and not C: Rule 6.3's rationale asks for one value on every backend, and only a literal
that the compiler emits gives that. Why B and not A: the constant and the expression disagree
today, and no rule says they may.

### Assumptions

- A target evaluates an `f32` operation of a constant expression to nearest, as Tint and ANGLE
  were measured to do. WGSL does not require it. The validation plan measures it again.
- An `f32` operation in JavaScript is `Math.fround` of the `f64` operation on `f32` operands.
  This is exact for `+ - * /` (double rounding is innocuous for these, 53 ≥ 2 · 24 + 2). For
  `%` the proposal uses the same construction as the CPU oracle; the validation plan holds the
  fold to the oracle.

## Owner's decisions

The proposal rests on these entries of `docs/owner-decisions.md`. It reverses none of them.

- **OD-3** (the language stays small; the compiler's work is not pushed onto the author): the
  author writes the same constant. The compiler makes the constant and the expression agree.
- **OD-6** (nothing is released yet): a changed literal owes no warning release under Rules 13.9
  and 13.10.
- **OD-7** (a number's type is inferred from its uses; where nothing decides, the compiler
  chooses `f32`): the fold reads the type the compiler gave the constant, written or inferred.
  Question Q1 is about a written number inside the initializer, which OD-7 also covers; neither
  reading of Q1 gives the author a type to learn.

OD-1, OD-2, OD-4 and OD-5 concern syntax and the way a decision is shown. The before-and-after
table above is OD-4's comparison.

The decision this proposal records: 2026-11-10, "B: 접기를 f32 연산처럼", the owner's choice
among the survey's options A, B and C.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, no diagnostic code and no surface form,
and it adds no rule. It changes one sentence of Rule 6.3 and one paragraph of §12. The compiler
does all of the work; the author writes nothing new.

## What it touches

**Rules.** Rule 6.3: the sentence above, and one sentence of its rationale. The change rests
on Rule 1.3 (the oracle gives a permitted answer), Rule 11.5 and Rule 11.7 (the CPU computes what
the GPU would), Rule 12.6 and Rule 13.3 (a front-end result that stands for a target's is
measured against the target), and Rule 12.7 (both halves).

**Surface.** §12: the paragraph above.

**Exports, codes, examples, names.** None.

**Files.**

- `src/compiler/ts/loop-bound.ts`: `foldConstNumber` gains the `f32` operation. Whether every
  caller takes it, or only the module constant, is question Q4.
- `src/compiler/ts/module-const.ts`: the scalar `f32` path and the value it records.
- `src/core/backends/wgsl.ts` and `src/core/backends/glsl.ts`: only if Q3 chooses a shorter
  literal.
- `docs/language-design.md`, `docs/use-typeshade-surface.md`, `CHANGELOG.md`, `reqs/` by
  `bun run reqs:sync`.

**`ConstDecl.cpuValue` and a constant folded from another.** [fact] Today `wgslValue` and
`cpuValue` of a folded scalar are the same `f64` (`src/compiler/ts/module-const.ts:976`). After
the change both are the `f32` value. A later constant that reads it takes that value:
`const D: f64 = f64(Y)` gives the `f64` of (b). Rule 6.3's second paragraph already says an
earlier constant contributes its value "rounded to `f32` when its type is `f32`", so for an
`f64` initializer the result changes only where the `f32` fold itself changes.

**A constant with a call.** Unchanged in the emit. [fact] `const S: f32 = sin(X)` keeps its
expression. Its recorded compile-time value is the `f64` routine on the unrounded operand, and
`const D: f64 = f64(S)` reads that value. Whether the recorded value of such a constant follows
the new fold (the operand read as an `f32`, the result rounded) is question Q5.

**The loop-bound fold.** [fact] `foldConstNumber` also gives a loop's trip count
(`analyzeCountedFor`, `src/compiler/ts/loop-bound.ts:285`), a constant index
(`src/compiler/ts/index-bound.ts:55`), a local constant's value
(`src/compiler/ts/lower/statement.ts:792`) and the refusals listed below. A trip count is an
integer made from the fold, so it changes only where an `f32` product crosses an integer between
the two arithmetics, for example `i < i32(X * K)` with a product within 1 ULP of a whole number.
The emitted loop computes its bound on the target in `f32` arithmetic already, so there the new
fold agrees with the target where the old one did not. Question Q4 decides the scope.

**Diagnostics that read a folded value.** Each one, and what it reads under the proposal:

| Diagnostic                                                                              | Where                                                                       | What it asks                                  | Reads under the proposal                                                                |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| An `f32` literal or constant outside the range of `f32`                                 | `constF32OutOfRange`, `src/compiler/ts/loop-bound.ts:842`                   | Does the written number fit `f32`?            | The value before rounding. A rounded value would be an infinity and hide the number.    |
| An `i32` or `u32` constant or `case` value outside its range, or not whole              | `src/compiler/ts/module-const.ts` (the integer arms), the `switch` lowering | Does the written number fit the integer type? | The number as written. `-2147483649` is refused as today (the hazard below).            |
| A shift amount at or past the bit width                                                 | `constShiftAmountOutOfRange`, `loop-bound.ts:701`                           | An integer question                           | Unchanged: integer fold.                                                                |
| A constant divisor of zero (`foldConstNumber` gives no value)                           | `loop-bound.ts`, `module-const.ts` (`isFoldableValueExpr`)                  | Is the divisor zero?                          | The rounded divisor. An `f32` divisor that rounds to zero is a zero on the target too.  |
| A builtin's constant argument outside its domain (`CONST_CALLS`, the stand-in for Tint) | `constCallOutsideDomain`, `loop-bound.ts:759`                               | What would Tint refuse?                       | The rounded value, since Tint reads the `f32`. To be measured against Tint (Rule 12.6). |
| `clamp` with crossed constant bounds                                                    | `crossedClampBounds`, `loop-bound.ts:860`                                   | What the program computes                     | The rounded values.                                                                     |
| A constant index outside an array                                                       | `src/compiler/ts/index-bound.ts:55` and `:80`                               | An integer question                           | Unchanged for an integer index; an index converted from `f32` reads the rounded value.  |
| A loop that cannot be counted, or that stalls                                           | `analyzeCountedFor`, `loop-bound.ts:285`                                    | What the loop computes                        | The rounded values (Q4).                                                                |

**The hazard.** [measured] In a scratch change that rounded the operand of every `f32` unary
minus, `src/compiler/ts/switch-validation.test.ts` ("refuses i32 case -2147483649 in the compiler
and editor") failed: the number is typed `f32` when the fold reads it, `Math.fround` makes it
-2147483648, and the range refusal is lost. Item 6 of the proposed rule keeps a literal, and a
sign written on a literal, out of the rounding.

**Both halves (Rule 12.7).** [measured] The language service's hover on such a constant shows
the type only: `const Y: f32`, before and after. It shows no value, so no hover text changes.
`getDiagnostics` reports nothing for the example before or after. The validation plan asserts
both.

**Tests and goldens.** [measured] In the scratch change (operations rounded, literals kept),
with the full suite and `bun run gate:compile` at `18c2ed7e`:

- `bun run gate:compile` passes: 206 examples, failures 0.
- 2 of 423 emit goldens change, both of one example of 114 (`capsule-corp-namek-class`, its
  WGSL and its GLSL ES 3.00). Six constants change their text and none changes its `f32` value:
  each is a negated literal, for example `const GROUND: f32 = -1.04;`. Under item 6 of the
  proposed rule a negated literal is not rounded, so no golden changes.
- 2 tests fail because of the change: `src/compiler/ts/module-const-f64.test.ts` ("widens an
  earlier f32 recorded value and rounds each subsequent f32 operation"), which pins the recorded
  `f64` fold of an `f32` constant, and the `switch` test above.
- No example's constant changes its value.

### Draft impact estimate

| Area              | Expected work                                                                                                              | Basis and uncertainty                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Front end         | The `f32` operation in `foldConstNumber`, or in a fold of its own for the module constant (Q4); the literal rule (item 6). | The scratch change was about 20 lines. The work is in the literal rule and in reading each caller. Estimate. |
| Writers           | A shorter literal for an `f32` value, if Q3 chooses it.                                                                    | Not measured.                                                                                                |
| Tests             | The Tint and ANGLE measurement as a gate case; both-halves tests; the two tests above; goldens if any move.                | Known from the scratch run.                                                                                  |
| Documents         | Rule 6.3, §12, `CHANGELOG.md`, `reqs/`.                                                                                    | Known.                                                                                                       |
| Compatibility     | An emitted literal of a folded `f32` constant can move by 1 ULP. OD-6: no release exists, so no warning release is owed.   | No example's value moves. An author's own constant can.                                                      |
| Dependencies      | None.                                                                                                                      | Known.                                                                                                       |
| Downstream        | A search in each repository (What it owes downstream).                                                                     | The downstream repositories were not searched for this draft.                                                |
| Duration and cost | Unknown; not estimated.                                                                                                    | No basis established.                                                                                        |

Decisions to resolve before acceptance: Q1 and Q4. Q2, Q3 and Q5 can be decided with them or
left as stated.

### Validation plan

Functional validation the implementation will owe:

1. A case in the compile gate (Rules 12.6 and 13.3): for a table of `f32` constants whose two
   folds differ, and their valid neighbours where the folds agree, compile the WGSL an author
   would write (`const Y: f32 = X * K;`) on Tint and the GLSL ES 3.00 on ANGLE, read the value
   back, and hold the front end's folded literal to it bit for bit. The table covers
   `+ - * / %`, a chain of two operations, a negated operand, and a constant read by another.
   The instrument is proven first: the old literal for the example must be reported as
   different.
2. Both halves on the same source: `compile()`'s emit and diagnostics, the language service's
   `getDiagnostics` and `getHover`, for the example and for each row of the diagnostics table.
3. The constant against the function: for each row of the table, the CPU value of the constant
   equals the CPU value of the same expression in a function, on the interpreter, the generated
   JavaScript and the stepper, in `'f32'` precision.
4. The range refusals: `-2147483649` as an `i32`, a literal past the range of `f32`, and a
   product that overflows `f32`, each refused as today, in both halves.
5. The goldens: `bun run bake:goldens` changes no file, or the pull request lists each changed
   literal with its `f32` value before and after.

Document validation: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` after the rule edit.

### Open questions

Each has a recommendation and its cost. The owner decides.

**Q1. An initializer, or a part of one, made of written numbers only.**
`const L: f32 = 0.0117 * 3.0;` has no typed operand. Two readings:

| Reading                                                                                 | `const L: f32 = 0.0117 * 3.0;` | `const M: f32 = (0.0117 * 3.0) * X;`               | Agrees with                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| R1. Written numbers combine at double precision, and the result converts once           | (a), as today                  | (a) is formed first, then one `f32` product by `X` | WGSL's abstract float: Tint gives (a) for `0.0117 * 3.0` [measured]. Today's emit for the constant and for the function's literal. |
| R2. Every operation rounds to `f32`, since the compiler types each written number `f32` | (b)                            | Two `f32` products                                 | The CPU oracle in `'f32'` precision today: `return 0.0117 * 3.0;` in a function gives (b) on the CPU.                              |

Under R1 the range refusals need no special rule, because a written number and its sign are
never rounded before they are checked. Under R2 item 6 is that special rule.
Recommendation: R1. Cost of R1: the CPU oracle rounds a literal-only expression in a function
operation by operation today, so R1 for constants leaves that one case to Q2. Cost of R2: the
emitted literal differs from what the same text means in WGSL, and it changes `L` above.

**Q2. The const-fold pass over function bodies.** [measured] `return 0.0117 * 3.0;` in a
function is emitted as `return 0.0351;` (the pass folds in `f64`), so a GPU reads (a), while the
CPU oracle in `'f32'` precision computes (b). That is a CPU and GPU difference of 1 ULP today,
outside module constants. Options: (i) leave it to its own issue; (ii) make this proposal cover
it, under the reading Q1 chooses.
Recommendation: (ii) if Q1 is R1: the precision pass then treats a literal-only `f32` expression
as one literal, and the CPU agrees with the emit. Cost: the proposal's scope grows to
`src/core/passes/opt/const-fold.ts` and `src/core/passes/precision.ts`, and Rule 11.5's
neighbourhood is read again.

**Q3. How the literal is spelled.** The `f32` value (b) prints as `0.035099998116493225` with
the writers' present spelling, which is the shortest text for the double. The shortest text
that reads back as the same `f32` is `0.035099998`. Options: (i) keep the present spelling;
(ii) print the shortest text for the `f32`.
Recommendation: (i). Cost of (i): long literals in the emit for such constants. Cost of (ii):
every `f32` literal's spelling is decided again, and many goldens change in text.

**Q4. Which callers of `foldConstNumber` take the `f32` operation.** Options: (i) all of them:
the module constant, a local constant, a loop's bound and the refusals; (ii) the module constant
only, through a fold of its own.
Recommendation: (i). The comment at `src/compiler/ts/loop-bound.ts:51` gives the reason for
integers, and it holds for floats: every caller compares the value with something the GPU will
compute. Cost of (i): each row of the diagnostics table is measured again, and a trip count can
change where a product crosses an integer. Cost of (ii): two folds that can disagree.

**Q5. The recorded value of a constant that keeps a call.** `const S: f32 = sin(X)` records
the `f64` routine's value on the unrounded `X`, and `const D: f64 = f64(S)` emits a pair made
from it, while a GPU computes `S` from `X` as an `f32`. Options: (i) the recorded value reads
`X` as an `f32` and rounds the result, as the CPU does at run time since #1190; (ii) leave it.
Recommendation: (i). Cost: the pair of such a `D` changes in the emit, and the expectations of
`src/compiler/ts/module-const-f64.test.ts` change with it.

### Independent review record

This record does not yet apply. Before the owner decides, a reviewer that did not write this
proposal reviews it against `changes/README.md` (Independent review). The record will hold the
reviewer, the date, the revision reviewed, each finding and the author's answer.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's decision on the proposal
and on Q1 and Q4, with its date; the pull request whose merge records it; the approved revision
and scope; and the validation that the implementation owes (Validation plan). The owner's choice
of option B on 2026-11-10 chose a direction among three options. It is not the acceptance of
this text.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing pull requests and their
commits with `Change: 0141`; the delivered configuration (commit, Bun, Node and Chromium
versions); the results of each item of the validation plan; the list of changed goldens with
each literal's `f32` value before and after; `bun run docs:impact`, `bun run docs:refs`,
`bun run reqs:sync` and `python scripts/doorstop-check.py -C` clean after the rule edit; each
deviation with its disposition; and, separately, each downstream repository's pin pull request
with `0141` in its `compiler-changes.md`.

## What it owes downstream

The downstream repositories were not searched for this draft. Each item is expected work.
Responsibilities are recorded at acceptance.

**typeshade.github.io.** A search of the pages, the Playground starters and the reference notes
for a quoted literal of a folded `f32` module constant. Each one found is emitted again with the
pinned compiler. `compiler-changes.md` records `0141` when the pin moves.

**radiance, typenn, typecv, typeaudio.** A search for a test or a record that pins the emitted
literal or the CPU value of an `f32` module constant whose initializer is arithmetic. Each one
found is baked again. `compiler-changes.md` records `0141` in each when the pin moves.

**vscode-typeshade.** No work is expected: the hover shows no value, and no diagnostic changes.
It is not listed in `downstream`.
