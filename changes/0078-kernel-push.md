---
id: '0078'
title: A kernel function's loop appends to an array parameter with `out.push(v)`, in the order of the iterations on every tier, and reads how many it appended from `out.length` after the loop
status: implemented
rules:
  - '8.22'
  - '8.23'
  - '11.8'
  - '11.13'
surface:
  - 63
  - 65
  - 71
exports: []
exports-removed: []
codes: []
examples:
  - kernel-push
downstream:
  - repo: typeshade.github.io
    what: The kernel-function page and the array-methods page, en and ko, gain `push` in a kernel function's loop, its order, the capacity of the host array, and `out.length` after the loop. The `fuse` page says that a loop that pushes is a group of its own. compiler-changes.md records 0078 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references gain `push` in a kernel function's loop and its host contract. compiler-changes.md records 0078 when the pin moves.
  - repo: typecv
    what: Nothing is owed at the pin. The hand-written stable compactions (`src/gpu/scan.shade.ts` and its callers) can move to `push` when the pin moves, each held to its current output. compiler-changes.md records 0078 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in other repositories -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0078. This file is the proposal source and the approved design of the change. It has status `implemented`.                                                                                                                                                                                                                           |
| Revision context            | Drafted 2026-10-21, UTC. The date is the authoring context. It is not an approval date.                                                                                                                                                                                                                                                       |
| Request source              | The repository owner, Seungup, approved the drafting of this proposal in a Claude Code session of 2026-10-21, as the first of the front-end concepts the session listed on 2026-10-20 after change 0077. No GitHub issue is recorded for this draft.                                                                                          |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                           |
| Current lifecycle state     | `implemented`. Accepted by the owner's approval of 2026-10-21, recorded by the merge of PR #713. Implemented by PRs #714, #721 and #722 (see Configuration and validation record). Downstream work is pending.                                                                                                                                |
| Applicability / effectivity | The kernel-loop proof (`src/core/passes/parallel-loop.ts`), the kernel lowering (`src/core/passes/kernel-lower.ts`), the call (`src/core/host-kernel.ts`), the host face (`src/compiler/ts/host-face.ts`), the front end's array methods, the language service, the `fuse` planner, the WebGPU and CPU tiers. No release version is assigned. |
| Review baseline             | `origin/main` at `9669a458` (commit "Merge pull request #712 …"), read on 2026-10-21. TypeCV was read at `580a64cb`.                                                                                                                                                                                                                          |
| Proposal review             | [PR #713](https://github.com/typeshade/typeshade/pull/713), the proposal-only pull request.                                                                                                                                                                                                                                                   |
| Revision authority          | Git records the revisions of this file. The review and merge of the proposal-only pull request record the decision.                                                                                                                                                                                                                           |

## What changes

A kernel function's loop (Rule 8.22) writes an array at an index made from its counter. It cannot
write a result whose count it does not know beforehand: the keypoints a detector finds, the pairs a
matcher keeps, the cells a filter passes. This proposal lets the loop append to an array parameter
with ECMAScript's `push`, and read the count from `.length` after the loop.

```ts
"use typeshade";

export function strong(xs: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(i);
    }
  }
  return out.length;
}
```

```ts
const out = new Uint32Array(1024); // the capacity
const n = await strong(xs, 0.5, out); // out[0 .. n) hold the indices, in ascending order
```

### 1. The spelling

`out.push(v)` is the method of `Array.prototype` that appends one element (Rule 2.1, source (b)).
It is accepted on an array parameter with no size of a kernel function, inside a candidate loop,
as a statement. One iteration may push zero, one or several times. `v` has the array's element
type.

Every other place keeps today's refusal (surface §63): a `push` outside a kernel function, outside a
loop, or on an array that is not a parameter.

### 2. The meaning: the order of the iterations

The elements are appended in the order a sequential run of the loop appends them: iteration by
iteration in the order of the counter, and within an iteration in the order of its statements.
That is what the TypeScript program means, and every tier gives it, so the result is one answer
(the CPU oracle's) on every tier. No tier appends in the order its invocations happen to finish.

### 3. The array and its length

Inside the function, an array the loop pushes onto starts empty: its `.length` is 0 before the
loop. After the loop, `out.length` is the count the loop appended. The host array is the
capacity. The call writes elements `0` to `min(count, capacity) - 1`, and leaves the elements
after them as they were. A `Resident` is taken as a typed array is.

### 4. The proof

Rule 8.22 gains a write form and a read rule:

- R3: a `push` onto an array parameter is a write the proof accepts, in any branch, any number of
  times per iteration.
- R4: the loop reads neither the elements nor the `.length` of an array it pushes onto, and it does
  not use the value `push` returns. Each of these depends on the iterations before it. A loop that
  does is refused with `TS8070`, which names the read and gives the remedy, and runs on the CPU.
- An array a loop pushes onto is written by no other form in the same function.

### 5. The tiers

- **The CPU tier** runs the loop as written. It is the oracle.
- **WebGPU** runs the loop in three steps, each a dispatch the call plans:
  1. Count: each invocation runs the iteration and counts its pushes into `counts[i]`. It stores
     nothing else.
  2. Offsets: an exclusive scan of `counts` into `offsets`, in workgroups with barriers, which the
     lowering writes as compiler-made entries.
  3. Store: each invocation runs the iteration again, storing its `j`th push at `offsets[i] + j`
     while it is inside the capacity, and the loop's other writes.
     The count is `offsets[n - 1] + counts[n - 1]`, read back as a reduction's result is.
- **WebGL2** does not run a loop that pushes in this change. The call says why and falls to the
  next tier.

### 6. Fusion

A `fuse` scope (Rule 11.13) puts a loop that pushes into a group of its own. Its three steps are
one item of the plan.

### Not in this change

- An unordered append (`atomicAdd` and a store), which is faster and gives an order that depends on
  scheduling. Rule 1.3 of a consumer (TypeCV `docs/design-rules.md`) asks that such an operation
  say so; it is a separate proposal with its own spelling and determinism report row.
- `filter`, `sort` and the other array methods.
- A push onto a texture or a module binding.

## Why

**The pattern is common, and each library writes it by hand.** Stream compaction is the step
between almost every detector and its consumer. TypeCV has written it itself: at `580a64cb`,
`src/gpu/scan.shade.ts` (72 lines) and nine host modules of `src/gpu/` compact or scan, and
`src/gpu/hough.shade.ts` appends with `atomicAdd`. `typeshade/algorithms` offers `exclusiveScan`
and `compact` (surface §72), which take four arrays and two calls, and whose scan reads about
`2 n sqrt(n)` elements, since a kernel function has no barrier.

**The meaning is TypeScript's.** A sequential `push` has one order. A GPU append by atomics has
another on every run. Keeping the sequential order costs a second pass over the iterations and a
scan, and buys one answer on every tier, which TypeShade's oracle and TypeCV's Rule 1.1 rest on.

### Alternatives

- **Atomic append.** One pass, no scan, and an order that changes from run to run. Refused as the
  default for the reason above; open as a separate, labeled operation.
- **Store the values in pass 1.** Pass 1 keeps each iteration's pushes in a scratch array of
  `n * k` elements and pass 3 copies them. It saves the second run of the iteration, and needs a
  bound `k` on the pushes of one iteration, which the proof cannot always give. Open decision 2.
- **`filter` instead of `push`.** `xs.filter(p)` covers one push per element of an input array, and
  not several pushes, a value made in the loop, or a loop over a grid.

### Assumptions

- The scan of step 2 is a compiler-made compute entry with workgroup memory and barriers, which
  WGSL and Tint accept. The compile gate measures it in the implementation (Rule 13.3).
- An iteration's computation gives the same values in pass 1 and pass 3. The proof's R5 (no write of
  a module variable or a binding) and R6 (no barrier) already give this.

### Decisions at acceptance

The owner accepted each item below as drafted (Approval and plan record).

1. **The count past the capacity.** The draft makes `out.length` the count appended, which may
   exceed the capacity, so the host sees the shortfall and can call again with more room. The
   alternative is the count stored, which hides the shortfall.
2. **Pass 1.** Run the iteration twice (the draft), or keep its pushes in scratch when the proof
   bounds them.
3. **The count on the host.** The draft gives it only through the function's own `return
out.length`. The alternative also gives it on the host array, which a typed array cannot carry.

## What it touches

- **Rule 8.22.** R3 gains the `push` write form; R4 gains the reads of a pushed array and the value
  `push` returns.
- **Rule 8.23.** A pushed parameter starts empty in the function, its `.length` after the loop is
  the count, and the host array is the capacity.
- **Rule 11.8.** The WebGPU tier runs the three steps; WebGL2 says why it does not run the loop.
- **Rule 11.13.** A loop that pushes is a group of its own.
- **Surface §63.** `push` leaves the refused list for a kernel function's loop.
- **Surface §65.** The kernel-function section gains `push`, its order and the host contract.
- **Surface §71.** The planner's reasons gain the group of a loop that pushes.
- **Example `kernel-push`.** The `strong` function above, held to the CPU oracle on every tier the
  call reaches.

### Draft impact estimate

Known work, by area:

- **Front end and language service.** Accept `push` on a kernel function's array parameter inside
  a candidate loop, typed against the element (Rule 12.7); keep today's refusal elsewhere. The
  ambient library already declares `push`.
- **Proof.** R3 and R4 in `src/core/passes/parallel-loop.ts`, with their `TS8070` wording in
  `src/compiler/ts/kernel-loops.ts`.
- **Lowering.** The three entries in `src/core/passes/kernel-lower.ts`: the counting iteration, the
  workgroup scan, and the storing iteration.
- **Call.** The capacity, the read of the count and its place in the tail, in
  `src/core/host-kernel.ts`.
- **CPU tier.** `push` and `.length` on a pushed parameter in the generated code.
- **Planner.** A loop that pushes is a group of its own (`src/core/fuse-group.ts`).
- **Gates.** The differential generator gains loops that push, held to the oracle bit for bit.

Compatibility: no program that compiles today changes its meaning. `push` is refused today
everywhere.

Dependencies: none. Change 0077 is not required.

Duration and cost: unknown. No estimate is established.

### Approval and plan record

The owner, Seungup, approved the proposal in the project conversation on 2026-10-21 (Asia/Seoul),
as drafted: decisions 1 to 3 take the draft's text. Decision 1: `out.length` after the loop is the
count the loop appended, which may exceed the capacity. Decision 2: pass 1 runs the iteration and
stores nothing but the count. Decision 3: the host reads the count through the function's own
`return out.length`. The merge of PR #713 with `status: accepted` records the decision.
Responsibilities: an agent of this repository implements the proposal in commits that say
`Change: 0078`. The site and the editor do their work when their pins move. No milestone date is
assigned.

### Configuration and validation record

Delivered on 2026-10-21 in three pull requests, each with commits that say `Change: 0078`:

- **Part 1, [PR #714](https://github.com/typeshade/typeshade/pull/714), merged as `1c03fea8`.**
  `out.push(v)` in the front end and the language service, the proof's R3 append form and its R4
  refusals with `TS8070`, and the CPU tier's `push` and `pushCount`.
- **Part 2, [PR #721](https://github.com/typeshade/typeshade/pull/721), merged as `63a64a90`.**
  `pushEntries` in `src/core/passes/kernel-lower.ts`: count, scan (one workgroup of 256) and
  store; the call's three dispatches in one batch and the total read back; WebGL2's reason; a fuse
  plan's group of its own; the example `kernel-push`; the import journey's `pushAbove` and
  `pushPairs`.
- **Validation, [PR #722](https://github.com/typeshade/typeshade/pull/722).** Generated kernels
  that push in the differential gate, and a fuse scope with a loop that pushes between two array
  loops. The gate found one defect of part 2, closed in that pull request (deviation 3).

Functional validation, observed:

- Both halves on one source (Rule 12.7): `src/compiler/ts/kernel-loops.test.ts`, the accepted
  form and each refusal, `compile()` and the language service.
- The CPU tier: `src/compiler/ts/host-kernel-push.test.ts`, the order of the iterations, an empty
  result, a count past the capacity, two pushes in one iteration, a second call that starts
  empty, and a second loop that appends after the first.
- WebGPU: `bun run gate:journeys` on 2026-10-21 at `c142d67a`, headless Chromium with
  SwiftShader: `pushAbove` inside the capacity and past it, nothing pushed, `pushPairs` with two
  pushes an iteration, and the counts, each equal to a sequential run (worst 0), WebGPU required.
- Fuse (Rule 11.13): `scale`, `keep` (which pushes) and `mark` in one plan equal the calls apart,
  on the CPU tier (groups `[scale] [keep] [mark]`) and on a WebGPU device in the journey
  (`pushFused`, `pushApart`, worst 0).
- `bun run gate:differential` on 2026-10-21 at `c142d67a`, the same browser: 48 generated kernel
  functions, 29 lowered, 7 of them pushing, 2 294 841 values bit for bit against the `f32`
  oracle, failures 0. The unit corpus of 30 seeds reaches a push, two pushes and a conditional
  push.
- The compile gate (Tint + WebGL2): green on #721, `kernel-push` among the examples.

Deviations from the approved text, each with its disposition:

1. **Pass 3 stores the loop's other writes only when the iteration does not read them back.** The
   approved text says the store step makes "the loop's other writes". The counting step runs the
   iteration and stores nothing, so an iteration that reads back what it wrote, or that reduces,
   scatters or stores into a texture, would compute other values in it. Such a loop runs on the
   CPU tier, with its reason (`pushGap`). Closed: the CPU tier gives the one answer.
2. **One pushed array per loop on WebGPU.** A loop that pushes onto two arrays runs on the CPU
   tier. Closed, for the same reason.
3. **Two loops that push onto one array run on the CPU tier.** The second appends after the
   first, and each loop's GPU offsets start at 0. `gate:differential` found it on seed 24 (5 for
   5647 at n = 5000), and #722 runs such a function on the CPU tier and says why. Closed.

## What it owes downstream

- **typeshade.github.io.** The kernel-function and array-methods pages, in English and Korean, gain
  `push` in a loop, its order and the capacity. The `fuse` page gains the group rule.
  `compiler-changes.md` records 0078 when the pin moves.
- **vscode-typeshade.** The skill's references gain `push` and its host contract.
  `compiler-changes.md` records 0078 when the pin moves.
- **typecv.** No page describes the old behavior. The hand-written compactions can move to `push`
  when the pin moves, each held to its current output. `compiler-changes.md` records 0078 when the
  pin moves.
