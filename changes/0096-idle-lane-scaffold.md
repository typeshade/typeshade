---
id: '0096'
title: In a kernel function's GPU loop, a lane past the trip count runs the last iteration and writes nothing instead of returning early, and a workgroup wholly past the trip count returns as one
status: draft
rules:
  - '8.22'
surface:
  - 65
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: Describe what the idle lanes of a kernel function's last workgroup do, where the kernel-function page describes the dispatch, in both locales, and record 0096 when the pin moves.
  - repo: vscode-typeshade
    what: Describe the idle lanes of a kernel function's last workgroup where the skill's kernel-function reference describes the dispatch, and record 0096 when the pin moves.
  - repo: typecv
    what: Decide in phases 9 and 10 of docs/library-structure.md which loop-heavy maps convert, restate the idle-lane rule of docs/gpu-sfm.md for kernel functions, decide section 7 item 11 (the hardware run), renew probe S2, and record 0096 when the pin moves.
---

<!-- doc-refs: skip-file — this draft names files of the TypeCV repository, which this tree does not have, and tests that a later implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0096`, `status: draft`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Date and attribution          | Written on 2026-10-26, UTC. The date records authorship, not an approval. A Claude Code sub-agent (Claude Opus 5.5) drafted it at the request of the coordinating Claude Code session of TypeCV's refactoring programme. TypeCV's owner decided on 2026-10-26 to open TypeCV's request C7 as a TypeShade proposal (TypeCV `docs/library-structure.md`, section 7, item 7). Issue #703 (open) asks for the same lowering as its item 2. Sources: that document, `docs/audits/2026-10-26-kernel-style.md`, `docs/gpu-sfm.md`, `docs/hardware-observations.md` and `tests/typeshade/compiler-probes.test.mjs` at TypeCV `0f28d8d`, issue #703 and its comments, `docs/hardware-notes.md`, this tree, and the emitted WGSL in "Why". No approval exists. |
| Applicability / Effectivity   | The compute entries that the lowering of a kernel function writes (Rule 8.22): `entryFor`, the loop entry of `reductionEntries` and the count and store entries of `pushEntries` in `src/core/passes/kernel-lower.ts`, `src/core/kernel-workgroup.ts`, and the entry of a fused group in `src/core/fuse-entry.ts`. The proof, the call, the WebGL2 program, the CPU tier and every entry an author writes (Rule 8.24) do not change. No release version is assigned.                                                                                                                                                                                                                                                                                 |
| Review baseline               | `main` at `6c6a1d14403397e054f62562f400b2fac72540c9`. The emitted WGSL in "Why" was read on `fc234dbc6568bacc33349d5492a27a418c0950c9`; `src/core/passes/kernel-lower.ts`, `src/core/kernel-workgroup.ts`, `src/core/fuse-entry.ts` and `src/core/host-kernel.ts` are byte-identical at `fc234db` and at `6c6a1d1`. TypeCV evidence: `main` at `0f28d8d42d81316bc1f6c2060e8e873bca9c9a94`, whose compiler pin is `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc` (`package.json` line 60); `src/core/passes/kernel-lower.ts` is byte-identical at the pin, so TypeCV's citation `kernel-lower.ts:756-767` holds at `6c6a1d1`.                                                                                                                             |
| Review and revision authority | No pull request is assigned yet. Git records the revisions. The review and merge of the proposal-only pull request will record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## What changes

**Proposal.** The compiler-made entries of a kernel function's GPU loop stop returning early for a
lane past the trip count. The new iteration scaffold has two parts:

1. **A workgroup wholly past the trip count returns as one.** Its condition reads only the
   workgroup's id, the number of workgroups, the workgroup size and the trip count, so every
   invocation of the workgroup takes the same branch. Such workgroups exist when a dispatch spills
   past 65,535 workgroups into `y`.
2. **In the workgroup that holds the last iteration, a lane past the trip count runs iteration
   `n − 1` and writes nothing.** Its index is clamped to `n − 1`, so it reads valid data, and every
   write of the iteration is masked by the lane's `live` flag. Where a clamped lane would read an
   element that another invocation of the dispatch writes, the lane skips the iteration instead,
   under the same flag, and still does not return before the end of the entry.

So no invocation of a workgroup that holds an iteration leaves the entry before the loop's body.
That is the form that TypeCV's rule for kernel authors asks for (TypeCV `docs/gpu-sfm.md`), and the
form that completed on the device of A1 where the early return hung (issue #703). The results of a
call do not change on any tier: the masked lanes write nothing, and the CPU tier runs the function
as written.

### Before and after

| Entry (`src/core/passes/kernel-lower.ts`)                          | Today, at `6c6a1d1`                                                          | With this proposal                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A map loop's entry (`entryFor`, lines 752 to 773)                  | `if (_k >= _n) { return; }` before the iteration (lines 756 to 767)          | A wholly idle workgroup returns. In the last workgroup a lane past `_n` runs iteration `_n − 1` with every write masked.         |
| The store step of a push (`pushEntries`, lines 1922 to 1937)       | the same early return                                                        | The same scaffold. A masked lane stores no push.                                                                                 |
| The count step of a push (`pushEntries`, lines 1772 to 1794)       | `if (_k < _n) { counts[_k] = count(_k); }`: an idle lane skips the iteration | An idle lane counts iteration `_n − 1` and stores no count.                                                                      |
| A reduction's loop entry (`reductionEntries`, lines 903 to 937)    | `if (_k < _n) { _sums = iteration(_k); }`, then the tree with its barriers   | An idle lane runs iteration `_n − 1` and gives the tree the identity, as it does today. The tree and its barriers do not change. |
| A fused group's entry (`src/core/fuse-entry.ts`, lines 703 to 713) | the first member's guard, then each member's iteration                       | The first member's new scaffold, then each member's iteration with its writes masked.                                            |
| A reduction's fold entry, a push's scan entry                      | no author code; a predicate on `_n`, or one workgroup                        | Unchanged.                                                                                                                       |
| The WebGL2 program (`lowerKernelGl`, lines 1538 to 1550)           | `if (_k >= _dispatch.x) return;`: the fragment's texel keeps its value       | Unchanged (decision D3).                                                                                                         |
| An entry an author writes (Rule 8.24)                              | runs as written                                                              | Unchanged (decision D4).                                                                                                         |

### The emitted WGSL

**Fact** (the WGSL of a P1-shaped loop, `for (let i = offset; i < offset + count; i++) { const
pixel = rgba[i]; gray[i] = f32(pixel & 255) / 255.; }`, emitted on `fc234db`):

```wgsl
@compute @workgroup_size(64)
fn rgbaToGrayK_loop0(@builtin(global_invocation_id) _gid: vec3<u32>, @builtin(num_workgroups) _nwg: vec3<u32>) {
  let _k = (_gid.x + (_gid.y * (_nwg.x * 64u)));
  if ((_k >= rgbaToGrayK_args._n)) {
    return;
  }
  let i = (rgbaToGrayK_args._start + u32(_k));
  let pixel = rgba[i];
  gray[i] = (f32((pixel & 255u)) / 255.0);
}
```

**Proposal** (illustrative; the implementation fixes the spelling):

```wgsl
@compute @workgroup_size(64)
fn rgbaToGrayK_loop0(@builtin(global_invocation_id) _gid: vec3<u32>, @builtin(num_workgroups) _nwg: vec3<u32>, @builtin(workgroup_id) _wid: vec3<u32>) {
  let _k = (_gid.x + (_gid.y * (_nwg.x * 64u)));
  // A workgroup wholly past the trip count returns as one.
  if ((((_wid.x + (_wid.y * _nwg.x)) * 64u) >= rgbaToGrayK_args._n)) {
    return;
  }
  // A lane past the trip count runs the last iteration and writes nothing.
  let _live = (_k < rgbaToGrayK_args._n);
  let i = (rgbaToGrayK_args._start + u32(min(_k, (rgbaToGrayK_args._n - 1u))));
  let pixel = rgba[i];
  if (_live) {
    gray[i] = (f32((pixel & 255u)) / 255.0);
  }
}
```

The workgroup's first index reads `workgroup_id` and `num_workgroups`, which are the same for every
invocation of a workgroup, and the trip count, which a uniform holds. **Inference.** WGSL's
uniformity analysis therefore reads the first return as uniform control flow, so a barrier after
it, as in a reduction's tree, stays valid. The compile gate measures that on Tint (Rule 13.3). The
clamp keeps `_n − 1` from wrapping: a lane that reaches it belongs to a workgroup whose first index
is below `_n`, so `_n` is at least 1. A call with no iteration dispatches nothing, as today.

### What a masked lane does

- **Every write that R3 accepts is masked** (Rule 8.22): a store to an outer array, a texel store,
  an atomic of a scatter, a store of a push and a record of a `Map` or a `Set`. A write to a name the
  body declares is private to the lane and is not masked.
- **Reads.** The lane reads what the lane of iteration `n − 1` reads, which is in range for every
  call that the lane of `n − 1` runs in.
- **A `continue` of the loop's own** stays the iteration's `return`, as today. A masked lane takes it
  exactly where the lane of iteration `n − 1` takes it: a return for a condition of the item's data,
  which TypeCV's rule allows.
- **A reduction.** The lane computes iteration `n − 1` and gives the tree the operator's identity
  instead of its value, so the tree folds the values it folds today (Rule 7.2).
- **A push.** The count step stores no count for the lane, and the store step stores no element, so
  the scan, the offsets, the order and the count are those of today (change 0078).

### Where the lane skips the iteration instead

A clamped lane runs iteration `n − 1` beside the lane that runs it. Where that iteration reads an
element that it also writes, the clamped lane would read what the other lane writes in the same
dispatch: a data race, which WGSL calls a dynamic error (§6.5.7 of the W3C Candidate Recommendation
Draft of 21 October 2026, read on 2026-10-26). So in these loops an idle lane skips the iteration,
`if (_live) { … }`, the form the count step and the reduction's entry use today:

- a loop that reads back an element it writes (the proof's `LoopStore.readBack`, R4);
- a loop that loads a texel it stores (R4, change 0077);
- a loop that writes through an `@inout` argument of a call (Rule 8.25), whose store is in the
  callee;
- a fused group with an edge, whose later member loads from storage what an earlier member wrote at
  `i` (item 6 of the file comment of `src/core/fuse-entry.ts`). A slot the planner contracts is a
  local, private to the lane, and needs no skip.

In both forms no lane returns before the end of the entry for being past the trip count. Only the
clamped form ran on the device of A1. Decision D2.

### The tiers

- **WebGPU.** The scaffold above, in each entry of the table.
- **WebGL2.** No change. The kernel program is a fragment program, one texel per iteration, and it has
  no workgroup. Its texels past the trip count lie in the last row of the target and keep their values
  (Rule 11.8). A1 is an observation of a compute workgroup on D3D12. Decision D3.
- **The CPU tier.** No change. The host's CPU tier runs the kernel function as written, a loop over
  its iterations in order (Rule 11.7, `onCpu` in `src/core/host-kernel.ts`), with no invocation and
  no lane. The oracle's run of a lowered plan (`src/core/testing/kernel-plan.ts`, test code) runs the
  new entries through `CpuModule.dispatch`, and must give the bits it gives today.

### What it costs

**Inference, not measured.** Each invocation computes one `min` and one comparison more, and each
write of the iteration takes one branch on the lane's flag. Only the last workgroup of a dispatch
holds lanes past the trip count, at most one less than the workgroup size. They now run iteration
`n − 1` instead of returning, so that workgroup takes at least as long as iteration `n − 1`. A
workgroup wholly past the trip count returns as one and costs what it costs today. Where an idle lane
shares its subgroup with live lanes of the same path, it adds no time; a subgroup of idle lanes now
computes instead of ending.

### Exclusions

- No change to an entry an author writes. Rule 8.24 runs an entry "as its author wrote it: … no guard
  added". Issue #703's item 2 as written, a rewrite of an author's guard at the top of a compute
  entry, is decision D4.
- No change to the proof, the call, the facts of the planner, the WebGL2 program or the CPU tier.
- No per-device behaviour: the scaffold is the same on every device (decision D1).
- No timing claim. The hardware item below is a requirement, not a result.

## Why

### TypeCV's evidence

**Fact** (TypeCV `docs/library-structure.md` at `0f28d8d`, section 6, row C7). The limit: "the map
lowering starts every invocation with an early return past the trip count; A1
(`hardware-observations.md`, TypeShade #703) forbids that return on the RTX 5060 Ti". The effect:
"loop-heavy maps must stay entries written clamp-and-mask". The request: "an iteration scaffold that
clamps the index and masks the writes". The row is an "enabler". Section 6 adds that C7 rests "on
the compiler's rules and source without a probe: … `kernel-lower.ts:756-767`".

**Fact** (the same document). Section 3.6 names the fourth need that forces an entry: "the idle-lane
hang A1 (`hardware-observations.md`): the compiler's map lowering emits the early return that A1
forbids", and keeps `triangulateTracks` an entry "until the compiler's idle-lane scaffold changes
(C7)". Section 5's phase 9 is "narrowed by A1": "`planarPropose`, `planarVerify`, `planarFinish` and
`claheApply` qualify … Every SLIC and mesh entry, `planarFit`, `kltEigenMax`, `houghVote` and
`houghCollect` loop or clamp and mask, so they wait for C7 (phase 10)". Its gate includes "a run on
the RTX 5060 Ti while A1 is open (item 11)". Section 7, item 11, who runs that hardware gate and on
which samples, is open.

**Fact** (TypeCV `docs/gpu-sfm.md` at `0f28d8d`, "Rule for kernel authors: an idle lane does not
return before a loop"). "1. Do not `return` for an idle lane before a loop or a barrier. 2. Clamp the
lane's index to the last item, so that the lane reads valid data. 3. Run the loop with the work
masked off: guard each write with an `active` flag. 4. Return early only for a condition of the
item's data, as the lane of that item would." The same section adds: "Other kernels of `src/gpu/`
still return for an out-of-range lane before a loop. They ran on that device without a loss".

**Fact** (TypeCV `docs/hardware-observations.md` at `0f28d8d`, A1). On an NVIDIA Blackwell GPU (a
GeForce RTX 5060 Ti by the owner's statement), Windows, Chrome 155 with Dawn on D3D12,
`triangulateTracks` (`@compute([16])`, one track per lane, emulated `f64`, a Jacobi SVD of up to 160
sweeps per hypothesis) lost the device (`DXGI_ERROR_DEVICE_HUNG`) whenever a workgroup held lanes
that returned before the loops: probe records `e0c75517`, `41d3ba90` and `14349a11`. Full workgroups
over the same tracks completed (`02ed0bfc`, `e37f29b0`). TypeCV #67 (site `a67e2df`) made an idle
lane compute the chunk's last track and write nothing, and the probe and the standard benchmark then
completed on that device (`4b85f996`, `472d5020`, `2a5988bb`, `209bc7c5`). "Open: The component at
fault (Tint's HLSL, DXC or the NVIDIA driver) is not known."

**Fact** (TypeCV `docs/audits/2026-10-26-kernel-style.md` at `0f28d8d`, sections 3 and 6). "The
kernel lowering starts every map invocation with `if (_k >= _n) { return; }`
(`kernel-lower.ts:756-767`)." Rank 7 (G-F) asks for "an iteration scaffold that clamps the index
and masks the writes, as TypeCV's rule does".

**Fact** (TypeCV `tests/typeshade/compiler-probes.test.mjs` at `0f28d8d`, #243). Probe S2 holds that
"the loop entry returns past the trip count before the iteration (kernel-lower.ts:756-767)". Its
signal: "C7 closed: the map scaffold no longer returns early, so phase 10 step "C6 and C7" may open
for the entries that phase 9 left (SLIC, mesh, planarFit, the KLT maximum, the Hough vote and
collect), with a hardware run while A1 is open, and triangulateTracks may leave the entries of
section 3.6".

### What A1 shows, and what it does not

**Fact** (issue #703 and `docs/hardware-notes.md`, A1). The remedy, the clamp-and-mask form,
completed on the device where the early return hung. The issue's comment of 2026-10-20 05:50 UTC
records it: "So the early return of the idle lanes was the condition, and the clamp-and-mask form
removes it on this driver." The issue asks for a kernel-author rule (item 1), or "a lowering that does
this for the author … This changes what the compiler emits for an existing program, so it needs a
proposal in `changes/`" (item 2). `docs/hardware-notes.md` lists the rule as a candidate, "not
decided" ("What a kernel author should know today", item 1).

**Fact** (the same sources). A1 is confirmed on one kernel and one device:

- the same kernel ran on an NVIDIA GeForce RTX 2080 (Turing) on 2026-10-17 with no loss, with a
  partial workgroup "almost certainly", and that run's browser and backend are not recorded;
- the CPU tier, SwiftShader (Vulkan) and an iPhone (Metal) run partial workgroups of the kernel with
  no loss;
- TypeCV's pair-model kernels have the same early return and verified pairs on the A1 device with no
  loss, so "the loop structure matters, and which property matters is not known".

**Inference.** The early return is a hazard on one device class under one driver, and a correct
WGSL program everywhere. The scaffold removes the condition that A1 names on every backend, at a cost
that does not depend on the device. That is why this draft makes it the default (decision D1).

### What the lowering does today

**Fact** (`src/core/passes/kernel-lower.ts` at `6c6a1d1`). `entryFor` (lines 752 to 773) writes the
map entry: the invocation index, then the early return (lines 756 to 767), then the iteration. The
store step of a push repeats it (lines 1922 to 1933). The count step of a push (lines 1772 to 1794) and
a reduction's loop entry (lines 903 to 937) do not return: an idle lane skips the iteration under
`_k < _n`, and the reduction's lanes then reach the tree's barriers together. The WebGL2 program
(lines 1538 to 1550) returns for a texel past the trip count.

**Fact** (`src/core/fuse-entry.ts`, lines 703 to 713). A fused group's entry takes "the first
member's guard": the statements between the invocation index and the first member's iteration.

**Fact** (`grid` in `src/core/host-kernel.ts`, line 981). A dispatch of `groups` workgroups runs
`x = min(groups, 65535)` by `y = ceil(groups / x)`. So up to 65,534 workgroups past the trip count can
run: 65,536 groups give 131,070. **Inference.** A clamp alone would make every lane of those
workgroups run iteration `n − 1`. The uniform return of part 1 keeps them as cheap as today.

### Relation to accepted proposals

- **Change 0067** (accepted on `main`): a kernel function's `@workgroup_size`, and a fused group's
  size (F7). The scaffold reads that size, and "the output bits are the same at every size" stays
  true (0067, rule 5).
- **Change 0057** (implemented): an override as a compute entry's workgroup dimension. A kernel
  function takes no override extent (Rule 8.22: "an override name is no extent in this version"),
  so the scaffold's size is a constant. An entry with an override size is an author's entry, which
  this proposal does not change.
- **Change 0074** (implemented): the host cuts a long kernel into chunks under a time budget. Each
  chunk is its own dispatch with its own last workgroup, and each takes the scaffold. A1's losses on
  `a3041af` were chunked runs: chunks did not remove the hang (TypeCV `docs/hardware-observations.md`,
  A1, "Remedy"). **Inference.** A chunk's time grows by at most the idle lanes of its last workgroup
  running iteration `n − 1`, which leaves the learned rate of change 0074 about where it is.
- **Change 0092** (accepted): the CPU tier runs an author's barrier entry in passes, and fails a
  workgroup that diverges at a barrier. An author's early return before a barrier is that divergence.
  A reduction's entry, which this proposal changes, has no return before its barriers today.
  After it, only a workgroup wholly past the trip count returns before them, as one, which is no
  divergence. The host's CPU tier runs a kernel function sequentially, so 0092 does not reach it.
- **Changes 0058 and 0078** (implemented): the fused entry and `push`. The scaffold keeps their
  facts, their order and their counts ("What a masked lane does").
- **Proposals 0094 and 0095** (drafts): a trip count read from the device, and R3's record form. The
  scaffold reads `_n` where 0094 puts it, and masks a record write as any other write.

### Alternatives considered

1. **Keep the early return, and document the hardware.** `docs/hardware-notes.md` keeps item 1 as
   advice. A1 is unconfirmed on any other device (above), so the early return stays correct and
   portable. But the compiler's own scaffold cannot follow the advice, so a loop-heavy map stays an
   entry while A1 is open (TypeCV phase 9). Rejected as the answer to C7 and to issue #703's item 2.
2. **A per-device switch**, an option of `createDevice` or a choice from the adapter's identity
   (change 0083 reports `architecture`). A1's scope is not known: one kernel, one device, one driver,
   an unknown component. A switch keyed to `blackwell` could miss the next device and would double the
   pipelines to compile. Rejected for now; decision D1.
3. **A uniform early return by whole workgroups alone.** It removes no lane of the partial workgroup,
   which is the workgroup A1 names. Taken as part 1 of this proposal, not alone.
4. **The skipped iteration everywhere.** No lane computes, which costs less, and no clamp can race.
   It is not the form that completed on the A1 device. Kept for the loops where the clamp races
   (decision D2).
5. **Full workgroups and a remainder dispatched at a workgroup size of 1.** No workgroup holds an idle
   lane. It doubles the pipelines and the dispatches of a map, and it cannot keep the tree of 256 of a
   reduction (Rule 7.2). Rejected.

### Unresolved decisions

- **D1. Default or option.** The scaffold for every kernel function (this draft), an option of
  `typeshade()`, or a per-device switch.
- **D2. The skipped form's scope.** The four cases above (this draft), or every loop, or none (a
  clamped read that races would then need another remedy).
- **D3. WebGL2.** Keep its early return (this draft), or clamp and mask there too, so one scaffold
  serves both GPU tiers.
- **D4. Entries an author writes.** Out of scope (this draft). A later proposal may offer an opt-in
  rewrite of an author's guard, issue #703's item 2 as written.
- **D5. The hardware evidence.** Whether acceptance waits for a run of a kernel function with a
  partial last workgroup on the A1 device, or only the implementation does. TypeCV's section 7, item
  11 decides who runs it.
- **D6. The face.** Whether the face of each loop says which form it took, so a library can check that
  a loop it converts takes the clamped form.

## What it touches

- **Rule 8.22.** A sentence on the WebGPU loop's invocations: every invocation of a workgroup that
  holds an iteration runs to the end of the loop's entry; one past the trip count runs the last
  iteration with its writes masked, or skips it where the clamp would race; a workgroup wholly past
  the trip count returns as one. The rationale cites A1 and issue #703. The "Enforced by" names the
  tests below.
- **Surface §65.** "Where it runs" gains the same sentences for an author: what the idle lanes of the
  last workgroup do, and that the results do not change.
- **Code.** `src/core/passes/kernel-lower.ts` (`entryFor`, `reductionEntries`, `pushEntries`),
  `src/core/kernel-workgroup.ts` (the workgroup's first index beside `invocationIndex`) and
  `src/core/fuse-entry.ts` (the guard of a fused group and its skipped form).
- **Documents.** `docs/hardware-notes.md`: item 1 of "What a kernel author should know today" and the
  "Decided" column of A1 name this change once it is accepted. `CHANGELOG.md`.
- **Tests.** The WGSL of each entry of the table, pinned in `src/compiler/ts/host-kernel.test.ts` and
  `src/compiler/ts/host-kernel-push.test.ts`. The oracle's run of the lowered plan
  (`src/core/testing/kernel-plan.ts`) on a partial last workgroup and on a grid that spills into `y`,
  bit for bit against the function on the oracle. The generated differential
  (`scripts/gpu-differential.ts`) with trip counts that are not a multiple of the workgroup size, held
  to the `f32` oracle bit for bit. The compile gate on Tint for every example kernel. Each of the four
  skipped cases, with its form.
- **Not touched.** No export, no diagnostic code, no example, no IR node and no backend writer.

**Fact** (`main` at `6c6a1d1`). Accepted proposals that are not implemented also declare these items:
Rule 8.22 (0056, 0067, 0077, 0080, 0085, 0091) and §65 (0051, 0056, 0065, 0067, 0068, 0077, 0080,
0082, 0085, 0091). Proposals 0094 and 0095 (drafts) declare them too. The implementation that lands
second rebases on the others' text.

### Draft impact estimate

**Known.** The WGSL of every kernel function's map loop, push loop and reduction loop changes, so the
emit goldens of the kernel examples are baked again (`bun run bake:goldens`). The result of every
call stays what it is on every tier, which the tests above must show. The CPU tier and WebGL2 do not
change. No export, code or example changes.

**Estimate.** The lowering's change is the scaffold of four entries and the guard of a fused entry,
a few dozen lines of `src/core/passes/kernel-lower.ts` and `src/core/fuse-entry.ts`. The validation
is the larger part: the differential cases and the hardware run. The run time cost is unmeasured.
Duration and cost are unestimated.

**TypeCV.** No line count (the row is an enabler). **Inference.** The maps that phase 9 left (SLIC,
mesh, `planarFit`, the KLT maximum, the Hough vote and collect) and the loop-heavy maps of phase 10
may convert once the hardware run passes. `triangulateTracks` may leave the list of entries.

**Decisions before acceptance:** D1 and D2. D3 to D6 may stay open.

### Approval and plan record

This record does not yet apply. Acceptance requires the merge of the proposal-only pull request
with `status: accepted`, the approved revision, the decisions taken on D1 to D6, the finalized
impact declarations, the assigned responsibilities and the required validation below. No approver,
milestone, duration or cost is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require: the implementing commits with
`Change: 0096`; the tests above, green; `bun run bake:goldens` for the intended emit change;
`bun run gate:compile`; `bun run gate:differential`; `bun run gate:journeys`; `bun run build`,
`bun run lint`, `bun run format:check` and `bun run test`; `bun run docs:impact`,
`bun run docs:refs`, `bun run reqs:sync` and `python scripts/doorstop-check.py -C -e -F`, with Rule
8.22 reviewed; and, under Rule 13.3, a run on the A1 device of a kernel function whose last workgroup
is partial, by the actor that TypeCV's item 11 names, recorded in `docs/hardware-notes.md`. Downstream
pins are tracked apart. These are requirements, not results.

## What it owes downstream

This draft did not search the site or the editor repository. The work below is expected work; a
search of each repository for "early return", "idle lane" and "past the trip count" fixes the list.

**typeshade.github.io.** Where the kernel-function page describes the dispatch, it gains what the
idle lanes of the last workgroup do. In English and Korean.

**vscode-typeshade.** Where the skill's kernel-function reference describes the dispatch, it gains
the same sentence.

**typecv.** Expected work, decided by TypeCV:

- Phase 9 and phase 10 step "C6 and C7": the maps that loop or clamp and mask may convert, each with
  the phase's gate and a hardware run while A1 is open (section 7, item 11).
- `docs/gpu-sfm.md`: the rule for kernel authors stays for entries. For a kernel function, the
  compiler's scaffold applies it.
- `triangulateTracks` may leave the entries of section 3.6, after R03 (section 4, rule 6).
- Probe S2 changes its verdict when this change lands, as its signal states.
- Record 0096 in `compiler-changes.md` when the pin moves.
