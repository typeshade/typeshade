---
id: '0079'
title: An array's methods work on a kernel function's array parameter, where each runs as a kernel loop, and the search methods and `fill` join the five an array has
status: accepted
rules:
  - '7.2'
  - '8.18'
  - '8.22'
surface:
  - 63
  - 65
exports: []
exports-removed: []
codes: []
examples:
  - kernel-array-methods
downstream:
  - repo: typeshade.github.io
    what: The array-methods page and the kernel-function page, en and ko, gain the methods on a kernel function's array, the new methods, what runs on the GPU and the order of a floating-point reduce. compiler-changes.md records 0079 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references gain the methods on a kernel function's array and the new methods. compiler-changes.md records 0079 when the pin moves.
  - repo: typecv
    what: Nothing is owed at the pin. A hand-written kernel loop that reduces, searches or fills can move to the method when the pin moves, held to its current output. compiler-changes.md records 0079 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in other repositories -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Document                    | Proposal 0079. This file is the proposal source and the approved design of the change. It has status `accepted`.                                                                                                                                                                                                               |
| Revision context            | Drafted 2026-10-21, UTC. The date is the authoring context. It is not an approval date.                                                                                                                                                                                                                                        |
| Request source              | The repository owner, Seungup, asked in a Claude Code session of 2026-10-21 for the front-end design of `Array.prototype` and of the use of arrays as a whole, and approved the drafting of this proposal. No GitHub issue is recorded for this draft.                                                                         |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                            |
| Current lifecycle state     | `accepted`. Accepted by the owner's approval of 2026-10-21 (see Approval and plan record), recorded by the merge of PR #715. No implementation exists.                                                                                                                                                                         |
| Applicability / effectivity | The front end's array methods (`src/compiler/ts/lower/array-methods.ts`, `expression-call.ts`), the kernel-loop proof (`src/core/passes/parallel-loop.ts`), the kernel lowering (`src/core/passes/kernel-lower.ts`), the language service's ambient library, the WebGPU, WebGL2 and CPU tiers. No release version is assigned. |
| Review baseline             | `origin/main` at `26daefb1` (commit "Merge pull request #713 …"), read on 2026-10-21. Change 0078 part 1 (PR #714, `3b2563b0`) was read and is not on this baseline.                                                                                                                                                           |
| Proposal review             | [PR #715](https://github.com/typeshade/typeshade/pull/715), the proposal-only pull request.                                                                                                                                                                                                                                    |
| Revision authority          | Git records the revisions of this file. The review and merge of the proposal-only pull request record the decision.                                                                                                                                                                                                            |

## What changes

### The problem, measured

The same array reads differently in two places. Measured with `compile()` and the host face on
`26daefb1`, on 2026-10-21:

| Written in a kernel function                         | Today                                                     |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `for (…) { out[i] = xs[i] * 2.; }`                   | a GPU loop                                                |
| `for (…) { out[2 * i + 1] = xs[i]; }`                | a GPU loop                                                |
| `for (…) { bins[xs[i] % 16] += 1; }`                 | a GPU loop (atomics)                                      |
| `for (…) { out[idx[i]] = xs[i]; }`                   | the CPU tier, `TS8070`                                    |
| `let s = 0.; for (const x of xs) { s += x; }`        | a GPU reduction                                           |
| `return xs.reduce((a, x) => a + x, 0.);`             | `TS8099` ("call `reduce` on the binding by its own name") |
| `xs.forEach((x, i) => { out[i] = x * 2.; });`        | `TS8099`, the same text                                   |
| `return xs.some((x) => x > 1.);`                     | `TS8099`, the same text                                   |
| `out.fill(0.);`                                      | `TS8099` ("Method calls are not supported here")          |
| `xs.findIndex(…)`, `xs.indexOf(v)`, `xs.includes(v)` | `TS8099`: not one of the five methods                     |

A shader's `array<T, N>` and a storage binding have five methods (surface §63). A kernel
function's array, which is where a TypeScript developer's data is, has none. The loop the method
would be is the loop the proof already runs on the GPU. The `TS8099` text also names a binding,
which a kernel function's parameter is not.

### 1. The methods on a kernel function's array

On an array parameter with no size of a kernel function (Rule 8.22), these are accepted:

| Written                                  | Its value          | The loop it is                                                         |
| ---------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `xs.forEach(f)`                          | nothing            | `for (i) { f(xs[i], i, xs); }`                                         |
| `xs.fill(v)`                             | nothing            | `for (i) { xs[i] = v; }`                                               |
| `xs.reduce(f, init)`                     | the type of `init` | `let acc = init; for (i) { acc = f(acc, xs[i], i, xs); }`              |
| `xs.some(p)`, `xs.every(p)`              | `bool`             | whether `p` holds for one element, or for every element                |
| `xs.findIndex(p)`, `xs.findLastIndex(p)` | `i32`              | the least, or the greatest, index where `p` holds, and `-1` where none |
| `xs.indexOf(v)`, `xs.lastIndexOf(v)`     | `i32`              | the least, or the greatest, index where `xs[i] === v`, and `-1`        |
| `xs.includes(v)`                         | `bool`             | whether one element is `v` by SameValueZero (a `NaN` finds a `NaN`)    |

Each runs as ECMAScript runs it. It may stand where a statement may at the top level of the
function's body: as a statement, as the value of a `const` or a `let`, or in the `return`. There
it is a candidate loop (Rule 8.22), proved and lowered as the `for` loop of the table is. A call
inside an expression is read first, into a value the statement then reads, as ECMAScript evaluates
it before the rest of the statement. Inside a loop it is a loop inside each iteration, as a nested
`for` is today.

### 2. What the proof does with each

- `forEach` and `fill` are the loops of the table. R3 and R4 decide them, unchanged.
- `reduce` runs on the GPU when its function combines the running value with one of the
  reduction operators, `(acc, x) => acc op e` or `min(acc, e)` or `max(acc, e)`, with `e` not
  reading `acc`. That is R3's reduction form, `s op= e`. Any other function runs on the CPU, with
  `TS8070` naming the line and the remedy.
- `some` and `every` are an `|` and an `&` reduction of the predicate, as a `u32`. The result does
  not depend on the order, so the stop at the first element that decides is no difference.
- `findIndex`, `indexOf` and `includes` are a `min` reduction of the index, and the `Last` forms a
  `max`. The least or the greatest index is the one an ECMAScript run finds first, on every tier.

A predicate or a function handed to a method is held to R5 and R6 as the body of a loop is.

### 3. The order of a floating-point reduce

A reduction is combined in the tree order on every tier (Rule 7.2): an `f32` `reduce` does not give
the left-to-right sum of ECMAScript. Rule 7.2 already records this for `s += x` in a loop, and this
change applies the same rule and the same divergence row to `reduce`. Every other method of this
change has one answer, the ECMAScript one, in any order.

### 4. The new methods everywhere

`fill`, `findIndex`, `findLastIndex`, `indexOf`, `lastIndexOf` and `includes` join the five an
array has (surface §63) wherever those five work: an `array<T, N>` and a storage binding, as a loop
inside the invocation. `fill` writes, so it is refused on a read-only binding and on a `const`.

### 5. The text of the refusals

A method on a kernel function's parameter that this change does not accept says so in its own
words, not in the words for a binding. `TS8099` keeps its code.

### Not in this change

- `map`, `filter`, `slice` and `concat`, which make a new array. A kernel function cannot make an
  array of a size it learns at run time. Open decision 3 lists the two forms for a later change.
- `find` and `findLast`, whose value is `T | undefined`. A shader value has no `undefined`.
  `findIndex` is the remedy.
- `sort`, `reverse`, `copyWithin`, and the `start` and `end` arguments of `fill`, `indexOf` and
  `includes`.

## Why

**The array is where a TypeScript developer starts.** `xs.reduce(…)` and `xs.some(…)` are written
before a `for` loop. Today each is an error on the one array a kernel function has, and the error
names a binding. The design goal of the kernel function (Rule 8.22, `docs/dx.md`) is that a
developer writes TypeScript and the compiler finds the dispatch. A method is the shortest
TypeScript there is for the loops the proof already accepts.

**Nothing new runs.** Each method is a loop the proof and the lowering already handle: an
independent loop, a reduction with an operator, or a `min` or `max` of an index. The front end
writes the loop, and the rest of the pipeline is unchanged.

**One answer.** Every method here has the ECMAScript answer on every tier, except the order of an
`f32` `reduce`, which Rule 7.2 already states for the loop form. This keeps TypeCV's Rule 1.1 and
Rule 1.3 (`docs/design-rules.md` of TypeCV) true for code written with methods.

### Alternatives

- **Leave the methods to shaders.** The loop is always writable by hand. That keeps two vocabularies
  for one array, which is the problem measured above.
- **Lower each method as a function of the module, as today's five are.** A function cannot take an
  array with no size (Rule 12.6), which is why the text names a binding. An inline loop can.
- **Run `reduce` left to right on every tier.** One answer equal to ECMAScript's, and a GPU tier
  that cannot run it in parallel. Refused for the loop form by Rule 7.2. Open decision 2.

### Assumptions

- A `bool` reduction lowers as `u32` `|` or `&`, which `notReducible` accepts.
- A `min` reduction of an `i32` index, with `-1` mapped to the greatest `i32` and back, is exact on
  every tier.

### Decisions at acceptance

The owner accepted decisions 1 and 2 as drafted, and left decision 3 to a later change (Approval
and plan record).

1. **The index type.** The function handed to a method takes its index as an `i32` (Rule 7.5, surface
   §63), and a kernel loop counts with a `u32`. The draft keeps `i32` for every method, so one array
   method reads the same everywhere. The alternative passes a `u32` on a kernel function's array.
2. **The order of an `f32` `reduce`.** The tree order (the draft, as Rule 7.2 gives the loop form),
   or left to right, which runs on the CPU tier only.
3. **A method that makes a new array**, for a later change. (a) A kernel function returns an array,
   which the call makes on the host: `return xs.map(f)`. (b) The method fills a host array the call
   takes: `out.set(xs.map(f))`. `filter` builds on change 0078's `push` in either form.

## What it touches

- **Rule 7.2.** The divergence row of a tree-order reduction gains `reduce` on a kernel function's
  array.
- **Rule 8.18.** The methods an array has gain `fill` and the five search methods, and the methods on
  a kernel function's array are inline loops.
- **Rule 8.22.** A method at the top level of a kernel function's body is a candidate loop, and the
  proof reads its function as the body of the loop.
- **Surface §63.** The new methods, and the refusal text on a kernel function's array.
- **Surface §65.** The methods on a kernel function's array, what runs on the GPU and the order of
  an `f32` `reduce`.
- **Example `kernel-array-methods`.** A kernel function that fills, reduces and searches, held to the
  CPU oracle on every tier the call reaches.

### Draft impact estimate

Known work, by area:

- **Front end.** `array-methods.ts` writes an inline loop for a method on a kernel function's array
  parameter, and a statement-level read for a call inside an expression. `lowerCall` routes the new
  methods.
- **Language service.** `ArrayOps` and `interface Array<T>` gain `fill`, `findIndex`,
  `findLastIndex`, `indexOf`, `lastIndexOf` and `includes`, typed against the element (Rule 12.7).
- **Proof.** Recognize `reduce`'s function as R3's reduction form. Lower `some`, `every` and the
  search methods to their reductions.
- **Lowering and tiers.** None new: the loops are today's forms.
- **Tests.** Each method in both halves on one source. Each on the CPU tier against ECMAScript's own
  `Array.prototype` on the same input. The import journey on WebGPU, bit for bit with the CPU tier.
  The differential gate gains generated method calls.

Compatibility: no program that compiles today changes its meaning. Every form this change accepts
is refused today.

Dependencies: none. Change 0078 is not required. Open decision 3's `filter` would need it.

Duration and cost: unknown. No estimate is established.

### Approval and plan record

The owner, Seungup, approved the proposal in the project conversation on 2026-10-21 (Asia/Seoul),
with the recommended decisions. Decision 1: the function handed to a method takes its index as an
`i32` on every array, a kernel function's included. Decision 2: an `f32` `reduce` combines in the
tree order of Rule 7.2 on every tier. Decision 3 is not part of this change: a method that makes a
new array waits for its own proposal. The merge of PR #715 with `status: accepted` records the
decision. Responsibilities: an agent of this repository implements the proposal in commits that
say `Change: 0079`. The site and the editor do their work when their pins move. No milestone date
is assigned.

### Configuration and validation record

This record does not yet apply. Delivery will require this evidence, none of which exists yet:

- each method and each refusal in both halves on one source (Rule 12.7);
- each method on the CPU tier equal to ECMAScript's on the same input, `NaN` and `-0` among them;
- `kernel-array-methods` through the compile gate (Tint), and on WebGPU in the import journey, bit
  for bit with the CPU tier;
- the differential gate over generated method calls.

## What it owes downstream

- **typeshade.github.io.** The array-methods page and the kernel-function page, in English and
  Korean, gain the methods on a kernel function's array and the new methods. `compiler-changes.md`
  records 0079 when the pin moves.
- **vscode-typeshade.** The skill's references gain the same. `compiler-changes.md` records 0079
  when the pin moves.
- **typecv.** No page describes the old behavior. A hand-written loop that reduces, searches or
  fills can move to the method when the pin moves. `compiler-changes.md` records 0079 when the pin
  moves.
