---
id: '0080'
title: A kernel function takes ECMAScript's Map and Set, its loops add to them, and every tier gives the entries, the size and the insertion order a sequential run gives
status: draft
rules:
  - '2.1'
  - '8.22'
  - '8.23'
  - '11.8'
  - '11.13'
surface:
  - 65
  - 71
  - 74
exports: []
exports-removed: []
codes: []
examples:
  - kernel-set-unique
downstream:
  - repo: typeshade.github.io
    what: A page, en and ko, for Map and Set in a kernel function, the kernel-function page's list of parameters, and the fuse page's group rule. compiler-changes.md records 0080 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references gain Map and Set parameters and their host contract. compiler-changes.md records 0080 when the pin moves.
  - repo: typecv
    what: Nothing is owed at the pin. A hand-written unique-label or key-collection pass can move to a Set or a Map when the pin moves, held to its current output. compiler-changes.md records 0080 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in other repositories -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0080. This file is the proposal source. It has status `draft`.                                                                                                                                                                                                                            |
| Revision context            | Drafted 2026-10-21, UTC. The date is the authoring context. It is not an approval date.                                                                                                                                                                                                            |
| Request source              | The repository owner, Seungup, asked in a Claude Code session of 2026-10-21 whether a Map and a Set can be made, said that the front end's concept is what matters and that the WGSL and GLSL inside may differ entirely, and approved the drafting of this proposal. No GitHub issue is recorded. |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                |
| Current lifecycle state     | `draft`. No decision is recorded. No implementation exists.                                                                                                                                                                                                                                        |
| Applicability / effectivity | The front end and the language service (a `Map` or `Set` parameter and its methods), the kernel-loop proof, the kernel lowering, the call (`src/core/host-kernel.ts`), the host face, the `fuse` planner, the WebGPU and CPU tiers. No release version is assigned.                                |
| Review baseline             | `origin/main` at `5c9cbee8` (commit "Merge pull request #722 …"), read on 2026-10-21. Changes 0078 and 0079 are `implemented` there.                                                                                                                                                               |
| Proposal review             | No pull request is assigned yet.                                                                                                                                                                                                                                                                   |
| Revision authority          | Git records the revisions of this file. The review and merge of the proposal-only pull request record the decision.                                                                                                                                                                                |

## What changes

A kernel function (Rule 8.22) appends with `push` (change 0078), and its arrays have the methods of
`Array.prototype` (change 0079). It cannot collect what is unique: the labels a segmentation finds,
the cells a set of points falls into, the last value written for each key. A TypeScript developer
writes that with a `Set` or a `Map`. This proposal lets a kernel function take one.

```ts
"use typeshade";

export function labels(pixels: array<u32>, seen: Set<u32>): u32 {
  for (let i: u32 = 0; i < pixels.length; i++) {
    if (pixels[i] !== 0) {
      seen.add(pixels[i]);
    }
  }
  return seen.size;
}

export function latest(keys: array<u32>, values: array<f32>, last: Map<u32, f32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    last.set(keys[i], values[i]);
  }
}
```

```ts
const seen = new Set<number>();
const n = await labels(pixels, seen); // seen holds each label once, in the order first seen
```

### 1. The principle: the concept is ECMAScript's, the implementation is the tier's

What an author writes and what the host reads back are ECMAScript's `Map` and `Set`: their entries,
their `size`, `has` and `get`, and the order they iterate in, which is the order of insertion. How a
tier computes them is the tier's. The CPU tier uses JavaScript's own `Map` and `Set`, and it is the
oracle. WebGPU may use a hash table, a sort, or another structure, and may change it between
versions, as long as every observable answer is the oracle's (Rule 11.13's "the bits of the calls
run apart" holds for it too).

### 2. The spelling

- A parameter of a kernel function may have the type `Map<K, V>` or `Set<K>`. `K` is `u32`, `i32` or
  `f32` (open decision 2). `V` is any type an array parameter may hold.
- Inside a candidate loop, `s.add(k)` and `m.set(k, v)` are statements, any number of times in an
  iteration and in any branch, as `push` is.
- Outside the loops that add to it, and in a later loop that does not add to it, `s.has(k)`,
  `m.has(k)`, `m.get(k)` and `.size` read it. `m.get(k)` of a key the map does not hold is refused
  where the proof cannot show the key is there: a shader value has no `undefined` (open decision 4).
- `delete`, `clear`, iteration inside the function (`for…of`, `forEach`, `keys()`), and a `Map` or
  `Set` anywhere but a kernel function's parameter are refused in this change.

### 3. The meaning: a sequential run's

The entries are those a sequential run of the loop leaves:

- `s.add(k)` adds `k` once. Its place in the insertion order is the iteration, and the statement in
  it, that added it first.
- `m.set(k, v)` keeps, for each key, the value of the last `set` in the order of the iterations,
  and its place in the order is the first `set` of the key.
- Keys are compared by SameValueZero, ECMAScript's rule for `Map` and `Set`: a `NaN` key equals a
  `NaN` key, and `-0` equals `0`.

### 4. The host

The caller passes a JavaScript `Map` or `Set`, by reference as an array is (Rule 8.23): its entries
are there before the loop, and when the call resolves the new entries are in it, in insertion
order, and an existing key's value is the last one set. A `Map` the host passes may hold keys and
values of the parameter's types only; the call refuses another with a `TypeError` that names the
parameter and the first key that does not fit.

### 5. The capacity

A GPU allocates nothing during a dispatch, and an ECMAScript `Map` has no capacity. The draft lets
the call size the table itself: the entries the host passed, plus the loop's trip count times the
most `add` or `set` calls one iteration can make, which the proof counts. A loop whose count it
cannot bound (an `add` inside a nested loop of a runtime bound) runs on the CPU tier and says why
(open decision 1).

### 6. The proof

Rule 8.22 gains, as for `push`:

- R3: an `add` or a `set` on a `Map` or `Set` parameter is a write the proof accepts.
- R4: a loop that adds to a map or a set does not read it (`has`, `get`, `size`), since each answer
  depends on the iterations before it. The remedy names a later loop or the code after the loop.
  The value an iteration `set`s may read anything else.

### 7. The tiers

- **The CPU tier** runs the function as written, with JavaScript's `Map` and `Set`. It is the oracle.
- **WebGPU** runs a loop that adds in steps the lowering chooses. The draft's: a hash table of the
  call's capacity, keyed by atomic compare-exchange; per key the least and the greatest iteration
  that wrote it, by atomic `min` and `max`; the value of the greatest; then the iterations that
  added a key first, compacted in the order of the iterations with 0078's count, scan and store,
  which gives the insertion order. A later loop that reads the map probes the same table.
- **WebGL2** has no atomics, and runs no such loop. The call says why and falls to the next tier.

### 8. Fusion

A `fuse` scope (Rule 11.13) puts a call that adds to a map or a set in a group of its own, as it does
a call that pushes.

### Not in this change

- `delete` and `clear`, and an `add` after a `delete` (which moves a key to the end of the order).
- Keys that are vectors or structs: ECMAScript compares an object key by identity, which a shader
  value has none of.
- A `Map` or `Set` local to a shader function, and one in a module binding.
- An order other than insertion order, and a faster unordered form.

## Why

**The concept is the one TypeScript developers use.** Collecting unique values and the last value per
key is written with `Set` and `Map` in every TypeScript codebase. Today a TypeShade author writes a
hash table by hand, or a sort and a compaction, and either gives an order that depends on the
dispatch.

**One answer.** The insertion order and the last value per key are defined by the sequential run,
and the draft's WebGPU steps compute exactly those. This keeps TypeCV's Rule 1.1, and lets a result
be held bit for bit to the CPU tier, as 0078's appends are.

**The tiers may differ inside.** The owner's direction: the front end is ECMAScript's concept, and
the WGSL and GLSL inside may be anything that gives the same answers. The proposal fixes the
observable meaning and leaves the WebGPU structure to the implementation.

### Alternatives

- **A device-made map with a capacity** (`device.map(capacity)`). It names the capacity outright,
  and is no ECMAScript value; the host would read a device object, not a `Map`. Open decision 1.
- **An unordered map** (atomic insert, scheduling order). Faster, and its iteration order changes
  between runs. Refused as the default; it may come as a labeled operation that says so (TypeCV
  Rule 1.3).
- **Sort-based dedupe** in place of a hash table. A valid WebGPU implementation of the same meaning,
  which the implementation may choose.

### Assumptions

- WGSL's `atomicCompareExchangeWeak` on `u32`, and `atomicMin`/`atomicMax`, are enough for the
  table; an `f32` key is stored by its bits, with `-0` stored as `0` and every `NaN` as one `NaN`.
- The proof can count the `add` and `set` calls of one iteration when none is inside a nested loop
  of a runtime bound.

### Open decisions

1. **The capacity.** The call sizes the table from the trip count and the most writes an iteration
   makes (the draft), or the host names it with a device-made map, or the map's entries beyond a
   host-given capacity are dropped as `push`'s are.
2. **The key types.** `u32`, `i32` and `f32` (the draft), or also `bool`; vectors and structs are out.
3. **What the host passes.** A JavaScript `Map` and `Set` (the draft), or also a device-resident form
   for a chain of calls on a device.
4. **`get` of a key that is not there.** Refused where the proof cannot show the key (the draft), or
   `m.get(k) ?? fallback`, with `??` read as ECMAScript's nullish coalescing on the one case.

## What it touches

- **Rule 2.1.** `Map` and `Set` join the standard-library declarations the ambient file restates,
  with the members this change takes.
- **Rule 8.22.** R3 gains `add` and `set`; R4 gains the reads of a map or a set the loop adds to.
- **Rule 8.23.** A `Map` or `Set` parameter is the caller's, passed by reference; the call sizes it.
- **Rule 11.8.** The WebGPU steps; WebGL2 says why it does not run the loop.
- **Rule 11.13.** A call that adds to a map or a set is a group of its own.
- **Surface §65.** The kernel-function section lists the new parameter types.
- **Surface §71.** The planner's reasons gain the group of such a call.
- **Surface §74 (new).** "A Map and a Set in a kernel function": the spelling, the meaning, the
  host contract and the capacity.
- **Example `kernel-set-unique`.** `labels` above, held to the CPU tier on every tier the call reaches.

### Draft impact estimate

Known work, by area:

- **Front end and language service.** The `Map` and `Set` parameter types, `add`, `set`, `has`,
  `get`, `size`, typed against `K` and `V` (Rule 12.7); the refusals.
- **Proof.** R3 and R4 for the new writes and reads; the count of writes an iteration makes.
- **Lowering.** The hash table and its steps, a later loop's probe, and the compaction into
  insertion order, reusing 0078's scan.
- **Call.** The capacity, the upload of the host's entries, the read back into the host's `Map` or
  `Set` in order.
- **CPU tier.** A `Map` or `Set` argument in the generated code, as JavaScript's own.
- **Planner.** A group of its own.
- **Gates.** The differential gate gains generated loops that add, held to the oracle bit for bit,
  colliding keys and `NaN` keys among them.

Compatibility: no program that compiles today changes its meaning. A `Map` or `Set` is refused today
everywhere.

Dependencies: change 0078 (its scan), implemented.

Duration and cost: unknown. No estimate is established. This is larger than 0078.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on open decisions 1 to
4 and the merge of the proposal-only pull request with `status: accepted`.

### Configuration and validation record

This record does not yet apply. Delivery will require this evidence, none of which exists yet:

- each spelling and refusal in both halves on one source (Rule 12.7);
- the CPU tier equal to JavaScript's `Map` and `Set` on the same input: duplicates, a `NaN` and a `-0`
  key, a host map with entries before the call;
- `kernel-set-unique` through the compile gate, and on WebGPU in the import journey, bit for bit with
  the CPU tier, insertion order included;
- the differential gate over generated loops that add;
- a `fuse` scope with a call that adds between two array calls, held to the calls apart.

## What it owes downstream

- **typeshade.github.io.** A page, in English and Korean, for a Map and a Set in a kernel function;
  the kernel-function page's parameter list; the `fuse` page's group rule. `compiler-changes.md`
  records 0080 when the pin moves.
- **vscode-typeshade.** The skill's references gain the parameter types and the host contract.
  `compiler-changes.md` records 0080 when the pin moves.
- **typecv.** No page describes the old behavior. A hand-written unique-label pass can move to a
  `Set` when the pin moves, held to its current output. `compiler-changes.md` records 0080 when the
  pin moves.
