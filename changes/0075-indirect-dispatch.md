---
id: '0075'
title: 'A host dispatches an entry with a workgroup count the GPU wrote: indirect dispatch'
status: accepted
rules:
  - '8.24'
  - '11.8'
  - '11.13'
surface:
  - 65
  - 67
  - 71
exports:
  - FuseReport
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typecv
    what: 'The batch loop of `src/gpu/pair-estimation.ts` stops reading the scheduling word `modelProgress` after `summarizePairModelWork` and `snapshotPairModelBudget`. `summarizePairModelWork` writes the next batch''s workgroup counts (0 when the adaptive budget is met) into a `Uint32Array` resident, and the batch''s entry calls dispatch with `{ indirect }`. `ShadeDevice` passes the new workgroup argument through. `compiler-changes.md` records 0075 when the pin moves.'
  - repo: typenn
    what: Nothing must change. The change is additive, and its host loop decides every dispatch on the host. `compiler-changes.md` records 0075 when the pin moves.
  - repo: radiance
    what: 'Nothing must change. Record 0011 (compiler need C4, issue #540) asks for indirect dispatch through the program runtime''s `Frame.dispatch`, which this draft does not reshape (D7). `compiler-changes.md` records 0075 when the pin moves.'
  - repo: typeshade.github.io
    what: The guide pages that copy surface sections 65, 67 and 71 gain the indirect workgroup count and the report's `indirect` field. The English API entry of `FuseReport` is generated from its JSDoc. Not read in this draft; the implementation reads the site before acceptance is recorded.
  - repo: vscode-typeshade
    what: The host view of an entry call (the signature `hostFace` writes) gains the indirect form, which the editor shows in hover and completion. The host references that describe `entry(bindings, workgroups)` gain it. Not read in this draft; the implementation reads the plugin before acceptance is recorded.
---

<!-- doc-refs: skip-file — this draft names options, fields, files and tests that a later implementation adds, and files of other repositories, which this tree does not have -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Document                    | Proposal 0075. This file is the proposal source and the approved design of the change. Option A is the decided design. Options B and C are recorded as alternatives that this proposal does not take.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Revision context            | Drafted 2026-10-19, Asia/Seoul. This date is the authoring context. The owner approved the proposal on 2026-10-20 (Asia/Seoul) in the project conversation; see Approval and plan record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Request source              | The owner, Seungup, asked in the project conversation of 2026-10-19 to proceed with every possible step after a literature review. That review named indirect dispatch as the missing primitive (typecv `docs/gpu-sfm-research.md`, see Why). That is the attribution of the request. It is not an approval of the proposal. Issue #540 (open, filed from radiance's record 0011) asks for the same primitive through the program runtime.                                                                                                                                                                                                                                                                                                                                           |
| Attribution                 | Drafted by an agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Current lifecycle state     | `accepted`. Accepted by the owner's approval of 2026-10-20 (see Approval and plan record), recorded by the merge of PR #696. The implementation is on branch `impl/0075-indirect-dispatch` and is not merged (see Configuration and validation record).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Applicability / effectivity | The entry call of the call layer (`src/core/host-compute.ts`: `callCompute`, `checkEntryCall`, `runEntry`; `src/core/host-entry.ts`: `workgroupsOf`, the dispatch batch, `onCpu`, the buffer usage of a `Resident`), the WebGL2 pass of an entry (`src/core/gl-compute.ts` through `onGl`), the plan of a fuse scope (`src/core/fuse-plan.ts`) and its report (`src/core/fuse-report.ts`), the host view of an entry (`src/compiler/ts/host-face.ts`, read by `src/language-service/index.ts`), the capability coverage rows of `src/core/coverage/webgpu-objects.ts`, Rules 8.24, 11.8 and 11.13 of `docs/language-design.md`, sections 65, 67 and 71 of `docs/use-typeshade-surface.md`, `reqs/`, `CHANGELOG.md` and the downstream documentation. No release version is assigned. |
| Review baseline             | `origin/main` at `17f1c58f33817fccaec9e8dbea08003d0d9d8841` (commit "Merge pull request #694 from typeshade/proposal/0074-time-budget").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Proposal review             | [PR #696](https://github.com/typeshade/typeshade/pull/696), the proposal-only pull request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Revision authority          | Git records the revisions of this file. The review and merge of PR #696 record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## What changes

**Before.** A host calls an exported `@compute` entry as `entry(bindings, workgroups)` (Rule 8.24, surface §67). `workgroups` is `n` or `[x, y?, z?]`, and the call layer dispatches it as written. The host view types the argument as `number | readonly [number, number?, number?]` (`computeFace` in `src/compiler/ts/host-face.ts`). `workgroupsOf` in `src/core/host-entry.ts` checks the numbers when the call is checked, before anything runs. On WebGPU the dispatch batch records `dispatchWorkgroups(x, y, z)`. On WebGL2 the pass program runs that grid. The CPU tier runs every invocation of that grid (`onCpu`).

So the host must know the count when it makes the call. A count that a kernel computes reaches the host only through a read: `await r.read()` of a `Resident`, a map of a staging buffer and a wait for the queue. typecv's RANSAC search makes such a read between batches (see Why).

The call layer gives a `Resident` buffer the usages `STORAGE | UNIFORM | VERTEX | INDEX | COPY_DST | COPY_SRC` (`RESIDENT_USAGE` in `src/core/host-entry.ts`). It does not give `INDIRECT`. The capability coverage table records `GPUComputePassEncoder.dispatchWorkgroupsIndirect()` and `GPUBufferUsage.INDIRECT` as `gap` on WebGPU, both naming issue #540.

**Proposed design (option A).** An entry call takes a workgroup count that a `Resident` holds. A kernel writes the count, and the host submits the next dispatch without a read.

1. **The spelling.** The second argument of an entry call also takes `{ indirect, offset? }`:
   - `indirect` is a `Resident<Uint32Array>`: from `resident(value)`, from `resident(length, 'u32')`, or from `device.array()` of the call's owner.
   - `offset` is a whole number of elements, 0 by default. The count is the three elements from `offset`: x, y and z, in the order of `dispatchWorkgroups`.
   - The host view types the argument as `number | readonly [number, number?, number?] | { readonly indirect: Resident<Uint32Array>; readonly offset?: number }`, in both signatures of §67 (the queued one that returns `void`, and the one that returns a promise).
   - The offset counts elements, not bytes. The byte offset is `4 × offset`, so WebGPU's rule that the offset is a multiple of 4 always holds.
   - Reason for the object, and not a bare `Resident` as the second argument: the call site says that the GPU decides the count, the offset has a place, and issue #540 sketches the same shape (`{ indirect: buffer, offset }`). D2 records the alternative.
2. **WebGPU.** The dispatch batch records `dispatchWorkgroupsIndirect(buffer, 4 × offset)`, where `buffer` is the `Resident`'s device buffer. The call layer makes the buffer, or uploads the host copy, as it does for a `Resident` binding today (`bufferFor`). The dispatch only reads the buffer, so a host copy that is the newer one is uploaded, and a device copy that is the newer one stays.
3. **The usage.** Every `Resident` buffer gains `GPUBufferUsage.INDIRECT` (`0x0100`): `RESIDENT_USAGE` adds the flag. The call layer makes no second buffer and copies nothing. D3 records the alternatives and their costs.
4. **The CPU tier.** The CPU tier reads the three elements from the `Resident`'s host copy when the call runs, in the order of the kernel queue (Rule 11.8), and not when the call is made. It brings the host copy up to date first, as it does for a `Resident` binding (`sync`): a read of the device buffer when a call on WebGPU wrote it last. It then runs that grid, as `onCpu` runs a grid today. `num_workgroups` is the three numbers it read. So the CPU tier runs what the WebGPU dispatch runs, and the oracle's results stay bit for bit those of the calls.
5. **WebGL2.** WebGL2 has no compute stage and no indirect dispatch. The WebGL2 tier holds a `Resident` as its host array already (§67: "a `Resident` is the array it holds, as on the CPU tier"). So it reads the three elements from that host copy when the call runs, brought up to date as in item 4, and runs that grid as the pass program of change 0054. It does not refuse the call. D4 records the alternative.
6. **A count of 0 and a count past the limit.** A count with a 0 in it runs no workgroup on every tier. A count with a number greater than the device's `maxComputeWorkgroupsPerDimension` runs nothing on WebGPU, as the specification's queue timeline steps say (quoted in Why). The CPU tier and the WebGL2 tier follow WebGPU: they run nothing for such a count. They read the limit of the owner's WebGPU device when it has one, and 65535 (the specification's default) when it has none. No tier throws for the words, since WebGPU cannot report them without a read. D5 records the alternative.
7. **A `fuse` scope (Rule 11.13).** An entry call with `{ indirect }` in the body of `fuse()` or `device.fuse()` is recorded as any entry call is. It is a group of its own (fact F8 of `core/fuse-group.ts`), so the planner needs no new fact. Reason: an entry call already joins no kernel call, and a kernel call takes no workgroup count. The plan reads the counts array as a read of the call, so the call depends on the last call before it that wrote the array (`buildPlan`). The group in the report gains `indirect: true`. `dispatches` counts the dispatch once, whatever the three elements hold, since the plan does not read them on WebGPU. The CPU tier and WebGL2 count as item 4 and item 5 say, and a read of the device buffer that the counts need is a submission, as for any `Resident` a call on the host reads.
8. **A kernel function (Rule 8.22).** A kernel function's call takes no indirect count in this proposal. Its dispatch size is its loop's trip count, which the array lengths fix at the call. The planner compares those trip counts when the plan is settled (F2). A count from the GPU would remove that fact, and no consumer has asked for it.
9. **The refusals.** The call layer refuses each of these before anything runs, with a `TypeError` that names the entry and the field (`workgroups.indirect` or `workgroups.offset`), as Rule 8.21 refuses an array too short:
   - `indirect` is not a `Resident`, or its host value is not a `Uint32Array` (a zeroed array of `'f32'` or `'i32'` among them).
   - `offset` is not a whole number from 0, or `offset + 3` is greater than the array's length. The message gives both numbers.
   - The `Resident` is of another owner (Rule 11.8). The wording is the one `foreignOwner` gives today, naming both owners.
   - The `Resident` is a scratch array of a `fuse` scope, which only a kernel call takes (Rule 11.13).
   - The `Resident` is also a binding that the entry writes. WebGPU refuses a buffer used as an indirect buffer and as a writable storage binding in one dispatch (the usage scope rule quoted in Why). A binding that the entry only reads is allowed.
   - The `Resident` was destroyed (the existing wording).

   An object with another key, or with no `indirect`, is refused as `workgroupsOf` refuses a wrong count today. No new diagnostic code is added: these are run-time refusals of a host call, and the compiler's type check of the host view catches the wrong shapes before they run.

**Example (illustrative, not an accepted example).** The shape of typecv's batch loop with this change. An entry writes the next batch's counts into `next`, a `Resident` of six words: three for the model entries and three for the scoring entry. It writes 0 as x when the adaptive budget is met. The host submits each batch with no read, and reads the result once:

```ts
import { createDevice } from 'typeshade/runtime';
import 'typeshade/fuse';
import { preparePairModels, scorePairModels, summarizePairModelWork } from './pair-models.shade.ts';

const device = await createDevice({ prefer: ['webgpu', 'cpu'] });
// [x, y, z] of the model entries, then [x, y, z] of the scoring entry.
const next = device.array(new Uint32Array([groups, 1, 1, scoreGroups, 1, 1]));
for (let batch = 0; batch < maxBatches; batch++) {
  await device.fuse(() => {
    preparePairModels(bindings, { indirect: next });
    scorePairModels(scoring, { indirect: next, offset: 3 });
    summarizePairModelWork({ state, modelState, next }, 1); // writes [0, 1, 1, 0, 1, 1] when done
  });
}
const best = await bestModel.read(); // the one read of the search
```

The body has braces. A body that returns a promise is refused as an `async` body (Rule 11.13). The host still bounds the loop (`maxBatches`). After the budget is met, each later plan dispatches zero workgroups. The host may read `next` every few batches to leave the loop early (see Why, "The cost"). Each dispatch is still one submission item, so the time budget of change 0074 applies to it as before. The example set does not change (`examples: []`).

## Why

**The problem.** typecv's RANSAC search decides, between batches, whether to run the next batch and how much of it to run. The decision rests on an adaptive trial budget that the GPU computes. These facts are read at typecv `main` `41b6c32` (2026-10-20 01:38 +0900, the merge of typecv PR #50):

- `summarizePairModelWork` (`src/gpu/pair-models.shade.ts`) writes one `u32` scheduling word, `modelProgress[0] = (state[0] << 1) | u32(remaining !== 0)`: the adaptive budget and a flag that some model is still active.
- `snapshotPairModelBudget` writes `modelProgress[0] = state[0]`, the budget alone.
- The batch loop of `src/gpu/pair-estimation.ts` reads that word with `device.read(modelProgress, 1)` after `summarizePairModelWork`, to decide whether to run `appendPairModelRows`, `solvePairModelNull` and `finishPairModels`. It reads it again after `snapshotPairModelBudget`, between batches, to decide whether to prepare the next batch. That is up to two reads of one word for each batch.
- typecv's `docs/gpu-sfm.md`, "The time budget: pair model generation runs as chunks", states the design: the host "reads the scheduling word and schedules the next batch, and nothing else until the search is done".

Each read is a map of a staging buffer and a wait for the queue to drain, so the GPU is idle while the host decides. The requester estimates the round trip at about a millisecond on a desktop and more on a phone. That estimate is not measured in this repository or in the typecv records read for this draft (see Validation, the hardware check).

**The literature.** typecv's `docs/gpu-sfm-research.md`, section "Long kernels under a GPU watchdog: what the literature says (2026-10-19)", read at typecv branch `docs/long-kernel-literature` commit `34fb8fd` (not merged into typecv `main` when this draft was written), records these points:

- Kornia's batched CUDA RANSAC (PR #4979, 2026) draws hypotheses in batches and checks PROSAC termination between batches, as typecv's adaptive stop does.
- NVIDIA's Iray renderer stops a long kernel through a flag in mapped memory that the kernel polls. The section states that WebGPU has no host-writable memory that a running dispatch can poll, so the host can only size the next submission.
- The section's inference for TypeShade: indirect dispatch is the missing primitive. The GPU decides the next batch's workgroup count from the adaptive stop, and the host reads nothing between batches.

**What WebGPU gives.** The WebGPU specification (W3C Candidate Recommendation Draft, 15 September 2026, https://www.w3.org/TR/webgpu/#dom-gpucomputepassencoder-dispatchworkgroupsindirect, read on 2026-10-19) defines the method. Quoted:

- The parameters: "The indirect dispatch parameters encoded in the buffer must be a tightly packed block of three 32-bit unsigned integer values (12 bytes total), given in the same order as the arguments for dispatchWorkgroups()." `indirectOffset` is the "Offset in bytes into indirectBuffer where the dispatch data begins."
- The device timeline checks: "indirectBuffer.usage contains INDIRECT", "indirectOffset + sizeof(indirect dispatch parameters) ≤ indirectBuffer.size" and "indirectOffset is a multiple of 4". The same steps "Add indirectBuffer to usageScope with usage input."
- The queue timeline: "If workgroupCountX, workgroupCountY, or workgroupCountZ is greater than this.device.limits.maxComputeWorkgroupsPerDimension, return." The default of that limit is 65535.
- The flag: `const GPUFlagsConstant INDIRECT = 0x0100;`. Buffer creation restricts only `MAP_READ` ("must contain no other flags except COPY_DST") and `MAP_WRITE` (except `COPY_SRC`), so `INDIRECT` combines with the usages a `Resident` has.
- The usage scope rule: a list of usages is compatible when "Each usage in U is input, constant, storage-read, or attachment-read", or when each is `storage`. "In a compute pass, each dispatch command (dispatchWorkgroups() or dispatchWorkgroupsIndirect()) is one usage scope." Inference: one dispatch may not use a buffer as its indirect buffer (`input`) and as a writable storage binding (`storage`). A read-only storage binding (`storage-read`) is compatible. That is the reason for the refusal in item 9.
- A count of 0. Neither method's validation sets a lower bound, and the compute algorithm (§ 23.1) loops "in range [0, dispatchCall.workgroupCountX]" over each count. Inference: a count with a 0 dispatches no workgroup, and it is valid.

MDN's page (https://developer.mozilla.org/docs/Web/API/GPUComputePassEncoder/dispatchWorkgroupsIndirect, last modified 2026-05-21, read on 2026-10-19) states the same three validation criteria, for example "`indirectOffset` is a multiple of 4." It marks the method "Limited availability", "not Baseline because it does not work in some of the most widely-used browsers". MDN has no note on a count of 0 or on a count past the limit.

**Options.** Each names what it touches.

- **Option A. An entry call takes an indirect count from a `Resident` (proposed).**
  - Touches: Rule 8.24 (the argument), Rule 11.8 (the usage of a `Resident` buffer, and how each tier reads the count), Rule 11.13 (the recorded call, its dependency on the counts array and the report's `indirect`), surface §65, §67 and §71, the export `FuseReport` (reshaped), and the host view of an entry.
  - Trade-off: the host reads nothing between batches. The host no longer knows when the search ends, so it submits up to its bound, and each plan after the end dispatches zero workgroups (The cost, below).
- **Option B. Keep the host read (the status quo).**
  - Touches: nothing in the compiler.
  - Trade-off: no compiler work. typecv keeps up to two one-word reads per batch, each a wait for the queue. A consumer with a GPU-sized count either reads it back or dispatches the capacity, as issue #540 states for radiance.
- **Option C. Speculative submissions with a flag in the kernel.**
  - The host submits a fixed number of batches ahead. Each kernel reads a "continue" flag that an earlier kernel wrote and returns at once when the flag is clear.
  - Touches: nothing in the compiler. Every kernel of the batch gains the check.
  - Trade-off: it works today. But every invocation of a skipped batch still runs to its first check, so a skipped batch costs a full grid of early returns, where option A costs an empty grid. The count of submissions depends on the host's guess, so the host still reads the flag to correct the guess. It is not proposed.

**Recommendation.** Option A. It removes the read that typecv makes between batches, with a primitive that WebGPU defines, that the CPU tier can run bit for bit, and that the WebGL2 tier can run from the host copy it holds already.

**The cost (inference, not measured).** Option A trades the read for submissions. With a host bound of `maxBatches` and a search that ends at batch `k`, the host submits `maxBatches − k` plans of empty dispatches. Each costs its encoding and one `queue.submit`, and no workgroup. An application can read the counts every `K` batches and leave its loop when they are 0: the reads drop from up to two per batch to one per `K` batches. The draft leaves `K` to the application.

**Assumptions.**

- A browser that implements WebGPU implements `dispatchWorkgroupsIndirect`. MDN marks the method as not Baseline. The draft assumes the browsers that run TypeShade's WebGPU tier (the journeys' Chromium, the owner's devices) have it. It is not checked in this draft.
- A browser may add work for each indirect dispatch to apply the limit check of the queue timeline. That cost is not measured in this draft (Open items).

## What it touches

- **Rule 8.24:** the second argument of an entry call takes `{ indirect, offset? }`: its meaning, its offset in elements, its refusals and its type in the host view. The direct form `n` or `[x, y?, z?]` does not change.
- **Rule 11.8:** a `Resident` buffer has the usage `INDIRECT`. Each tier reads an indirect count: WebGPU by `dispatchWorkgroupsIndirect`, the CPU tier and WebGL2 from the host copy brought up to date, when the call runs. A count past the limit runs nothing on every tier. The owner check covers the counts array.
- **Rule 11.13:** an entry call with an indirect count in a scope: it stays a group of its own (F8), the counts array is a read of the call in the plan's order, `dispatches` counts it once, and the group has `indirect: true`.
- **Surface §65:** the paragraph "Resident arrays" gains one sentence: a `Uint32Array` resident can hold an entry's workgroup count (§67).
- **Surface §67:** "The workgroup count" gains the indirect form, its offset, the tiers, the limit and the refusals.
- **Surface §71:** an entry call with an indirect count in a scope, and the report's `indirect`.
- **Surface §69:** not declared. The program runtime's `Frame.dispatch` and `ComputePipeline.dispatch` do not change in this draft (D7).
- **Exports:** `FuseReport` is reshaped: a group gains the optional `indirect: true`. The host view of an entry is generated by `hostFace` for each module and is not an export of `src/__api__/surface.md`. `resident`, `Resident` and `Device` do not change under the draft's D3. The explicit option of D3 would reshape them.
- **Codes:** none. The refusals are `TypeError`s of the call layer, as `workgroupsOf` refuses a count today.
- **Examples:** none.
- **Documents:** `CHANGELOG.md` gains an entry. `reqs/` follows the edits of the three rules and the three sections through `bun run reqs:sync` and `python scripts/doorstop-check.py -C`. The coverage rows of `GPUComputePassEncoder.dispatchWorkgroupsIndirect()` and `GPUBufferUsage.INDIRECT` move from `gap` to `typed` on WebGPU, naming the test that verifies them (Rule 11.18), and `docs/capability-coverage.md` is baked again (`bun run bake:capability-coverage`). Their WebGL2 cells stay `n/a`. Their notes keep the program runtime's gap and issue #540 (D7). The JSDoc of `FuseReport` and the comment that `hostFace` writes on an entry change with them.

### Draft impact estimate

- **Technical work (known).**
  - `src/core/host-entry.ts`: `workgroupsOf` accepts the indirect form and checks its shape. The compute pass type of `GpuDevice` gains `dispatchWorkgroupsIndirect`. `USAGE` and `RESIDENT_USAGE` gain `INDIRECT`. The dispatch batch takes either a grid or an indirect buffer with its byte offset. `onCpu` takes the grid it is given, as today.
  - `src/core/host-compute.ts`: `CheckedEntry` carries the counts array and its offset. `runEntry` resolves the grid on each tier when the call runs (`bufferFor` on WebGPU, `sync` then a read of three elements on the CPU tier and WebGL2). `callCompute` checks the owner of the counts array and keeps the error of a failed queued call as today.
  - `src/core/fuse-plan.ts`: `entry()` checks the counts array's owner. `accessesOf` and `buildPlan` count it as a read. The report sets `indirect` on the group.
  - `src/core/fuse-report.ts`: the optional `indirect` field and its JSDoc.
  - `src/compiler/ts/host-face.ts`: the parameter type of both entry signatures. The language service reads the same face.
  - The test doubles of the recording and fake devices (`src/fuse.test.ts`, `src/runtime/runtime.test.ts`, `src/runtime/device.test.ts`) gain `dispatchWorkgroupsIndirect`.
- **Technical work (estimate).** About 150 lines of source and 300 lines of tests. Not measured. The basis is the size of `workgroupsOf`, the batch's dispatch and the entry path of the plan.
- **Bundle.** `typeshade/runtime` measured 35,777 bytes minified and gzipped against a budget of 39,000 in change 0073's record. Change 0074 adds an unmeasured growth before this one. The growth of this change is estimated at a few hundred bytes. Not measured. `typeshade/fuse` is expected to grow by a few lines.
- **Compatibility.** Additive. A call with a number or a tuple runs as today. The new usage flag changes no buffer's size or contents. A host that re-declares the report type stays compatible, since the field is optional.
- **Dependencies.** Change 0071 (the device owner and `device.array()`, implemented on the review baseline). Change 0074 (accepted, not implemented): no dependency, but see Open items for the chunk's units.
- **Tools.** No new tool. The checks are those of Validation.
- **Downstream effort.** See "What it owes downstream".
- **Unestimated.** Effort, schedule and cost are unknown. None is recorded as established.

### Decisions for the owner

- **D1. Option A, B or C?** The draft recommends A.
- **D2. The spelling.** The draft takes `entry(bindings, { indirect, offset? })`, with the offset in elements. The alternatives are `entry(bindings, counts)` with a bare `Resident` and no offset (the offset then needs a third argument or a view), and an offset in bytes as WebGPU spells it, which needs the check of a multiple of 4.
- **D3. How a buffer gets `INDIRECT`.** The draft adds the flag to every `Resident` buffer (`RESIDENT_USAGE`). Its cost: one bit of the usage, and no extra memory or copy that the specification names. The alternatives:
  - Only a `Resident` of a `Uint32Array` or of `resident(n, 'u32')`. The same cost, and one more branch where the buffer is made.
  - The flag on the first indirect use, with a new buffer and a copy. It costs a copy, and a bind group of the program runtime that holds the old buffer goes stale.
  - An explicit option, `resident(value, { indirect: true })` and the same on `device.array()`. It reshapes the exports `resident`, `Resident` and `Device`, and a host that forgets the option gets a refusal.
- **D4. WebGL2.** The draft reads the three elements from the host copy that the WebGL2 tier holds already. The alternative refuses an indirect call on WebGL2 with a `TypeError`, so the call goes to the next tier of `configure({ prefer })`.
- **D5. A count past the limit.** The draft runs nothing on every tier, as WebGPU's queue timeline does. The alternative, which issue #540 suggests, throws a `RangeError` on the CPU tier and WebGL2 naming the limit. That alternative makes the tiers differ: WebGPU cannot throw for a count it does not read back.
- **D6. The default owner.** The draft lets a bare entry call, `fuse()` of `typeshade/fuse` and `device.fuse()` all take the indirect form, since every one of them takes an entry call today. The alternative limits it to a device owner, which needs one more refusal.
- **D7. The program runtime.** Issue #540 and radiance's record 0011 ask for the same primitive through the program runtime (`Frame.dispatch(pipeline, bindings, workgroups)` and `ComputePipeline.dispatch(target, bindings, workgroups)`, surface §69). The draft leaves them out, to keep one change to one call path, and issue #540 stays open for them. The alternative widens this proposal: the same `{ indirect, offset? }` there, with §69 and the exports `Frame` and `ComputePipeline` declared.
- **D8. The class of the refusals.** The draft throws a `TypeError` for every refusal of item 9, as Rule 8.21 refuses an array too short. The alternative throws a `RangeError` for an offset past the array's length.

### Approval and plan record

- **Decision.** The owner approved the proposal in the project conversation on 2026-10-20 (Asia/Seoul), as drafted: option A (D1), `entry(bindings, { indirect, offset? })` with the offset in elements (D2), `INDIRECT` on every `Resident` buffer (D3), WebGL2 reading the count from its host copy (D4), nothing run for a count past the limit on every tier (D5), the indirect form for every owner (D6), the program runtime left out (D7) and a `TypeError` for every refusal (D8). The merge of PR #696 records the acceptance.
- **Approved revision.** This file at the commit that PR #696 merges. Git records that commit.
- **Scope.** Option A as "What changes" states it, with D1 to D8 as decided above. The front matter stands as declared: D3 and D7 as decided change no export beyond `FuseReport`. No decision is open. The open items below stay open as later proposals or application work, not as conditions of this acceptance.
- **Responsibilities and milestones.** The implementation is the next work of the session that drafted this proposal, on a branch of its own, with commits that carry `Change: 0075`, followed by typecv's pin move and the removal of its scheduling-word reads. No schedule or estimate is established.
- **Required validation.** The validation list below. What ran, and what stood in for an item that could not run as written, goes in the Configuration and validation record.

### Validation (required before the implementation merges)

Functional:

- Call-layer tests on the fake device of `src/runtime/runtime.test.ts` (or the recording device of `src/fuse.test.ts`):
  - an entry call with `{ indirect: r, offset: 3 }` records `dispatchWorkgroupsIndirect` with `r`'s device buffer and the byte offset 12, and no `dispatchWorkgroups`;
  - the buffer of a `Resident` has a usage that contains `0x0100`, under the usage D3 decides;
  - each refusal of item 9: a `Float32Array` resident, an array of two elements, an offset of 1 on an array of three, an offset of `1.5`, a resident of another owner, a scratch array, a counts array that the entry also writes, and a destroyed resident, each with its wording; a counts array that the entry only reads is accepted.
- The CPU tier (`src/compiler/ts/host-entry.test.ts`, against the interpreter's dispatch): a two-step test. One entry writes `[4, 1, 1]` into a resident, and the next call with `{ indirect }` runs 4 workgroups, read from `num_workgroups` and from the elements it writes. The words `[0, 1, 1]` run nothing. A word past 65535 runs nothing, under the rule D5 decides.
- The plan (`src/fuse.test.ts`): an indirect entry call in a scope is a group of its own, its report group has `indirect: true`, `dispatches` counts it once, a call that writes the counts array before it orders before it, and on the CPU tier the call reads what an earlier call of the same plan wrote.
- Both halves (`CLAUDE.md`, "A test reads both halves"): the host view under `tsc` accepts `{ indirect: r }` and `{ indirect: r, offset: 3 }` and refuses `{ indirect: new Uint32Array(3) }`, and the language service's `getDiagnostics` and `getHover` on the same host source agree (`src/compiler/ts/host-entry.test.ts` and `src/language-service/`).
- WebGPU in a browser: the import journey (`scripts/user-journey.ts`, `gate:journeys`) gains one indirect call on WebGPU in Chromium, whose counts an earlier call wrote, held to the CPU tier. This is the test the coverage rows name.
- WebGL2, under the rule D4 decides: the call runs the grid of the host copy, or is refused with its wording.
- The existing gates: `bun run build` (the type check), `bun run lint`, `bun run format:check` and `bun run test` (CI's `typecheck + unit`), `bun run gate:compile` (`compile gate (Tint + WebGL2)`) and `bun run gate:journeys` (`user journeys (packed tarball, WebGPU)`), with no existing result changed.
- `bun scripts/bundle-boundary.ts`: `typeshade/runtime` and `typeshade/fuse` stay inside their budgets, or the budget moves in the same pull request with the measured growth.
- Hardware (Rule 13.3): the typecv lab, with typecv's pin moved and its batch loop changed, runs pair model generation on the owner's devices. The reads of the scheduling word drop to zero, or to one per `K` batches, in the record's `applicationReadbackBytes`, and the selected models are equal to those of the loop with reads. The time of a search is recorded beside the lab records of 2026-10-19.

Document:

- `bun run bake:api-surface` lists the reshaped `FuseReport`, and nothing else moves.
- `bun run bake:capability-coverage` moves the two rows to `typed` with the test named, and `src/core/spec-conformance/capability-coverage.test.ts` passes.
- `bun run docs:impact` and `bun run docs:refs` pass after the rule and surface edits.
- `bun run reqs:sync`, then `python scripts/doorstop-check.py -C`, after the edits of Rules 8.24, 11.8 and 11.13 and sections 65, 67 and 71.
- `bun scripts/changes.ts` passes on the implementing pull request.

**Acceptance (for the eventual implementation).** A host submits a chain of entry calls whose workgroup counts an earlier call wrote, with no read between them, on WebGPU, on WebGL2 and on the CPU tier, and every array they write holds the same bits on the three tiers.

### Configuration and validation record

The status stays `accepted` until the implementing pull request merges. The rows below record what the implementing branch delivers and what ran on it.

- **Accepted revision.** This file at the merge of PR #696, `2a5859d`.
- **Implementing branch.** `impl/0075-indirect-dispatch`, from `main` at `2a5859d`. The pull request is not opened yet. Its commits carry `Change: 0075`: `7902aea` (the call layer, the planner, the report, the host view, the tests and the API surface), `c744805` (the import journey, the coverage rows, the rules, the surface, the changelog, the requirements tree and the maps), and the commit that contains this record, which Git knows.
- **Delivered configuration.** `src/core/host-entry.ts` (`workgroupsOf` takes `{ indirect, offset? }`; `USAGE.INDIRECT` and `RESIDENT_USAGE`; the compute pass gains `dispatchWorkgroupsIndirect`; `GpuDevice.limits.maxComputeWorkgroupsPerDimension`; the batch's `Workgroups` is three counts or a buffer and a byte offset, and a pending clear of the counts buffer runs before its pass), `src/core/host-compute.ts` (`indirectOf`, `countsOf`, `CheckedEntry.wg` as three counts or an `IndirectCount`, the owner check in `callCompute`, the grid on each tier in `runEntry` and `gridOf`), `src/core/fuse-plan.ts` (the counts array a read in `accessesOf` and `buildPlan`, `PlanCall.indirect`, the owner and scratch checks in `entry()`, the report's `indirect`), `src/core/fuse-report.ts` (`indirect?: true` and its JSDoc), `src/compiler/ts/host-face.ts` (`WORKGROUPS` in both signatures, the view's `Resident` import for every module with a `@compute` entry, the comment on the entry), `src/core/coverage/webgpu-objects.ts`, `src/__api__/surface.md`. `src/core/fuse-group.ts` and `src/core/gl-compute.ts` did not change: F8 holds as it was, and `onGl` gets the grid that `runEntry` read. The program runtime (`src/runtime/program.ts`, `src/runtime/gl.ts`) did not change (D7). Tools in the container: bun 1.4.2, TypeScript 5.6.3, Node 22.22.0, vitest 3.2.7, Doorstop 3.2, Playwright's Chromium from `/opt/pw-browsers`.
- **Functional validation, observed on 2026-10-19 (UTC) on `c744805`.** `src/fuse.test.ts` (18 new tests): on the recording device a call with `{ indirect: r, offset: 3 }` records `dispatchWorkgroupsIndirect` with `r`'s buffer at byte 12 and no `dispatchWorkgroups`; a Resident buffer, a zeroed one among them, has the usage `RESIDENT_BUFFER` with `0x0100`, and a zeroed counts array is not written; a newer host copy is uploaded and a current one is not; in a scope the call after `uadd` that writes its counts is a group of its own with `indirect: true`, `dispatches` 2 and one submission; a pooled array of counts is cleared before its pass; on the CPU tier the call reads what `uadd` wrote in the same plan, `[0, 1, 1]` runs nothing, a count past the configured device's `maxComputeWorkgroupsPerDimension` of 2 runs nothing and a count of 2 runs, and a counts array that the entry only reads is accepted; on WebGL2 (a stand-in context) the pass program gets the grid `[7, 3, 2]` of the host copy and is not run for a count with a 0; each refusal of item 9 with its wording (a `Uint32Array` that is no Resident, a `Float32Array` resident, a zeroed `'i32'` array, two elements, offset 1 on three elements, offsets `1.5`, `-1` and `'3'`, another key, no `indirect`, a counts array that the entry writes and one that it binds `read_write`, a destroyed Resident, a scratch array), a refused indirect call fails its whole plan; the plan record reads the counts array and depends on its writer. `src/runtime/device.test.ts` (2 new tests): a counts array of another owner is refused in a bare call and in `device.fuse()`, naming `workgroups.indirect` and both owners; a pooled array of counts on a device is cleared and dispatched in one submission. `src/compiler/ts/host-entry.test.ts` (3 new tests): the two-step CPU test (`plan` writes `[4, 1, 1]`, `mark` runs 4 workgroups, `num_workgroups` and the written elements equal the interpreter's `dispatch('mark', [4, 1, 1])`), `[0, 1, 1]` and 65536 run nothing, offset 3 reads `[3, 1, 1]`; both halves (below). `bun run build`, `bun run lint` and `bun run format:check` pass. `bun run test`: 459 of 460 files and 10,576 tests pass, 4 skipped, 1 todo. The one failure is `src/scope-backtest.test.ts` ("resolves every fix commit in this repository"): `git rev-parse` cannot find `596c805` in the container's shallow clone. CI checks out the full history, and this change touches no file that test reads. `bun run gate:compile`: 163 examples, WGSL on Tint 163, GLSL ES 3.00 on WebGL2 124, render pipelines on Tint 121, 21 entry calls, 0 failures. `bun run gate:journeys`: 28 journeys, 71 runs, every check passed; the import journey's indirect chain ran on WebGPU in headless Chromium (SwiftShader), with WebGPU required, and on the CPU tier, and both equal the reference and each other element for element (`WebGPU's indirect dispatch writes what the CPU tier writes`).
- **Both halves.** The host view under `tsc` accepts `{ indirect: counts }` and `{ indirect: counts, offset: 3 }` and refuses `{ indirect: new Uint32Array(3) }`, `{ indirect: resident(new Float32Array(3)) }` and `{ indirect: counts, offset: "3" }` with `TS2769`. The editor's half of a host file is a TypeScript language service over the same host source and view: the same diagnostics, and its hover on the call shows the indirect form. Deviation from the text of Validation: `createTypeshadeLanguageService` serves `"use typeshade"` documents only, so its `getDiagnostics` (no diagnostic) and `getHover` (`(parameter) nw: vec3<u32>`) read the shader module, and the TypeScript language service stands in for it on the host source.
- **WebGL2 (D4).** The call runs the grid of the host copy. The unit test reads it on a stand-in context; the journey's WebGL2 pages run no indirect call.
- **Bundle.** `bun scripts/bundle-boundary.ts` on `c744805`: `typeshade/runtime` 38,944 bytes minified and gzipped (budget 39,000; 38,932 on `2a5859d`, so 12 bytes of growth), `typeshade/fuse` 81,439 (budget 86,000; 81,292 before). No budget moves. The runtime has 56 bytes of room left.
- **Document validation, observed on 2026-10-19.** `bun run docs:impact` listed review items only; each sentence that states the forms of the workgroup count, the usages of a Resident buffer or the fields of a report group was read, and the stale ones were fixed (the rules, the surface, `journeys/README.md`, the journey's comments, the JSDoc of `callCompute`). `bun run docs:refs`: 0 dead references in 1,216 files. `bun run reqs:sync`, then `python scripts/doorstop-check.py -C -e -F` clean after `doorstop review` of RULE-0824, RULE-1108 and RULE-1113 and `doorstop clear` of SURF-038, SURF-065, SURF-067, SURF-069 and SURF-071. `src/fuse.test.ts` now carries `Verifies: Rule 8.24`. `bun run bake:api-surface` moves `FuseReport` alone. `bun run bake:capability-coverage` moves the two rows to `typed`, naming `scripts/user-journey.ts`, with 0 defects, and `src/core/spec-conformance/capability-coverage.test.ts` passes (92 tests). `bun scripts/changes.ts --base origin/main` passes: the change touches Rules 8.24, 11.8 and 11.13, surface §65, §67 and §71, and the export `FuseReport`. `scripts/ifchange.ts` passes.
- **Deviations.**
  1. Item 9 refuses a counts array that is also a binding the entry writes. The implementation also refuses one that the entry binds `read_write` and does not write: WebGPU binds it as writable storage, which the usage scope rule refuses with an indirect buffer in one dispatch. Disposition: closed, stated in Rule 8.24 and surface §67.
  2. The editor's half of Validation, as "Both halves" above records. Disposition: closed.
  3. The CPU tier and WebGL2 read the limit from a device the owner holds without asking for one: for the default owner, the device of `configure({ runtime })` or the call layer's device once it is made. A call on those tiers requests no WebGPU device to read a limit. Disposition: closed, stated in Rule 11.8 ("the owner's WebGPU device (65535 where the owner holds none)").
- **Open.**
  - The hardware item of Validation (the typecv lab on the owner's devices) waits for typecv's pin move and its batch loop.
  - typeshade.github.io and vscode-typeshade are not read: neither is in this container. The pin move of each reads them.
  - The journeys' WebGL2 pages run no indirect call. The WebGL2 path is held by the unit test on a stand-in context.
  - Rule 11.11's Rationale quotes the runtime bundle as 38,254 bytes, a figure of change 0064. This proposal does not declare Rule 11.11, so the figure stays.
  - The CI checks of the pull request have not run.

## What it owes downstream

For each repository in `downstream`:

- **typecv.** The reason for this proposal. After the pin moves, the batch loop of `src/gpu/pair-estimation.ts` stops reading `modelProgress` between batches. `summarizePairModelWork` writes the counts of the next batch's entries (0 when the budget is met, or when no model is active) into a `Uint32Array` resident, and `snapshotPairModelBudget` is folded into it or removed. `preparePairModels`, `appendPairModelRows`, `solvePairModelNull`, `finishPairModels` and the scoring entry dispatch with `{ indirect }`. A value that the host passes in a uniform today, such as `control.trials`, cannot follow a count the GPU decides, so the entries read it from storage. typecv decides `K`, the batches between reads. `ShadeDevice` passes the new argument through. Record 0075 in `compiler-changes.md` when the pin moves.
- **typenn.** Nothing must change. Its host loop decides each dispatch on the host. Record 0075 in `compiler-changes.md` when the pin moves.
- **radiance.** Nothing must change. Its record 0011 (C4, issue #540) asks for indirect dispatch through the program runtime's `Frame.dispatch`, which `packages/radiance/src/renderers/PathTracer.ts` calls. Under the draft's D7 that need stays open. Record 0075 in `compiler-changes.md` when the pin moves.
- **typeshade.github.io.** The guide pages that copy surface sections 65, 67 and 71 gain the indirect count and the report's `indirect`. The API entry of `FuseReport` is generated from the JSDoc. Not read in this draft; the implementation reads the site at its pinned commit and records what it found. Record 0075 in `compiler-changes.md` when the pin moves.
- **vscode-typeshade.** The editor shows the host view that `hostFace` writes, so hover and completion of an entry call gain the indirect form with no plugin change expected. The host references that describe `entry(bindings, workgroups)` gain it. Not read in this draft; the implementation reads the plugin at its pinned commit and records what it found. Record 0075 in `compiler-changes.md` when the pin moves.

Each downstream item is pending. No downstream change exists.

## Open items

- **Indirect draw.** `drawIndirect` and `drawIndexedIndirect` are the render path's form of the same primitive (coverage group 5, #636). They are a later proposal, for the program runtime's draws.
- **The program runtime.** D7. Under the draft, `Frame.dispatch` and `ComputePipeline.dispatch` keep a host count, and issue #540 stays open for them.
- **Validation limits per backend.** The specification's checks are the usage, the size and the 4-byte alignment, and the call layer's checks of item 9 cover all three before the call runs. Whether a browser adds its own work or limits for an indirect dispatch (for example, a pass that applies the limit check of the queue timeline) is not read or measured in this draft.
- **Browser support.** MDN marks the method "Limited availability". The draft assumes the browsers of the journeys and of the owner's devices have it. The implementation checks Chromium in the journey, and the typecv lab checks the owner's devices.
- **A chunk of change 0074.** `device.fuse(body, { chunk: { key, units } })` learns a rate from `units`, which the host gives. A plan of indirect calls whose counts the GPU set to 0 runs in almost no time, and the rate it teaches is wrong. The draft does not change 0074. An application that chunks an indirect plan gives `units` from what it knows, or does not chunk it. Whether 0074's rate should skip such a chunk is not decided.
- **The cost of empty plans.** The submissions that option A adds after a search ends (Why, "The cost") are not measured. The hardware check of Validation measures them on typecv's search.
