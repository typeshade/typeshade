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
| Identity and status           | Proposal 0144, status `draft`. It is plan unit S3 of `docs/typeshade-plan.md`, "the memory and thread contract", with one stage for each of the plan units A1, A2 and A3 (proposal 0100, decision D4).                                                                                                                                                                                                                                                                                                                                                     |
| Date and attribution          | 2026-11-23, UTC (the container's clock). The date is the drafting date. An AI agent session (Claude Code) drafted the text at the request of the session that works for the repository owner. Nobody has reviewed or approved it.                                                                                                                                                                                                                                                                                                                          |
| Applicability / Effectivity   | The call layer (`src/core/host-kernel.ts`, `src/core/host-entry.ts`, `src/core/resident.ts`), the kernel lowering (`src/core/passes/kernel-lower.ts`, `src/core/passes/kernel-lower-ir.ts`), the reflection and the manifest (`src/core/reflect.ts`, `src/core/manifest-types.ts`, `src/core/manifest.ts`), the program runtime (`src/runtime/program.ts`, `src/runtime/runtime.ts`), the region (`src/runtime/region.ts`), and the WebAssembly tier of proposal 0042 when it exists. No release version is assigned. TypeShade has no release yet (OD-6). |
| Review baseline               | `origin/main` at `4f789240` (merge of #1398, "Order the run-time heap in the plan after OD-10").                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Review and revision authority | No PR is assigned at the time of writing. Git records the revisions of this file. The review and merge records of the proposal-only pull request will record the decisions.                                                                                                                                                                                                                                                                                                                                                                                |

## What changes

The labels in brackets keep facts, inferences, proposals and decisions apart.

### Terms

| Term        | Meaning in this proposal                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region      | The one global memory region of proposal 0138, R17 and Amendment A4 (`src/runtime/region.ts`). It holds the host's copy of every resource. It is a host-side memory. |
| Arena       | The memory the compiler owns for one device owner (Rule 11.8) on one target. Plan unit A1.                                                                           |
| Header      | The first 256 bytes of the arena. They hold the words that the allocation reads and writes: the next free offset, the overflow flag and the bytes needed.            |
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
  `n + 1` `u32`s"). WebGPU's default `maxStorageBuffersPerShaderStage` is 8 (WebGPU
  specification, general knowledge, not verified in this proposal).
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
  - The language service was not run for these cases in this draft.

### 2. The contract

[proposal] Ten clauses, C1 to C10, make one memory contract. WebGPU and WebAssembly take it
whole. The JavaScript CPU tier follows it on one thread. WebGL2 follows C1 to C5 and refuses run
regions (C8). A new rule in section 11 of `docs/language-design.md` (numbered 11.25 at
implementation) holds the clauses. Rule 1.5's rationale points to unit S3 today, and it points to
the new rule after this change.

**C1. One arena for each device owner and target.**

- WebGPU: one `GPUBuffer` with the usages `STORAGE`, `COPY_SRC` and `COPY_DST`, on the owner's
  device.
- WebAssembly and the JavaScript CPU tier: one range of the region of 0138 (R17). The region is
  one for the page (0138, Amendment A4). So the CPU tiers of all owners share it, and each owner
  has its own range.
- WebGL2: one data texture in the layout the WebGL2 pass program already uses for a storage
  array (`PackGlCompute`, `src/core/manifest-types.ts`).
- The author writes nothing for it (OD-3, OD-10). The host calls no function for it. The call
  sizes it and binds it.

**C2. One layout.** An offset is a byte offset from the start of the arena. A region starts at a
multiple of 16 bytes, the alignment of `RANGE_ALIGN` in `src/runtime/region.ts`. A value in the
arena has the `std430` layout of Rule 6.8. So the arena holds the same bytes on every target, and
a move between a GPU arena and a CPU arena is a copy with no conversion. Plan units R5 and W9
depend on this. [inference] This is the reason for one layout. 0042 measured that the copy of a
call's data costs as much as its loop (#459, M2, as 0042 cites it).

**C3. The header.** The first 256 bytes of the arena are the header. 256 is WebGPU's default
`minStorageBufferOffsetAlignment` (general knowledge, not verified here). The header holds:

1. the next free offset (the bump word);
2. the overflow flag;
3. the bytes needed, which the code adds to on each allocation, fitted or not;
4. words that later stages may use.

A target with threads changes the header with atomic operations: WGSL `atomicAdd` on an
`atomic<u32>`, and WebAssembly `i32.atomic.rmw.add` on a shared memory. A target with one thread
changes it with plain loads and stores. [proposal] On WebGPU the module sees two bindings over
two ranges of the one buffer that do not overlap: the header as `array<atomic<u32>, 64>` and the
data as `array<u32>`. [inference] WebGPU accepts two writable bindings of one buffer when their
ranges do not overlap. The compile gate and a device test verify this in stage A1.

**C4. Three kinds of region.**

- The fixed part: what the compiler sizes from the program alone, for example a frame of each
  invocation with a size the compiler computes. It starts after the header.
- Call regions (A2): what the call sizes from host values before the dispatch. Examples: the
  `n + 1` counts of a push over a loop of `n` iterations, the partials of a reduction, the `n`
  elements of a made array (0114, Amendment A1), the result of `filter`, at most the length of
  its input.
- Run regions (A3): what the running code sizes. It reserves them from the bump word. Example:
  the elements of a push over a loop whose trip count the device holds (change 0094).

**C5. One call is one lifetime.** Every region lives for one call. For a fuse plan (Rule 11.13)
or a graph of 0138, every region lives for one submission. No code frees a region inside a call.
When the call ends, the whole arena is free again. A result leaves the arena by a copy: into the
caller's array for a call with plain data, or into a new `Buffer` for a call on a resource (0114,
Amendment A1, items 6 and 7). [inference] Since nothing is freed inside a call, the bytes needed
are a sum that does not depend on the order of the allocations.

**C6. The thread contract.** The contract is the weaker of the two memory models, WGSL's:

1. Only the header words are atomic, and their atomics are relaxed.
2. A data word has one writer between two synchronization points. The compiler holds this.
3. A synchronization point is a dispatch boundary on WebGPU, the join of the workers on
   WebAssembly, or a barrier inside one workgroup.
4. An invocation reads a word that another invocation wrote only after a synchronization point.

**C7. Determinism.** The place of a run region may depend on the order in which invocations or
workers run. No observable answer depends on it (Rule 1.6, Rule 7.2):

- An offset is not observable. The program cannot read it, and the host never sees it.
- An ordered result keeps the order of a sequential run. A push keeps the count, scan and store
  of change 0078, and the scan, not the bump word, gives each element its index.
- Whether a call runs out depends on the bytes needed, a sum (C5). So it is the same on every run
  and for every count of threads.

**C8. Running out (A3).** An allocation that does not fit sets the overflow flag, adds its size to
the bytes needed, and gives no region. The code drops each write into that missing region. The
call reads the flag and the bytes needed with its results, in the same submission. When the flag
is set, the call does this:

1. It grows the arena to the bytes needed and runs the call again once on the same tier, if the
   bytes needed are within the bound (question Q2).
2. Otherwise, a kernel call (Rule 8.21) runs on the next tier of its owner's list, the CPU tier
   last, and says why, as Rule 1.5 and Rule 11.8 give it.
3. Otherwise, a call with no tier left (an entry or a draw under `createRuntime`, or a list of one
   tier) throws a `RangeError`. It names the function, the bytes needed and the bound, in the
   form `src/runtime/program.ts` uses today: "this device makes at most N bytes in one buffer
   (maxBufferSize)".

The bound of each target:

| Target              | Bound                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| WebGPU              | The smaller of the device's `maxStorageBufferBindingSize` and `maxBufferSize`.                        |
| WebAssembly         | The region's maximum: at most 4 GiB (0042, N4). A shared memory declares its maximum when it is made. |
| JavaScript CPU tier | What the region's `ArrayBuffer` can hold.                                                             |
| WebGL2              | No run region. A call that needs one skips WebGL2 and says why (Rule 11.8).                           |

**C9. What the host sees.** `reflect()` and the manifest show the arena as one binding that the
compiler adds (`injected`, as the `_fp64` guard is today in `src/core/manifest.ts`), with a record
of its fixed bytes and of the host values that size each call region. They show no layout of the
regions (question Q1). The host sets no size: no option of `configure` or `createRuntime` changes
the arena (OD-3).

**C10. The hook for references (A4).** [proposal] An offset is a `u32` from the start of the
arena. Offset 0 is in the header, so no region starts at 0, and A4 may use 0 as `null`. A value
that holds an offset lives no longer than the call (C5). A reference that outlives a call, and how
the region of 0138 holds one between calls, are left to A4. This proposal does not design A4.

**The region of 0138 under threads.** [proposal] The runtime does not grow or compact the region
while a call holds a range of it. 0042 states this for one thread. C6 makes it a rule for workers
too. Where `crossOriginIsolated` is true (and always in Node), the region is made as a shared
`WebAssembly.Memory` with a declared maximum (plan unit W2). Elsewhere it stays as 0042 gives it.
[fact] The owner decided that 0042's stage 1 runs on the calling thread (0042, decision C2), and
that threads are the default as far as the host allows (0100, decision D5). The contract serves
both: on one thread the header uses plain loads and stores.

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
- After stage A3: no diagnostic. On WebGPU the range entry of change 0094 writes the trip count.
  The count and the scan of change 0078 run over it in a run region. The scan reserves the total
  from the bump word, and the store writes the elements there. The call copies them into the
  result. If the arena is too small, C8 applies.
- The same source compiles today without `n[0]`, with `i < score.length`, since the call knows
  that bound (0114, stage S5d). That form needs no heap.

### 4. The stages

Each stage is one pull request, or more, and each leaves `main` green.

| Stage | Plan unit | Delivers                                                                                                                                                                                                                                                            | First user                                                                                                                                                                                                                                                            | Verifies                                                                                                                                                                                                                                                                                                  | Needs first |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| A1    | A1        | C1 to C3 and C9 on WebGPU and the JavaScript CPU tier: one arena for each owner, its header, its binding in `reflect()` and the manifest (Rules 6.8, 11.10), the call that sizes and binds it (Rule 8.21), and the runtime that binds it for an entry (Rule 11.11). | The scratch of today's kernel call moves into the arena: the counts of a push (0078), the records of a `Map` or `Set` (0080), the trip words (0094) and the partials of a reduction. No author's program changes.                                                     | `bun run test` green; the differential gate gives the same results; the compile gate passes on Tint; the count of storage bindings of each lowered kernel, before and after (M2); the manifest goldens rebaked and reviewed; the bundle budget.                                                           | none        |
| A2    | A2        | C4's call regions and C5, for a kernel call, an entry, and a fuse plan or graph (Rule 11.13). The region of 0138 holds the CPU tiers' arena.                                                                                                                        | The made array of 0114, stage S5, moves from its own binding into a call region, "with no change to the program" (plan unit B8). B8b (0114) and G4 can then land under their own proposals.                                                                           | The S5 tests unchanged; a test that two made arrays and the scratch of one call share one arena; a fuse plan with two nodes that each reserve a call region; the copy-out cost of a result (M3).                                                                                                          | A1          |
| A3    | A3        | C4's run regions, C7 and C8: the bump word, the overflow flag, the bytes needed, running again, the next tier and the `RangeError`. Rules 8.21, 11.8 and 11.11 say what the call does when it runs out.                                                             | The form of 0114, Amendment A6, item 5: a push in a loop whose range the device holds (section 3), and a loop of 0094 that pushes over a device range with no cap (0094, decision D6), which runs on the CPU tier today. Rule 8.23 and surface §65 lose that refusal. | `bothTake` (`src/core/testing/both-halves.ts`) on section 3's example: `compile()` and the language service give no diagnostic. A test that forces a small arena and sees the second run, the CPU tier and the `RangeError` with its text. Results equal across runs (C7). The cost of a second run (M4). | A2          |

The order of the work follows `docs/typeshade-plan.md` (the owner, 2026-11-18): this proposal
comes first within area S; then area W; then A1, A2 and A3. Question Q3 asks how this agrees with
the plan's dependency of S3 on S2. On the WebAssembly tier, each stage applies when the tier's
calls exist (0042, stage 1f), and plan unit W9 brings the arena into the shared memory.

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
array, for each call (section 1). [inference] One arena that the owner keeps uses one or two
bindings in place of one for each scratch array. It creates no buffer for a call that fits. M1 and
M2 measure both.

### Alternatives

- **A buffer for each dynamic array (today's way).** Each array is one more binding, against the
  default limit of 8. A size known only on the device needs a read back before the buffer exists.
  Not taken.
- **Always read the size back first.** The call runs a sizing pass, reads the size with
  `mapAsync`, then allocates and runs. It needs no overflow flag. It costs a round trip for every
  call, and it breaks a fuse plan's one submission. Not taken. C8 reads the flag with the results,
  so a call that fits pays no round trip.
- **A general allocator with free lists.** It frees inside a call. The bytes needed then depend on
  the order of the threads, so running out would not be the same on every run (C7). Not taken.
- **A memory for each target, each in its own layout.** A move between targets then converts.
  0042 measured that a copy costs as much as the loop. Not taken.

### Assumptions

- [inference] WebGPU accepts the two bindings of C3 over one buffer. The compile gate and a device
  test check it in A1.
- [inference] The engines make a shared `WebAssembly.Memory` with a large declared maximum. M7
  measures it.

## Owner's decisions

This proposal rests on these entries of `docs/owner-decisions.md` and reverses none.

| Entry | What this proposal takes from it                                                                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-3  | The arena, its size and its growth are the compiler's and the runtime's work. No author construct and no host option (C1, C9).                                                                 |
| OD-4  | Section 3 shows one example before and after. Questions Q1 to Q3 show the options and their costs.                                                                                             |
| OD-5  | A function that writes its parameter changes the caller's object. A second run (C8) must not change it twice (open question N1).                                                               |
| OD-6  | No release exists, so the reshape of `Pack` and `Reflection` owes no warning release.                                                                                                          |
| OD-9  | The arena need not match the source one to one. A made array, a scratch array and a result may share one buffer (C4). The 2026-11-17 addition allows a pointer or an offset in the emit (C10). |
| OD-10 | The arrays compile time cannot size get their storage from this heap (section 3). Compile time decides first where it can (C4's fixed part and call regions).                                  |

It also follows these accepted decisions: proposal 0100, D4 (one stage for each unit) and D5 (area
S first, then W; threads as far as the host allows); proposal 0042, decision M (the region is the
linear memory) and C2 (stage 1 on the calling thread); proposal 0138, Amendment A4 (one global
region); proposal 0114, Amendment A1 (the storage moves to the arena when A1 and A2 exist).

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
  - (A) The arena is one binding with its fixed bytes and the host values that size it. Its
    content has no layout in the record. The host binds one buffer of that size. A later compiler
    may place regions differently, and the host does not change.
  - (B) Each region shows its offset, size and type. A host can read a scratch array. A change of
    placement then changes the manifest, and the host may depend on it.
- Recommendation: (A). It rests on OD-3 and OD-9, and on Rule 1.5. Rule 11.10 gains a sentence
  that the arena's content is the compiler's. Cost: a host cannot read the arena's content.

**Q2. When a call runs out, does it run again before it falls to the next tier?**

- Plan unit A3: "a flag the call reads, then the CPU tier for a host call, or a refusal that names
  the bound".
- OD-10: the compiler decides the room "at compile time where it can …: a capacity it computes
  from the program, a second pass, or another form with the same result".
- (A) Run again once with the arena grown to the bytes needed, then fall (C8, step 1). The second
  run always fits, since C7 makes the bytes needed the same.
- (B) Fall to the next tier at once, as the plan's text says.
- Recommendation: (A). It rests on OD-3 and OD-10. The plan's row A3 is written again in the
  implementing pull request. Cost: a call that runs out runs twice on its tier (M4), and a
  function that writes a caller's array first needs N1.

**Q3. The plan's table says S3 needs S2; the order the owner set says S3 comes first in area S.
(two parts of one document point different ways)**

- `docs/typeshade-plan.md`, the row of unit S3: "Needs S2". S2 needs S1. Neither has started.
- `docs/typeshade-plan.md`, Notes, the order of 2026-11-18: "within it S3, the memory and thread
  contract, comes first". The row of unit A1 needs nothing.
- (A) The order holds. This proposal is decided now. A1 to A3 are written against today's call
  layer (`src/core/host-kernel.ts`, `src/runtime/program.ts`), and S1 and S2 take the contract
  when they land. The row of S3 changes to "none".
- (B) The table holds. This proposal waits for S1 and S2, and so does the heap of OD-10.
- Recommendation: (A). It rests on the owner's latest words on the order (2026-11-18) and on
  OD-10. Cost: S2 moves the arena's code once more when it unifies the runtime.

## Open questions

Each has a recommendation. They are the compiler's and the runtime's work (OD-3), so they are not
questions for the owner unless a review finds a conflict.

| Id  | Question                                                                                                | Recommendation                                                                                                                                                                                                          | Cost                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| N1  | A function writes a caller's array in place, then runs out. How does the second run not write it twice? | The compiler knows which arrays a function writes (OD-5). Where no such write comes before the first run region, run again as is. Otherwise copy those arrays before the first run, and restore them before the second. | A copy for each call of such a function, on WebGPU a `copyBufferToBuffer`. M4 measures it.                   |
| N2  | How long does an owner keep its arena?                                                                  | Keep it at its largest size until the owner is disposed. Grow it by doubling between submissions, never inside one.                                                                                                     | A call with a large need holds that memory on the device. A later revision may shrink an arena that is idle. |
| N3  | Who reserves a run region on WebGPU: each invocation, or one invocation for a workgroup or a scan?      | The compiler chooses. For a push, the scan reserves the total once (section 3). Each invocation does not touch the bump word.                                                                                           | A form with no scan needs its own plan. M5 measures contention.                                              |
| N4  | What maximum does a shared region declare?                                                              | 4 GiB (65536 pages). If the engine refuses it, halve it until the engine accepts. The maximum is the bound of C8.                                                                                                       | Engines may reserve address space. M7 measures each engine.                                                  |
| N5  | Does a region of the arena start zeroed?                                                                | No. The compiled code writes each made array's first value (zeros for `new Float32Array(n)`), as the constructor does in JavaScript.                                                                                    | One write for each element, which a fresh buffer does not need.                                              |

## Why the compiler cannot do it

Not applicable: this proposal adds no author-facing name, code or form. The new rule in section 11
states the compiler's and the runtime's own work. The reshape of `Pack` and `Reflection` adds a
host-facing record (C9, Q1).

## What it touches

- Rule 1.5: the rationale points to the new rule in place of "unit S3".
- Rule 6.8: the arena's layout is `std430`, and `reflect()` and the manifest agree on its binding.
- Rule 8.21: a kernel call sizes and binds the arena, copies a result out, and runs out by C8.
- Rule 8.23: stage A3 removes the refusal of a push over a range the device holds (0114, A6,
  item 5).
- Rule 11.8: a call that runs out falls to the next tier and says why.
- Rule 11.10: the manifest carries the arena's binding and record (C9).
- Rule 11.11: the program runtime sizes and binds the arena for an entry, and throws the
  `RangeError` of C8.
- Rule 11.13: a fuse plan reserves the regions of its nodes for one submission (C5).
- The new rule 11.25: clauses C1 to C10.
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

| Id  | What                                                                                                     | Stage |
| --- | -------------------------------------------------------------------------------------------------------- | ----- |
| M1  | The time of a kernel call that pushes (example `kernel-push`), before and after, for three sizes of `n`. | A1    |
| M2  | The storage bindings of each lowered kernel of the examples, before and after.                           | A1    |
| M3  | The copy of a made array's result out of the arena, against its own binding today.                       | A2    |
| M4  | The cost of a call that runs out and runs again, with and without the copy of N1.                        | A3    |
| M5  | Contention on the bump word on WebGPU, for one reservation per scan against one per invocation.          | A3    |
| M6  | The bundle of `typeshade/runtime` against `scripts/bundle-budget.json`.                                  | A1–A3 |
| M7  | A shared `WebAssembly.Memory` with a maximum of 4 GiB on Chromium, Firefox, Safari and Node.             | W9    |
| M8  | The same results across ten runs, and on WebAssembly across thread counts once W2 lands.                 | A3    |

### Independent review record

Not yet performed. Before the owner decides, an agent or a person that did not write this proposal
reviews it against `changes/README.md` (Independent review), with file and line evidence, and this
section records each finding and its answer.

### Approval and plan record

This record does not yet apply. Acceptance will require: the owner's answers to Q1 to Q3 and
their dates; the independent review record with every finding answered; the merge of the
proposal-only pull request with `status: accepted`; and the plan's rows of S3, A1 and A3 written
again as the answers give them. No responsibility or milestone date is assigned.

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
