---
id: '0094'
title: A kernel function reads its loop bound from an array, pushes after a length that a `Resident` holds, and stores its results into arrays after its loops, so its counts stay on the device
status: accepted
rules:
  - '8.21'
  - '8.22'
  - '8.23'
  - '11.8'
  - '11.13'
surface:
  - 65
  - 71
exports: []
exports-removed: []
codes: []
examples:
  - kernel-device-counts
downstream:
  - repo: typeshade.github.io
    what: Describe the trip count read from an array, the held length of a pushed array and the stores after the loops on the kernel-function page, the new group reasons on the fuse page, show the kernel-device-counts example, in both locales, and record 0094 when the pin moves.
  - repo: vscode-typeshade
    what: Describe the three forms in the skill's kernel-function reference, accept the held-length shape where the skill or a fixture names the host view of a pushed array, update any fixture that quotes the TS8070 text for a store outside the loops, and record 0094 when the pin moves.
  - repo: typecv
    what: Decide in phase 10 steps C3 and C8 of docs/library-structure.md which hand-written compactions, counters and indirect entries become kernel functions, keep src/gpu/scan.shade.ts until section 7 item 14 is decided, and record 0094 when the pin moves.
---

<!-- doc-refs: skip-file — this draft names entries, fields, tests and an example that a later implementation adds, and files of the TypeCV repository, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0094`, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Date and attribution          | Written on 2026-10-26, UTC. The date records authorship, not an approval. A Claude Code sub-agent (Claude Opus 5.5) drafted it at the request of the coordinating Claude Code session of TypeCV's refactoring programme. TypeCV's owner decided on 2026-10-26 to open TypeCV's requests C3 and C8 as one TypeShade proposal (TypeCV `docs/library-structure.md`, section 7, item 7). Sources: that document, `docs/audits/2026-10-26-kernel-style.md` and `tests/typeshade/compiler-probes.test.mjs` at TypeCV `0f28d8d`, this tree, and the probes in "Why". Accepted on 2026-10-26, UTC, by the owner's go-ahead in the session (Approval and plan record). Neither date is a delivery date.                   |
| Applicability / Effectivity   | A kernel function's body shape, lowering and call: `src/core/passes/parallel-loop.ts` (the shape), `src/core/passes/kernel-lower.ts` (the range entry, the finish entry, the base of a push), `src/core/host-kernel.ts` (the indirect dispatches, the held length, the tiers), `src/compiler/ts/kernel-loops.ts` (the text of the shape refusal), `src/compiler/ts/host-face.ts` (the face and the host view), `src/core/cpu-runtime.ts` and `src/compiler/ts/lower/kernel-push.ts` (the CPU tier's `push`), `src/core/fuse-group.ts` and `src/core/fuse-plan.ts` (the groups and the reads of a plan). Entry calls (Rule 8.24) and the program runtime do not change. No release version is assigned.           |
| Review baseline               | `main` at `8150508b6ebc42fc5447924bb518766e03d52732`. The probes in "Why" ran on `fc234dbc6568bacc33349d5492a27a418c0950c9`; `8150508` adds only `changes/0093-optional-positions.md` to it. TypeCV evidence: `main` at `0f28d8d42d81316bc1f6c2060e8e873bca9c9a94`, whose compiler pin is `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc` (`package.json` line 60). `src/core/passes/kernel-lower.ts` and `src/core/passes/parallel-loop.ts` are byte-identical at the pin and at `8150508`. `main` moved to `6c6a1d14403397e054f62562f400b2fac72540c9` during the review: #769 implemented change 0088, which adds a sentence on optional values to Rule 8.21 and changes none of the sentences this proposal cites. |
| Review and revision authority | [PR #771](https://github.com/typeshade/typeshade/pull/771), opened on 2026-10-26, UTC, is the review record. The owner's go-ahead in the session accepted revision `709f0ec` (Approval and plan record). Git records the revisions. The merge of PR #771 with `status: accepted` records the decision; this file does not claim that merge.                                                                                                                                                                                                                                                                                                                                                                      |

## What changes

**Proposal.** A kernel function (Rule 8.22) keeps the counts and the results it computes on the
device, in three ways that share one lowering:

1. **A trip count the device holds.** A loop's start and bound, and the scalar statements before
   the loop, may read elements of the function's arrays. The call then computes the loop's range
   on the device, in an entry that the compiler makes, and dispatches the loop indirectly from the
   counts that entry writes (the primitive of change 0075).
2. **A push after a held length.** A host may pass an array that a loop pushes onto together with
   its length, which a `Resident<Uint32Array>` holds: `{ array, length, offset? }`. The pushes
   append after that length, as ECMAScript's `push` appends after an array's `length`. The call
   leaves the new length in the word.
3. **Stores after the loops.** After its last loop, a kernel function may store scalars into
   elements of its arrays: `sums[0] = s`, `count[0] = list.length`. On WebGPU the stores run in an
   entry that the compiler makes, after the loops, so a value stored into a `Resident` stays on the
   device.

A chain of such calls over `Resident` arrays then needs no read between its calls. The source needs
no new name. Each part is an ECMAScript form that a kernel function refuses, or runs on the CPU
tier, today.

### Before and after

| Today, at `8150508`                                                                                                                                                                                                      | With this proposal                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| A loop whose range reads an element, `const n = counts[0]; for (… i < n …)`, runs the whole function on the CPU tier: "the statements before loop 1 read an array's elements, which the call runs before it dispatches". | The range runs on the device. The loop runs on WebGPU, dispatched indirectly.                                                    |
| A loop that pushes starts at element 0 (Rule 8.23). The host learns the count through the function's `return out.length`, which the call reads back.                                                                     | With `{ array, length }` the pushes start at the held length. The new length stays in the word, and nothing is read back for it. |
| Two loops of one function that push onto one array run on the CPU tier (change 0078, deviation 3).                                                                                                                       | The second loop appends after the first on WebGPU, from the count that the first left on the device.                             |
| A store after the loops, `sums[0] = s`, runs the function on the CPU tier with `TS8070`: "line 7 writes "sums" outside its loops".                                                                                       | The store runs on the device, after the loops.                                                                                   |
| A function that reads `out.length` of a pushed array before its `return` runs on the CPU tier.                                                                                                                           | A later loop's range and a store after the loops may read it, on the device.                                                     |
| A reduction's result reaches the host only: "`sum = total(u)` in the body, and `await sum` after it" (surface §71).                                                                                                      | A store after the loop puts it into an array, which stays on the device when it is a `Resident`. The `return` keeps its meaning. |

### 1. A trip count the device holds

**Fact.** `lowerKernel` turns the statements before each loop, and the loop's start and bound, into
a range function. The call runs it on the CPU tier before it dispatches, over the array lengths
only: "Its arrays are read only by their `.length`, so the call hands it the lengths alone"
(`src/core/passes/kernel-lower.ts`, file comment). `checkCall` in `src/core/host-kernel.ts`
computes every range before anything runs, because "the loops write no scalar the ranges read
(Rule 8.22), so every range is known up front".

**Proposal.**

- **What a range may read.** The statements before a loop, its start and its bound may read the
  elements and the `.length` of the function's array parameters, its scalar parameters, and what an
  earlier loop of the same call wrote, `out.length` of a pushed array included. They may not read a
  texture, as today.
- **The range entry.** For a loop whose range reads an element, the lowering writes a compute entry
  of one invocation. It runs those statements over the bound arrays, computes the trip count as
  `tripsOf` does in `src/core/host-kernel.ts`, and writes three things into a storage buffer that
  the call makes for the call: the loop's `_start` and `_n`, and the workgroup count `[x, y, 1]` of
  each dispatch that the loop makes. A count past 65,535 workgroups spills into `y`, as `grid` does
  today. The loop's entries read `_start` and `_n` from that buffer instead of the uniform.
- **The dispatches.** The call dispatches each of the loop's entries with
  `dispatchWorkgroupsIndirect` from those counts: the loop's entry, each fold level of a loop that
  reduces, and the count and store steps of a loop that pushes. The range entry and the dispatches
  are in one submission. Nothing is read back. A trip count of 0 dispatches no workgroup, as
  change 0075 states for an entry.
- **The order.** The range entry of loop `j` runs after the dispatches of the loops before it. So a
  range can read what those loops wrote.
- **Writes past an array's end.** The host cannot check such a loop's writes before it runs, since
  it does not know the trip count. On every tier a write that such a loop makes past the end of its
  array is dropped. The WebGPU entry guards the write with `arrayLength`, as the store step of a
  push guards its stores today. The CPU tier drops it, as a typed array drops a store past its end.
  A loop whose range the host computes keeps today's check and its `TypeError`. Decision D2.
- **A cap for a loop that pushes or reduces.** The call makes the scratch buffers of such a loop on
  the host: the `n + 1` counts of a push, and the partials of a reduction. So it needs an upper bound
  of the trip count. The bound of such a loop is written `min(d, c)`, with `c` a value that the host
  knows: a scalar parameter or an array's `.length`, read through the constants that the bound
  names. The call sizes the scratch for `c`. A loop that pushes or reduces over a device range with
  no cap runs the function on the CPU tier, and the host view's comment says why. Decision D6.

### 2. A push after a held length

**Fact.** Rule 8.23: "An array parameter a loop pushes onto … starts empty in the function … The
host array is the capacity … and the host reads the count through the function's own `return
out.length`". On WebGPU the call makes a zeroed buffer of `n + 1` counts for the loop, dispatches
the count, scan and store steps, and reads the total back from slot `n` (`onDevice` in
`src/core/host-kernel.ts`). Change 0078's deviation 3: "each loop's GPU offsets start at 0".

**Proposal.**

- **The host value.** For an array parameter that a loop pushes onto, the call also takes
  `{ array, length, offset? }`. `array` is what the parameter takes today: the typed array or the
  `Resident`, whose length is the capacity. `length` is a `Resident<Uint32Array>`, and `offset` is
  an element of it, 0 by default. That element is the array's length when the call runs. The host
  view types the parameter as today's type or that object.
- **The meaning.** In the function, the array's `.length` starts at the held length, and each
  `push` appends after it. That is ECMAScript's `push` on an array of that length (Rule 2.1, source
  (b)). After the call the word holds the new length: the held length plus the count appended. The
  call stores the pushed elements at the indices from the held length up to the capacity, and
  leaves every other element as it was. A count past the capacity is still counted, as change
  0078's decision 1 states.
- **WebGPU.** The scan step adds the held length to every offset and writes the new length into the
  word. It already writes the total into slot `n` today. The store step stores at the offset it
  reads. When `length` is a `Resident` on the device, nothing is read back. When the function also
  returns `out.length`, the call reads that value back, as today.
- **Two loops that push onto one array.** The second loop starts at the count that the first loop
  left, on the device. So such a function runs on WebGPU, and change 0078's deviation 3 closes.
  This holds with and without a held length.
- **The refusals.** The call refuses each of these with a `TypeError` that names the function and
  the parameter, before anything runs, in the words of change 0075 where the case is the same:
  `length` that is not a `Resident` whose host value is a `Uint32Array`; an `offset` that is not a
  whole number from 0, or that is past the array; a `length` that is also another argument of the
  same call; a `Resident` of another owner (Rule 11.8); a scratch array of a `fuse` scope as
  `length`; a destroyed `Resident`; and the object on a parameter that no loop pushes onto
  (decision D5). An object with another key is refused as a wrong value is refused today.

### 3. Stores after the loops

**Fact.** Rule 8.22: "Its body is scalar statements, then its loops, then an optional `return` of
scalars; a statement outside its loops that writes an array … runs the whole function on the CPU".
The probe below gives `TS8070` for `sums[0] = s` after a loop that reduces.

**Proposal.**

- **The form.** After its last loop, and before its `return`, a kernel function may store a scalar
  into an element of an array parameter: `a[k] = e`. `k` and `e` may read the function's scalars,
  what its loops reduced, `out.length` of a pushed array, and elements of its arrays. The stores run
  in program order. A function with no loop may consist of scalar statements and such stores
  (decision D7).
- **WebGPU.** The stores run in a finish entry of one invocation, which the compiler makes. It runs
  after the loops' dispatches, in the same submission. It binds the arrays that the stores read and
  write. A store into a `Resident` stays on the device.
- **A reduction.** The variable is folded in the tree order of Rule 7.2, as today. The finish entry
  combines the folded value with the variable's starting value, which the CPU tier's tail does
  today. **Inference.** For integers, and for `f32` `+`, `*`, `min` and `max`, the combine has one
  answer on both, so a stored value has the bits of a returned value. For `f64` the device combines
  in the emulated double (surface §39) and the CPU tier in binary64, so the two can differ within
  the emulation's error, the room surface §65 already gives an `f64` result.
- **The `return`.** It keeps its meaning: the host result, computed on the CPU tier from what the GPU
  folded, as today. A function that stores its result and returns nothing reads nothing back.

### 4. Each tier

- **WebGPU.** The one lowering of the three parts: a range entry before a loop whose range reads an
  element, indirect dispatches from the counts it writes, a base word for each pushed array, and a
  finish entry after the loops. All of it is ordinary IR, emitted by the WGSL writer and compiled by
  Tint like any other entry. The call buffer of the ranges has the usages `STORAGE` and `INDIRECT`;
  change 0075 quotes WebGPU's usage-scope rule, under which one dispatch may read a buffer both
  as its indirect counts and as a read-only storage binding, and its call layer accepts such a
  call.
- **WebGL2.** WebGL2 has no compute stage and no indirect dispatch. Its tier holds a `Resident` as
  its host array already (surface §67). So it reads what a range reads from the host copies when the
  call runs, brought up to date first, as change 0075's item 5 reads an entry's indirect count. A
  read of a newer device copy is a submission, as for any `Resident` that a call on the host reads.
  It then computes the range on the CPU tier over those host copies, the range function reading
  the elements it names, and draws that many texels. A store after the loops runs on the CPU tier
  over the host copies, after the draws. A loop that pushes or
  reduces does not run on WebGL2, as today.
- **The CPU tier.** It runs the function as written (Rule 11.7), over the host copies: the range
  reads the element, `push` starts at the held length, and the store writes the array. It is the
  oracle that the other tiers are held to.

### 5. `fuse` and the determinism report

- **`fuse` (Rule 11.13, surface §71).** A call with any of the three parts forms a group of its own,
  as an entry call does (fact F8). F1 gains three reasons: `b reads its trip count from an array`,
  `b pushes after a held length` and `b stores into an array after its loops`. The plan reads the
  arrays that a range entry reads as reads of the call, and the held length as a read and a write.
  So the call runs after the last call before it that wrote them, and a later call that reads them
  runs after it. `dispatches` counts the range entry, the finish entry and each indirect dispatch
  once, whatever the counts hold, as change 0075 counts an indirect entry call. Decisions D3 and D4.
- **The determinism report (surface §38).** It gains no kind and no row. The fold of a reduction is
  the tree of Rule 7.2, which its `order` row names already. The operations of the stores after the
  loops are the function's own operations, which the report already lists under the function. The
  implementation checks that a function with a store after its loops has the rows of the same
  function with a `return`.

### Example (illustrative)

The example `kernel-device-counts` would hold these three functions. The names are illustrative.

```ts
"use typeshade";

// Appends the index of each value above t after the list's length.
export function keepAbove(xs: array<f32>, t: f32, list: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      list.push(i);
    }
  }
}

// One iteration for each entry of the list: the trip count is the device's word.
export function gather(count: array<u32>, list: array<u32>, xs: array<f32>, out: array<f32>): void {
  const n: u32 = count[0];
  for (let j: u32 = 0; j < n; j++) {
    out[j] = xs[list[j]];
  }
}

// Sums the gathered values and stores the sum, on the device.
export function sumInto(count: array<u32>, out: array<f32>, sums: array<f32>): void {
  let s = 0.;
  const n: u32 = min(count[0], out.length);
  for (let j: u32 = 0; j < n; j++) {
    s += out[j];
  }
  sums[0] = s;
}
```

```ts
import { createDevice } from 'typeshade/runtime';
import { gather, keepAbove, sumInto } from './device-counts.shade.ts';

const dev = await createDevice({ prefer: ['webgpu', 'cpu'] });
const xs = dev.array(values); // a Float32Array
const list = dev.array(capacity, 'u32');
const count = dev.array(new Uint32Array([0])); // the list's length
const out = dev.array(capacity, 'f32');
const sums = dev.array(1, 'f32');
await dev.fuse(() => {
  keepAbove(xs, 0.5, { array: list, length: count }); // appends after count[0], writes the new length
  gather(count, list, xs, out); // n = count[0], read on the device
  sumInto(count, out, sums); // sums[0] = s, on the device
});
const [sum] = await sums.read(); // the one read of the chain
```

The plan has three groups and one submission, and reads nothing back until `sums.read()`. The
CPU tier runs the same three calls, in order, and gives the same `list`, `count`, `out` and `sums`.

### Exclusions

- No new argument on a kernel call. A kernel function's trip count stays its loop's, as the source
  writes it. The kernel-call form of TypeCV's C8 is part 1, with a `Resident` as the argument
  ("Alternatives considered", item 4).
- No change to an entry call (Rule 8.24) or to change 0075's `{ indirect, offset? }`.
- No change to a function whose ranges read no element, that passes no held length and that stores
  nothing after its loops: its WGSL, its face and its call stay as they are.
- A loop over a device range that stores into a texture, or that adds to a `Map` or a `Set`, runs
  the function on the CPU tier. The call checks a texture's rows, and sizes a collection's records,
  from the trip count on the host (changes 0077 and 0080).
- No unordered append. Change 0078 leaves it to a separate proposal.
- No automatic chunking (TypeCV's C4) and no change to change 0074's chunks.

## Why

### TypeCV's evidence

**Fact** (TypeCV `docs/library-structure.md` at `0f28d8d`, section 6, row C3). The limit: "a kernel
function's trip count is computed on the host, and a reduction result or a `push` count reaches
only the host". The effect: "`scan.shade.ts`, its copy, and about 25 flag, scatter, advance and mark
entries keep counts on the device by hand". The request: "a `push` that appends after a count held
in a `Resident` and leaves the new count there; a reduction into a `Resident`; a loop bound read
from a `Resident`, lowered to an indirect dispatch". Its estimate is 300 to 400 lines
(**Inference**, the audit's).

**Fact** (the same section, row C8). The limit: "a kernel call takes no workgroup argument and no
indirect count". The effect: "12 entries dispatch indirectly and cannot become kernel functions".
The request: "a kernel call whose trip count is read from a `Resident` (shares C3's lowering)".

**Fact** (the same document, section 3.6). The first of four needs that force an entry today is
"device-side control without a host round trip: the 56 single-invocation steps, counters read by
later dispatches, and 12 indirect dispatches". The section adds: "`scan.shade.ts`, its copy in
`pair-preparation.shade.ts` and about 25 flag, scatter and count entries re-implement `push`
(change 0078). `engine-v2.md` keeps the shared scan as the device layer (item 14)."

**Fact** (the same document, section 5, phase 10). "C3: the hand-written compactions of SIFT, ORB,
KLT, matching and MVS become `push` where the compiler holds the count on the device, and so does
the pair-preparation copy of the scan after R03; `scan.shade.ts` stays the device layer's scan
until an amendment of `engine-v2.md` retires it (item 14)." Its gate: "row order and counts
bit-identical; no new readback". Section 7, item 14 is open. TypeCV `docs/engine-v2.md` keeps "the
shared scan and partial reductions" as "the device layer".

**Fact** (TypeCV `docs/audits/2026-10-26-kernel-style.md` at `0f28d8d`). Section 1: "A kernel
function computes its trip count on the host and returns its reductions and its push count to the
host." Section 2 names the 12 indirect entries: `preparePairModels`, `appendPairModelRows`,
`appendPairModelRowsInPlace`, `solvePairModelNull`, `finishPairModels`, `scorePairModels`,
`scorePairModelsOracle`, `samplePnP`, `solveP3p`, `scorePnP`, `scorePnPOracle` and `selectPnP`.
Section 4: "Compaction runs on the device, but the host plans it: `planFlagScan` … and
`scanBlockCount` sizing", in eight host modules. Section 6 ranks this gap second (G-C) and the
indirect count of a kernel call eighth (G-D).

**Fact** (TypeCV `tests/typeshade/compiler-probes.test.mjs` and `compiler-probes.sources.mjs` at
`0f28d8d`, #243, holding the verdicts of the pin). P6, a trip count read from `counts[0]` before the
loop: the CPU tier, with no diagnostic. P7, the guard `if (i >= counts[0]) continue` over the
capacity: a GPU loop on WebGPU and WebGL2. P9, `out.push(i)` with `return out.length`: a GPU loop
whose push runs as count, scan and store. P1 holds that the call "takes no workgroup count and no
indirect count". P6's signal reads: "C3 closed for loop bounds … and C8 (which shares the lowering)
may follow".

**Fact** (TypeCV `docs/design-rules.md` at `0f28d8d`, Rule 3.3). What TypeShade cannot do yet
becomes a proposal in TypeShade's `changes/`, not a workaround inside TypeCV.

### What the compiler does today, and why

**Fact** (probes on `fc234db`, Bun 1.4.4, `compile()` and `hostFace()` on the same source):

| Source                                                      | Verdict                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `const n: u32 = counts[0];` then a loop to `n` (P6)         | the CPU tier, no diagnostic; reason "the statements before loop 1 read an array's elements, which the call runs before it dispatches"                                                                                                          |
| a loop to `counts[0]`                                       | the same reason                                                                                                                                                                                                                                |
| `if (i >= counts[0]) continue;` over `out.length` (P7)      | a GPU loop on WebGPU and WebGL2; the call checks `out` at `a = 1`, `c = 0`                                                                                                                                                                     |
| `out.push(i)`, `return out.length` (P9)                     | a GPU loop in three steps; no WebGL2 tier                                                                                                                                                                                                      |
| `out.push(i)` in the loop, then `count[0] = out.length`     | `TS8070`: "This function runs on the CPU because line 6 writes "count" outside its loops. A kernel function's body is scalar statements, then its loops, then a return: move that line into a loop, or into the code that calls the function." |
| `s += xs[i]` in the loop, then `sums[0] = s`                | `TS8070`, the same text for line 7 and "sums"                                                                                                                                                                                                  |
| a push loop, then `const m = idx.length;` and a loop to `m` | the CPU tier; reason "it reads the length of an array it pushes onto before its result, which the call knows once the loop has run"                                                                                                            |

- **Fact.** The guard form of P7 runs every lane up to the capacity and skips past the device count.
  It costs a dispatch over the capacity, and it gives no reduction or push over the live range only.
- **Fact** (`onDevice` and `reduceOnGpu` in `src/core/host-kernel.ts`). The call sizes the scratch of
  a loop that pushes (`(n + 1) * 4` bytes) and of a loop that reduces (the partials of every level)
  from the trip count on the host, and reads the push total and the folded value back in the
  submission that holds the dispatches.
- **Fact** (change 0075, item 8). "A kernel function's call takes no indirect count in this proposal.
  Its dispatch size is its loop's trip count, which the array lengths fix at the call. The planner
  compares those trip counts when the plan is settled (F2). A count from the GPU would remove that
  fact, and no consumer has asked for it." TypeCV now asks.
- **Inference.** No rule needs the range on the host. The range function is IR, which a compute
  entry can run, and change 0075 already gives the call layer `dispatchWorkgroupsIndirect`. Only the
  scratch sizes need a host number, which the cap of part 1 gives.

### Relation to accepted proposals

- **Change 0075** (implemented) gives an entry call an indirect count. This proposal reuses the
  primitive and its rules (the usage `INDIRECT`, a count of 0, a count past the limit, the CPU tier
  and WebGL2 reading the host copy). It adds the counts that a compiler-made entry writes, for a
  kernel function's loops, which item 8 of 0075 left out.
- **Change 0078** (implemented) gives `push` and its count. This proposal adds the start of a push at
  a held length and closes 0078's deviation 3. It keeps 0078's order, its capacity rule and its
  decision 1. 0078's decision 3, the count through `return out.length`, stays available.
- **Change 0079** (implemented) makes an array method the loop it stands for. A method whose value
  is stored, `found[0] = xs.findIndex(p)`, becomes a loop and a store after it, under part 3.
- **Change 0074** (implemented) chunks a long kernel under a time budget, which the host cuts. A
  chunk of calls whose trip counts the device holds may hold less work than the host's `units`, as
  0075's open item "A chunk of change 0074" states for an indirect entry. This proposal does not
  change 0074.
- **Change 0092** (accepted) runs a barrier entry on the CPU tier in passes. The range and finish
  entries have no barrier, and the CPU tier runs the kernel function as written, so neither change
  depends on the other. **Inference.** A TypeCV compaction that becomes a `push` needs neither its
  hand-written scan nor that scan's CPU twin.

### Alternatives considered

1. **Keep the host round trip.** The host reads each count (`await r.read()` or the function's
   result) and passes it to the next call as a scalar. No compiler work. Each read is a map of a
   staging buffer and a wait for the queue; change 0075 recorded the requester's estimate of about a
   millisecond on a desktop, not measured. Rejected as the answer to TypeCV, whose gate asks for
   "no new readback".
2. **An entry for each count, as today.** TypeCV keeps `scan.shade.ts`, its copy, the flag, scatter,
   advance and mark entries, the single-invocation finish steps and the 12 indirect entries. No
   compiler work. Rejected: each library with a compaction pays it again (change 0078, "Why").
3. **Change 0075 alone.** An entry writes the counts, and entries dispatch from them. That is what
   TypeCV does today. A kernel function cannot use the counts. Rejected as the whole answer; this
   proposal builds on it.
4. **A kernel call that takes `{ indirect }`, as an entry call does.** The host's count would set the
   dispatch, and the source's loop would say another count. The CPU tier would have to read a
   workgroup count as a trip count, and F2 would compare nothing. Rejected: part 1 says the same in
   the loop's own terms, and the CPU tier runs it as written.
5. **`out.length = base` in the source**, ECMAScript's way to set an array's length before a push. The
   ambient library declares `length` read-only on `array<T>` (`src/language-service/ambient.ts`), and
   the compiler would have to refuse it everywhere but before a push, in both halves (Rule 12.7).
   Rejected for part 2, whose held length is the host value's own length.
6. **A device error word for a write past an array's end** instead of dropping it. It needs one more
   binding and a read, and it differs from a sequential TypeScript run over typed arrays. Kept as an
   option of decision D2.

### Unresolved decisions

- **D1. The spelling of a held length.** `{ array, length, offset? }` (this draft); or a list handle
  from the device, `device.list(capacity, element)`, which reshapes the export `Device`; or
  `out.length = base` in the source (item 5 above).
- **D2. A write past an array's end in a loop over a device range.** Dropped on every tier (this
  draft); or a device error word that the host may read; or a trip count clamped to what every
  checked write allows.
- **D3. Fusion.** A call with a device range is a group of its own (this draft). A later change may
  fuse two calls whose ranges read the same word with the same arithmetic.
- **D4. The report's `indirect` field.** Not set for a kernel group (this draft). Setting it would
  widen the meaning of an existing field of the export `FuseReport`.
- **D5. A held length on a parameter that no loop pushes onto.** Refused (this draft); or its
  `.length` reads the held word, so a loop to `xs.length` runs over a device count.
- **D6. The cap of a loop that pushes or reduces.** `min(d, c)` in the bound (this draft); or a cap
  that the call derives from an array that the loop reads at `i`.
- **D7. A function with no loop.** Its stores run in the finish entry (this draft), so a
  single-invocation step becomes a kernel function; or such a function keeps the CPU tier.
- **D8. Speed.** The scan step of a push is one workgroup of 256 (change 0078). A device range does
  not change it. Its speed over large counts is unmeasured.

## What it touches

- **Rule 8.21.** Its sentence "before anything runs, the call checks each array against the indices
  a loop writes at `a*i + c` and refuses one too short" gains the exception of a loop over a device
  range, whose writes past an array's end are dropped on every tier (decision D2).
- **Rule 8.22.** The body shape: the statements before a loop, its start and its bound may read
  elements of the function's arrays and what an earlier loop wrote; stores of scalars into array
  elements may follow the last loop; a loop that pushes or reduces over a device range needs a cap.
  The "Enforced by" names the range entry, the finish entry and their tests.
- **Rule 8.23.** A pushed array's host value may be `{ array, length, offset? }`: its pushes start at
  the held length, and the call leaves the new length in the word. The sentence on two loops that
  push onto one array changes.
- **Rule 11.8.** Each tier and a device range: WebGPU dispatches indirectly from the counts of the
  range entry, WebGL2 and the CPU tier read the host copies when the call runs. A write past an
  array's end in such a loop is dropped on every tier. How each tier reads and writes a held length.
- **Rule 11.13.** F1 gains the three reasons of part 5, and the plan's reads gain the arrays a range
  entry reads and the held length.
- **Surface §65.** "The body", "Where it runs", "A reduction", "A push" and the table of host values
  gain the three parts, the cap, the refusals and the dropped writes. The `TS8070` text for a store
  outside the loops changes for a store after the loops.
- **Surface §71.** The reasons of F1 and the sentence on `await sum`: a result may also be stored
  into an array.
- **Example `kernel-device-counts` (new).** The three functions above, compiled through the compile
  gate, and called through a packed journey.
- **Code.** `src/core/passes/parallel-loop.ts` (the shape), `src/core/passes/kernel-lower.ts` (the
  range entry, the finish entry, the base word of a push, the guarded writes),
  `src/core/host-kernel.ts` (the call buffer, the indirect dispatches, the held length),
  `src/compiler/ts/host-face.ts` (the face of a device range, the host view of a pushed array),
  `src/core/cpu-runtime.ts` and `src/compiler/ts/lower/kernel-push.ts` (the CPU tier's push from a
  held length), `src/compiler/ts/kernel-loops.ts` (the shape text), `src/core/fuse-group.ts` and
  `src/core/fuse-plan.ts` (the reasons and the reads).
- **Tests.** Both halves on the same source (the shape now accepted, no `TS8070` in `compile()` or in
  the language service's `getDiagnostics`, and `getHover` on the host view of a pushed array), on the
  shape of `src/language-service/ambient-parity.test.ts`. The CPU tier against the oracle for each
  part (`src/compiler/ts/host-kernel.test.ts`, `src/compiler/ts/host-kernel-push.test.ts`). The
  generated differential (`scripts/gpu-differential.ts`) with device ranges, held lengths and stores
  after the loops, held to the `f32` oracle bit for bit. The plan (`src/fuse.test.ts`): the groups,
  the order of a writer and a reader of a count, and `dispatches`. A packed journey runs the chain of
  the example on WebGPU with no read between the calls, and holds it to the CPU tier.
- **Not touched.** No export (D1 and D4 as drafted), no diagnostic code, no IR node and no entry call.

**Fact** (`main` at `8150508`). Accepted proposals that are not implemented also declare these items:
Rule 8.21 (0082, 0088, 0093), Rule 8.22 (0056, 0067, 0077, 0080, 0085, 0091), Rule 8.23 (0068,
0077, 0080, 0082, 0085, 0091), Rule 11.8 (0051, 0054, 0065, 0067, 0077, 0080, 0085, 0092), Rule
11.13 (0051, 0066, 0067, 0068, 0077, 0080, 0085), §65 (0051, 0056, 0065, 0067, 0068, 0077, 0080,
0082, 0085, 0091) and §71 (0051, 0056, 0066, 0067, 0068, 0077, 0080, 0085). The implementation
that lands second rebases on the others' text.

### Draft impact estimate

**Known.** The change is additive. A function whose ranges read no element, that passes no held
length and that stores nothing after its loops compiles to the same WGSL and runs as today. A
function that ran on the CPU tier for one of the reasons above may now run on WebGPU; its results
stay those of the CPU tier, which is the oracle. The `TS8070` text for a store outside the loops
changes for the stores that become accepted, so a fixture that quotes it changes.

**Estimate.** The compiler work is two compiler-made entries of one invocation, a base word for the
push lowering, the indirect path of the call, and the face. Its basis is the code it extends:
`pushEntries` (about 240 lines) and `reduceOnGpu` (about 70 lines) in the files above, and the
indirect path that change 0075 added. The validation work is the larger part: the differential
generator and the journey. The bundle growth of `typeshade/runtime` is unmeasured. Duration and
cost are unestimated.

**TypeCV.** Up to 300 to 400 lines by the audit's estimate (**Inference**), after TypeCV decides
which entries convert (What it owes downstream).

**Decisions before acceptance:** D1, D2 and D6. D3, D4, D5, D7 and D8 may stay open.

### Approval and plan record

**Decision.** Accepted, by the owner's go-ahead in the session on 2026-10-26, UTC, at 13:33 UTC
as the coordinating session reported it, with each decision taken as the draft recommends. The
review evidence is [PR #771](https://github.com/typeshade/typeshade/pull/771). The approved
revision is commit `709f0ec8eeb7ce773c9e21065d9dfb9d0f221021`, committed at 13:05 UTC, the head of
PR #771 before this acceptance commit. Its file is blob
`de933e0654072846d8eaf998ab5a27f67e3decbd`. This acceptance commit changes no scope. It sets the
status and fills this record and the document control.

**Approved scope.** What changes, with its exclusions, the front-matter declarations and the
required validation below.

**Decisions taken.** The approved revision asked to settle D1, D2 and D6 before acceptance. The
go-ahead takes each at the draft's choice:

- D1: a held length is spelled `{ array, length, offset? }`, with `length` a
  `Resident<Uint32Array>` and `offset` an element of it, 0 by default.
- D2: a write past an array's end, in a loop whose range the device holds, is dropped on every
  tier.
- D6: a loop that pushes or reduces over a device range has a cap in its bound, `min(d, c)`, with
  `c` a value that the host knows.

**Open decisions.** D3, D4, D5, D7 and D8 stay open. The first implementing pull request decides
each one for the owner's review. Until then the approved text bounds the scope:

- D3, fusion: a call with a device range is a group of its own.
- D4, the report's `indirect` field: not set for a kernel group.
- D5, a held length on a parameter that no loop pushes onto: refused.
- D7, a function with no loop: its stores run in the finish entry.
- D8, the speed of a push's scan over large counts: unmeasured.

**Finalized impact declarations.** Rules 8.21, 8.22, 8.23, 11.8 and 11.13 (amended); surface §65
and §71 (amended); the example `kernel-device-counts` (new); no export; no diagnostic code;
downstream typeshade.github.io, vscode-typeshade and typecv, as the front matter states. **Fact**
(a re-scan of `main` at `6c6a1d14403397e054f62562f400b2fac72540c9` on 2026-10-26). These rules
and sections keep their numbers. Rule 8.21 gained a sentence on optional values (change 0088), and
its sentence on the call's check of `a*i + c`, which this proposal cites, stands. The example id is
free. So no number moved and no deviation is recorded. Accepted proposals that are not implemented
also declare some of the same items: Rule 8.21 (0082, 0093), Rule 8.22 (0056, 0067, 0077, 0080,
0085, 0091), Rule 8.23 (0068, 0077, 0080, 0082, 0085, 0091), Rule 11.8 (0051, 0054, 0065, 0067,
0077, 0080, 0085, 0092), Rule 11.13 (0051, 0066, 0067, 0068, 0077, 0080, 0085), §65 (0051, 0056,
0065, 0067, 0068, 0077, 0080, 0082, 0085, 0091) and §71 (0051, 0056, 0066, 0067, 0068, 0077, 0080,
0085). Proposal 0095, accepted by the same go-ahead, declares Rules 8.21 and 8.22 and §65 too. The
implementation that lands second rebases on the others' text.

**Required validation.** The functional and document checks of the Configuration and validation
record below. They are requirements, not results.

**Responsibilities and milestones.** The go-ahead assigned no implementer, milestone, duration or
cost. Implementation is unassigned. Each downstream repository does its work when its pin moves.
Acceptance of this plan is not evidence that the implementation works.

### Decisions of the first implementing pull request

**Record.** The approved text left D3, D4, D5, D7 and D8 to the first implementing pull request,
for the owner's review. That pull request is stage 1 of the implementation (stores after the loops,
branch `claude/0094-s1-stores-after-loops`). It takes each decision as this draft recommends. The
coordinating session took these recommendations from the stage A plan on 2026-10-27, UTC. The owner
reviews them on that pull request, and its merge records them. Until then they are proposed, not
approved.

- **D3, fusion.** A call with a device range, a held length or a store after its loops forms a
  group of its own (F1). Alternative not taken: fuse two calls whose ranges read the same word with
  the same arithmetic. It needs a range key in the face, F2 over keys and a fused entry that reads
  the call buffer. Reason: TypeCV's gate asks for no new readback, and a group of its own meets it.
  The alternative changes only speed, so a later proposal can take it.
- **D4, the report's `indirect` field.** It is not set for a kernel group. Alternative not taken:
  set it for a kernel group with a device range. That widens the meaning of a field of the export
  `FuseReport`, which this proposal does not declare. Reason: the group's `why` names the reason,
  and no export changes.
- **D5, a held length on a parameter that no loop pushes onto.** The call refuses it with a
  `TypeError` that names the function and the parameter, and the host view types the object on a
  pushed parameter only. Alternative not taken: its `.length` reads the held word. That changes
  `.length` in every entry, on the CPU tier and in Rule 8.23, and lets a read pass the capacity.
  Reason: part 1 already reads a count with `count[0]`.
- **D7, a function with no loop.** Its stores run in the finish entry, one dispatch of one
  invocation. Alternative not taken: the CPU tier, where each call first brings its `Resident`s to
  the host. Reason: TypeCV's steps of one invocation that move a count (`siftAdvance`, `siftMark`,
  `orbAdvance`, `orbMark`) need it, and so does a reset of a held length inside `fuse()`, where
  `write()` is refused.
- **D8, the speed of a push's scan.** The scan stays one workgroup of 256. The pull request of
  stage 4 measures it over large counts and records the configuration, the sizes and the times.
  Alternative not taken: a scan in several levels now. Reason: a faster scan is a performance
  change, which needs no proposal.

**Clarification of D2.** A store after the loops whose index is past the array's end is dropped on
every tier, as D2 drops a write past an array's end in a loop over a device range. The front end
guards each store after the loops by the array's length in the IR, and every tier runs that guard.
So on the CPU tier the array's `.length` after such a store is still its length. **Fact**
(observed on `f0d41b36`, 2026-10-27): in a loop to `counts[0]`, which runs on the CPU tier, a store
past the end of a 4-element array left the host array as it was, and `out.length` read after it
gave 6. The CPU tier's array is a JavaScript array, which a store past its end makes longer. Stage 3
gives the writes of a loop over a device range the same guard. This clarification changes no other
part of the approved text.

**Deviations of stage 1** from the approved text of part 3, each with its disposition:

1. A function that takes a `Map` or a `Set` and stores after its loops runs on the CPU tier, and
   the host view's comment says why. Its loops are lowered through the records of change 0080, and
   the stores would need those records applied first. Disposition: closed. The CPU tier gives the
   one answer.
2. A function whose statements after its loops reach an array that a loop scatters into runs on
   the CPU tier, and says why. The lowered module holds such an array as atomics, and a plain store
   or read cannot reach an atomic. Disposition: closed, for the same reason.
3. A function with no loop does not run on WebGL2. The WebGL2 tier draws loops, and with none it
   gives the reason `it has no loop to draw`, so the call goes to the CPU tier, which runs the
   stores over the same host copies. Disposition: closed. The arrays and the result are the same,
   and only the report's `tier` is `cpu` instead of `webgl2`.

### Decisions of stage 2

**Record.** Stage 2 of the implementation (branch `claude/0094-s2-push-after-held-length`) delivers
part 2: a push after a held length, and two loops that push onto one array, which closes deviation
3 of change 0078. It takes the decisions below for the owner's review, which its pull request
records. Until the merge they are proposed, not approved.

- **S2-1, a store after the loops that reads the length of a pushed array.** It runs on the
  device. Such an array has a length word, and the entry that stores reads the word; the call makes
  a zeroed word when the caller holds no length. Alternative not taken: keep such a function on the
  CPU tier, as stage 1 did. Cost of the decision: about 25 lines in the lowering, and one buffer of
  4 bytes for each call that holds no length. Reason: `count[0] = list.length` is the step that
  moves a count after a compaction (part 3 and the table "Before and after"), and the word is the
  same mechanism as part 2.
- **S2-2, the storage buffers of the entry that stores.** On a device that allows a stage fewer
  storage buffers than that entry binds (every array, the partials of each loop that reduces and
  the length words), the call runs on the next tier and says why. The check is in the call, where
  the device and its limit are known, and not in the lowering, which has no device. Alternative not
  taken: leave the open observation of stage 1 open. Reason: about 15 lines and a test, and a call
  that would fail at the dispatch now runs on another tier.
- **S2-3, the length is a `u32` on every tier.** The device's scan adds in `u32`, so a held length
  near 2^32 wraps there. The CPU tier wraps its count too, so the tiers agree. Alternative not
  taken: refuse such a length. The call cannot know the count before the loop runs.
- **S2-4, a loop that runs no iteration.** With a length word, the call dispatches the loop's scan
  alone, so the slot that the result reads holds the length after the loop. Alternative not taken:
  read the word itself. A read of a buffer is a copy at the end of a plan's submission, after the
  calls that follow, which may change the word.

**Deviations of stage 2** from the approved text, each with its disposition:

1. A call that passes a held length to a function that takes a `Map` or a `Set` runs on the CPU
   tier, and the call says why. The records of change 0080 lower such a function, and its face has
   no second WGSL text. Disposition: closed. The CPU tier gives the one answer.
2. The face of a function that pushes gains the second WGSL text and marks its pushed parameters,
   while the Exclusions say that the face of a function that passes no held length stays as it was.
   **Fact** (compared on 2026-10-27, `main` at `21da2e16` against this stage): the WGSL, the
   uniform, the bindings and the loops that a call without a held length reads are byte-identical
   for every kernel function of the examples and the journeys. Disposition: closed. A call without
   a held length runs as it did, and the face needs the second text for a call with one.

### Decisions of stage 3

**Record.** Stage 3 of the implementation (branch `claude/0094-s3-device-trip-count`) delivers
part 1 for the loops that neither push nor reduce: a loop whose range reads an element of an array,
or the length of an array an earlier loop pushed onto, runs on WebGPU from a range entry and an
indirect dispatch, with nothing read back. It takes the decisions below for the owner's review,
which its pull request records. Until the merge they are proposed, not approved.

- **S3-1, which loops have a range the device holds.** A loop whose statements before it, start or
  bound read an element of an array parameter, or `pushCount` of a pushed array, read as Rule 8.22
  words it: one function, `deviceRangeLoops` in `src/core/passes/kernel-stores.ts`, which the front
  end's guard and the lowering both call. Alternative not taken: only the statements the start and
  the bound depend on. Cost of the alternative: a dependency walk that the front end and the
  lowering would each have to agree on. Reason: the text of part 1 names the statements before the
  loop, and one predicate keeps the guard and the lowering in step.
- **S3-2, the statements before such a loop in its entries.** Each invocation of the loop's entry
  runs those statements again, as every loop's entry does, so a loop that writes an array they read
  runs the function on the CPU tier and says why. Alternative not taken: the range entry stores each
  local of those statements in the trip buffer, and the entries read them there. Cost: a slot and a
  bit pattern for every local of every type. Reason: such a loop races with itself on WebGPU, and the
  CPU tier gives the one answer.
- **S3-3, the trip buffer.** Eight `u32`s for each loop with such a range (the start's bits, the
  trip count, `[x, y, 1]`, three words of room), one buffer with the usages `STORAGE` and `INDIRECT`
  that the call makes and frees once the call has run, under two bindings: read-write for the range
  entries, read-only for the loops' entries, which also read their workgroup count from it.
  The bindings come after the textures and before the length words, so the second WGSL text of a
  call that passes a held length binds them at the same numbers. Alternative not taken: one
  read-write binding. Cost: WebGPU's usage scope refuses a dispatch that reads its indirect counts
  from a buffer it binds writable. Alternative not taken: copy the counts into the uniform. Cost: a
  copy for each loop and a uniform that changes inside one submission.
- **S3-4, WebGL2.** Part 4 runs such a loop on WebGL2: the call computes the range on the CPU tier
  over the host copies, after the draws before it, and draws the iterations whose `i` lies inside
  the array the loop writes. The program drops the front end's guard, since every iteration it draws
  writes inside the array. Alternative not taken: draw every iteration, and let the host copy drop
  the texels past its end. Cost: a target as large as a trip count read from the device, which may
  be any `u32`. Reason: the writes are the same, and the target stays the array's size.
- **S3-5, a write through a reference.** A call statement inside such a loop that passes an element
  of an array as an `@inout` argument is guarded by the array's length, as an assignment is, so a
  callee that would write past the end does not run, on every tier. On WebGPU such a loop runs the
  function on the CPU tier and says why, since a call that writes through a reference may also sit
  inside an expression, where no guard reaches it. Alternative not taken: leave the call unguarded.
  Cost: the CPU tier's array is a JavaScript array, which a write past its end lengthens, so its
  `.length` after the loop would differ from the host array's (observed on this branch, the probe
  of `host-kernel-range.test.ts`).
- **S3-6, a result.** A function with such a range that returns a value runs on the CPU tier when
  its result's tail, the function's statements outside its loops, reads an element, with the reason
  it has today. Alternative not taken: keep only the statements the `return` depends on. Reason: the
  stores after the loops carry a value the device computes (part 3), and the `return` keeps its
  meaning, a host result.
- **S3-7, the storage buffers of such a loop's entries.** On a device that allows a stage fewer
  storage buffers than the range entry or the loop's entry binds (every array, the trip buffer and
  the length words), the call runs on the next tier and says why, as S2-2 does for the entry that
  stores. Cost: about 20 lines and a test.
- **S3-8, the private input layout.** A function with such a range keeps its full layout, and the
  call projects no input (change 0082). Alternative not taken: project the range entry too. Reason:
  the range entry reads the arrays the statements before the loop name, which the projection does
  not plan for; the face gives the full layout to every other call already when it is resident.
- **S3-9, the generated corpus.** `generateKernelModule` makes such a range only when asked
  (`deviceRange: true`), so that every seed's kernel is the one it was; the differential test and
  the GPU differential ask for it on seeds of their own (321 to 344).

**Deviations of stage 3** from the approved text, each with its disposition:

1. A function that takes a `Map` or a `Set` and has a range the device holds runs on the CPU tier,
   and says why, also when its loops only read the collection, while the Exclusions name only a loop
   that adds to one. The records and the lookups of change 0080 are sized and uploaded from trip
   counts the host knows. Disposition: closed. The CPU tier gives the one answer.
2. The guard of S3-5 skips a call whose `@inout` element is past the array's end, so the callee's
   other effects are skipped with the write, where D2 drops the write only. Disposition: closed. The
   CPU tier and the WebGPU entry run the same guarded IR, so the tiers agree; no example or journey
   writes through a reference inside such a loop.

### Decisions of stage 4

**Record.** Stage 4 of the implementation (branch `claude/0094-s4-device-range-push-reduce`, PR
#806) delivers part 1 for the loops that push or reduce: such a loop over a range the device
holds runs on WebGPU when its bound has the cap of decision D6, its scratch sized for the cap,
its steps and fold levels dispatched from the trip buffer, and nothing read back but a result. It
also measures D8. It takes the decisions below for the owner's review, which its pull request
records. Until the merge they are proposed, not approved.

- **S4-1, what `c` may be.** An expression of the scalar parameters and the arrays' `.length`,
  read through the top-level `const`s the bound names, with no variable, no element, no pushed
  length and no effect; of `min(min(d, c1), c2)`, `min(c1, c2)` (`capOf` in
  `src/core/passes/kernel-lower.ts`). Alternative not taken: only a scalar parameter or an
  array's `.length` as written. Cost of the alternative: `j <= min(d, xs.length - 1)` and
  `min(d, m + 1)` would keep the CPU tier. Cost of the decision: about 90 lines, and a CPU-tier
  function `<f>__cap<j>` in the plan, which the call runs as it runs any host range. Reason: the
  host computes such an expression from the lengths and scalars before anything runs, which is
  what "a value that the host knows" needs. Deviation 1 records the wider reading.
- **S4-2, the start and the direction of a capped loop.** The loop counts up (`<`, `<=`) from a
  start the host knows too, and the call sizes the scratch for the iterations from that start
  to `c` (`tripsOf`). A loop that counts down, or whose start reads what the device holds, has no
  cap and keeps the CPU tier with the reason of a loop with no cap. Alternatives not taken: size
  a device start of a `u32` counter for `c` (a second form of the cap for one counter type; an
  `i32` start stays unbounded); `max(d, c)` for a loop that counts down (a spelling the approved
  text does not name). Reason: D6 names `min(d, c)` in the bound, and the CPU tier gives the one
  answer otherwise. Deviation 2 records it.
- **S4-3, the trip buffer of such a loop.** A loop that pushes keeps the eight words of S3-3 and
  uses the first word of room, word 5, for the length after the loop. A loop that reduces over a
  range the device holds has twenty: the eight, then three fold levels of four words, how many
  partials the level folds and its workgroups `[x, y, 1]`; three levels hold 2^32 iterations.
  Each loop's words start where the loop before it ends, so a function with no such reduction
  keeps the offsets of stage 3. Alternatives not taken: twenty words for every loop (changes the
  offsets and the buffer of every stage-3 function); a buffer for each level (more bindings, so
  the storage-buffer limit of S3-7 is met sooner).
- **S4-4, the fold levels over a range the device holds.** The call dispatches the levels the
  cap needs, one at least, each from its counts; the range entry gives each level one workgroup
  at least. A level of one partial or none takes no tree: its first invocation copies the partial,
  or writes the operator's identity for a loop that ran no iteration. So the folded value is in
  the slot the call knows, and it has the bits the levels of a trip count the host knows give.
  Alternatives not taken: the tree on such a level (it combines the value with identities again,
  which changes bits, `min(inf, 3.4028235e38)` and a NaN among them); read the level count back
  (a read, against part 1). Cost: a branch in the fold entry of such a loop only, and one dispatch
  of one workgroup for a cap that one workgroup folds.
- **S4-5, the length after a capped push.** The scan, dispatched directly, binds the trip buffer
  read-write: it reads the trip count there and writes the length after the loop into word 5. A
  result reads those 4 bytes back in the same submission; a call with no result reads nothing.
  Alternatives not taken: write it at slot `c` of the counts (one more field of the uniform for
  each such loop); read slot `n` of the counts (the host does not know `n`).
- **S4-6, a cap whose scratch exceeds a storage binding.** The call checks the largest scratch
  buffer the caps need against the device's `maxStorageBufferBindingSize`, 134,217,728 bytes when
  it reports none, and runs on the next tier with the reason (`capScratch` in
  `src/core/host-kernel.ts`). Alternative not taken: let the dispatch fail, a validation error
  that leaves the arrays as they were or loses the device. Cost: about 30 lines and a test.
- **S4-7, the open observation of stage 3** (a write through an `@inout` argument from inside an
  expression, in a loop over a range the device holds, is unguarded on the CPU tier). Left open.
  Alternatives not taken: (a) rewrite such an argument through a local whose store the IR guards,
  for a `let`, an assignment and a call statement: about 80 lines; it moves the write to the end
  of the statement and leaves an `if` or `switch` condition, a loop header and a statement that
  names the array twice unguarded, so the observation stays open in part; (b) make the CPU
  tier's code and the interpreter drop a store-back past the end of an array with no size: about
  20 lines and complete, but it changes the CPU tier of every function and entry, outside the
  range of D2, a rule change this proposal does not declare. Reason: no example, journey or
  generated function reaches it; on every tier the host array keeps its length, and only a
  `.length` read later in the same call differs on the CPU tier. Next action: (b) as a proposal
  of its own when a consumer meets it.
- **S4-8, the generated corpus.** `generateKernelModule` makes a last loop that pushes
  (`devicePush`) or reduces (`deviceReduce`) over a range capped by the arrays' length,
  `min(c0[0] % (length + 2), length)`, only when asked, so that every pinned seed's kernel is the
  one it was. A reduction reads the element in its bound and returns what it folded, or, on half
  the seeds (a stream of their own), reads it in a constant before the loop and stores what it
  folded after it. The differential test and the GPU differential ask for them on seeds of their
  own (351 to 366 and 371 to 388). The instrument is the fault `device-fold-one-less`, a range
  entry that gives the first fold level one partial too few, which turns a level of one partial
  into the identity.
- **S4-9, the measurement of D8.** The scan of a push and the whole push (range entry, count,
  scan, store) are timed apart, over a host range and over a capped device range, at 2^10 to 2^24
  elements, as below. A faster scan is a performance change, which needs no proposal; this record
  proposes none.

**D8, measured.** **Fact** (measured on 2026-10-27, from 14:05 to 14:07 UTC). Configuration: the
lowering of commit `e16e988c` (later commits of PR #806 change no lowering or call code); Bun
1.4.4; Playwright 1.64.1 with Chromium headless shell build 1243, version 153.0.8010.12
(`TYPESHADE_CHROMIUM`), flags of `scripts/gate-browser.ts` (software); WebGPU adapter `google /
swiftshader`, with `timestamp-query`; a container of 4 CPUs shared with two other agents, load
average 5.1 to 7.9 during the runs. Method: a scratch script, not in the tree, compiles
`hostKeep` (`i < xs.length`, a range the host knows) and `deviceKeep` (`i < min(count[0],
xs.length)`, a capped range the device holds), each `if (xs[i] > 0.) list.push(i)` over
`n` elements of which about 3 in 7 pass, and dispatches the plan's own entries in plain WebGPU.
It times the scan step alone, by the pass's timestamps, and the whole push (range entry, count,
scan, store) by the wall clock around one submission and `onSubmittedWorkDone`. Each figure is
the median of 7 runs after one warm run (3 at 2^22 and 2^24); two whole runs gave the two figures
of each cell.

|  `n` | scan, GPU time, host range (ms) | scan, GPU time, device range (ms) | whole push, wall, host range (ms) | whole push, wall, device range (ms) |
| ---: | ------------------------------: | --------------------------------: | --------------------------------: | ----------------------------------: |
| 2^10 |                     0.43 / 0.41 |                       0.35 / 0.51 |                         2.6 / 2.4 |                           2.5 / 2.4 |
| 2^12 |                     0.55 / 0.60 |                       0.43 / 0.40 |                         2.6 / 2.6 |                           2.8 / 2.5 |
| 2^14 |                     0.78 / 0.59 |                       0.58 / 0.83 |                         2.8 / 2.5 |                           2.4 / 2.7 |
| 2^16 |                     1.38 / 1.34 |                       1.32 / 1.36 |                         5.7 / 5.9 |                           4.9 / 6.1 |
| 2^18 |                     4.65 / 4.83 |                       5.10 / 4.31 |                       22.2 / 14.8 |                         21.5 / 22.4 |
| 2^20 |                   24.97 / 17.76 |                     24.10 / 17.27 |                       80.4 / 73.0 |                         94.3 / 86.8 |
| 2^22 |                   69.41 / 75.75 |                    100.87 / 81.95 |                     454.7 / 481.4 |                       534.1 / 536.2 |
| 2^24 |                 308.12 / 282.26 |                   317.84 / 294.14 |                   1388.4 / 1234.6 |                     1490.6 / 1419.5 |

**Inference.** On SwiftShader the scan grows linearly with `n`, about 18 µs for each 1,024 counts
from 2^20 up: each of its 256 invocations adds a run of `n / 256` counts in order, twice. It is
about a sixth to a third of the whole push from 2^20 up, and under 1.4 ms up to 2^16, where a
submission's own cost, about 2.5 ms of wall time, is larger. A range the device holds does not
change the scan's cost, as D8 stated. A hardware GPU was not measured; its proportions may
differ. No faster scan is proposed here.

**Deviations of stage 4** from the approved text, each with its disposition:

1. Part 1 says that `c` is "a scalar parameter or an array's `.length`, read through the
   constants that the bound names". The delivered `c` is any expression of those, through those
   constants (S4-1). Disposition: open, for the owner: amend that sentence of part 1 to "an
   expression of the scalar parameters and the arrays' `.length`", as Rule 8.22 now words it, or
   narrow `capOf` to the two forms.
2. Part 1 sizes the scratch "for `c`" and says nothing of the start. The delivered cap also needs
   a start the host knows and a loop that counts up (S4-2); such a loop with a start the device
   holds, or that counts down, keeps the CPU tier with its reason. Disposition: closed. The CPU
   tier gives the one answer, and the call never sizes scratch for a count it cannot bound.

### Configuration and validation record

This record does not yet apply. No implementation exists at acceptance. Delivery requires: the
implementing commits with `Change: 0094`; the tests above, green; `bun run gate:compile` with the
new example; `bun run gate:differential` with the new generated cases; `bun run gate:journeys`
with the new journey; `bun run gate:boundary` with the measured growth; `bun run build`,
`bun run lint`, `bun run format:check` and `bun run test`; `bun run docs:impact`,
`bun run docs:refs`, `bun run reqs:sync` and `python scripts/doorstop-check.py -C -e -F`, with
the changed rules reviewed. Downstream pins are tracked apart. These are requirements, not results.

## What it owes downstream

This draft did not search the site or the editor repository. The work below is expected work; a
search of each repository for "outside its loops", for `out.length` and for "reads back" in the
kernel pages fixes the list.

**typeshade.github.io.** The kernel-function page gains the trip count read from an array, the held
length of a pushed array and the stores after the loops, with the cap and the dropped writes. The
fuse page gains the three reasons of F1. The gallery shows `kernel-device-counts`. In English and
Korean.

**vscode-typeshade.** The skill's kernel-function reference gains the three forms. A fixture that
quotes the `TS8070` text for a store outside the loops changes. Hover shows the host view of a
pushed array with the held-length shape.

**typecv.** Expected work, decided by TypeCV:

- Phase 10 step C3: the hand-written compactions of SIFT, ORB, KLT, matching and MVS may become a
  `push` after a held length, each held to the gate "row order and counts bit-identical; no new
  readback". The pair-preparation copy of the scan waits for R03 (TypeCV section 4, rule 6).
- `src/gpu/scan.shade.ts` stays until section 7, item 14 amends `docs/engine-v2.md`. This proposal
  does not require that amendment.
- Row C8: the 12 indirect entries are sparse-scene kernels, which wait for R03. **Inference.** The
  audit marks those families "intentional" for several needs at once (DC, 1I, WG, IN). This proposal
  removes IN and DC from that list. An entry that also needs workgroup memory or a specific
  invocation-to-work mapping stays an entry. Section 3.6's list of what only an entry provides needs
  an amendment before a conversion.
- **Inference.** The single-invocation finish steps that only move a count become stores after the
  loops of the function that computes the count. A step without a loop depends on decision D7.
- Probes: P6 changes its verdict when this change lands, as its signal states. P1's assertion that
  the call takes no indirect count stays true, since part 1 adds no argument to the call.
- Record 0094 in `compiler-changes.md` when the pin moves.
