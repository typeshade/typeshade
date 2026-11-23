---
id: '0144'
title: An array whose length is known only when the call runs gets its storage from one memory the compiler owns, the arena, which WebGPU and WebAssembly hold in the same layout
status: draft
rules:
  - '1.5'
  - '6.8'
  - '8.21'
  - '8.23'
  - '11.8'
  - '11.10'
  - '11.11'
  - '11.13'
  - '11.25'
surface:
  - 64
  - 65
  - 67
  - 69
  - 71
exports:
  - Pack
  - Reflection
exports-removed: []
codes: []
examples: []
names: []
downstream:
  - repo: typeshade.github.io
    what: The host-call, kernel-function, fuse and runtime pages (en and ko) say where a call's scratch and a made array live (the arena), that a call which runs out of it runs again, runs on the CPU tier or throws a RangeError that names the bound, and that a push over a range the device holds compiles once stage A3 lands; the manifest page names the arena record; compiler-changes.md records 0144
  - repo: vscode-typeshade
    what: The skill's references for host calls and the manifest name the arena record and the running-out behaviour, and drop the refusal of a push over a device-held range once stage A3 lands; compiler-changes.md records 0144
---

**Document control**

| Field                         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0144, status `draft`. It is plan unit S3 of `docs/typeshade-plan.md`, "the memory and thread contract", with one stage for each of the plan units A1, A2 and A3. That split departs from proposal 0100, decision D4 (deviation DV1, question Q5).                                                                                                                                                                                                                                                                                                 |
| Date and attribution          | 2026-11-23, UTC (the container's clock). The date is the drafting date. An AI agent session (Claude Code) drafted the text at the request of the session that works for the repository owner. An independent agent review read it at `c722574d` on 2026-11-23, and the same day's revision answers it (Independent review record). The owner has not approved it.                                                                                                                                                                                          |
| Applicability / Effectivity   | The call layer (`src/core/host-kernel.ts`, `src/core/host-entry.ts`, `src/core/resident.ts`), the kernel lowering (`src/core/passes/kernel-lower.ts`, `src/core/passes/kernel-lower-ir.ts`), the reflection and the manifest (`src/core/reflect.ts`, `src/core/manifest-types.ts`, `src/core/manifest.ts`), the program runtime (`src/runtime/program.ts`, `src/runtime/runtime.ts`), the region (`src/runtime/region.ts`), and the WebAssembly tier of proposal 0042 when it exists. No release version is assigned. TypeShade has no release yet (OD-6). |
| Review baseline               | `origin/main` at `4f789240` (merge of #1398, "Order the run-time heap in the plan after OD-10").                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Review and revision authority | PR #1400 (draft) carries this proposal. Git records the revisions of this file. The review and merge records of the proposal-only pull request will record the decisions.                                                                                                                                                                                                                                                                                                                                                                                  |

## What changes

The labels in brackets keep facts, inferences, proposals and decisions apart.

### Terms

| Term        | Meaning in this proposal                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region      | The one global memory region of proposal 0138, R17 and Amendment A4 (`src/runtime/region.ts`). It holds the host's copy of every resource. It is a host-side memory. |
| Arena       | The memory the compiler owns for one device owner (Rule 11.8) on one target. Plan unit A1.                                                                           |
| Header      | The first 256 bytes of the arena. They hold the words that the allocation reads and writes. C3 gives their layout.                                                   |
| View        | A binding of the module over the arena's one buffer, typed for its use: plain words or atomic words (C3).                                                            |
| Call region | A part of the arena that a call reserves before it runs, from a size the call knows (plan unit A2).                                                                  |
| Run region  | A part of the arena that the running code reserves, from a size known only on the device (plan unit A3).                                                             |
| Offset      | A `u32` byte offset from the start of the arena.                                                                                                                     |
| Running out | A run region that does not fit in the arena that the call bound.                                                                                                     |
| Bound       | The largest arena a target can hold. Section 2, C8, gives it for each target.                                                                                        |

### 1. Today

- [fact] Each scratch array of a kernel call is a buffer of its own, which the call creates and
  destroys. `src/core/host-kernel.ts` calls `zeroedBuffer` at six places for the `n + 1` counts of
  a loop that pushes (change 0078), the records of a `Map` or `Set` that a loop adds to (change
  0080), the partials of a reduction, the slots that a finish entry binds and does not read, and
  others. `src/core/host-entry.ts` and `src/core/resident.ts` create more.
- [fact] Each such buffer is one storage binding of the lowered module
  (`src/core/passes/kernel-lower-ir.ts`, the `push` field: "the storage binding that holds them,
  `n + 1` `u32`s").
- [assumption] WebGPU's default `maxStorageBuffersPerShaderStage` is 8, and its default
  `maxStorageBufferBindingSize` is 128 MiB. This is general knowledge of the WebGPU
  specification. This proposal did not verify it.
- [fact] A loop whose range the device holds writes its start, its trip count and its workgroup
  counts into a trip buffer that the call creates (change 0094). The call then dispatches the
  loop's entries with `dispatchWorkgroupsIndirect` from that buffer (`src/core/host-kernel.ts`,
  `trips`). `zeroedBuffer` gives it `RESIDENT_USAGE`, which includes `INDIRECT`
  (`src/core/host-entry.ts`).
- [fact] A write past an array's end in a loop over a device range is dropped on every tier
  (0094, decision D2). The WebGPU entry guards the write with `arrayLength` of the array's own
  binding (0094, section 1). 0114 states the same and does not rely on WGSL's robust access
  (0114, "Costs of the owner's decisions").
- [fact] The WebGL2 compute path holds each memory root as an `R32UI` texture array of `std430`
  words (`src/core/gl-compute.ts`, `PackGlCompute` in `src/core/manifest-types.ts`). One vertex
  is one invocation. Transform feedback captures its record: its state, its write log and its
  request. A scatter draw then writes the log into the textures, and the last invocation wins.
  The host performs each atomic request in invocation index order on memory it reads back, and
  it holds a barrier between passes. The kernel lowering refuses a `Map` or `Set` on WebGL2
  (`src/core/passes/kernel-lower-gl.ts`, change 0080).
- [fact] Proposal 0114, Amendment A1, gives a made array (`new Float32Array(n)`) a binding of its
  own for each call. The owner decided that this storage moves to a region of the arena when A1
  and A2 exist (0114, Amendment A1, "The owner's decisions").
- [fact] The region of 0138 is one `ArrayBuffer` in the tree today. No `WebAssembly.Memory`
  exists in `src/` outside the comments of `src/runtime/region.ts`. Proposal 0042 (accepted)
  makes the region the WebAssembly tier's linear memory (its section "Memory: the region is the
  module's linear memory"). Its stage 1 runs on the calling thread (0042, decision C2). Workers
  and a shared memory are plan unit W2.
- [observed, 2026-11-23, `compile()` at a tree equal to `4f789240`] These forms are refused:
  - A push in a loop whose bound reads an element:
    `TS8099 "for (let i: u32 = 0; i < n[0]; i++)" pushes onto "out", and its start or bound reads a value the call does not know before it runs. … any other operand is not supported yet.`
  - A push in a `while`:
    `TS8099 "path.push(at)" pushes onto "path" inside "while (at !== 0)", which is no for loop at the top level of "walk", and that is not supported yet. …`
  - A made array in a helper:
    `TS8099 This function makes and returns array<f32>, an array whose length the call gives. Only an exported kernel function makes such an array; in a helper or an entry it is not supported yet.`
  - `return xs.filter(p)`: `TS8020 … A result that holds an array with no size is not supported yet. …`
- [observed, 2026-11-23, `c722574d`, Bun 1.4.4] `bothHalves` (`src/core/testing/both-halves.ts`)
  read section 3's example with both bounds. With `i < n[0]`, `compile()` and the language
  service give the same `TS8099` text. With `i < score.length`, neither gives a diagnostic.

### 2. The contract

[proposal] Eleven clauses, C1 to C11, make one memory contract. WebGPU and WebAssembly take it
whole. The JavaScript CPU tier follows it on one thread. WebGL2 follows the clauses that its
table below names, and it refuses run regions (C8). A new rule in section 11 of
`docs/language-design.md` (numbered 11.25 at implementation) holds the clauses. Rule 1.5's
rationale points to unit S3 today, and it points to the new rule after this change.

**C1. One arena for each device owner and target.**

- WebGPU: one `GPUBuffer` with the usages `STORAGE`, `COPY_SRC` and `COPY_DST`, on the owner's
  device. It has no `INDIRECT` usage.
- The indirect arguments of a dispatch stay outside the arena. [assumption] WebGPU's validation
  refuses a buffer that one dispatch uses both as its indirect arguments and as a writable
  storage binding. This is general knowledge of WebGPU's usage scope rules, not verified here.
  [fact] The arena is writable in every dispatch that reserves from it. [proposal] So the trip
  words of change 0094 stay in their own small buffer with `INDIRECT`, as
  `src/core/host-kernel.ts` makes it today. A later stage may keep that buffer for the owner.
- WebAssembly and the JavaScript CPU tier: one range of the region of 0138 (R17). The region is
  one for the page (0138, Amendment A4). So the CPU tiers of all owners share it, and each owner
  has its own range.
- WebGL2: one memory root in the layout the WebGL2 pass program already uses for a storage
  array (`PackGlCompute`, `src/core/manifest-types.ts`). The program reads it as a texture. Its
  writes go through the write log of the transform feedback record and the scatter draw.
- The author writes nothing for it (OD-3, OD-10). The host calls no function for it. The call
  sizes it and binds it.

**C2. One layout, and each region checks its own length.** An offset is a byte offset from the
start of the arena. A region starts at a multiple of 16 bytes, the alignment of `RANGE_ALIGN` in
`src/runtime/region.ts`. A value in the arena has the `std430` layout of Rule 6.8. So the arena
holds the same bytes on every target. A move between a GPU arena and a CPU arena is then a copy
with no conversion. Plan units R5 and W9 depend on this. [inference] This is the reason for one
layout. 0042 measured that the copy of a call's data costs as much as its loop (#459, M2, as 0042
cites it).

[proposal] Inside one arena, `arrayLength` gives the arena's length, not a region's. So the
compiled code checks every access of a region against that region's own length:

1. The length of a region in the fixed part is a constant of the module.
2. The length of a call region comes from the call's host values, which the call passes in its
   uniform.
3. The length of a run region is the size its reservation gave.
4. A write past a region's end is dropped. So 0094's decision D2 and 0114's drop hold inside the
   arena, and no write reaches another region.
5. A read past a region's end stays inside that region, and it gives what the target gives today
   for the array's own binding.

Cost: one comparison for each access of a region, and one length word for each call region.

**C3. The header and the views.** The first 256 bytes of the arena are the header. [assumption]
256 is WebGPU's default `minStorageBufferOffsetAlignment`. This is general knowledge, not
verified here. The header holds these `u32` words:

| Word | Content                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------- |
| 0    | The next free offset (the bump word). Before the run it holds the end of the call regions.     |
| 1    | The overflow flag: 0, or 1 once an allocation did not fit.                                     |
| 2    | The bytes needed: the code adds each allocation's size to it, fitted or not.                   |
| 3    | The wrap flag: 1 once word 2 passed 2³² − 1. Then the bytes needed are past every bound of C8. |
| 4–63 | Zero. Later stages may use them. A host that binds the arena by hand writes zeros there (Q1).  |

A target with threads changes the header with atomic operations: WGSL `atomicAdd` on an
`atomic<u32>`, and WebAssembly `i32.atomic.rmw.add` on a shared memory. A target with one thread
changes it with plain loads and stores.

[proposal] On WebGPU the module sees the arena's one buffer through views:

- `array<u32>`, the plain view, for every region's plain data;
- `array<atomic<u32>>`, the atomic view, for the header and for each region the compiler makes
  atomic (C6);
- `array<atomic<i32>>`, only in a module that has an atomic `i32` region.

The views cover the whole buffer and overlap. C6 keeps each word to one view between two
synchronization points. [inference] WebGPU accepts writable storage bindings of one buffer that
overlap in one dispatch. The compile gate and a device test verify this in stage A1. If WebGPU
refuses it, the atomic regions take a second arena binding (question Q4).

**C4. Three kinds of region.**

- The fixed part: what the compiler sizes from the program alone, for example a frame of each
  invocation with a size the compiler computes. It starts after the header.
- Call regions (A2): what the call sizes from host values before the dispatch. Examples: the
  `n + 1` counts of a push over a loop of `n` iterations, the partials of a reduction, the `n`
  elements of a made array (0114, Amendment A1), the result of `filter`, at most the length of
  its input. A loop of 0094 with a cap `min(d, c)` sizes its scratch for `c` in a call region.
- Run regions (A3): what the running code sizes. It reserves them from the bump word. Example:
  the elements of a push over a loop whose trip count the device holds (change 0094), with no
  cap. Stage A3 makes the cap of 0094's decision D6 unnecessary. OD-3 makes it removable, since
  the author writes the cap only for the compiler's sake.

**C5. One call is one lifetime.** Every region lives for one call. For a fuse plan (Rule 11.13)
or a graph of 0138, every region lives for one submission. No code frees a region inside a call.
When the call ends, the whole arena is free again. A result leaves the arena by a copy: into the
caller's array for a call with plain data, or into a new `Buffer` for a call on a resource (0114,
Amendment A1, items 6 and 7). [inference] Since nothing is freed inside a call, the bytes needed
are a sum that does not depend on the order of the allocations.

**C6. The thread contract.** The contract is the weaker of the two memory models, WGSL's:

1. Atomic words are the header's words and the words of an atomic region. Their atomics are
   relaxed. An atomic region is a call region or a run region that the compiler marks atomic.
   Example: the hash table of change 0080, which uses `atomicCompareExchangeWeak`, `atomicMin`
   and `atomicMax` (0080, section 7).
2. An atomic word is read and written only through the atomic view between two
   synchronization points.
3. A plain data word has one writer between two synchronization points. The compiler holds this.
4. A synchronization point is a dispatch boundary on WebGPU, the join of the workers on
   WebAssembly, or a barrier inside one workgroup.
5. An invocation reads a word that another invocation wrote only after a synchronization point.

**C7. Determinism.** The place of a run region may depend on the order in which invocations or
workers run. No observable answer depends on it (Rule 1.6, Rule 7.2):

- An offset is not observable. The program cannot read it, and the host never sees it.
- An ordered result keeps the order of a sequential run. A push keeps the count, scan and store
  of change 0078, and the scan, not the bump word, gives each element its index.
- After the overflow flag is set, each later loop of the call runs no iteration. On WebGPU its
  range entry or each invocation reads word 1 first. So the bytes needed count the allocations
  up to the loop that ran out, and no size is computed from a dropped write.
- So whether a call runs out, and its bytes needed, are the same on every run and for every
  count of threads, for one arena size. Cost: one read of word 1 for each later loop, or for
  each invocation of a loop whose range the host holds.

**C8. Running out (A3).** An allocation that does not fit sets the overflow flag, adds its size to
the bytes needed, and gives no region. The code drops each write into that missing region. The
call reads words 1 to 3 after the submission. When the flag is set, C11 restores the call's
writable arguments first. Then the call does this:

1. It grows the arena to the bytes needed and runs the call again once on the same tier, if the
   bytes needed are within the bound (question Q2). The second run can run out too, at a later
   loop than the first (C7). Then step 2 applies.
2. Otherwise, a kernel call (Rule 8.21) runs on the next tier of its owner's list, the CPU tier
   last, and says why, as Rule 1.5 and Rule 11.8 give it.
3. Otherwise, a call with no tier left (an entry or a draw under `createRuntime`, or a list of one
   tier) throws a `RangeError`. It names the function, the bytes needed and the bound, in the
   form `src/runtime/program.ts` uses today: "this device makes at most N bytes in one buffer
   (maxBufferSize)".

The bound of each target:

| Target              | Bound                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU              | The smaller of the device's `maxStorageBufferBindingSize` and `maxBufferSize`, for each arena binding (question Q4).               |
| WebAssembly         | The region's maximum: at most 4 GiB (0042, N4). From W2, a shared memory declares its maximum when it is made (W2's own proposal). |
| JavaScript CPU tier | What the region's `ArrayBuffer` can hold.                                                                                          |
| WebGL2              | No run region. A call that needs one skips WebGL2 and says why (Rule 11.8).                                                        |

**The cost of reading the flag.** [fact] Today a device-resident call of 0094 reads nothing back
(0094, section 1, "Nothing is read back"). A call on a resource and a graph of 0138 return a
resource at once and submit later (0138, R2). [proposal] Only a function that has a run region
reads the flag:

- A call with plain data reads words 1 to 3 in the same `mapAsync` as its results. [inference]
  That adds 16 bytes to a read the call makes anyway.
- A call on a resource, a device-resident call of 0094 and a graph add one read of words 1 to 3
  after their submission. The returned resource is ready only when that read shows no overflow.
- A fuse plan or a graph is one unit for C8 and C11. When one node runs out, the whole
  submission is restored and runs again once with a larger arena. Otherwise it runs on the next
  tier, by the path Rule 11.13 gives a plan that its tier cannot run. Otherwise the `RangeError`
  names the node's function. [assumption] That path of Rule 11.13 serves this case. Stage A3
  confirms it.
- On a non-blocking path the `RangeError` surfaces at the next `read()`, `show` or call, as 0138's
  R2 states for a failed non-blocking call. It names the line of the failed call.

Cost: one round trip for each submission that holds a run region, which 0094 avoided. A function
with no run region pays nothing.

**WebGL2.** [proposal] WebGL2 follows these clauses:

| Clause | WebGL2                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1     | One memory root, read as a texture and written through the write log and the scatter draw.                                                                                                                                            |
| C2     | The same `std430` words, in the `PackGlCompute` layout, and the check of each region's own length.                                                                                                                                    |
| C3     | No header word is read or written, since no run region exists. An atomic on the bump word would be a host round trip for each pass.                                                                                                   |
| C4     | The fixed part and call regions only.                                                                                                                                                                                                 |
| C5     | Yes.                                                                                                                                                                                                                                  |
| C6     | In its own stronger form: atomics in invocation index order on the host, a barrier as a hold between passes, and the last write wins. A kernel function that needs an atomic region skips WebGL2, as 0080's `Map` and `Set` do today. |
| C7     | Yes, for the regions it has.                                                                                                                                                                                                          |
| C8     | No run region. The function skips WebGL2 and says why.                                                                                                                                                                                |
| C9     | Yes.                                                                                                                                                                                                                                  |
| C10    | No reference.                                                                                                                                                                                                                         |
| C11    | Yes. A call that skips WebGL2 has written nothing.                                                                                                                                                                                    |

**C9. What the host sees.** `reflect()` and the manifest show the arena as one binding that the
compiler adds (`injected`, as the `_fp64` guard is today in `src/core/manifest.ts`). Its record
holds the fixed bytes, the host values that size each call region, and the header words of C3.
They show no layout of the regions (question Q1). The host sets no size: no option of
`configure` or `createRuntime` changes the arena (OD-3).

**C10. The hook for references (A4).** [proposal] An offset is a `u32` from the start of the
arena. Offset 0 is in the header, so no region starts at 0, and A4 may use 0 as `null`. A value
that holds an offset lives no longer than the call (C5). A reference that outlives a call, and how
the region of 0138 holds one between calls, are left to A4. This proposal does not design A4.

**C11. No write survives a call that runs out.** [proposal] Before each of the three outcomes of
C8, every array and resource that the call can write holds the values it held before the call.
This keeps OD-5 (a second run does not apply a write twice) and OD-9 (the same values the host
sees):

1. A call with plain data writes the caller's array only when it copies the results back (Rules
   8.21 and 8.23). [inference] So its restore is a new upload from the caller's unchanged array.
   Stage A3 verifies this against `src/core/host-kernel.ts`.
2. A call that writes a resource in place (a `Buffer` of 0138) copies each such resource before
   its first run. On WebGPU that is a `copyBufferToBuffer`. It copies them back before the
   outcome.
3. The compiler may skip the copy of an array where it proves the first run's writes harmless:
   the function writes the array only by plain assignment, never reads it, and the next outcome
   writes every element the first run wrote.
4. Only a function that has a run region pays this. A function with call regions only cannot run
   out.

Cost: a copy of each resource such a function writes, on every call, also a call that fits, and
the device memory to hold it. A read-modify-write (`a[i] += x`, a scatter) never takes the
proof of step 3. M4 measures it.

**The region of 0138 under threads, from plan unit W2 only.** [proposal] This paragraph states
what W2 must keep for this contract. It does not design W2, and it does not amend 0042: 0042's
decision C2 (stage 1 on the calling thread) stands, and workers and a shared memory are 0042's
"Stage 3, a later proposal". On one thread, 0042 already states that the runtime does not grow or
compact the region while a call holds a range of it. When W2 brings workers, C6 needs the same
rule for every worker. How W2 makes its shared memory, and the maximum it declares, are W2's
proposal (open question N4). [fact] The owner decided that 0042's stage 1 runs on the calling
thread (0042, decision C2), and that threads are the default as far as the host allows (0100,
decision D5). The contract serves both: on one thread the header uses plain loads and stores.

### 3. What an author can write

[proposal] An author's code does not change. Only what compiles changes. The example is the form
that 0114, Amendment A6, item 5, keeps for "the heap OD-10 names".

```ts
export function survivors(n: u32[], score: f32[], t: f32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n[0]; i++) {
    if (score[i] > t) {
      out.push(i);
    }
  }
  return out;
}

// host
const kept: Uint32Array = await survivors(count, scores, 0.5);
```

- Before (observed, section 1): `TS8099`, since the bound `n[0]` is known only on the device.
- After stage A3: no diagnostic. On WebGPU the range entry of change 0094 writes the trip count
  into its own `INDIRECT` buffer (C1). The count and the scan of change 0078 run over it in a run
  region. The scan reserves the total from the bump word, and the store writes the elements
  there. The call copies them into the result and reads the flag with them (C8). If the arena is
  too small, C8 applies. The function writes no caller array, so C11 copies nothing.
- The same source compiles today without `n[0]`, with `i < score.length`, since the call knows
  that bound (0114, stage S5d). That form needs no heap.

### 4. The stages

Each stage is one pull request, or more, and each leaves `main` green.

| Stage | Plan unit | Delivers                                                                                                                                                                                                                                                                                                                   | First user                                                                                                                                                                                                                                                                       | Verifies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Needs first |
| ----- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| A1    | A1        | C1 to C3 and C9 on WebGPU and the JavaScript CPU tier: one arena for each owner, its header, its views, the check of each region's own length (C2), its binding in `reflect()` and the manifest (Rules 6.8, 11.10), the call that sizes and binds it (Rule 8.21), and the runtime that binds it for an entry (Rule 11.11). | The scratch of today's kernel call moves into the arena: the counts of a push (0078), the records of a `Map` or `Set` (0080) in an atomic region, and the partials of a reduction. The trip words of 0094 stay in their own `INDIRECT` buffer (C1). No author's program changes. | `bun run test` green; the differential gate gives the same results; the compile gate passes on Tint, with the overlapping views of C3; a device test of the views; a test that a write past a region's end is dropped and leaves the next region unchanged (C2); the storage bindings of each lowered kernel, before and after (M2); the manifest goldens rebaked and reviewed; the bundle budget.                                                                                                                                                              | none        |
| A2    | A2        | C4's call regions and C5, for a kernel call, an entry, and a fuse plan or graph (Rule 11.13). The region of 0138 holds the CPU tiers' arena. A loop of 0094 with a cap sizes its scratch in a call region.                                                                                                                 | The made array of 0114, stage S5, moves from its own binding into a call region, "with no change to the program" (plan unit B8). B8b (0114) and G4 can then land under their own proposals.                                                                                      | The S5 tests unchanged; a test that two made arrays and the scratch of one call share one arena; a fuse plan with two nodes that each reserve a call region; the copy-out cost of a result (M3).                                                                                                                                                                                                                                                                                                                                                                | A1          |
| A3    | A3        | C4's run regions, C7, C8 and C11: the bump word, the overflow flag, the bytes needed, the restore, running again, the next tier and the `RangeError`. Rules 8.21, 8.23, 11.8, 11.11 and 11.13 say what the call does when it runs out. 0094's decision D6 is amended: a loop over a device range needs no cap.             | The form of 0114, Amendment A6, item 5: a push in a loop whose range the device holds (section 3), and a loop of 0094 that pushes over a device range with no cap (0094, decision D6), which runs on the CPU tier today. Rule 8.23 and surface §65 lose that refusal.            | `bothTake` (`src/core/testing/both-halves.ts`) on section 3's example: `compile()` and the language service give no diagnostic. A test that forces a small arena and sees the second run, the CPU tier and the `RangeError` with its text. A function that runs out after `a[i] += x` on a caller array gives the CPU tier's values (C11). A fuse plan with one node that runs out. The `RangeError` of a non-blocking call at the next `read()`. Results equal across runs (C7). The cost of a second run and of the restore (M4) and of the flag's read (M9). | A2          |

The order of the work follows `docs/typeshade-plan.md` (the owner, 2026-11-18): this proposal
comes first within area S; then area W; then A1, A2 and A3. Question Q3 asks how this agrees with
the plan's dependency of S3 on S2, and with W9, which needs A1 but comes in area W. On the
WebAssembly tier, each stage applies when the tier's calls exist (0042, stage 1f), and plan unit
W9 brings the arena into the shared memory.

**Deviation DV1.** [fact] Proposal 0100, decision D4, gives one proposal for each area, with a
stage for each unit. This proposal is unit S3 of area S, and it carries the stages of units A1 to
A3 of area A. Unit A4 of area A stays out (C10). Disposition: open, until the owner answers
question Q5.

### 5. Exclusions

- No author-facing name, spelling, rule of what an author writes, or diagnostic code.
- No host option that sets the arena's size (OD-3).
- No design of A4 beyond C10: no reference held in a field, no reference across calls.
- No free inside a call, and no garbage collection.
- The forms of plan units B8b, B9, G4, H1, I3, J2 and K2 land with their own units. This proposal
  gives them their storage.
- A push in a loop inside a loop (0114, Amendment A7, item 2) stays refused for its own reason.
- No change to plan units S1 and S2. The `Target` of S1 carries this contract as its memory when
  S1 lands.
- No design of plan unit W2. Section 2 states only what W2 must keep for this contract. 0042's
  decision C2 and its stage 3 stand.

## Why

**The owner's decision.** [fact] OD-10 says that where compile time cannot size an array, "the
compiler uses a heap it manages at run time". Plan units A1 to A3 are that heap, and units B8b,
B9, G4, H1, I3, J2 and K2 depend on them. The owner set on 2026-11-18 that S3 comes first, "so
that one design serves the run-time heap of OD-10 and the wasm memory of area W".

**One design for two memories.** [inference] The arena on WebGPU and the linear memory of
WebAssembly hold the same kind of data. With one layout (C2) and one allocation (C3, C4), the
compiler lowers a run region once for both targets, and the runtime moves an arena between them
with a copy (units R5, W9). With two designs, each later unit pays twice.

**Fewer bindings and fewer buffers.** [fact] A kernel call today creates a buffer for each scratch
array, for each call (section 1). [inference] One arena that the owner keeps uses two or three
views in place of one binding for each scratch array. It creates no buffer for a call that fits.
M1 and M2 measure both. [inference] A kernel with zero or one scratch array gains bindings, and
the whole call shares one binding's size. Question Q4 records both costs.

### Alternatives

- **A buffer for each dynamic array (today's way).** Each array is one more binding, against the
  default limit of 8. A size known only on the device needs a read back before the buffer exists.
  Not taken.
- **Always read the size back first.** The call runs a sizing pass, reads the size with
  `mapAsync`, then allocates and runs. It needs no overflow flag. It costs a round trip for every
  call, and it breaks a fuse plan's one submission. Not taken. C8 reads the flag after the one
  submission. A call with plain data reads it with its results. A call on a resource pays one
  round trip only when its function has a run region.
- **A general allocator with free lists.** It frees inside a call. The bytes needed then depend on
  the order of the threads, so running out would not be the same on every run (C7). Not taken.
- **A memory for each target, each in its own layout.** A move between targets then converts.
  0042 measured that a copy costs as much as the loop. Not taken.

### Assumptions

- [inference] WebGPU accepts the overlapping writable views of C3 over one buffer in one
  dispatch. The compile gate and a device test check it in A1. If it does not, atomic regions take
  a second arena binding (Q4).
- [assumption] WebGPU refuses one buffer as indirect arguments and as writable storage in one
  dispatch. C1 keeps the trip words out of the arena on that basis.
- [assumption] WebGPU's defaults: 8 storage buffers for each stage, 128 MiB for each storage
  binding, 256 bytes of storage offset alignment. Not verified in this proposal.
- [inference] A call with plain data writes the caller's array only when it copies the results
  back, so C11's restore is a new upload. Stage A3 verifies it.
- [inference] W2's proposal can make a shared `WebAssembly.Memory` with a large declared maximum.
  M7 measures it for W2.

## Owner's decisions

This proposal rests on these entries of `docs/owner-decisions.md` and reverses none.

| Entry | What this proposal takes from it                                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-3  | The arena, its size and its growth are the compiler's and the runtime's work. No author construct and no host option (C1, C9, Q4). The cap `min(d, c)` of 0094's decision D6 is written for the compiler's sake, so stage A3 makes it unnecessary (C4).                                                                   |
| OD-4  | Section 3 shows one example before and after. Questions Q1 to Q5 show the options and their costs.                                                                                                                                                                                                                        |
| OD-5  | A function that writes its parameter changes the caller's object. A second run (C8) must not change it twice, so C11 restores what the call can write.                                                                                                                                                                    |
| OD-6  | No release exists, so the reshape of `Pack` and `Reflection` owes no warning release.                                                                                                                                                                                                                                     |
| OD-9  | The arena need not match the source one to one. A made array, a scratch array and a result may share one buffer (C4). The 2026-11-17 addition allows a pointer or an offset in the emit (C10). Its bound, "the same values the host sees", makes C11 restore the first run's writes before a tier fall or a `RangeError`. |
| OD-10 | The arrays compile time cannot size get their storage from this heap (section 3). Compile time decides first where it can (C4's fixed part and call regions).                                                                                                                                                             |

It also follows these accepted decisions: proposal 0100, D5 (area S first, then W; threads as far
as the host allows); proposal 0042, decision M (the region is the linear memory) and C2 (stage 1
on the calling thread), which section 2 does not amend; proposal 0138, Amendment A4 (one global
region) and R2 (a call on a resource does not block); proposal 0114, Amendment A1 (the storage
moves to the arena when A1 and A2 exist); proposal 0094, decision D2 (a write past an array's end
is dropped), which C2 keeps inside the arena.

It changes these accepted decisions, and it says so:

- Proposal 0094, decision D6. A loop that pushes or reduces over a device range needs a cap
  `min(d, c)` today, or it runs on the CPU tier. Stage A3 removes that need with run regions. A
  loop that has a cap keeps it and sizes its scratch in a call region (C4).
- Proposal 0094, section 1, "Nothing is read back". A loop of 0094 with a run region reads the
  flag after its submission (C8).
- Proposal 0100, decision D4 (one proposal for each area, a stage for each unit). Deviation DV1
  and question Q5.

## Questions for the owner

**Q1. How much of the arena do `reflect()` and the manifest show? (two rules point different
ways)**

- Rule 1.5 (`docs/language-design.md`): the representation is the compiler's and "may change
  between versions". OD-9 supports it.
- Rule 11.10 and Rule 6.8: the manifest carries "each binding … and a buffer's byte layout with
  every offset, size and stride", and `reflect()` agrees byte for byte. Plan unit A1 says the
  arena "appears in `reflect()` and the manifest".
- What each choice does to one host: a host that builds its bind groups from `reflect()` for the
  emitted WGSL.
  - (A) The arena is one binding. Its record holds the fixed bytes, the host values that size each
    call region, and the header words of C3. Word 0 holds the end of the call regions before the
    run, which the record's sizes give. Words 1 to 63 hold zero before the run. Word 1 is the
    overflow flag, word 2 the bytes needed and word 3 the wrap flag. The regions have no layout in
    the record. The host binds one buffer of the size the record gives and writes the header.
    After the run it reads words 1 to 3. It cannot size a run region beforehand. So when the flag is
    set, it restores its own arrays (C11), grows the buffer to word 2 and runs again, or it gives
    up. A later compiler may place regions differently, and the host does not change.
  - (B) Each region shows its offset, size and type. A host can read a scratch array. A change of
    placement then changes the manifest, and the host may depend on it.
- Recommendation: (A). It rests on OD-3 and OD-9, and on Rule 1.5. Rule 11.10 gains a sentence
  that the arena's content is the compiler's, and that its header words are stable. Cost: a host
  cannot read the arena's content, and a host that binds by hand carries C8 and C11 itself for a
  function with a run region.

**Q2. When a call runs out, does it run again before it falls to the next tier?**

- Plan unit A3: "a flag the call reads, then the CPU tier for a host call, or a refusal that names
  the bound".
- OD-10: the compiler decides the room "at compile time where it can …: a capacity it computes
  from the program, a second pass, or another form with the same result".
- (A) Run again once with the arena grown to the bytes needed, then fall (C8, step 1). The second
  run can run out too: a later loop's range can read what an earlier loop wrote (0094, section 1),
  and C7 stops the count at the loop that ran out. Then the call falls to the next tier. It does
  not run a third time.
- (B) Fall to the next tier at once, as the plan's text says.
- Recommendation: (A). It rests on OD-3 and OD-10. The plan's row A3 is written again in the
  implementing pull request. Cost: a call that runs out runs twice on its tier, with C11's restore
  before the second run (M4). A call that runs out twice runs three times in all, the last on the
  next tier.

**Q3. The plan's table says S3 needs S2; the order the owner set says S3 comes first in area S.
(two parts of one document point different ways)**

- `docs/typeshade-plan.md`, the row of unit S3: "Needs S2". S2 needs S1. Neither has started.
- `docs/typeshade-plan.md`, Notes, the order of 2026-11-18: "within it S3, the memory and thread
  contract, comes first". The row of unit A1 needs nothing.
- Two more points of the same plan:
  - The row of unit W9 needs W2 and A1. The order puts area W before A1, so W9 cannot land inside
    area W.
  - The row of unit S3 names "the device's linear memory (R2)", and R2 gives "one
    `WebAssembly.Memory` per device owner". 0138's Amendment A4 overruled that: one global region
    (the owner, 2026-11-10, "전역 하나").
- (A) The order holds. This proposal is decided now. A1 to A3 are written against today's call
  layer (`src/core/host-kernel.ts`, `src/runtime/program.ts`), and S1 and S2 take the contract
  when they land. The row of S3 changes to "none" and names the region of 0138 (R17, Amendment
  A4) in place of R2. W9 moves after A1, out of area W's place in the order.
- (B) The table holds. This proposal waits for S1 and S2, and so does the heap of OD-10.
- Recommendation: (A). It rests on the owner's latest words on the order (2026-11-18), on OD-10,
  and on 0138's Amendment A4. Cost: S2 moves the arena's code once more when it unifies the
  runtime. W9's arena on the WebAssembly tier comes after A1, later than the rest of area W.

**Q4. How much room does one call get, and how many arena bindings?**

- [assumption] Today each scratch buffer and each made array gets its own binding, each up to
  `maxStorageBufferBindingSize` (128 MiB by default). One arena caps the whole call at one
  binding's size.
- [inference] Today a kernel with no scratch buffer binds none. With an arena it binds two or
  three views (C3). A kernel with one scratch buffer gains one or two. A kernel near the limit of
  8 storage bindings may then not compile on WebGPU.
- (A) One arena binding for every function, as C1 says. The bound is one binding's size.
- (B) The compiler binds the arena only for a function that uses it. Where one call's regions
  pass one binding's size, it spreads them over more than one arena binding, while the stage has
  bindings free.
- (C) As (B), and the runtime requests the adapter's largest `maxStorageBufferBindingSize`,
  `maxBufferSize` and `maxStorageBuffersPerShaderStage` when it requests the device. A device that
  the host made keeps its own limits.
- Recommendation: (C). It rests on OD-3 and OD-10: the room is the compiler's and the runtime's
  work, with no host option and no author construct. It reverses no entry. Cost: more than one
  arena binding is more lowering work, and a run region still fits in one binding. Larger limits
  may cost device memory or fail on some adapters (M2, M10).

**Q5. Does this proposal carry the stages of area A? (proposal 0100, decision D4)**

- Proposal 0100, decision D4: "One proposal for each area, with a stage for each unit and a pull
  request for each stage". This proposal is unit S3 of area S. It carries units A1 to A3 of area
  A, and it leaves A4 out (deviation DV1).
- (A) Keep it as written. Contract C1 to C11 and its first users stay in one proposal. A4 gets a
  later proposal of area A, which builds on C10. DV1 is closed by the owner's answer.
- (B) Follow D4. This proposal keeps the contract (C1 to C11, the S3 rule). A new proposal of area
  A carries the stages A1 to A4 and cites this one.
- Recommendation: (A). No owner's decision governs the split, so neither choice reverses an
  entry. It rests on OD-10, whose heap then has one approved design and its stages together, and
  on OD-4, since the owner sees the stages with the contract. Cost: area A has two proposals, this
  one and A4's, against D4's one.

## Open questions

Each has a recommendation. They are the compiler's and the runtime's work (OD-3), so they are not
questions for the owner unless a review finds a conflict.

| Id  | Question                                                                                                | Recommendation                                                                                                                                                                                    | Cost                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| N1  | A function writes a caller's array in place, then runs out. How does the second run not write it twice? | Closed by C11, after the independent review (finding 5): the call restores what it can write before each outcome of C8.                                                                           | C11 gives the cost.                                                                                          |
| N2  | How long does an owner keep its arena?                                                                  | Keep it at its largest size until the owner is disposed. Grow it by doubling between submissions, never inside one.                                                                               | A call with a large need holds that memory on the device. A later revision may shrink an arena that is idle. |
| N3  | Who reserves a run region on WebGPU: each invocation, or one invocation for a workgroup or a scan?      | The compiler chooses. For a push, the scan reserves the total once (section 3). Each invocation does not touch the bump word.                                                                     | A form with no scan needs its own plan. M5 measures contention.                                              |
| N4  | What maximum does a shared region declare?                                                              | Deferred to the proposal of plan unit W2 (section 2). A proposed starting point for it: 4 GiB (65536 pages), halved until the engine accepts. The maximum is then the bound of C8 on WebAssembly. | Engines may reserve address space. M7 measures each engine.                                                  |
| N5  | Does a region of the arena start zeroed?                                                                | No. The compiled code writes each made array's first value (zeros for `new Float32Array(n)`), as the constructor does in JavaScript.                                                              | One write for each element, which a fresh buffer does not need.                                              |

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, code or form. The new rule in section 11
states the compiler's and the runtime's own work. The reshape of `Pack` and `Reflection` adds a
host-facing record (C9, Q1).

## What it touches

- Rule 1.5: the rationale points to the new rule in place of "unit S3".
- Rule 6.8: the arena's layout is `std430`, and `reflect()` and the manifest agree on its binding.
- Rule 8.21: a kernel call sizes and binds the arena, copies a result out, and runs out by C8.
- Rule 8.23: stage A3 removes the refusal of a push over a range the device holds (0114, A6,
  item 5). C11 keeps a written argument as it was before a call that runs out.
- Rule 11.8: a call that runs out falls to the next tier and says why.
- Rule 11.10: the manifest carries the arena's binding and record (C9).
- Rule 11.11: the program runtime sizes and binds the arena for an entry, and throws the
  `RangeError` of C8.
- Rule 11.13: a fuse plan reserves the regions of its nodes for one submission (C5). It is one
  unit for C8 and C11 when a node runs out.
- The new rule 11.25: clauses C1 to C11.
- Proposal 0094, decision D6: stage A3 removes the need for a cap on a loop over a device range
  (C4). Section 1's "Nothing is read back" gains the flag's read for a loop with a run region
  (C8). A3's pull request records both in 0094 as an amendment.
- Proposal 0094, decision D2, and 0114's drop of a write past an array's end: unchanged, and kept
  inside the arena by C2.
- Surface §64 (a host call: where scratch lives, running out), §65 (the kernel loop: stage A3's
  form compiles), §67 (an entry's call: the arena and the `RangeError`), §69 (the program runtime
  binds the arena), §71 (`fuse`: one arena for a plan).
- `exports`: `Pack` gains the arena record. `Reflection` gains the arena field. Both are
  reshapes, if Q1 is answered (A) or (B).
- `codes`, `examples`, `names`: none.

### Draft impact estimate

- [estimate] Technical work: the lowering of every scratch binding to an offset into the arena;
  the call layer's sizing and binding; the runtime's binding for entries; the manifest and the
  reflection; on WebAssembly, the same offsets in the region. No duration or cost is established.
- [known] Compatibility: no program changes (section 3). The manifest's goldens and
  `src/__api__/surface.md` change. TypeShade has no release (OD-6).
- [known] Dependencies: none added. The JavaScript CPU tier stays the oracle (0100, D6).
- [estimate] Downstream: the site's and the editor's pages above. Radiance, TypeNN, TypeCV and
  TypeAudio were not searched in their own repositories for a host that binds the manifest's
  bindings by hand. The local checkouts of TypeCV, TypeNN and TypeAudio at this date call neither
  `reflect()` nor `packModule()` (searched 2026-11-23). If such a host exists, it binds one more
  buffer.

### Measurements owed

Each measurement names its device and commit when it runs. None has run.

| Id  | What                                                                                                      | Stage |
| --- | --------------------------------------------------------------------------------------------------------- | ----- |
| M1  | The time of a kernel call that pushes (example `kernel-push`), before and after, for three sizes of `n`.  | A1    |
| M2  | The storage bindings of each lowered kernel of the examples, before and after.                            | A1    |
| M3  | The copy of a made array's result out of the arena, against its own binding today.                        | A2    |
| M4  | The cost of a call that runs out and runs again, with and without the restore of C11.                     | A3    |
| M5  | Contention on the bump word on WebGPU, for one reservation per scan against one per invocation.           | A3    |
| M6  | The bundle of `typeshade/runtime` against `scripts/bundle-budget.json`.                                   | A1–A3 |
| M7  | A shared `WebAssembly.Memory` with a maximum of 4 GiB on Chromium, Firefox, Safari and Node, for W2.      | W2    |
| M8  | The same results across ten runs, and on WebAssembly across thread counts once W2 lands.                  | A3    |
| M9  | The round trip of the flag's read for a call on a resource, a loop of 0094 and a graph (C8).              | A3    |
| M10 | The kernels of the examples near 8 storage bindings, and a device with the adapter's largest limits (Q4). | A1    |

### Independent review record

- Reviewer: an independent agent review. That agent did not write this proposal.
- Date: 2026-11-23.
- Configuration: branch `claude/typeshade-agent-code-quality-vxpu3p` at `c722574d` (PR #1400).
- Answered: 2026-11-23, by the drafting session. Each finding was checked against the code and
  the cited proposals before the text changed.

| No. | Finding                                                                                                                                                                                                | Evidence checked                                                                                                                                                                      | Disposition                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Blocking. The trip words cannot live in the arena: the loop is dispatched with `dispatchWorkgroupsIndirect` from them, and a buffer cannot be indirect arguments and writable storage in one dispatch. | `src/core/host-kernel.ts`, `trips` and the indirect `batch.add`; `zeroedBuffer` and `RESIDENT_USAGE` with `INDIRECT` in `src/core/host-entry.ts`. The WebGPU rule is an [assumption]. | Applied. C1 keeps indirect arguments out of the arena and gives it no `INDIRECT` usage. Stage A1 no longer moves the trip words.                                                                                                                                                                                 |
| 2   | Blocking. Inside one arena, `arrayLength` is the arena's, so 0094 D2's drop of a write past an array's end is lost.                                                                                    | 0094, section 1 and decision D2; 0114, "Costs of the owner's decisions".                                                                                                              | Applied. C2 checks each region access against the region's own length and drops a write past it.                                                                                                                                                                                                                 |
| 3   | C6 allows atomics only on header words, but 0080's hash table needs atomic scratch.                                                                                                                    | 0080, section 7.                                                                                                                                                                      | Applied. C3 adds atomic views, and C6 allows atomic regions.                                                                                                                                                                                                                                                     |
| 4   | Q2's "the second run always fits" is false: a later loop's range can read what an earlier loop wrote, and dropped writes give wrong sizes.                                                             | 0094, section 1, "The order".                                                                                                                                                         | Applied. Q2 and C8 say the call runs again once, then falls. C7 now stops later loops after the flag is set, so the bytes needed stay the same on every run.                                                                                                                                                     |
| 5   | N1 is wrong and too narrow: a read-modify-write is applied twice (OD-5), and a tier fall or a `RangeError` leaves the first run's writes (OD-9).                                                       | OD-5; OD-9, addition of 2026-11-17, "the same values the host sees".                                                                                                                  | Applied. New clause C11 restores, or proves harmless, every write before each outcome of C8, with its cost. N1 is closed.                                                                                                                                                                                        |
| 6   | The flag's read is a round trip that 0094 avoided, and graphs submit later; the behaviour of a fuse plan or graph that runs out is not stated.                                                         | 0094, section 1, "Nothing is read back"; 0138, R2.                                                                                                                                    | Applied. C8 states the read for each kind of call, a plan or graph as one unit, the `RangeError` at the next `read()`, and the cost. M9 measures it.                                                                                                                                                             |
| 7   | Less room per call, and a kernel with zero or one scratch buffer gains bindings.                                                                                                                       | Section 1; the WebGPU defaults are an [assumption].                                                                                                                                   | Applied as owner question Q4, recommendation (C). M10 measures it.                                                                                                                                                                                                                                               |
| 8   | Stage A3 changes 0094 D6 without saying so.                                                                                                                                                            | 0094, section 1 and "Decisions taken", D6.                                                                                                                                            | Applied. "What it touches", the list of changed decisions, C4 and stage A3 name it. OD-3 makes the cap removable.                                                                                                                                                                                                |
| 9   | The split departs from 0100 D4: S3 carries A1 to A3 and leaves A4 out.                                                                                                                                 | 0100, decision D4.                                                                                                                                                                    | Applied as deviation DV1 and owner question Q5, recommendation (A).                                                                                                                                                                                                                                              |
| 10  | Q1 (A) does not work for a host that binds WGSL by hand: it must read the flag and cannot size a run region.                                                                                           | C3; Q1.                                                                                                                                                                               | Applied. C3 gives the header layout. Q1 (A) shows it and says what such a host does.                                                                                                                                                                                                                             |
| 11  | Section 2 decides W2's design in advance against 0042 C2 and its stage 3.                                                                                                                              | 0042, stage 3, exclusions and decision C2.                                                                                                                                            | Applied. Section 2's paragraph applies from W2 only, does not amend 0042, and leaves the shared memory to W2's proposal. N4 is deferred to it. An exclusion says so.                                                                                                                                             |
| 12  | The plan puts A1 after area W, but W9 needs A1; the plan's S3 row names R2, which 0138 A4 overruled.                                                                                                   | `docs/typeshade-plan.md`, rows S3, W9 and R2, and the order of 2026-11-18; 0138, Amendment A4.                                                                                        | Applied. Q3 lists both, and its option (A) rewrites the rows of S3 and W9.                                                                                                                                                                                                                                       |
| 13  | WebGL2 does not fit C1 to C5: it writes through transform feedback, and C3's header is neither atomic nor single-threaded there.                                                                       | `src/core/gl-compute.ts` (the execution model); `PackGlCompute` in `src/core/manifest-types.ts`; `src/core/passes/kernel-lower-gl.ts`.                                                | Applied, with one correction. WebGL2 has no writable texture binding and writes through the record, as the finding says. It does perform atomics, on the host in invocation index order, and it holds barriers between passes. Section 1 states this, and a table in section 2 lists the clauses WebGL2 follows. |
| 14  | Statements marked [fact] that say "not verified" are assumptions; record the language service run.                                                                                                     | Section 1; C3.                                                                                                                                                                        | Applied. Those statements are [assumption]. Section 1 records the `bothHalves` run, which this session repeated on 2026-11-23 at `c722574d` with Bun 1.4.4 and the same result.                                                                                                                                  |

No finding was rejected. Finding 13 was corrected in one point. Findings 7 and 9 wait for the owner's answers to Q4 and Q5.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's answers to Q1 to Q5 and
their dates; the independent review record with every finding answered; the disposition of
deviation DV1; the merge of the proposal-only pull request with `status: accepted`; and the
plan's rows of S3, A1, A3 and W9 written again as the answers give them. No responsibility or
milestone date is assigned.

### Configuration and validation record

This record does not yet apply. Delivery will require, for each stage: the implementing pull
requests and commits with `Change: 0144`; `bun run test`, the compile gate and the differential
gate green on the implementing head; the measurements of its stage with device and commit;
`bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` clean; and the document audit that the rule text, the
surface sections and the plan's rows match the delivered configuration.

## What it owes downstream

- **typeshade.github.io.** The pages for host calls, kernel functions, `fuse` and the runtime, in
  English and in Korean, say where scratch and made arrays live, what a call does when it runs
  out, and, after stage A3, that a push over a range the device holds compiles. The manifest page
  names the arena record. `compiler-changes.md` records 0144 when the pin moves.
- **vscode-typeshade.** The skill's references for host calls and the manifest change as above.
  `compiler-changes.md` records 0144 when the pin moves.
- **radiance, typenn, typecv, typeaudio.** No program changes. Nothing is owed unless a search at
  implementation finds a host that binds the manifest's bindings by hand.
