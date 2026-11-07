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
| Review and revision authority | [PR #803](https://github.com/typeshade/typeshade/pull/803), opened on 2026-10-27, UTC, as a draft, is the review record. Git records the revisions. The review and merge records of PR #803 record the decision; this file does not claim that merge.                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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

## Why

### The evidence

**Fact** (the audit, sections 0, 2 and 6, labelled there as counts at TypeCV `73c84dc`). Row T1 is
rank 3 of 27 by the lines that a compiler change removes: 188 code lines, 114 in 4 kernels and 74
in 4 host modules ("114 + 74 = 188"). The CPU reference's grid (57 lines) stays. Row T13 counts
the TSDF table's overflow word and the host's retry loop in T1. The audit's sites:

- the voxel table, `src/mvs/gpu/cloud-voxel.shade.ts`, its claim by compare-exchange and its
  hand-written hash;
- the TSDF block table, `src/mvs/gpu/tsdf.shade.ts`, its claim, its block assignment and its
  lookup, with the host's growth loop in `src/mvs/gpu/tsdf.ts` and a host rebuild of the table in
  `src/mvs/gpu/tsdf-box-table.ts`;
- the bucket lookups of a host-built grid in `src/mvs/gpu/cloud-knn.shade.ts` and
  `src/mvs/gpu/dense-mesh.shade.ts`, with their uploads in `src/mvs/gpu/cloud-clean.ts` and
  `src/mvs/gpu/dense-mesh.ts`.

**Fact** (TypeCV `main` at `e68ecd5`, read for this proposal). The voxel claim is open addressing
by hand, with an `EMPTY` sentinel, a hash of three coordinates and linear probing:

```ts
// src/mvs/gpu/cloud-voxel.shade.ts
declare const voxelTable: storage<array<atomic<u32>>, 'read_write'>;
const EMPTY: u32 = 0xffffffff;
// …
let slot: u32 = voxelSlot(x, y, z) & voxelControl.mask;
let owner: u32 = EMPTY;
for (let probe: u32 = 0; probe <= voxelControl.mask; probe++) {
  if (owner !== EMPTY) break;
  const claim = atomicCompareExchangeWeak(voxelTable[slot], EMPTY, i);
  if (claim.exchanged) {
    owner = i;
  } else if (claim.old_value !== EMPTY) {
    const j: u32 = claim.old_value;
    if (/* the point j has the same three coordinates */) {
      owner = j;
    } else {
      slot = (slot + 1) & voxelControl.mask;
    }
  }
}
```

The table holds a point index, and the kernel compares keys by recomputing the coordinates of the
point it finds. **Inference.** Under this proposal the key is the cell, packed to a `u32`, and the
value is the owner. The owner is the least point index of the cell. A `Map` keeps the last `set`,
so a loop that runs the points from the last to the first sets it.

**Fact** (the same commit). The TSDF claim counts its keys in word 0 and raises an overflow flag
in word 2 when the probe ends with no slot:

```ts
// src/mvs/gpu/tsdf.shade.ts
const claim = atomicCompareExchangeWeak(tsdfTable[HEADER + slot], EMPTY, key);
if (claim.exchanged) {
  atomicAdd(tsdfTable[0], 1);
  done = true;
} else if (claim.old_value === key) {
  done = true;
} else if (claim.old_value !== EMPTY) {
  slot = (slot + 1) & tsdfControl.mask;
}
// …
if (!done) atomicStore(tsdfTable[2], 1);
```

The host grows the table until the claim fits at half load, and reads the table back to list the
keys:

```ts
// src/mvs/gpu/tsdf.ts
let T = nextPow2(Math.max(4096, (2 * volume.samples) / 16));
for (;;) {
  table = tableOf(T);
  words = await claim(table, T, TSDF_WHOLE);
  if (words[2] === 0 && 2 * words[0]! <= T) break;
  free(table);
  T *= 4;
}
```

The block assignment `tsdfAssign` gives each claimed slot a block index by `atomicAdd`. The comment
of `tsdfBoxTable` in `src/mvs/gpu/tsdf-box-table.ts` says that "Slot/block order is private and may
already differ between concurrent GPU claims".

**Fact** (TypeShade `main` at `b009cd8a`). What the compiler does today:

- `lowerCollections` in `src/core/passes/kernel-lower.ts` lowers a loop that adds to a collection
  into pushed records, one for each `add` or `set` in the order of a sequential run. The call sizes
  the records from the trip count and the most records one iteration pushes (`perIteration`). An
  add in a nested loop of a runtime bound has no such count, so the function runs on the CPU tier.
- `applyRecords` in `src/core/host-kernel.ts` reads the records back and applies them to the
  caller's `Map` or `Set`. A loop that reads a collection searches keys that `lookupTable` sorts
  and uploads from the host's collection.
- `checkCollection` refuses any value that is not a JavaScript `Map` or `Set`. So a `Resident`
  cannot hold a collection between calls.
- Change 0094's stage-1 and stage-2 deviations run on the CPU tier a function that takes a
  collection and stores after its loops, and a call that passes a held length to such a function.

**Inference.** So the host-applied form reads the collection back after every call that adds to
it, and uploads it before every call that reads it. A chain of calls over one table, which is what
TypeCV's TSDF and voxel passes are, pays a read and an upload for each call, or runs on the CPU
tier. TypeCV writes the table by hand to avoid both.

### The goal

**Inference.** A TypeScript author writes a `Set` or a `Map` for unique cells and a value per key.
Change 0080 gave that spelling its meaning and the host-applied form. This proposal keeps the
spelling and the meaning, and adds the one thing TypeCV's tables need: the collection stays on the
device. The author then declares what ECMAScript does not have, the capacity, at the one place that
needs it, the host. The TSDF table also becomes deterministic: its insertion order is the
sequential run's, where today its slot and block order follow the scheduling.

### Relation to accepted proposals

- **0078 (push, implemented).** Its count, scan and store compact the occupied slots when the host
  reads a collection. Its rule that a count passes the capacity is the model of the overflow
  (decision D4).
- **0080 (Map and Set, accepted).** This proposal adds the form that its decision 3 left open: a
  device-resident collection for a chain of calls on a device. It keeps 0080's spelling, meaning,
  key types, R3 and R4, and its host-applied form for a JavaScript collection. 0080's section 7
  draft proposed the hash table, the least and greatest iteration and the compaction; this
  proposal takes that draft for the resident form. 0080's decision 1 (the call sizes the table)
  stays for a JavaScript collection. For a resident one the host's capacity replaces it. Decision
  D1 says whether this record amends 0080 instead.
- **0081 (string keys and Record, implemented).** A key-type key is its id on the device, as it is
  in 0080's records. `read()` converts ids back to strings.
- **0085 (host calls without setup, accepted).** A resident collection has an owner, as a resident
  array does.
- **0094 (device-resident counts, accepted).** Its `Resident` held length is the model of the
  handle (decision D6). Its exclusion of a loop over a device range that adds to a collection
  closes for a resident collection, since the table does not depend on the trip count. Its stage
  deviations for a collection stay closed for a JavaScript collection.
- **0101 (record bindings, draft, PR #802).** A resident `Map`'s value may be a struct. Under 0101
  its host value in `read()` stays a JavaScript `Map` of objects; 0101 changes array host values
  only. The two do not overlap otherwise.

**Fact** (the front matter of every proposal at `b009cd8a`, and of PR #802). Accepted proposals
that are not implemented also declare these items: Rule 8.21 (0082, 0094, 0095), Rule 8.22 (0056,
0067, 0077, 0080, 0085, 0091, 0094, 0095), Rule 8.23 (0068, 0077, 0080, 0082, 0085, 0091, 0094),
Rule 11.8 (0051, 0054, 0065, 0067, 0077, 0080, 0085, 0092, 0094), Rule 11.13 (0051, 0066, 0067,
0068, 0077, 0080, 0085, 0094), §65 (0051, 0056, 0065, 0067, 0068, 0077, 0080, 0082, 0085, 0091,
0094, 0095), §71 (0051, 0056, 0066, 0067, 0068, 0077, 0080, 0085, 0094) and §74 (0076, 0080). The draft 0101 declares Rules 8.21 and 8.23 and §65. The
implementation that lands second rebases on the others' text.

### Alternatives considered

- **Keep the host-applied form.** Cost: none in the compiler. Every call that adds reads the records
  back, and every call that reads uploads the keys, so a chain pays a round trip per call. A nested
  add and a device range stay on the CPU tier. TypeCV keeps its 188 lines. Rejected as the answer
  for a chain; it stays the form for a JavaScript collection.
- **A sorted-key table built by 0078's scan, read by a binary search.** The adds push records, as
  today, and a device sort and compaction build a sorted key array that later calls search. Cost: a
  sort of every record on every call that adds, where a hash insert is one probe sequence; a key
  added twice is sorted twice. It needs no atomic table and has no overflow past the records'
  capacity. It is a valid implementation of the same meaning, which the implementation may choose
  under 0080's section 1; this proposal does not forbid it. Not taken as the draft's lowering.
- **Author-written open addressing with atomics, as today.** Cost: none in the compiler. The author
  writes the hash, the sentinel, the probe, the overflow and the host's growth loop, and the order
  follows the scheduling. Rejected: it is the form the audit counts.

## Unresolved decisions

Each decision has alternatives, their cost and a recommendation, for the owner. D1, D2, D3 and D4
must be decided before acceptance. D5, D6 and D7 may stay open, bounded by the recommendation.

**D1. The framing: a proposal of its own, or an amendment of change 0080.**

- (a) A proposal of its own, `changes/0102-device-map-set.md`, as this document is. Cost: two
  records describe Map and Set; §74 cites both. 0080 stays `accepted` and its implementation goes on
  under `Change: 0080`; this one is implemented under `Change: 0102`. Downstream repositories record
  0102 as its own id.
- (b) An amendment of 0080 (its decision 3 reopened). What it changes: this text goes into
  `changes/0080-kernel-map-set.md` as Amendment 2, with the front matter widened by the exports
  `resident` and `Device` and the example `kernel-device-map`; number 0102 is not used; 0080's
  status stays `accepted` and the amendment needs the owner's acceptance in its own pull request;
  the implementing commits say `Change: 0080`; a downstream pin that has recorded 0080 already
  records nothing new, so `scripts/downstream-impact.ts` does not stop a pin for the new form.
  Cost: one record grows by half, and a downstream repository that pinned 0080's first form is
  not told about the second.

Recommendation: (a). The resident form adds exports, an example and a host contract that 0080's
downstream records did not name, and a separate id makes each downstream pin record it.

**D2. The spelling of the capacity.**

- (a) `resident(new Map<number, V>(), { capacity })`, and `dev.array(new Map<number, V>(), {
capacity })` for a device's owner. The value is an ECMAScript `Map`; the option is TypeShade's.
  Cost: a second argument on two exports (`resident`, `Device`), and a `Resident<Map>` whose
  `read()` returns a `Map`.
- (b) `dev.map<V>(capacity)` and `dev.set(capacity)`, new members of `Device`, and a default-owner
  form beside `resident`. Cost: new names that no ECMAScript source has, and the type arguments
  restate the parameter's. 0080's "Alternatives" named this form and did not take it for the
  host-applied case.
- (c) `new Map()` with a capacity option. ECMAScript's `Map` constructor takes one argument, an
  iterable, so `new Map(entries, { capacity })` is not ECMAScript, and TypeScript's own `lib`
  types refuse the second argument. A subclass would be a new export. Rejected.
- (d) The capacity on the kernel parameter, as a type argument. Cost: a name in the `"use
typeshade"` source that neither WGSL nor ECMAScript spells, which needs a row of
  `docs/language-design.md` §9.3 (Rules 9.6 and 13.6), and the capacity is a runtime value of the
  host, not a constant of the shader.

**Inference.** Rule 2.1 governs the names that a `"use typeshade"` program writes. Under (a), (b)
and (c) the capacity is written in host code, which the package's exports govern
(`src/__api__/surface.md`), so no §9.3 row is needed. Only (d) puts a new name in the kernel
source. Recommendation: (a). It keeps the ECMAScript value and reuses the handle that a resident
array already is.

**D3. A key of three cell coordinates.**

- (a) A `u32` key that the author packs, as TypeCV's `blockKey` does for the TSDF. Cost: the author
  bounds each coordinate (10 bits each for three) or hashes them, and a hash may collide, which
  makes two cells one key. The meaning stays ECMAScript's.
- (b) A `vec3u` key that the compiler hashes and compares by value. Cost: ECMAScript compares an
  object key by identity, so a JavaScript `Map` keyed by `[x, y, z]` never finds a new array of the
  same numbers. The host view would need its own key form (a string or a packed number), and the
  oracle would no longer be JavaScript's `Map`. A rule beside Rule 2.1 would have to state the
  difference.
- (c) A tuple key, `Map<[u32, u32, u32], V>`. Cost: the same identity problem as (b), and a tuple
  type is not a WGSL type.

Recommendation: (a) in this proposal. The refusal of a vector or tuple key names the packed form.
(b) can come by its own proposal when a site needs more than 32 bits of key.

**D4. What `size` means after an overflow, and the retry contract.**

- (a) `size` is the distinct keys placed plus the inserts that found no slot. It is past the
  capacity exactly when the table overflowed. **Inference.** Each missing key fails at least once,
  so `size` is at least the number of distinct keys, and a retry with a capacity of `size` holds
  them all. The entries of an overflowed collection are unspecified: which keys WebGPU placed
  follows the scheduling. `read()` of an overflowed collection throws a `RangeError` that names the
  size and the capacity. A later call that reads it on the device runs, and its result is
  unspecified; the determinism report says so. The host checks `size` (4 bytes) where it would
  have checked TypeCV's overflow word, and retries.
- (b) An overflowed collection makes every later call that takes it throw before it runs. Cost: a
  read of the overflow word before each such call, which is the round trip the proposal removes.
- (c) The exact count of distinct keys. Cost: the keys that found no slot would need a second
  structure to deduplicate, which has its own capacity.

Recommendation: (a). It matches change 0078's count past the capacity and TypeCV's growth loop, and
the retry is sufficient in one step.

**D5. Iteration order and `for…of` over a resident collection.**

- (a) Refuse iteration inside a kernel function, as §74 does. The host's `read()` gives the
  insertion order. Cost: a device-side pass over the keys needs the host. **Inference.** The TSDF
  host already reads its table for the growth loop, so it can take the keys in insertion order from
  `read()`, upload them as an array, and number the blocks with a later kernel loop
  `rank.set(keys[j], j)` over a second resident `Map`.
- (b) A candidate `for…of` over a resident collection, in insertion order. The call compacts the
  table first, with 0078's scan, on the device. Cost: a compaction per call that iterates, a new
  candidate-loop form in Rule 8.22, and its trip count is a device count (change 0094, part 1).
- (c) Iteration in slot order. Cost: the order follows the capacity and the scheduling, which change
  0080 refused as a default.

Recommendation: (a) in this proposal. (b) is the natural next step and needs 0094's device ranges
implemented first.

**D6. Where the table lives, and how a later call binds it.**

- (a) In the handle, as a resident array's buffer lives in its `Resident`: one storage buffer of
  `array<atomic<u32>>` for the slots, the count and the overflow, and one for a `Map`'s values at
  their stride. A later call binds the same buffers. `destroy()` frees both. A device's pool
  (`dev.release`) does not take a collection in this proposal.
- (b) A `Resident<Uint32Array>` of the slots that the author makes and passes, as 0094's held
  length is. Cost: the layout becomes the author's contract and cannot change between versions.

Recommendation: (a).

**D7. The order of an add in a nested loop of a runtime bound.**

The order of an add is the pair (iteration, rank in the iteration). With no count `R` of the adds
of an iteration (part 3), the pair does not fit one word by a product.

- (a) Two words and two passes: the first pass takes `atomicMin` of the iteration; the settle pass
  (part 3, the value) takes `atomicMin` of the rank among the adds of the winning iteration. Cost:
  the settle pass runs for a `Set` too when an add is nested.
- (b) A bound from the host: the handle's options take the most adds of one iteration. Cost: one more
  number the author states, and a call past it overflows.
- (c) Order the keys of a nested add by key value. Cost: the order is not ECMAScript's; rejected.

Recommendation: (a). It keeps the sequential meaning with no new option.

## What it touches

- **Rule 8.21.** A kernel function's `Map` or `Set` parameter also takes a resident collection,
  with its capacity and its checks.
- **Rule 8.22.** An `add` or a `set` in a nested loop of a runtime bound lowers when the collection
  is resident; R3 and R4 do not change.
- **Rule 8.23.** A resident collection is the caller's, passed by reference; its capacity is the
  host's, and its `size` passes the capacity on overflow.
- **Rule 11.8.** The WebGPU table and the WebGL2 reason for a resident collection; the CPU tier's
  overflow.
- **Rule 11.13.** The plan reads a resident collection as a read or a read and a write.
- **Surface §65.** "Resident arrays" gains the resident collection, and the list of host values the
  collection form.
- **Surface §71.** The F1 reason for a call that adds to a collection names the resident case, and
  the plan's reads gain the collection.
- **Surface §74.** The host contract, the capacity, the overflow and the retry, and "The tiers" for a
  resident collection.
- **Exports `resident` and `Device`.** Under D2 (a) each gains the overload that takes a `Map` or a
  `Set` and `{ capacity }`. Under D2 (b) `Device` gains `map` and `set`, and `resident` a form of its
  own.
- **Example `kernel-device-map` (new).** A function that adds to a resident `Set` and one that reads
  it, called in a chain, through the compile gate and a packed journey.
- **Host view types.** `src/compiler/ts/host-face.ts`: a `Map` or `Set` parameter is typed as
  today's collection or its `Resident`.
- **Code.** `src/core/resident.ts`, `src/runtime/device.ts`, `src/core/host-kernel.ts`
  (`checkCollection` and the resident path), `src/core/passes/kernel-lower.ts` (the table lowering
  beside `lowerCollections`), `src/core/cpu-runtime.ts` and `src/core/cpu-codegen.ts` (the capacity
  and the overflow on the CPU tier), `src/core/fuse-group.ts` and `src/core/fuse-plan.ts`.
- **Not touched.** No diagnostic code: the refusals are `TypeError`s and `RangeError`s of the host,
  and the kernel's refusals are §74's (`TS8002`, `TS8003`, `TS8070`, `TS8099`). No rule of §2 or §9:
  the kernel source has no new name. The export `ShaderType` keeps change 0080's `collection` kind.
- **If D3 is (b) or D5 is (b).** A rule beside Rule 2.1 or a new candidate-loop form of Rule 8.22,
  and a new surface section, join the front matter before acceptance.

### Draft impact estimate

**Known.** The change is additive. A call that passes a JavaScript `Map` or `Set` runs as today,
with the same WGSL. A program that compiles today keeps its meaning. A new WGSL text is emitted
only for a call with a resident collection.

**Estimate.** The lowering is the larger part: the table, the insert, the probe, the two order
words, the settle pass, the compaction for `read()`, and the reserved word's extra slot. The host
part is the handle, its checks, its `read()` and its owner. The validation is as large: both
halves, the differential against JavaScript's `Map`, colliding and reserved keys, overflow and
retry, a nested add, and a chain. Duration and cost are unestimated.

**TypeCV.** Up to 188 code lines by the audit's count (**Inference**: an upper bound, since the
TSDF block numbering and the k-NN bucket ranges may keep part of their code under D5 (a)).

**Required validation** (requirements, not results; the gates of `AGENTS.md`):

1. Both halves on the same source: `compile()` and the language service's `getDiagnostics`, and
   `getHover` on the host view of a resident collection, on the shape of
   `src/language-service/ambient-parity.test.ts`.
2. The host's refusals with their sentences: a wrong kind, a key or a value of the wrong type, more
   entries than the capacity, a destroyed handle, another owner.
3. The differential against JavaScript's `Map` and `Set` (`scripts/gpu-differential.ts`) on
   WebGPU and the CPU tier, bit for bit and in insertion order: duplicate keys, colliding keys,
   the key `0xffffffff` and the `i32` key `-1`, `NaN` and `-0` keys, a `Map`'s last value, an add in
   a nested loop, a loop over a device range, and a chain of three calls with no read.
4. Overflow: `size` past the capacity on both tiers, `read()`'s `RangeError`, and a retry with a
   capacity of `size` that holds every key.
5. WebGL2: the reason, and the fall to the CPU tier.
6. A `fuse` scope with a call that adds between two array calls, held to the calls apart.
7. The compile gate (Tint and WebGL2) for the new example, and a packed journey that runs it on
   WebGPU.
8. The API-surface bake shows the declared exports and no other.
9. The documentation checks: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
   `python scripts/doorstop-check.py -C` after the rules change.

**Decisions before acceptance:** D1, D2, D3 and D4. D5, D6 and D7 may stay open.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision with its date and the
merge of the proposal-only pull request with `status: accepted`, the approved revision, the
decisions D1 to D4, the finalized declarations, and the required validation above. No implementer,
milestone, duration or cost is assigned.

### Configuration and validation record

This record does not yet apply. Delivery will require the accepted revision, the implementing
commits and pull requests with `Change: 0102`, the delivered configuration, and the observed
results of the required validation, functional and document checks kept apart. Compiler status
`implemented` will not establish downstream completion.

## What it owes downstream

Expected work, not yet agreed:

- **typeshade.github.io.** The Map and Set page gains the resident collection, its capacity, its
  overflow and its retry; the kernel-function page's resident values gain it; the `fuse` page's
  group reason names it; the `kernel-device-map` example is shown. In both locales. The proposal id
  goes into its `compiler-changes.md` when the pin moves.
- **vscode-typeshade.** The skill's Map and Set reference gains the host contract of a resident
  collection, and any fixture that quotes the host view of a collection parameter accepts the
  `Resident`. The proposal id goes into its `compiler-changes.md` when the pin moves.
- **typecv.** Phase 10 of `docs/library-structure.md` converts the voxel table, the TSDF block table
  (its claim, its lookup and its growth loop, which becomes a retry on `size`), the k-NN grid and
  the mesh grid, each held to its current output. The CPU reference's `Map<string, number>` stays.
  The proposal id goes into its `compiler-changes.md` when the pin moves.
