---
id: '0141'
title: A module constant with an operand of fixed type `f32` is folded as `f32` arithmetic computes it
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
    what: A search of the pages, the Playground starters and the reference notes for a quoted literal of a folded module constant whose initializer has an operand annotated `f32`; each one found is emitted again. compiler-changes.md records 0141 when the pin moves.
  - repo: radiance
    what: A search for a test or a record that pins the emitted literal or the CPU value of a module constant whose initializer is arithmetic over a constant annotated `f32`; compiler-changes.md records 0141 when the pin moves.
  - repo: typenn
    what: The same search as radiance; compiler-changes.md records 0141 when the pin moves.
  - repo: typecv
    what: The same search as radiance; compiler-changes.md records 0141 when the pin moves.
  - repo: typeaudio
    what: The same search as radiance; compiler-changes.md records 0141 when the pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0141, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                              |
| Date and attribution          | Drafted 2026-11-10 (UTC) by an AI agent (Claude Code) at the direction of the session's coordinator. Revised the same day to answer the first independent review (of `4e9747de`) and the second (of `5ecabbcb`). The dates are dates of authorship. They are not approval dates.                                                       |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-10, in Korean: "B: 접기를 f32 연산처럼". The owner was shown a survey of the fold with three options, and chose option B. After the second review the owner decided, the same day: "초안으로 두고 0134 구현 뒤에" (Owner's decisions).                                        |
| Applicability / effectivity   | Expected: `docs/language-design.md` Rule 6.3, `docs/use-typeshade-surface.md` §12, `src/compiler/ts/loop-bound.ts`, `src/compiler/ts/module-const.ts`, their tests, and the files of "What it touches". Targets: WGSL, GLSL ES 3.00 and the CPU oracle. No export, diagnostic code or example changes. No release version is assigned. |
| Review baseline               | `main` at `2fc20c99`. Each line number in this document was read at that commit.                                                                                                                                                                                                                                                       |
| Review and revision authority | Pull request [#1202](https://github.com/typeshade/typeshade/pull/1202). Git records the revisions. The review and the merge of that pull request record the decision.                                                                                                                                                                  |

## What changes

An author writes the same program. One number changes: the value of a module constant whose
initializer is arithmetic over an operand of fixed type `f32`.

### The example

```ts
"use typeshade";
const X: f32 = 0.0117;
const Y: f32 = X * 3.0;

export function inFunction(): f32 {
  return X * 3.0;
}
```

`X` has a fixed type: its annotation. Two `f32` values are in play. They are neighbours.

- (a) 0.035100001841783524: the `f64` product 0.0117 × 3.0, rounded once to `f32`.
- (b) 0.035099998116493225: the `f32` product of `f32(0.0117)` and `f32(3.0)`, rounded to
  nearest.

| Where `Y` is read                                            | Today (`2fc20c99`)              | After                                   |
| ------------------------------------------------------------ | ------------------------------- | --------------------------------------- |
| The emitted WGSL                                             | `const Y: f32 = 0.0351;`        | A literal whose `f32` value is (b)      |
| The emitted GLSL ES 3.00                                     | `const float Y = 0.0351;`       | A literal whose `f32` value is (b)      |
| The CPU in `'f32'` precision, the constant                   | (a)                             | (b)                                     |
| The CPU in `'f32'` precision, `inFunction()`                 | (b)                             | (b)                                     |
| The CPU in `'f64'` precision (the default), the constant     | 0.0351                          | Question Q6: 0.0351, or (b)             |
| The CPU in `'f64'` precision, `inFunction()`                 | 0.0351                          | 0.0351                                  |
| A GPU, the constant, from the emitted literal                | (a)                             | (b)                                     |
| A GPU, `inFunction()` (`return (X * 3.0);` is emitted)       | (b), measured on Tint and ANGLE | (b)                                     |
| Tint and ANGLE, for the typed constant an author would write | (b), measured                   | (b): the emitted literal agrees with it |

Today the constant is one value on every backend, and in `'f32'` precision and on the measured
targets that value is not the value of `X * 3.0`. After the change the two agree there. What
the `'f64'` oracle carries is question Q6.

### What the rule covers

The rule is worded in terms that hold on `main` today: an annotation, and the value the fold
has today. Accepted proposal 0134 (`changes/0134-literal-from-use.md`, which OD-7 names as the
record of the design) uses the terms "fixed type" and "constant of no fixed type". Its items 1
to 3 are not implemented at `2fc20c99`, and `docs/language-design.md` does not yet have those
terms. This document uses "an operand of fixed type `f32`" as a short name for the definition
of item 1 below.

1. **An operand of fixed type `f32`.** It is one of these:
   - a constant annotated `f32` (`const X: f32 = 0.0117;`);
   - a `static readonly` field annotated `f32`, which folds as a module constant does
     ([measured] `static readonly Y: f32 = S.X * 3.0` emits `const S_Y: f32 = 0.0351;` today);
   - the result of an operation `+`, `-`, `*` or `/` that has such an operand;
   - the negation of such an operand (`-X`; the negation is exact);
   - a constant with no annotation whose initializer is such a result
     (`const Y = X * N;`, so `const Z = Y * 2.0;` reads `Y` as an `f32`).

   A written number is not one. A constant with no annotation whose initializer is written
   numbers only (`const K = 0.0117`, and `const M = K * 2`; 0134 item 2 calls it a constant of
   no fixed type) is not one. A constant imported from another `"use typeshade"` module is
   expected to carry its annotation with its declaration; that case is not measured, and the
   validation plan holds it. Whether the cast `f32(0.0117)` makes one is question Q9.

2. **The fold.** In a module constant's initializer that the front end folds to one value, an
   operation `+`, `-`, `*` or `/` that has an operand of fixed type `f32` reads its operands as
   `f32` values and rounds its result to `f32`, to nearest with ties to even. The result is of
   fixed type `f32`, so the rule carries through the rest of the expression. `%` is question Q7.
3. **An expression of written numbers and of constants of no fixed type keeps its ECMAScript
   value.** That is 0134's decision Q1 ("The compiler folds every literal-only expression with
   ECMAScript semantics") and item 2 ("Its value is the ECMAScript value of the expression").
   This proposal does not change it. Such an expression converts to `f32` once, where it meets
   an operand of fixed type `f32` or the constant's own annotation.
4. **An integer position of written numbers keeps the fold it has.** A `case` value, an enum
   member, an `i32` or `u32` constant, a loop's step, a shift amount and an index have no
   operand of fixed type `f32` when they are written as numbers, so nothing in them rounds.
   An integer position that reads a constant annotated `f32` does change: [measured]
   `const X: f32 = 16777216; const K: i32 = X + 1;` is 16777217 on `main`, and
   [measured by the reviewer] 16777216 under the rule; `case X + 1:` follows the same fold.
   That `main` accepts an `i32` constant from an `f32` expression with no cast is a separate
   defect. It is not fixed here.
5. **An `f64` initializer** keeps Rule 6.3's second paragraph. That paragraph already requires
   this rounding for an `f32` operation inside an `f64` initializer.
6. **A constant that keeps its expression** (a vector, an array, a matrix, a struct, and a scalar
   whose initializer calls anything, a conversion of a constant such as `f32(N)` included) is
   emitted as today. Question Q8 is about its scalar parts. A conversion of a written number is
   not kept: [measured] `const A: f32 = f32(0.0117) * 3.0;` emits `const A: f32 = 0.0351;`
   (question Q9).

| Source                                               | Fixed-type operand? | Today                                          | After                                        |
| ---------------------------------------------------- | ------------------- | ---------------------------------------------- | -------------------------------------------- |
| `const X: f32 = 0.0117; const Y: f32 = X * 3.0;`     | Yes, `X`            | (a)                                            | (b)                                          |
| `const X: f32 = 0.0117; const Y = X * 3.0;`          | Yes, `X`            | (a)                                            | (b)                                          |
| `const L: f32 = 0.0117 * 3.0;`                       | No                  | (a)                                            | (a): 0134 Q1                                 |
| `const X0 = 0.0117; const Y0 = X0 * 3.0;`            | No                  | (a)                                            | (a): 0134 item 2                             |
| `const M: f32 = (0.0117 * 3.0) * X;`                 | Yes, `X`            | —                                              | 0.0351 converts once, then one `f32` product |
| `const K: i32 = 16777216 + 1;`                       | No                  | 16777217                                       | 16777217                                     |
| `const X: f32 = 16777216; const K: i32 = X + 1;`     | Yes, `X`            | 16777217                                       | 16777216                                     |
| `const N = 3.0; const Y = X * N; const Z = Y * 2.0;` | Yes, `X`, then `Y`  | `Z` is 0.0702, as an `f32` 0.07020000368356705 | `Z` is 0.07019999623298645                   |
| `const M1: f32 = (-X) * 3.0;` and `-(X * 3.0)`       | Yes                 | -(a)                                           | -(b)                                         |
| `const BIG = 16777216;` then `case BIG + 1:`         | No                  | `case 16777217`                                | `case 16777217`                              |

### The proposed text of Rule 6.3

One sentence is added after the first sentence of Rule 6.3:

> In a scalar initializer, an operation `+`, `-`, `*` or `/` with an operand that is a constant
> annotated `f32`, the negation of one, or the result of such an operation, reads its operands
> as `f32` values and rounds its result to `f32`, to nearest; every other operand keeps the
> value the fold has today, and converts once.

The sentence names no rule and no term that `main` does not have. The first revision's wording
("keeps its ECMAScript value (Rule 5.1)", "constants of no fixed type") cited text that only
0134's implementation will add: Rule 5.1 at `2fc20c99` says "Where no integer type is
established, the literal must be an `f32`". "The value the fold has today" is the double fold,
which is also the value 0134's decision Q1 asks for.

The sentence does not say that the constant equals the same expression in a function. That
holds for the example, and it does not hold in every case while the related defects below stand.
Under Q8 (ii) the words "In a scalar initializer" also have to cover a scalar part of a
constant that keeps its expression.

**The order with 0134.** The owner decided on 2026-11-10 that this proposal stays a draft until
0134 is implemented (Owner's decisions). So the rule text of 0134 lands first, and the sentence
above is then read again against the rule text that `main` has. [measured] At `2fc20c99` items 1
to 3 of 0134 are not implemented: `const N = 8;` with `for (let j = 0; j < N; j++)` is refused
(`TS8003 … cannot compare i32 and f32`); `const K = 3` read at an `i32` and at an `f32` is
refused; `const K = 16777217;` emits `const K: f32 = 16777217.0;`.

The rationale gains one sentence:

> An operation on a constant annotated `f32` folds as Tint and ANGLE were measured to compute a
> constant expression of type `f32`, so the emitted literal is the value Tint and ANGLE were
> measured to give the expression.

Whether the first sentence of Rule 6.3 and the rest of its rationale stand is question Q6. The
wording for `%` follows question Q7.

### The proposed text of surface §12

After "A scalar one folds to a single value at declaration"
(`docs/use-typeshade-surface.md:1024`):

> In the fold, an operation on a constant annotated `f32` computes as `f32` arithmetic does:
> `const X: f32 = 0.0117; const Y: f32 = X * 3.0;` gives `Y` the `f32` product, which is what
> the CPU in `'f32'` precision gives `X * 3.0` and what Tint and ANGLE were measured to give the
> same constant expression. An expression of written numbers keeps its ECMAScript value:
> `const L: f32 = 0.0117 * 3.0` is 0.0351 converted once. Before change 0141 the first fold
> also computed in double precision, and `Y` could differ from `X * 3.0`.

The text makes no statement about every GPU. WGSL does not fix a rounding mode (Why, below).

### What an author can meet: two new refusals

[measured by the reviewer on a patched tree; the `main` column measured again by the author]
Two programs compile on `main` and are refused under the rule, because a divisor is 0 in `f32`
arithmetic:

| Source                                                                                | `main` emits                                | Under the rule | What Tint does with the typed WGSL |
| ------------------------------------------------------------------------------------- | ------------------------------------------- | -------------- | ---------------------------------- |
| `const A: f32 = 16777216.0; const B: f32 = 16777217.0; const Q: f32 = 1.0 / (B - A);` | `const Q: f32 = 1.0;`                       | Refused        | Refuses it                         |
| `const T: f32 = 1e-46; const P: f32 = 1.0 / T;`                                       | `const P: f32 = 1e+46;`, which Tint refuses | Refused        | Refuses it                         |

Both refusals are right: the program has no value on the target. The sentence must name the
cause (Rule 12.5). Today's sentence for a zero divisor is `Division by zero: "Z" is 0 on every
invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.` (`TS8003`). The proposed
sentence for these cases, with the same code:

> Division by zero: "B - A" is 0 as `f32` arithmetic computes it, since 16777217 is not an
> `f32` value. WGSL refuses it and GLSL ES 3.00 leaves it undefined.

That sentence fits the first program. The second has no arithmetic in its divisor, and takes
its own sentence:

> Division by zero: "T" is 0 as an `f32`, since 1e-46 is below the smallest `f32` value. WGSL
> refuses it and GLSL ES 3.00 leaves it undefined.

No diagnostic code is added.

### How far a value can move

The statement "by one unit in the last place" is not true in general.

- [measured] One operation: on 3,000,000 random pairs in [-100, 100), the `f64` fold rounded
  once and the `f32` operation on rounded operands differed by at most 2 units in the last
  place for `*` and for `/`.
- [measured] `+` and `-` have no such bound, because of cancellation:
  `const A: f32 = 16777216.0; const B: f32 = 16777217.0; const D: f32 = B - A;` is 1.0 today and
  0 as `f32` arithmetic computes it.
- `%` is question Q7.

### Exclusions

- No syntax, no name, no diagnostic code and no example changes.
- A constant of no fixed type and a literal-only expression keep their value (0134).
- An integer position keeps its fold.
- The `f64` constant's evaluator (`src/compiler/ts/module-const-f64.ts`) does not change.
- The const-fold pass over function bodies is out of scope (Related defects).

## Why

### The measurements

[measured by the author] 2026-11-10, Bun 1.4.4, Playwright's Chromium headless shell
156.0.8078.4 (SwiftShader). The Tint and ANGLE rows were measured at `18c2ed7e`; the front
end's rows at `2fc20c99`.

Tint: a scratch script launched the gates' Chromium (`scripts/gate-browser.ts`), compiled one
WGSL module with a compute entry on WebGPU, wrote the values to a storage buffer and read the
buffer back. ANGLE: the same Chromium, WebGL2, a vertex shader with transform feedback,
`precision highp float`.

| Text given to the target                                    | Tint | ANGLE        |
| ----------------------------------------------------------- | ---- | ------------ |
| `const YC: f32 = X * 3.0;` with `const X: f32 = 0.0117;`    | (b)  | (b)          |
| `const YL: f32 = 0.0351;` (today's emit)                    | (a)  | (a)          |
| `const YA = 0.0117 * 3.0;` (abstract float, then converted) | (a)  | not measured |
| `x * 3.0` at run time, `x` a uniform that holds 0.0117      | (b)  | (b)          |

TypeShade at `2fc20c99`:

| Source                                                           | Emitted WGSL                           | CPU, `'f32'`       | CPU, `'f64'`      |
| ---------------------------------------------------------------- | -------------------------------------- | ------------------ | ----------------- |
| `const Y: f32 = X * 3.0;`                                        | `const Y: f32 = 0.0351;`               | (a)                | 0.0351            |
| `const L: f32 = 0.0117 * 3.0;`                                   | `const L: f32 = 0.0351;`               | (a)                | 0.0351            |
| `const X0 = 0.0117; const Y0 = X0 * 3.0;`                        | `const Y0: f32 = 0.0351;`              | (a)                | 0.0351            |
| `const Y: f32 = X * f32(N);`                                     | `const Y: f32 = (X * f32(N));`         | not measured       | not measured      |
| `return X * 3.0;` in a function                                  | `return (X * 3.0);`                    | (b)                | 0.0351            |
| `const PI: f32 = 3.141592653589793; const TAU2: f32 = 2.0 * PI;` | `const TAU2: f32 = 6.283185307179586;` | 6.2831854820251465 | 6.283185307179586 |
| `return 2.0 * PI;` in a function                                 | `return (2.0 * PI);`                   | 6.2831854820251465 | 6.283185307179586 |

### What the specifications say

- [fact] WGSL (the editor's draft source, `wgsl/index.bs` of `gpuweb/gpuweb`, read 2026-11-10;
  the reviewer read https://www.w3.org/TR/WGSL/ the same day). The correctly rounded result for
  a type T is x when x is in T; otherwise "the smallest value in T greater than x, or the
  largest value in T less than x". `x * y`, `x + y` and `x - y` are "Correctly rounded". "No
  rounding mode is specified. An implementation may round an intermediate result up or down."
  On conversion: "If X lies between two adjacent finite values in T, then XOut is one of those
  two values."
- [fact, from the review] `x / y` has the accuracy "2.5 ULP"; `x % y` is "Inherited from
  x - y \* trunc(x/y)"; "An implementation may reassociate operations", and it may fuse them.
- [inference] WGSL permits (a) and (b) alike for `const Y: f32 = X * 3.0;`. The change moves
  the constant from one permitted value to the one that Tint and ANGLE compute. It does not make
  the constant the value of the expression on every conforming GPU.
- [fact] GLSL ES 3.00: the Khronos registry refused the download of the specification three
  times in this work (HTTP 403, by WebFetch and by `curl`; the reviewer met the same). This
  document quotes no sentence of it. Its statement about GLSL ES 3.00 rests on the ANGLE
  measurement only.

### What the rules say today

- [fact] Rule 6.3 (`docs/language-design.md:487`): "A top-level `const` is a module constant: a
  scalar must fold to one value carried at double precision for the oracle and at the target's
  precision for emit, and a vector, array, or struct must carry a constant-foldable expression
  every backend evaluates." Its rationale (line 491): "a module constant must be one value on
  every backend, and the dual-precision scalar is how the oracle stays exact where the target
  rounds." `AGENTS.md:372` says the same of `ConstDecl.wgslValue` and `cpuValue`.
- [fact] Rule 6.3's second paragraph (line 488), for an `f64` initializer: "explicit `f32`
  conversions and `f32` arithmetic or builtin calls round their operands and results to `f32`
  at each operation or call".
- [fact] 0134 (accepted), decision Q1 (`changes/0134-literal-from-use.md:408`) and item 2
  (lines 141 to 157), quoted in "What the rule covers".
- [fact] No sentence of Rule 6.3 or of §12 promises that a constant equals the same expression
  in a function.

### Where the fold is, and who reads it

- [fact] The scalar path of a module constant is `src/compiler/ts/module-const.ts:862`:
  `foldConstValue(init, scope)`, hence `foldConstNumber` (`src/compiler/ts/loop-bound.ts:23`).
  A float operation there is a JavaScript `f64` operation with no rounding. An integer
  operation is folded "the way the hardware performs it" (line 51, #154).
- [fact] `containsCall(init)` (`module-const.ts:877`) decides the emit: an initializer that
  calls nothing gives a literal; one that calls anything, a conversion included, keeps its
  expression.
- [fact] A second evaluator, `foldConstComponents` (`loop-bound.ts:901`), serves the refusals
  below. It can run exact or with a rounding function.

Every caller, and what it takes under the proposal. "Takes the `f32` operation" means: where an
operand has fixed type `f32`. A caller in an integer position has no such operand when its text
is written numbers, so it does not change. When its text reads a constant annotated `f32`, it
changes (item 4 of the rule).

| Caller                                                                                                                     | What it folds                                        | Under the proposal                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module-const.ts:862`                                                                                                      | A scalar module constant                             | Takes the `f32` operation. This is the rule.                                                                                                                                                                    |
| `module-const.ts:279`                                                                                                      | An enum member                                       | Integer position: unchanged for written numbers (item 4)                                                                                                                                                        |
| `lower/statement.ts:792`                                                                                                   | A local constant's recorded value                    | Takes it, so that a local read by a module-level rule agrees; the emit of a local is the related defect                                                                                                         |
| `lower/control.ts:989`                                                                                                     | A `case` value                                       | Integer position: unchanged for written numbers (item 4)                                                                                                                                                        |
| `lower/control.ts:578`, `:1220`; `readStep` (`loop-bound.ts:215` to `239`); `analyzeCountedFor` (`loop-bound.ts:285`)      | A loop's condition, step and trip count              | The step is an integer position: unchanged. A bound with an operand of fixed type `f32` takes it (N2 below)                                                                                                     |
| `exactOperand` (`loop-bound.ts:653`)                                                                                       | A comparison operand that both targets compute alike | Its rule stays: a float is taken only where double and `f32` cannot differ. With the `f32` operation it can take more cases; this proposal does not widen it                                                    |
| `index-bound.ts:55`, `:80`; `lower/index-select.ts:87`; `lower/expression-prop.ts:779`                                     | A constant index                                     | An integer index: unchanged. An index converted from an `f32` expression of fixed type takes it (N2 below)                                                                                                      |
| `lower/expression.ts:1256` (`isWholeF32Pair`)                                                                              | Whole numbers written as floats in a bit operation   | Written numbers: unchanged                                                                                                                                                                                      |
| `lower/expression-misc.ts:78`                                                                                              | A value for an `f64` context                         | Unchanged: the `f64` evaluator has its own rule                                                                                                                                                                 |
| `constShiftAmountOutOfRange` (`loop-bound.ts:701`)                                                                         | A shift amount                                       | Integer position: unchanged for written numbers (item 4)                                                                                                                                                        |
| `constF32OutOfRange` (`:842`), `constCallOutsideDomain` (`:759`), `crossedClampBounds` (`:860`)                            | Range and domain refusals                            | Unchanged. Each reads `foldConstComponents` twice, exact and with `Math.fround`, and refuses only where both agree (#373, #374, #613)                                                                           |
| The zero-divisor checks: `module-const.ts:547`, `module-vars.ts:684`, `lower/expression.ts:729`, `lower/statement.ts:1822` | Whether a divisor folds to zero                      | Each reads `foldConstComponents` in doubles today. Under the proposal a divisor with an operand of fixed type `f32` is read as `f32` arithmetic computes it, or the two folds disagree (the new refusals above) |

[evidence for the true `f32` positions, N2 of the review; the `main` side measured again by
the author] With `const X: f32 = 0.7;`, `main` accepts `A[i32(X * 90.0)]` on an
`array<f32, 63>`, because the `f64` fold says 62. The reviewer measured that Tint refuses the
emitted text ("index 63 out of bounds [0..62]"). `const N: i32 = i32(X * 90.0);` keeps its
expression, and the CPU in `'f32'` precision gives 63.

**Readers of `ConstDecl.cpuValue`.** `module-vars.ts:232`, `lower/function.ts:3156`, `:3805`
and `:4073`, `host-face.ts:2250`, `src/core/passes/opt/unroll.ts:87`,
`src/core/passes/fp64-lower.ts:1584`, `src/core/debug/interp.ts:1009`, `src/core/oracle.ts:867`
and `src/core/cpu-codegen.ts:1841`. The front end's readers (`module-vars.ts:232`,
`lower/function.ts:3156`) take the value as the next fold's operand. The three CPU walks take
the oracle's value. Question Q6 decides what they read. [verified by the reviewer] Three
readers are not affected: `fp64-lower.ts:1584` lowers only `f64` constants, `unroll.ts:87`
reads only `i32` and `u32` constants, and `host-face.ts:2250` reads an enum member.

### Alternatives

The survey gave the owner three options. The owner chose B on 2026-11-10: "B: 접기를 f32
연산처럼".

| Option                                                   | What an author sees                                                                                       | Cost                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Leave it                                              | A constant can differ from the same expression in a function, on every tier. It is silent.                | None in the compiler. The difference stays.                                                                                                             |
| B. Fold as `f32` arithmetic (this proposal)              | The constant is the value that the CPU in `'f32'` precision and the measured targets give the expression. | Rule 6.3 and §12 change. A literal can move in the emit. Two programs are newly refused. The front end models `f32` arithmetic in one more place.       |
| C. Do not fold `f32` arithmetic, and emit the expression | The target computes the constant.                                                                         | WGSL lets a driver round either way, so "one value on every backend" is no longer the compiler's to keep. Every such constant changes its emitted text. |

### Assumptions

- A target evaluates `+ - * /` of a constant expression of type `f32` to nearest, as Tint and
  ANGLE were measured to do. WGSL does not require it. The validation plan measures it again.
- An `f32` operation `+ - * /` in JavaScript is `Math.fround` of the `f64` operation on `f32`
  operands. Double rounding is innocuous for these four (53 ≥ 2 · 24 + 2).
- A decimal literal is read back as the nearest `f32`. WGSL does not require it: a literal has
  "its mathematical value after conversion to the target type", and a value between two
  neighbours converts to "one of those two values". Only an exactly representable literal is
  certain. [measured by the reviewer] `0.035099998116493225` and `0.035099998` both read back
  as (b) on Tint and on ANGLE. "One value on every backend" rests on this assumption today as
  well.

## Owner's decisions

The proposal rests on these entries of `docs/owner-decisions.md`. It reverses none of them.

- **OD-7** (a number's type is inferred from its uses; there is no default type to learn;
  "Proposal 0134 records the full design"): the rule applies only where the author fixed the
  type `f32`. A written number and a constant of no fixed type keep the ECMAScript value of
  0134's decision Q1. No author has to know which constants the compiler made `f32`.
- **OD-3** (the compiler's work is not pushed onto the author): the author writes the same
  constant.
- **OD-6** (nothing is released yet): a changed literal owes no warning release under Rules 13.9
  and 13.10.

OD-1, OD-2, OD-4 and OD-5 concern syntax and the way a decision is shown. The table at the top
is OD-4's comparison.

The decisions this proposal records or follows:

- 2026-11-10, "B: 접기를 f32 연산처럼": the owner's choice among the survey's options.
- 2026-11-10, after the second independent review, "초안으로 두고 0134 구현 뒤에" (keep it a
  draft; after the implementation of 0134). What it means for this record:
  - `status` stays `draft`. The proposal is not accepted, and nothing of it is implemented.
  - The open questions Q3 to Q9 are not asked now. They are asked together after proposal 0134
    is implemented.
  - The measurements of this document are repeated then. 0134 changes what a constant with no
    annotation is, so each row that has such a constant, and each "today" column, can change.
  - Until then the proposal is held in its pull request, which is a draft pull request.
    `changes/README.md` (The lifecycle) starts review with a proposal-only pull request and
    makes the merge with `status: accepted` the agreement; it has no step that merges a draft.
- 2026-11-09, 0134 decision Q1, "ECMAScript: 0.5": the arithmetic of an expression of written
  numbers. The first revision of this proposal offered a reading (R2: round every operation of
  a literal-only initializer) that would reverse that decision. The reading is removed. This
  proposal asks for no change to 0134.

## Why the compiler cannot do it

Not applicable: the proposal adds no author-facing name, no diagnostic code and no surface form,
and it adds no rule. It adds one sentence to Rule 6.3 and one paragraph to §12. The compiler does
all of the work; the author writes nothing new.

## What it touches

**Rules.** Rule 6.3: the sentence above; its rationale; its "Enforced by" line (the new tests).
Its first sentence only under Q6 (ii). The change rests on Rule 5.1 and proposal 0134 (the
written number), Rule 1.3 (the oracle gives a permitted answer), Rule 11.7 (the CPU tier
computes what the GPU would), Rule 12.5 (a refusal names its cause), Rule 12.6 and Rule 13.3 (a
front-end result that stands for a target's is measured against the target) and Rule 12.7 (both
halves).

**Surface.** §12: the paragraph above.

**Exports, codes, examples, names.** None.

**Files.**

- `src/compiler/ts/loop-bound.ts`: the `f32` operation in `foldConstNumber` and in
  `foldConstComponents`' zero-divisor reading.
- `src/compiler/ts/module-const.ts`: the scalar path, the two values it records, the new
  refusal's sentence.
- `src/compiler/ts/module-vars.ts`, `src/compiler/ts/lower/expression.ts`,
  `src/compiler/ts/lower/statement.ts`: the zero-divisor checks.
- `src/core/ir/nodes.ts:369` to `392` (the documentation of `ConstDecl`), the comments at
  `src/core/oracle.ts:15` and `:865` and at `src/core/cpu-codegen.ts:1822`, and
  `AGENTS.md:372`: under Q6.
- `src/core/passes/precision.ts`: under Q6 (i), if the `'f32'` mode reads `wgslValue`.
- `src/core/backends/wgsl.ts` and `src/core/backends/glsl.ts`: only if Q3 chooses a shorter
  literal.
- `docs/language-design.md`, `docs/use-typeshade-surface.md`, `CHANGELOG.md`, `reqs/` by
  `bun run reqs:sync`.

**A dependency.** The rule reads "fixed type" as 0134 defines it. At `2fc20c99` the compiler
emits `const BIG: f32 = 16777216.0;` for `const BIG = 16777216;`: it does not yet tell a constant
of no fixed type from one annotated `f32`. The implementation of 0141 needs that distinction,
from 0134's implementation or from the annotation.

**A constant folded from another.** After the change `const D: f64 = f64(Y)` reads the value
that the fold recorded for `Y`. Rule 6.3's second paragraph already says an earlier constant
contributes its value "rounded to `f32` when its type is `f32`".

**Both halves (Rule 12.7).** [measured] The hover on such a constant shows the type only,
`const Y: f32`, before and after. `getDiagnostics` reports nothing for the example. For the two
new refusals both halves must give the same sentence; the validation plan holds it.

**Examples and goldens, measured again under this scope.** [measured] A search of
`examples/*.shade.ts` (102 files), `examples/hosts/`, `journeys/` and the common modules found
no module constant annotated `f32` whose initializer is arithmetic over another operand, and no
such static field. Under this scope no example and no golden changes, in text or in value.

The first revision said the same of a wider rule, and that was false. [measured by the
reviewer, confirmed by the author] `examples/capsule-corp-namek-class.shade.ts` has
`const GROUND = -1.04; const SHOCK_Y = GROUND + 0.12;`. Under a rule that rounds every
`f32`-typed operation, `SHOCK_Y` moves from -0.9200000166893005 to -0.9199999570846558, and
three golden files carry it (`capsule-corp-namek-class.wgsl`, `.vertex.glsl`,
`.fragment.glsl`). Both constants have no fixed type, so under this scope `SHOCK_Y` keeps its
value.

**Tests.** `src/compiler/ts/module-const-f64.test.ts` ("widens an earlier f32 recorded value
and rounds each subsequent f32 operation") pins a recorded fold and is read again. The `switch`
test of `-2147483649` is an integer position and does not change under this scope.

### Related defects, not in this proposal

[measured by the author and by the reviewer] On `main`, regardless of 0141, the CPU in `'f32'`
precision and the emitted text disagree for folded arithmetic in a function:

| Source, in a function                                      | Emitted          | A GPU reads | CPU, `'f32'` |
| ---------------------------------------------------------- | ---------------- | ----------- | ------------ |
| `return 0.0117 * 3.0;`                                     | `return 0.0351;` | (a)         | (b)          |
| `const x: f32 = 0.0117; const y: f32 = x * 3.0; return y;` | `return 0.0351;` | (a)         | (b)          |

- **Case 1 is implementation of 0134, not a plain bug fix.** By the rule text on `main` (Rule
  5.1: the literal "must be an `f32`"; Rule 1.3) the CPU's (b) is the conforming value, and the
  emit is the one that differs. Only 0134's decision Q1 makes (a) right, and its rule text has
  not landed. A change that moves the CPU to (a) therefore carries `Change: 0134`.
- **Case 2 is a bug fix that needs no proposal** (Rule 1.3, Rule 11.7). The operand is
  annotated, the WGSL an author would write gives (b), and the const-fold pass
  (`src/core/passes/opt/const-fold.ts`, whose header says its `f32` fold is deferred) emits (a).
  The fix needs the annotation to survive constant propagation, and it can move goldens.
- **Case 3, the remainder in a function.** With `const X5: f32 = 5.3;`, `return X5 % 0.1;` is
  emitted as `(X5 % 0.1)` in WGSL [measured] and as `(X5 - 0.1 * trunc(X5 / 0.1))` in GLSL
  [measured by the reviewer]. Tint and ANGLE give 0 [measured by the reviewer]. The CPU in
  `'f32'` precision gives 1.1175870895385742e-7 [measured]. The CPU oracle and both measured
  targets disagree on `main`. Rule 11.2 asks for the measurement to be recorded; it is recorded
  here and in Q7. Which of the two is right is the subject of Q7, so no fix is proposed here.
- This proposal's rule text does not depend on these. The proposed sentences claim agreement
  with the CPU in `'f32'` precision and with the measured targets for a module constant only.
- They are recorded here so that they are not lost. They are not fixed by 0141.

### A document conflict, not fixed here

Surface §38 (`docs/use-typeshade-surface.md:5180`) says "`x + y`, `x * y`, `abs`, `floor`, `min`
and `clamp` are correctly rounded: one answer, on every driver". The WGSL specification's
"correctly rounded" permits either neighbour, and fixes no rounding mode. One of the two
readings needs a correction, in its own pull request.

### Draft impact estimate

| Area              | Expected work                                                                                                                                                                         | Basis and uncertainty                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Front end         | The `f32` operation where an operand has fixed type `f32`; the zero-divisor checks; the new refusal's sentence.                                                                       | The reviewer's and the author's scratch folds were about 20 lines; they did not have the fixed-type test. Estimate. |
| Oracle            | Under Q6 (i): the `'f32'` mode reads `wgslValue`, and `unroll.ts:87` is read again.                                                                                                   | Not measured.                                                                                                       |
| Tests             | The Tint and ANGLE table as a gate case; both-halves tests; the rows of the validation plan.                                                                                          | Known.                                                                                                              |
| Documents         | Rule 6.3, §12, `CHANGELOG.md`, `reqs/`, and the files of Q6.                                                                                                                          | Known.                                                                                                              |
| Compatibility     | An emitted literal can move: by up to 2 units in the last place for one `*` or `/`, and by more after cancellation. Two programs are newly refused. OD-6: no warning release is owed. | Measured. No example changes. An author's own constant can.                                                         |
| Dependencies      | The "fixed type" of 0134.                                                                                                                                                             | Known.                                                                                                              |
| Downstream        | A search in each repository.                                                                                                                                                          | Not searched for this draft.                                                                                        |
| Duration and cost | Unknown; not estimated.                                                                                                                                                               | No basis established.                                                                                               |

Decisions to resolve before acceptance: Q6 with Q8, and Q7. Q3, Q4, Q5 and Q9 can be decided
with them. By the owner's decision of 2026-11-10 all of them wait for the implementation of 0134.

### Validation plan

Functional validation the implementation will owe:

1. A case in the compile gate (Rules 12.6 and 13.3): for a table of module constants with an
   operand annotated `f32` whose two folds differ, and their valid neighbours where the folds
   agree, compile the WGSL an author would write on Tint and the GLSL ES 3.00 on ANGLE, read the
   value back, and hold the front end's literal to it bit for bit. The table covers `+ - * /`,
   a chain of two operations, a negated operand and a constant read by another. `%` follows Q7.
   The instrument is proven first: the old literal for the example must be reported.
2. Both halves on the same source, `compile()` and the language service's `getDiagnostics` and
   `getHover`: the example, the two new refusals with their sentence, and the valid neighbour
   of each (`1.0 / (B - A)` with a `B` that `f32` holds).
3. The integer positions and the constants with no annotation, in both halves:

   | Source                                                                              | Must stay                                                                                            |
   | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
   | `switch (x) { case 16777216 + 1: … }`, `x: i32`                                     | `case 16777217`                                                                                      |
   | `enum E { A = 16777216 + 1, B = A + 1 }`                                            | 16777217 and 16777218                                                                                |
   | `const K: i32 = 16777216 + 1;`                                                      | 16777217                                                                                             |
   | `const U: u32 = 4294967294 + 1;`                                                    | `4294967295u`, accepted                                                                              |
   | `const BIG = 16777216;` then `case BIG + 1:`                                        | `case 16777217`                                                                                      |
   | `const N = 16777216; const K: i32 = N + 1;`                                         | 16777217                                                                                             |
   | `const X: f32 = 16777216; const K: i32 = X + 1;` and `case X + 1:`                  | 16777216 (it changes; the row holds the new value), or refused if the separate defect is fixed first |
   | `case -2147483649:` on an `i32`                                                     | Refused, as today                                                                                    |
   | `const L: f32 = 0.0117 * 3.0;` and `const Y0 = X0 * 3.0;` with `const X0 = 0.0117;` | (a)                                                                                                  |

4. The definition of item 1 of the rule, each case in both halves: the `static readonly` field,
   the negation (`(-X) * 3.0` and `-(X * 3.0)`), the constant with no annotation that reads an
   annotated one (`Z` above), a constant imported from another module, and the cast of Q9.
5. The constant against the function, on the interpreter, the generated JavaScript and the
   stepper, in `'f32'` precision and in `'f64'` precision, for each row of item 1. The expected
   `'f64'` value follows Q6.
6. The true `f32` positions: the index `A[i32(X * 90.0)]` of N2 and a loop bound, held to what
   Tint does with the emitted text.
7. The goldens: `bun run bake:goldens` changes no file, or the pull request lists each changed
   literal with its `f32` value before and after.

Document validation: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` after the rule edit.

### Open questions

Each has one example and the cost of each option. A recommendation names the entry or the
decision it rests on. Q6 and Q7 have no recommendation: Q6 is a conflict between two of the
owner's texts, and in Q7 the measurements do not single out one option. The owner decides. By
the owner's decision of 2026-11-10 the questions are asked together after 0134 is implemented,
and each measurement is repeated first.

**Q1. Closed.** An initializer of written numbers only keeps its ECMAScript value. The owner
decided it in 0134 (decision Q1, 2026-11-09). `const L: f32 = 0.0117 * 3.0;` is (a).

**Q2. Withdrawn.** The const-fold pass over function bodies is the related defect above. It is
not a question of this proposal.

**Q3. How the literal is spelled.** Example: (b) prints as `0.035099998116493225` with the
writers' present spelling; the shortest text that reads back as the same `f32` is
`0.035099998`. Options: (i) keep the present spelling; (ii) print the shortest text for the
`f32`.
Recommendation: (i). It rests on Rule 6.3's rationale (one value on every backend): the long
text is within 2^-53 of the `f32` value, so a parser that rounds to nearest gives that value
whether it parses to `f32` directly or through a double. Cost: long literals in the emit for
such constants.

**Q4. Which callers take the `f32` operation.** Example: `A[i32(X * 90.0)]` with
`const X: f32 = 0.7;` is accepted today and Tint refuses it. Options: (i) every caller of the
table above takes it where an operand has fixed type `f32`, and no caller rounds a written
number; (ii) the module constant only.
Recommendation: (i). It rests on OD-7 (only a type the author fixed changes a fold) and on
the comment at `src/compiler/ts/loop-bound.ts:51` (every caller compares the value with
something the GPU will compute). Cost of (i): each row of the table is measured again, and a
bound or an index with an operand of fixed type `f32` can change its answer where the two folds
cross an integer. Cost of (ii): two folds that can disagree about one expression.

**Q5. The recorded value of a constant that keeps a call.** Example:
`const X: f32 = 100.7; const S: f32 = sin(X); const D: f64 = f64(S);`. `S` records the routine's
value on the unrounded `X`, and `D`'s emitted pair is made from it, while a GPU computes `S`
from `X` as an `f32`. Options: (i) the recorded value reads `X` as an `f32` and rounds the
result, as the CPU does at run time since #1190; (ii) leave it.
Recommendation: (i). It rests on Rule 6.3's second paragraph, which already says an earlier
constant contributes its value rounded to `f32`. Cost: the pair of such a `D` changes in the
emit, and expectations of `src/compiler/ts/module-const-f64.test.ts` change.

**Q6. What the oracle carries for such a constant.** This is a conflict, and the proposal
does not choose. The owner's choice B asks for the `f32` fold. Rule 6.3's first sentence says a
scalar is "carried at double precision for the oracle", and its rationale says that is "how the
oracle stays exact where the target rounds". `compileModule` defaults to `'f64'` precision.

| Example, read in a function               | Today, `'f32'`     | Today, `'f64'`    | (i) `'f32'`        | (i) `'f64'`       | (ii) `'f32'`       | (ii) `'f64'`       |
| ----------------------------------------- | ------------------ | ----------------- | ------------------ | ----------------- | ------------------ | ------------------ |
| `Y` (`X * 3.0`)                           | (a)                | 0.0351            | (b)                | 0.0351            | (b)                | (b)                |
| `X * 3.0` in a function                   | (b)                | 0.0351            | (b)                | 0.0351            | (b)                | 0.0351             |
| `TAU2` (`2.0 * PI`, `PI` annotated `f32`) | 6.2831854820251465 | 6.283185307179586 | 6.2831854820251465 | 6.283185307179586 | 6.2831854820251465 | 6.2831854820251465 |
| `2.0 * PI` in a function                  | 6.2831854820251465 | 6.283185307179586 | 6.2831854820251465 | 6.283185307179586 | 6.2831854820251465 | 6.283185307179586  |

- (i) `cpuValue` stays the double fold. `wgslValue` becomes the `f32` fold, and the emit and the
  `'f32'` mode read it. `AGENTS.md:372` stands. Rule 6.3's first sentence stands in the letter
  only: (b) is not the rounding of 0.0351, and after cancellation the two values differ fully
  (`B - A` is 1.0 in the oracle and 0 in the emit). Costs [from the review, NS3]:
  - A folded constant has two unrelated values, and the `'f32'` mode must read `wgslValue`
    (`src/core/passes/precision.ts` and the three CPU walks).
  - The front end's bindings take `constValue` from `cpuValue` (`module-vars.ts:232`,
    `lower/function.ts:3156`). A loop bound or an index would then read the double, which
    defeats Q4 (i). They must read the `f32` fold.
  - A later constant needs both values of an earlier one: the `f32` value for its `f32` fold and
    the double for its double fold. So a binding carries two values.
  - `const D: f64 = f64(Y)` must say which value it reads. Rule 6.3's second paragraph says
    "its recorded compile-time value, rounded to `f32`". The double 0.0351 rounded is (a); the
    `f32` fold is (b). The text must say (b), which is what a GPU reads from the literal.
  - A constant built through the EDSL with a `wgslValue` that differs from its `cpuValue`
    changes its value in `'f32'` precision. The new value is the one a GPU reads.
- (ii) Both values become the `f32` fold. Rule 6.3's first sentence, its rationale and
  `AGENTS.md:372` change. Cost: in `'f64'` precision the constant then differs from the same
  expression in a function (the rows `Y` and `TAU2`), and the algebra oracle carries an error of
  about 3e-8 for `TAU2`.
- [measured] Under (i) the constant equals the same expression in a function in both
  precisions. Under (ii) it does so in `'f32'` precision only.
- [verified by the reviewer] Neither option breaks a gate through the constant's `'f64'` value.
  `scripts/gpu-differential.ts` holds the GPU to the `'f32'` oracle bit for bit. The other
  comparisons use a tolerance of 1e-6 or wider.
- Q6 and Q8 are answered together. Under Q6 (i) with Q8 (ii), in `'f64'` precision the scalar
  `Y` reads 0.0351 while the part `V.x` of `vec2(X * 3.0, …)` reads (b), unless a folded part
  also carries two values.

No recommendation is given: two of the owner's texts meet here, and the owner chooses. Under (i)
the choice B holds in the emit and in `'f32'` precision, and Rule 6.3's first sentence stands in
the letter. Under (ii) the choice B holds in every precision, and Rule 6.3's first sentence
changes.

**Q7. The remainder.** `%` has no single value. With `const X5: f32 = 5.3;`, for `X5 % 0.1`:

| Where                                                | Tint                  | ANGLE         | CPU, `'f32'`          |
| ---------------------------------------------------- | --------------------- | ------------- | --------------------- |
| `main`'s scalar literal (`const R: f32 = X5 % 0.1;`) | 0.10000000149         | 0.10000000149 | 0.10000000149         |
| The typed constant an author would write             | 0                     | not measured  | —                     |
| In a function, as emitted                            | 0                     | 0             | 1.1175870895385742e-7 |
| A part of `vec2(X5 % 0.1, 0.0)`, as emitted          | 0                     | 0             | 1.1175870895385742e-7 |
| At run time, the operand from a uniform              | 1.1175870895385742e-7 | 0             | —                     |

[Tint and ANGLE measured by the reviewer; the CPU column, the emitted WGSL and the literal
measured by the author.] TypeShade emits the function's `%` as `(X5 % 0.1)` in WGSL and as
`(X5 - 0.1 * trunc(X5 / 0.1))` in GLSL. With a module constant `X5` both are constant
expressions on the target. [measured] WGSL's stated formula `x - y * trunc(x / y)` in `f32`
steps gives 0 in JavaScript; `Math.fround` of the JavaScript `%` on the `f32` operands gives
1.1175870895385742e-7.

Options: (α) leave `%` out of the fold: an initializer with `%` over an operand of fixed type
`f32` keeps its expression, and the target computes it; (β) fold `%` as the CPU oracle computes
it today (the exact remainder of the `f32` operands, rounded); (γ) fold `%` by WGSL's formula
in `f32` steps, which is also the text the GLSL writer emits.

| Option | The scalar constant         | It agrees with                                                                | It differs from                                                                                                |
| ------ | --------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| (α)    | Tint 0, ANGLE 0, CPU 1.1e-7 | Each tier's own function body                                                 | Itself across tiers: it is not one value on every backend                                                      |
| (β)    | 1.1e-7 on every tier        | The CPU oracle; Tint at run time with a uniform operand                       | The same expression in a function on Tint and on ANGLE, the vector part on both, and ANGLE at run time (all 0) |
| (γ)    | 0 on every tier             | The function body and the vector part on Tint and on ANGLE; ANGLE at run time | The CPU oracle (in a function and in the vector part), and Tint at run time with a uniform operand             |

No recommendation is given. (β) and (γ) both keep "one value on every backend" for the scalar
constant (Rule 6.3's rationale); (α) does not. (β) follows the oracle against both measured
targets' constant evaluation. (γ) follows both measured targets against the oracle, and then
the oracle's own `%` (related defect, case 3) is the open item. The owner chooses, and the
choice also settles case 3. No existing gate compares the fold with Tint's constant evaluation;
only item 1 of the validation plan would.

**Q8. The scalar parts of a constant that keeps its expression.** Example:
`const V: vec2 = vec2(X * 3.0, 0.0117 * 3.0);` is emitted as written today.

| `V.x`, `V.y`                                           | Tint     | ANGLE    | CPU, `'f32'` |
| ------------------------------------------------------ | -------- | -------- | ------------ |
| Today, as emitted                                      | (b), (a) | (b), (b) | (b), (b)     |
| Option (ii): `vec2<f32>(0.035099998116493225, 0.0351)` | (b), (a) | (b), (a) | (b), (a)     |

[Tint and ANGLE measured by the reviewer; the emitted text and the CPU row of "today" measured
by the author.] So `0.0117 * 3.0` is (a) in `const L: f32` and is (b) inside `vec2(...)` on
ANGLE and on the CPU today. 0134's decision Q1 asks for the ECMAScript value of the
literal-only part. Options: (i) leave such a constant as an expression in this proposal, and
leave the literal-only part to 0134's implementation; (ii) fold each scalar part by this
proposal's rule and by 0134, and emit `vec2<f32>(<literal>, <literal>)`.

Recommendation: (ii). It rests on 0134's decision Q1 and on OD-7: the same text then has the
same value in a scalar constant and in a component, on every tier. Rule 6.3 still holds, since
the constant carries a constant-foldable expression. Costs of (ii):

- `V.y` changes its VALUE on ANGLE and on the CPU in `'f32'` precision, from (b) to (a). It is
  not a change of text only.
- Every vector, array and matrix constant with arithmetic in a component changes its emitted
  text. [measured by the reviewer] One of the 102 examples has such a constant, and no
  literal-only part there changes its `f32` value.
- The proposed Rule 6.3 sentence says "In a scalar initializer", and must then cover a scalar
  part.
- It is answered together with Q6 (see Q6).

**Q9. Whether a cast of a written number fixes the type.** Example:
`const A: f32 = f32(0.0117) * 3.0;`. [measured] `main` lowers `f32(0.0117)` to a literal and
emits `const A: f32 = 0.0351;`, which is (a). [measured by the reviewer] Tint gives (b) for the
WGSL `f32(0.0117) * 3.0`. Options: (i) the cast makes an operand of fixed type `f32`, so `A` is
(b); (ii) the cast of a written number is a written number, so `A` stays (a).
Recommendation: (i). It rests on OD-7 (the author fixed the type where the author wrote it) and
on 0134, which says "A cast is a read". Cost of (i): one more form in the definition, and a
constant written with such a cast can move. Cost of (ii): `f32(0.0117) * 3.0` and `X * 3.0` with
`const X: f32 = 0.0117` are the same WGSL and get different values.

### Independent review record

**First review.**

- **Reviewer.** An AI agent that did not write this proposal.
- **Date.** 2026-11-10.
- **Revision reviewed.** `4e9747de`, against `main` at `2fc20c99`.
- **Verification by the author.** Each finding was checked before the text changed. The author
  ran the `main` side of B2, B3, B4, B5, S2, S3, S5 and N2 again and got the reviewer's values.
  The author did not repeat the reviewer's patched-tree columns or the reviewer's Tint and
  ANGLE rows for `%`, for `V.y`, for the two refused programs and for the index; those are
  marked "measured by the reviewer".

| #   | Severity   | Finding                                                                                                                                   | Disposition                                                                                                                                         |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Blocking   | The proposal did not cite accepted proposal 0134 and contradicted its item 2 and its decision Q1; reading R2 would reverse that decision. | Fixed: the rule covers only an operand of fixed type `f32`; 0134 is cited; Q1 is closed; R2 is removed and named as a reversal.                     |
| B2  | Blocking   | "No example's constant changes its value" was false: `SHOCK_Y` moves, in three golden files, not two.                                     | Fixed: the claim is corrected, and the search is repeated under the new scope (no example and no golden changes).                                   |
| B3  | Blocking   | Integer positions change silently: a `case` value, an enum member, an `i32` or `u32` constant, also through a constant of no fixed type.  | Fixed: item 4 of the rule; the caller table; the rows of the validation plan; Q4 rewritten.                                                         |
| B4  | Blocking   | The `'f64'` oracle was not shown, and it regresses if `cpuValue` becomes the `f32` value.                                                 | Made an open question (Q6), with the `'f64'` rows in the first table and one example under each option. The proposal does not choose.               |
| B5  | Blocking   | `%` has no single target value, and "1 ULP" is false in general.                                                                          | `%` made an open question (Q7) with the measured table. The general statements are replaced by "How far a value can move".                          |
| S1  | Should-fix | The list of readers was incomplete and partly wrong.                                                                                      | Fixed: the caller table, `foldConstComponents`, `exactOperand`, the readers of `cpuValue`.                                                          |
| S2  | Should-fix | Two new refusals were not listed, and their sentence names no cause.                                                                      | Fixed: the section "two new refusals", with a proposed sentence and the validation rows.                                                            |
| S3  | Should-fix | The const-fold defect is wider than "literal-only" and exists on `main`; the rule text depended on it.                                    | Recorded as related work, with the measured cases. Q2 is withdrawn. The proposed rule text no longer claims the function's value.                   |
| S4  | Should-fix | "On a GPU" claimed more than WGSL gives.                                                                                                  | Fixed: the texts say "the CPU in `'f32'` precision" and "what Tint and ANGLE were measured to give"; `/`, `%`, reassociation and fusion are quoted. |
| S5  | Should-fix | Constants that keep their expression differ between targets; a conversion is a call.                                                      | Made an open question (Q8).                                                                                                                         |
| S6  | Should-fix | A decimal literal is not exact by specification.                                                                                          | Fixed: named as an assumption; Q3's recommendation gives the reason.                                                                                |
| S7  | Should-fix | "What it touches" omitted files.                                                                                                          | Fixed: the file list.                                                                                                                               |
| N2  | Note       | Evidence for the true `f32` positions.                                                                                                    | Used in the caller table and in Q4.                                                                                                                 |
| —   | Note       | Surface §38 says "one answer, on every driver" where WGSL permits either neighbour.                                                       | Recorded as a document conflict, not fixed here.                                                                                                    |

**Second review.**

- **Reviewer.** An AI agent that did not write this proposal.
- **Date.** 2026-11-10.
- **Revision reviewed.** `5ecabbcb`, against `main` at `2fc20c99`.
- **Result.** The twelve findings B1 to B5 and S1 to S7 are closed. Two new blocking findings
  and six new should-fix findings.
- **Verification by the author.** The author ran the `main` side again and got the reviewer's
  values for: NB1 (the emitted WGSL, the CPU value in a function and in the vector part, the
  formula in `f32` steps), NB2 (the three programs), NS1 (a), (b), (c) and (d), NS2 and NS4
  (today's emit and CPU values). The author did not repeat the reviewer's patched-tree values,
  the Tint and ANGLE rows, the emitted GLSL of `%`, or case (e) of NS1. Those are marked
  "measured by the reviewer" or "not measured".

| #   | Severity   | Finding                                                                                                              | Disposition                                                                                                                                                                                                                      |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NB1 | Blocking   | Q7 stated two costs that the measured targets contradict; (γ) is the function's value on both targets.               | Fixed: the two cost sentences are replaced by the measured table and a table of what each option agrees with. No recommendation is given. The function-body `%` is related defect case 3.                                        |
| NB2 | Blocking   | The proposed Rule 6.3 sentence cited rule text that is not on `main` (Rule 5.1's ECMAScript value, "no fixed type"). | Fixed: the sentence names an annotation and "the value the fold has today". The order with 0134 is stated as the owner decided it.                                                                                               |
| NS1 | Should-fix | "An operand of fixed type `f32`" was not defined for five cases.                                                     | Fixed: item 1 defines the result of an operation, the negation, the `static readonly` field and the unannotated constant that reads an annotated one. The imported constant is stated and not measured. The cast is question Q9. |
| NS2 | Should-fix | An integer position with an operand annotated `f32` changes silently.                                                | Fixed: item 4, the table row, the caller table's wording and a validation row. The acceptance of an `i32` constant from an `f32` expression is named as a separate defect.                                                       |
| NS3 | Should-fix | Q6 (i) understated its cost.                                                                                         | Fixed: Q6 lists the bindings, the two values of a binding, `f64(Y)` (the text must say (b)), "in the letter only" and the EDSL constant.                                                                                         |
| NS4 | Should-fix | Q8 (ii) meets Q6 (i), and changes values on two tiers.                                                               | Fixed: Q8's table and costs; Q6 and Q8 are answered together; the scope of "In a scalar initializer".                                                                                                                            |
| NS5 | Should-fix | The proposed refusal sentence fits one of the two programs.                                                          | Fixed: a second sentence for `1.0 / T`.                                                                                                                                                                                          |
| NS6 | Should-fix | The rationale sentence said "the targets".                                                                           | Fixed: "the value Tint and ANGLE were measured to give".                                                                                                                                                                         |
| —   | Note       | Case 1 of the related defect is implementation of 0134, not a plain bug fix; case 2 is a bug fix.                    | Fixed: the related defects say so, with the rule text of `main` as the reason.                                                                                                                                                   |

No finding is left without a disposition. This revision has not been reviewed again. By the
owner's decision of 2026-11-10 the next review is due when the questions are asked, after 0134
is implemented and the measurements are repeated.

### Approval and plan record

This record does not yet apply. The owner decided on 2026-11-10 that the proposal stays a draft
until 0134 is implemented ("초안으로 두고 0134 구현 뒤에"). Acceptance will require: the
measurements repeated on the `main` that carries 0134; a review of that revision; the owner's
decision on the proposal and on Q3 to Q9, with its date; the pull request whose merge records it; the approved revision
and scope; and the validation that the implementation owes. The owner's choice of option B on
2026-11-10 chose a direction among three options. It is not the acceptance of this text.

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
for a quoted literal of a folded module constant whose initializer has an operand annotated
`f32`. Each one found is emitted again with the pinned compiler. `compiler-changes.md` records
`0141` when the pin moves.

**radiance, typenn, typecv, typeaudio.** A search for a test or a record that pins the emitted
literal or the CPU value of such a constant. Each one found is baked again.
`compiler-changes.md` records `0141` in each when the pin moves.

**vscode-typeshade.** No work is expected: the hover shows no value. The two new refusals reach
the editor through the compiler's own diagnostics. It is not listed in `downstream`.
