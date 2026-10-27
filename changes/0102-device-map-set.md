---
id: '0102'
title: A kernel function fills a device-resident Map or Set of a declared capacity, and later calls read it on the device with no read between them
status: draft
rules:
  - '8.21'
  - '8.22'
  - '8.23'
  - '11.8'
  - '11.13'
surface:
  - 65
  - 71
  - 74
exports:
  - resident
  - Device
exports-removed: []
codes: []
examples:
  - kernel-device-map
downstream:
  - repo: typeshade.github.io
    what: Describe the device-resident Map and Set, its capacity, its overflow and its retry on the Map and Set page, the kernel-function page and the fuse page, show the kernel-device-map example, in both locales, and record 0102 when the pin moves.
  - repo: vscode-typeshade
    what: Describe the device-resident Map and Set and its host contract in the skill's Map and Set reference, accept the new host view where a fixture quotes a Map or Set parameter, and record 0102 when the pin moves.
  - repo: typecv
    what: Convert the voxel table, the TSDF block table, the k-NN grid and the mesh grid in phase 10 of docs/library-structure.md, each held to its current output, and record 0102 when the pin moves.
---

<!-- doc-refs: skip-file — this draft names an example that a later implementation adds, and files of the TypeCV repository, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0102`, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Date and attribution          | Written on 2026-10-27, UTC. The date records authorship, not an approval. A Claude Code sub-agent drafted it at the request of the coordinating Claude Code session of TypeCV's refactoring programme. The owner approved drafting P2 after P1 (change 0101, PR #802) on 2026-10-27. The source is proposal P2 of TypeCV's audit `docs/audits/2026-10-27-typescript-surface-gaps.md` (row T1, rank 3, with row T13, whose overflow and retry the audit counts in T1). Numbers 0100 (PR #801) and 0101 (PR #802) are taken by open pull requests, so this proposal takes 0102.                                                                                                            |
| Applicability / Effectivity   | A kernel function's `Map<K, V>` or `Set<K>` parameter (Rule 8.22, surface §74) when the host passes a device-resident collection. Files: `src/core/resident.ts` (`resident`), `src/runtime/device.ts` (`Device`), `src/core/host-kernel.ts` (`checkCollection`, `applyRecords`, `lookupTable`, the WebGPU path), `src/core/passes/kernel-lower.ts` (`lowerCollections`), `src/core/cpu-runtime.ts` and `src/core/cpu-codegen.ts` (the CPU tier's collection), `src/compiler/ts/host-face.ts` (the host view), `src/core/fuse-group.ts` and `src/core/fuse-plan.ts` (the group). A call that passes a JavaScript `Map` or `Set` keeps change 0080's form. No release version is assigned. |
| Review baseline               | TypeShade `main` at `b009cd8a` (`fix(compiler): refuse a kernel function's optional result (#792) (#798)`). The facts on the code in this document were read there. TypeCV evidence: `main` at `e68ecd5`; the audit's own baseline is TypeCV `73c84dc` with the compiler pin `725b2969`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Review and revision authority | No pull request is assigned at the first revision of this file. Git records the revisions. The review and merge records of the proposal-only pull request record the decision; this file does not claim that merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## What changes

**Proposal.** A host may make a `Map` or a `Set` that lives on the device, with a capacity it
declares. A kernel function takes it where it takes a `Map` or a `Set` today: the parameter is
still `Map<u32, V>` or `Set<u32>`. A loop of the function fills it, an `add` or a `set` in a
nested loop included. A later loop of the same call, or a later call, reads it with `has`, `get`
and `size` on the device. Nothing is read back between the calls. The host reads the entries once,
when it asks for them, as a JavaScript `Map` or `Set` in insertion order.

```ts
"use typeshade";

// A cell's key, packed by the author from three coordinates under 1024 (decision D3).
function cellKey(xs: array<f32>, i: u32, inverse: f32): u32 {
  const x = u32(floor(xs[3 * i] * inverse));
  const y = u32(floor(xs[3 * i + 1] * inverse));
  const z = u32(floor(xs[3 * i + 2] * inverse));
  return x | (y << 10) | (z << 20);
}

export function occupy(xs: array<f32>, inverse: f32, cells: Set<u32>) {
  for (let i: u32 = 0; i < xs.length / 3; i++) {
    cells.add(cellKey(xs, i, inverse));
  }
}

export function lookup(xs: array<f32>, inverse: f32, cells: Set<u32>, hit: array<u32>) {
  for (let i: u32 = 0; i < hit.length; i++) {
    hit[i] = cells.has(cellKey(xs, i, inverse)) ? 1 : 0;
  }
}
```

```ts
import { resident } from 'typeshade/runtime';

const cells = resident(new Set<number>(), { capacity: 1 << 20 }); // the spelling is decision D2
occupy(points, 20, cells); // queued: fills the table on the device
lookup(points, 20, cells, hit); // probes the same table, with no read between
const seen = await cells.read(); // the one read of the chain, a Set in insertion order
```

The example is illustrative. It needs no name that the surface does not have today: the kernel
source is §74's, and only the host value is new.

### Before and after

| Today, at `b009cd8a`                                                                                                                                               | With this proposal                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| A `Map` or a `Set` parameter takes a JavaScript `Map` or `Set` only. `checkCollection` in `src/core/host-kernel.ts` refuses any other value: `takes a Map; got …`. | It also takes a `Resident` of a `Map` or a `Set`, made with a capacity.                                                         |
| On WebGPU each `add` or `set` pushes a record. The call reads the records back and applies them to the host's collection in order (`applyRecords`).                | For a resident collection the loop inserts into a hash table on the device. Nothing is read back.                               |
| A loop that reads a collection finds a key by a binary search over keys that the call sorts and uploads from the host (`lookupTable`).                             | A loop that reads a resident collection probes the table on the device.                                                         |
| An `add` inside a nested loop runs the function on the CPU tier (§74), because the call cannot size the records.                                                   | With a resident collection the capacity is the host's. The nested `add` runs on WebGPU.                                         |
| A loop over a device range (change 0094, part 1) that adds to a collection runs the function on the CPU tier (0094, "Exclusions").                                 | With a resident collection it runs on WebGPU. The table does not depend on the trip count.                                      |
| A call that adds to a collection forms a group of its own in a `fuse` plan (§71, F1).                                                                              | The same. The group's reason names the resident collection.                                                                     |
| TypeCV writes the table by hand: 188 code lines in 4 kernels and 4 host modules (the audit's count, row T1).                                                       | The kernel writes `add`, `set`, `has` and `get`. The host makes the collection with its capacity and retries when it overflows. |

### 1. The host value

**Proposal.**

- **Making one.** The host makes a resident collection from a JavaScript `Map` or `Set` and a
  capacity: the most distinct keys the collection may hold. The spelling is decision D2. The draft
  uses `resident(new Map<number, V>(), { capacity })` and `dev.array(new Map<number, V>(), {
capacity })`. The entries of the given collection are its first entries, in their order. A
  collection with more entries than the capacity is refused with a `TypeError`.
- **The handle.** It is a `Resident<Map<number, V>>` or a `Resident<Set<number>>` (Rule 11.8).
  `read()` returns a new `Map` or `Set` that holds the entries in insertion order. `write(value)`
  replaces the entries, with the same capacity. `destroy()` frees the table. The owner rules of
  change 0085 hold for it as for a resident array.
- **The parameter.** A kernel function's `Map<K, V>` or `Set<K>` parameter takes the handle. The
  key and value types are checked as `checkCollection` checks a JavaScript collection, when the
  handle is made and when the call starts. A handle of the wrong kind (a `Set` for a `Map`), a
  destroyed handle and a handle of another owner are refused with a `TypeError` that names the
  function and the parameter.
- **The key types.** `K` is one of §74's key types: `u32`, `i32`, `f32` or a key type (change
  0081). The table stores each key as its order word (`orderWord` in `src/core/host-kernel.ts`):
  SameValueZero equality on one `u32`. A key of three coordinates is decision D3.

### 2. The meaning

**Proposal.** The meaning is §74's and change 0080's: the entries that a sequential run of the
calls leaves, in the order of that run.

- A key is added once. Its place in the insertion order is its first `add` or `set`, ordered by
  the call, then the iteration, then the statement in the iteration, an `add` of a nested loop
  included.
- A `Map` keeps the value of the last `set` of each key, in the same order.
- Keys compare by SameValueZero.
- R4 holds: a loop that adds to a collection does not read it. A later loop or a later call may.
- `delete`, `clear` and iteration inside a kernel function stay refused, as §74 has them.
  Decision D5 states the alternative for `for…of`.

### 3. WebGPU

**Proposal.** The lowering is open addressing over `array<atomic<u32>>`. The implementation may
change the layout between versions, as long as every observable answer is the oracle's (change
0080, section 1).

- **The table.** `T` slots, `T` the next power of two at or above twice the capacity, so the load
  is at most one half. Each slot holds a key word, a first-order word and, for a `Map`, a
  last-order word and the value. A count word holds the distinct keys and an overflow word holds
  the failed inserts.
- **The reserved word.** An empty slot holds `0xffffffff` in its key word. That word is a valid
  `u32` key and a valid `i32` key (`-1`). It goes into one extra slot of its own, outside the
  probe sequence, so every key of `K` can be held. **Inference.** No `f32` key has that order word,
  since `orderWord` maps every `NaN` to `0x7fc00000`.
- **The insert.** `add` and `set` hash the order word to a first slot and probe linearly. Each
  step is one `atomicCompareExchangeWeak(key, 0xffffffff, word)`. A won exchange adds 1 to the
  count. A lost one that found the same word is the same key. A spurious failure retries the same
  slot. The probe stops after `T` steps; a key that finds no slot adds 1 to the overflow word.
- **The order.** The first-order word of a slot takes `atomicMin` of the add's order, and a
  `Map`'s last-order word takes `atomicMax`. The order is the pair (iteration, the add's rank in
  that iteration's serial run). When the proof counts the adds of one iteration, `R` (change 0080,
  section 5), the pair is one word, `i * R + r`. For an add in a nested loop of a runtime bound
  there is no such `R`; decision D7 states the alternatives.
- **The value.** A `Map`'s value is the value of its last `set`. The value is written after the
  last-order word is settled, so that two `set`s of one key cannot race. The draft settles it in a
  second dispatch of the loop: each `set` whose order equals the slot's last-order word stores its
  value. **Inference.** R4 keeps the loop from reading the collection, so the second run computes
  the same keys and values as the first.
- **`has`, `get` and `size`.** A later loop probes from the same first slot until it finds the
  word or an empty slot. `size` is the count word. `get` reads the slot's value, guarded by `has`
  as §74 requires.
- **The insertion order on the host.** The table does not hold the order as a list. When the host
  calls `read()`, the call compacts the occupied slots by their first-order word, with change
  0078's count, scan and store over the slots and one sort of the occupied ones by that word, and
  reads the compacted keys and values back. Nothing is compacted for a call on the device.
- **Overflow.** A full table counts the keys it could not place. `size` then reads the count plus
  the overflow, which is past the capacity, as change 0078's count passes the capacity of a pushed
  array. Decision D4 states the contract.

### 4. WebGL2

**Fact** (Rule 11.8; `src/core/passes/kernel-lower.ts`, `noWebgl2`). GLSL ES 3.00 has no
atomics. The WebGL2 tier runs no kernel function that takes a `Map` or a `Set` today: "it takes the
Map or Set …, which the WebGL2 tier does not run (change 0080)".

**Proposal.** The same holds for a resident collection. The call falls to the next tier of the
owner's policy, the CPU tier by default, and says why, with the same reason. The CPU tier then
holds the collection as a JavaScript `Map` or `Set` (part 5). A `prefer: ['webgl2']` policy throws
the reason, as any required tier does.

### 5. The CPU tier and the oracle

**Proposal.** The CPU tier holds a resident collection as a JavaScript `Map` or `Set`, as it holds
a resident array as a host array (surface §65, "Resident arrays"). It runs the function as written
(Rule 11.7) and is the oracle. It counts the distinct keys and reports the same overflow when a
call adds a key past the capacity: the key is not added, and `size` reads past the capacity, as on
WebGPU. **Inference.** The CPU tier's overflow is deterministic, since it adds in the order of a
sequential run; which keys WebGPU holds after an overflow is not. Decision D4 handles the
difference.

### 6. `fuse`

**Proposal.** A call that adds to a resident collection forms a group of its own, as a call that
takes a `Map` or a `Set` does today (§71, F1). A call that only reads one may join a group under
the rules of the other facts. The plan reads a resident collection as a read of a call that reads
it, and as a read and a write of a call that adds to it, as it reads a held length (change 0094).

### Exclusions

- A JavaScript `Map` or `Set` passed to a call keeps change 0080's form: records applied on the
  host, a binary search for a lookup. Whether that form later moves to the table is the
  implementation's, under change 0080's section 1.
- A collection local to a shader function, one in an entry's binding, and `new Map()` in a
  `"use typeshade"` program stay refused (`TS8035`, `TS8002`).
- `Map<string, V>` with an open key set stays refused (change 0081, decision 3).
- An object key, a vector key and a tuple key, under decision D3's recommendation.
- An unordered collection whose order follows the scheduling. Change 0080 refused it as a default.
