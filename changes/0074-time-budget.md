---
id: '0074'
title: 'A device runs long kernels as chunks under a time budget, and reports what each chunk took'
status: implemented
rules:
  - '11.8'
  - '11.13'
surface:
  - 65
  - 69
  - 71
exports:
  - DeviceOptions
  - Device
  - FuseReport
  - ChunkRate
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typecv
    what: '`ShadeDevice` (`src/gpu/device.ts`) retires `fitChunk`, `learnRate`, its map of rates, its `chunkSize` and `chunkRates` and the chunk branch of `planSteps`, and runs each chunk step through `device.fuse(body, { chunk })`. `ShadeDeviceOptions.timeBudgetMs` becomes a pass-through to `createDevice({ timeBudgetMs })`. The chunk tests of `tests/typeshade/plan-steps.test.mjs` move to the compiler; its bounded-submission tests stay. `compiler-changes.md` records 0074 when the pin moves.'
  - repo: typenn
    what: Nothing must change. Its kernels do not iterate inside a dispatch. It may read the per-plan time of a chunked `fuse` from the report. `compiler-changes.md` records 0074 when the pin moves.
  - repo: typeshade.github.io
    what: The English API reference is generated from the JSDoc of `createDevice`, `Device`, `FuseReport` and `ChunkRate`, which gain the budget, `chunkSize`, `chunkRates` and the report's `chunk` row. The Korean entries for `createDevice` and `Device` are translated again. The guide pages that copy surface sections 65, 69 and 71 gain the chunked plan. Not read in this draft; the implementation reads the site before acceptance is recorded.
  - repo: vscode-typeshade
    what: The host references that describe `createDevice(options)` and `device.fuse(body)` describe the `timeBudgetMs` option, the `chunk` argument, `chunkSize` and `chunkRates`. Not read in this draft; the implementation reads the plugin before acceptance is recorded.
---

<!-- doc-refs: skip-file — this draft names options, members, files and tests that a later implementation adds, and files of other repositories, which this tree does not have -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0074. This file is the proposal source and the approved design of the change. Option A is the decided design. Options B and C are recorded as alternatives that this proposal does not take.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Revision context            | Drafted 2026-10-19, Asia/Seoul. This date is the authoring context. The owner approved the proposal on 2026-10-19 (Asia/Seoul) in the project conversation; see Approval and plan record.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Request source              | The owner, Seungup, approved the drafting of this proposal in the project conversation of 2026-10-19. That is the attribution of the request. It is not an approval of the proposal. No GitHub issue is recorded for this draft.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Attribution                 | Drafted by an agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Current lifecycle state     | `implemented`. Accepted by the owner's approval of 2026-10-19 (see Approval and plan record), recorded by the merge of PR #694. The implementation merged in PR #697 (`main` at `41a140a`), and typecv moved its pin to it in typecv PR #54 (see Configuration and validation record).                                                                                                                                                                                                                                                                                                                                                |
| Applicability / effectivity | The device owner of change 0071 (`src/runtime/device.ts`: `DeviceOptions`, `Device`, `createDevice`), the fuse report (`src/core/fuse-report.ts`: `FuseReport`, `mergeReports`), the exports of `typeshade/runtime` and of the package root (`src/runtime.ts`, `src/index.ts`, `src/__api__/surface.md`), Rule 11.8 and Rule 11.13 of `docs/language-design.md`, sections 65, 69 and 71 of `docs/use-typeshade-surface.md`, `reqs/`, `CHANGELOG.md` and the downstream documentation. The planner (`src/core/fuse-plan.ts`) and the slot (`src/core/fuse-scope.ts`) are expected to stay as they are. No release version is assigned. |
| Review baseline             | `origin/main` at `8c91f468319869086855a55d61d8eb093c05b012` (commit "Proposal 0064 PR-1: viewport, scissor and blend constant through typeshade/runtime (#678)").                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Proposal review             | [PR #694](https://github.com/typeshade/typeshade/pull/694), the proposal-only pull request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Revision authority          | Git records the revisions of this file. The review and merge of PR #694 record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## What changes

**Before.** A host opens a device owner with `createDevice(options)` (change 0071, Rule 11.8). `DeviceOptions` takes `prefer`, `device`, `runtime`, `poolBytes` and `fp64Flavor` (change 0073). `device.fuse(body)` takes one argument and runs the calls of `body` as one plan (Rule 11.13). `device.wait()` resolves after `queue.onSubmittedWorkDone()` on WebGPU. `device.lost` resolves when the browser invalidates the WebGPU device. `FuseReport` gives each group `gpuTime` where the device has `timestamp-query` (change 0066). The owner has no notion of how long a plan may take, and no record of how long one took.

A kernel that iterates inside one dispatch (RANSAC trials, Jacobi sweeps, solver iterations) can run for seconds in one submission. A GPU watchdog then resets the device. The compiler gives a host no help to cut such a kernel into submissions of a bounded time. Each consumer must write that scheduler itself, and typecv has (see Why).

**Proposed design (option A).** The device owner schedules the chunks of a long kernel under a time budget. The application decides which kernel loop to cut, and where the loop's state lives.

1. `createDevice({ timeBudgetMs })` takes the time one chunk of a long kernel may take, in milliseconds. The default is 250. A value that is not a finite number from 1 to 60000 is a `RangeError` that names the range. `device.timeBudgetMs` reports the value.
2. `device.fuse(body, { chunk: { key, units } })` takes a second, optional argument. `key` is a non-empty string that names the kernel loop. `units` is a whole number of 1 or more: the work the chunk holds (sweeps, trials, iterations). A `chunk` that does not fit this shape is a `TypeError` that names the field. A plan with a chunk runs alone, as follows:
   - The device first waits for the work it submitted before (`device.wait()`), so the measured time is the chunk's alone. This is a difference from typecv's delivered design; see D5.
   - The device starts a wall clock (`performance.now()`), runs the plan, fences it with `device.wait()` and stops the clock.
   - The device learns the rate of `key` from the measured time (item 3).
   - The report gains a `chunk` row: `{ key, units, elapsedMs }`. The promise resolves after the fence.

   A plan with no second argument runs as today and does not wait for the fence.

3. `device.chunkSize(key, max, min = 1)` returns the units of the next chunk of `key`. The arithmetic is that of typecv's `fitChunk` and `learnRate`:
   - With no chunk of `key` measured yet, the result is `min`, capped at `max`. The first chunk teaches the rate.
   - Otherwise the result is the units that fit eight tenths of the budget at the learned rate, at most `max`, at most four times the last chunk's units, at least `min`, and at least 1.
   - The learned rate (`msPerUnit`) is the mean of the previous rate and the measured one. The first chunk sets it. A chunk counts at least one unit and at least 0.001 ms.
   - On the CPU tier the result is `max`. The CPU tier has no watchdog. The CPU oracle then runs the whole work as one chunk, and its results are those of the state machine run once.
   - `max` wins over `min`: a chunk never holds more units than `max`. typecv's `fitChunk` lets `min` win over `max` after the first chunk. This is a difference from typecv's delivered design; see D7.
   - `max` and `min` are whole numbers of 1 or more, else a `RangeError`.
4. `device.chunkRates` is a `Readonly<Record<string, ChunkRate>>`: the keys the device ran, each with what it measured. `ChunkRate` is `{ msPerUnit, chunks, longestMs, lastUnits }`, a new type exported from `typeshade/runtime` and from the package root.
5. The default owner (`configure()`, `fuse()` from `typeshade/fuse`) gets no budget. A budget is a property of an owned device. `fuse(body)` of `typeshade/fuse` keeps its one argument.
6. `device.lost` (change 0071) does not change. A chunked plan does not catch a lost device. The host watches `device.lost`, as today.

The device does the timing around the planner's entry (`fuseSlot.open`). This is an expectation of the draft, not a decision: the planner is expected to need no change, and `typeshade/fuse` is expected to keep its size.

**Example (illustrative, not an accepted example).** A host runs at most 160 Jacobi sweeps of a batch of 9x9 matrices. The entry `sweepKernel` runs `control.sweeps` sweeps and writes a one-word done flag. The host reads the flag between chunks:

```ts
import { createDevice } from 'typeshade/runtime';
import 'typeshade/fuse';
import { sweepKernel } from './svd.shade.ts';

const device = await createDevice({ prefer: ['webgpu'], timeBudgetMs: 250 });
const matrices = device.array(input); // 81 numbers per matrix
const done = device.array(1, 'u32'); // 1 when every matrix converged
for (let swept = 0; swept < 160; ) {
  const sweeps = device.chunkSize('sweep', 160 - swept);
  await device.fuse(
    () => {
      sweepKernel({ control: { sweeps }, matrices, done }, groups);
    },
    { chunk: { key: 'sweep', units: sweeps } },
  );
  swept += sweeps;
  if ((await done.read())[0] === 1) break;
}
device.chunkRates.sweep; // { msPerUnit, chunks, longestMs, lastUnits }
```

The body has braces. A body that returns the entry call's promise is refused as an `async` body (Rule 11.13). The example set does not change (`examples: []`).

## Why

**The failure.** A GPU watchdog resets a device whose submission runs too long. Windows loses the device after about two seconds (`DXGI_ERROR_DEVICE_HUNG`). iOS Safari loses it and gives no reason. The typecv lab met both on 2026-10-19. typecv's own record (`docs/lab-run-records.md`, "A lost device", at typecv `f253716`) states these facts:

- On the owner's iPhone (iOS 18.7, Safari 27), every unbounded run lost the device during pair verification, under either flavor of the emulated double.
- A run with fenced submissions still lost the device in one long dispatch, `sweepPairModelSvd` (record `20261019140528615-057b3152`).
- typecv's record calls fencing "a diagnostic, not the remedy". It names the time budget as the fix.

typecv's pair-model kernels iterate inside one dispatch: RANSAC trials, 9x9 Jacobi SVD sweeps (at most 160) and conjugate-gradient iterations. One such dispatch ran for seconds.

**What typecv delivered.** typecv fixed the failure in its own device, `ShadeDevice` (`src/gpu/device.ts`), by PR #49, merged as typecv `main` at `f253716` (2026-10-20 00:31 +0900). The facts, read at that commit:

- `ShadeDeviceOptions.timeBudgetMs`: 250 ms by default. A value that is not finite, below 1 or above 60000 is a `RangeError`.
- `planSteps` takes steps that can carry a chunk, `{ key, units }`. A chunk step runs as a plan of its own. It is fenced with `wait()` (`onSubmittedWorkDone`) and timed with `performance.now()`.
- `learnRate` keeps, per key, `msPerUnit` (the mean of the previous rate and the measured one), `chunks`, `longestMs` and `lastUnits`.
- `fitChunk(rate, budgetMs, max, min)` gives the units that fit eight tenths of the budget, at most four times the last chunk, at least `min`. The first chunk is `min`.
- `chunkSize` returns `max` on the CPU tier.
- `ShadePlanReport.chunks` carries the rates of the keys a plan ran.
- `tests/typeshade/plan-steps.test.mjs` holds three tests of this: a chunk step is a plan of its own, the budget's validation and default, and the arithmetic.

typecv's design note (`docs/gpu-resident-scene.md`, step 2) states a different sizing rule: a chunk halved after it ran past the budget and doubled while chunks finish early. The same step records that the delivered rule grows a chunk at most fourfold and shrinks it to what fits. `docs/gpu-sfm.md`, "The time budget: pair model generation runs as chunks", describes the delivered rule.

**Why the scheduler belongs to the compiler.** Change 0071 moved the device owner into the compiler because two consumers had written the same owner over the same runtime state and had diverged ("Why", "Why the owner belongs to the compiler"). The time budget is the same case:

- The scheduling is application-independent. It needs the owner's fence (`device.wait()`), its tier and a clock. The owner holds all three.
- typecv has the scheduler. TypeNN (`src/runtime/device.ts` at typenn `61259c3`) has none, because its kernels do not iterate inside a dispatch: the host loop iterates per training step. A third consumer with an iterating kernel would write the scheduler again.
- The choice of which kernel loop to cut, and where its state lives (a cursor and a done flag in a storage buffer), stays in the application. The compiler cannot cut a kernel's loop: the loop's state lives in registers, and the re-entrant form is the author's design.

**Options.** Each names what it touches.

- **Option A. The owner schedules chunks; the application cuts its loops (proposed).**
  - Touches: Rule 11.8 (the budget, `chunkSize`, `chunkRates`), Rule 11.13 (a chunked plan and its report row), surface §65, §69 and §71, the exports `DeviceOptions`, `Device` and `FuseReport` (reshaped) and `ChunkRate` (added).
  - Trade-off: a few lines in `typeshade/runtime` and no change to the planner (expected, not measured). The application still writes the re-entrant kernel and the host loop.
- **Option B. The application keeps its own scheduler, as today.**
  - Touches: nothing in the compiler.
  - Trade-off: no compiler work. Each consumer with an iterating kernel writes the scheduler and its tests again. typecv's tests of the arithmetic stay in typecv. This is the divergence change 0071 removed for the owner.
- **Option C. The compiler cuts loops itself, through an entry attribute such as `@chunked`.**
  - Touches: a new rule and an extension name (the extension table of `docs/language-design.md` §9), the front end, the three backends, the CPU oracle, a new surface section, and probably new diagnostic codes.
  - Trade-off: the author writes the loop once. It is not proposed now. A loop's state lives in registers, so a cut loop must spill its state to a buffer and restore it, and the right state to keep is the author's design. The scheduler of option A is what such an attribute would call, so option A does not close option C.

**Recommendation.** Option A. It moves delivered and tested behavior from one consumer into the owner that change 0071 made for that purpose. It leaves the loop design with the author.

**Assumptions.**

- Wall time around a fence measures what the watchdog sees closely enough to keep each submission under the budget. typecv's lab is the evidence. It is not measured in this repository.
- A plan of `device.fuse()` is one item of the kernel queue (Rule 11.13). The fence before the clock (item 2) keeps earlier plans out of the chunk's time.

## What it touches

- **Rule 11.8:** the owner's budget (`createDevice({ timeBudgetMs })`, `device.timeBudgetMs`), its default and its refusal, `device.chunkSize()` and its CPU-tier answer, and `device.chunkRates`. The sentence on `device.lost` stays as it is.
- **Rule 11.13:** `device.fuse(body, { chunk })`: the fence before and after, the clock, the rate the device learns, and the report's `chunk` row. `fuse(body)` of the default owner does not change.
- **Surface §65:** the owner's options (beside `poolBytes` and `fp64Flavor`) gain `timeBudgetMs`, and the section gains the chunk loop of a kernel.
- **Surface §69:** the paragraph "A device owner" (beside `dev.lost` and `dev.wait()`) gains the budget, `dev.chunkSize()` and `dev.chunkRates`.
- **Surface §71:** `device.fuse(body, { chunk })` and the `chunk` row of `FuseReport`.
- **Surface §64:** not declared. It names no device option and no plan.
- **Exports:** `DeviceOptions` (the option), `Device` (`timeBudgetMs`, `chunkSize`, `chunkRates`, and the second argument of `fuse`) and `FuseReport` (the optional `chunk` row) are reshaped. `ChunkRate` is added to `./runtime` and to `.`.
- **Codes:** none. The refusals are a `RangeError` and a `TypeError` of the call layer, as `createDevice` refuses an option today.
- **Examples:** none.
- **Documents:** `CHANGELOG.md` gains an entry. `reqs/` follows the edits of the two rules and the three sections through `bun run reqs:sync` and `python scripts/doorstop-check.py -C`. The JSDoc of `createDevice`, `Device`, `DeviceOptions` and `FuseReport` changes with them. `src/AGENTS.md` changes where its row for `runtime/device.ts` names the owner's parts.

### Draft impact estimate

- **Technical work (known).** `src/runtime/device.ts` gains the option, its check, the map of rates, `chunkSize`, `chunkRates` and the chunk branch of `fuse`. The arithmetic (typecv's `fitChunk` and `learnRate`) goes into an internal module under `src/runtime/` that the package does not export. `src/core/fuse-report.ts` gains the optional `chunk` row. `src/runtime.ts` and `src/index.ts` export `ChunkRate`.
- **Technical work (estimate).** About 100 lines of source and 200 lines of tests, from the size of typecv's delivered code. Not measured.
- **Bundle.** `typeshade/runtime` measured 35,777 bytes minified and gzipped against a budget of 39,000 in change 0073's record. The growth is estimated at a few hundred bytes. Not measured. `typeshade/fuse` is expected not to grow.
- **Compatibility.** Additive. `device.fuse(body)` with one argument runs as today. The budget applies only to a plan that names a chunk, so a host that names none sees no change. A consumer that re-declares the report type (typecv's `ShadePlanReport`) stays compatible, since the new row is optional.
- **Dependencies.** Change 0071 (the device owner, implemented on the review baseline). Change 0066 (`gpuTime`) for the later slice on `timestamp-query` (Open items).
- **Tools.** No new tool. The checks are those of Validation.
- **Downstream effort.** See "What it owes downstream".
- **Unestimated.** Effort, schedule and cost are unknown. None is recorded as established.

### Decisions for the owner

- **D1. Option A, B or C?** The draft recommends A.
- **D2. The sizing rule.** The fit-and-fourfold rule that typecv runs (the draft), or the halving-and-doubling rule of typecv's design note (`docs/gpu-resident-scene.md`, step 2). The draft takes the rule that runs and has tests.
- **D3. A budget for the default owner.** Should `configure()` take `timeBudgetMs`, and `fuse(body, { chunk })` of `typeshade/fuse` take a chunk? The draft says no: the budget is a property of an owned device, and the default owner has no `chunkRates` to keep.
- **D4. The refusal of a budget out of range.** A `RangeError` (the draft, as typecv refuses it), or a `TypeError`, as `createDevice` refuses a `poolBytes` that does not fit today.
- **D5. The fence before the clock.** The draft waits for the device's earlier work before it starts the clock, so a chunk's time is its own. typecv starts the clock with no fence before, since its own queue is serialized. The alternative keeps typecv's behavior byte for byte.
- **D6. `mergeReports` and the `chunk` row.** The draft leaves `chunk` out of a merged report, since a merged report is no one chunk and `device.chunkRates` holds the rates. The alternative gives the merged report a list of the chunk rows. That alternative reshapes `mergeReports` and adds it to `exports`.
- **D7. `min` above `max`.** The draft lets `max` win in every case, so a chunk never holds more work than remains. typecv's `fitChunk` returns `max` for the first chunk and `min` after it. The alternative ports typecv's behavior as it is.

### Approval and plan record

- **Decision.** The owner approved the proposal in the project conversation on 2026-10-19 (Asia/Seoul), as drafted: option A (D1), the fit-and-fourfold sizing rule that typecv runs (D2), no budget for the default owner (D3), a `RangeError` for a budget out of range (D4), the fence before the clock (D5), the `chunk` row left out of a merged report (D6) and `max` winning over `min` (D7). The merge of PR #694 records the acceptance.
- **Approved revision.** This file at the commit that PR #694 merges. Git records that commit.
- **Scope.** Option A as "What changes" states it, with D1 to D7 as decided above. No decision is open. The open items below stay open as later slices or application work, not as conditions of this acceptance.
- **Responsibilities and milestones.** The implementation is the next work of the session that drafted this proposal, on a branch of its own, with commits that carry `Change: 0074`, followed by typecv's pin move and the retirement of its scheduler. No schedule or estimate is established.
- **Required validation.** The validation list below. What ran, and what stood in for an item that could not run as written, goes in the Configuration and validation record.

### Validation (required before the implementation merges)

Functional:

- Unit tests of the arithmetic, ported from typecv's `tests/typeshade/plan-steps.test.mjs` (typecv `f253716`): the first chunk is `min`, capped at `max`; the growth is at most fourfold; a chunk past the budget shrinks to what fits; the rate is the mean of the previous rate and the measured one; `chunks`, `longestMs` and `lastUnits`; `max` and `min` bound the fit; a chunk is at least one unit; `max` wins over `min` (D7); a chunk of no time and no units counts 0.001 ms and one unit.
- `src/runtime/device.test.ts`, on the fake device of `src/runtime/runtime.test.ts`: a chunked `device.fuse()` fences before and after the plan (`onSubmittedWorkDone` called), measures the time, fills `FuseReport.chunk` with `key`, `units` and `elapsedMs`, and updates `device.chunkRates`. A plan with no chunk does not fence.
- The budget: the default is 250, `device.timeBudgetMs` reports it, and 0, -1, 60001, `NaN`, `Infinity` and `'250'` are refused with the error D4 decides.
- The CPU tier: `chunkSize(key, max, min)` returns `max`.
- The default owner: `configure()` and `fuse(body)` pass their existing tests unchanged.
- Both halves (`CLAUDE.md`, "A test reads both halves"): no `"use typeshade"` source changes, so the editor's half is not expected to move. The implementation states which half its tests read.
- The existing gates: `bun run build` (the type check), `bun run lint`, `bun run format:check` and `bun run test` (CI's `typecheck + unit`), `bun run gate:compile` (`compile gate (Tint + WebGL2)`) and `bun run gate:journeys` (`user journeys (packed tarball, WebGPU)`).
- `bun scripts/bundle-boundary.ts`: `typeshade/runtime` and `typeshade/fuse` stay inside their budgets, or the budget moves in the same pull request with the measured growth.
- Hardware (Rule 13.3): the typecv lab on the owner's iPhone and on the Windows machine, with typecv's pin moved and its scheduler retired, runs pair model generation as chunks and loses no device. The lab records of 2026-10-19 are the baseline.

Document:

- `bun run bake:api-surface` lists `ChunkRate` and the reshaped `DeviceOptions`, `Device` and `FuseReport`.
- `bun run docs:impact` and `bun run docs:refs` pass after the rule and surface edits.
- `bun run reqs:sync`, then `python scripts/doorstop-check.py -C`, after the edits of Rules 11.8 and 11.13 and sections 65, 69 and 71.
- `bun scripts/changes.ts` passes on the implementing pull request.

**Acceptance (for the eventual implementation).** A host that opens `createDevice({ timeBudgetMs })` and runs a long kernel through `chunkSize` and `device.fuse(body, { chunk })` keeps each chunk's measured time near the budget after the first chunks. The typecv lab runs pair model generation on the owner's iPhone without its own scheduler.

### Configuration and validation record

The status is `implemented` since PR #697 merged (`41a140a`). The rows below record what the implementing branch delivers and what ran on it.

- **Accepted revision.** This file at the merge of PR #694, `17f1c58`.
- **Implementing branch.** `impl/0074-time-budget`, from `main` at `17f1c58`, merged by [PR #697](https://github.com/typeshade/typeshade/pull/697) as `41a140a` on 2026-10-19 with every required check green. Its commits carry `Change: 0074`: `4be27be` (the option, `chunkSize`, `chunkRates`, the chunked plan, `ChunkRate`, the report's `chunk` row, the tests and the API surface), `f2bb60e` (the fences as items of the kernel queue, the rules, the surface, the changelog, the requirements tree and `src/AGENTS.md`), and the commit that contains this record, which Git knows.
- **Delivered configuration.** `src/runtime/device.ts` (`DeviceOptions.timeBudgetMs`, `Device.timeBudgetMs`, `Device.chunkSize`, `Device.chunkRates`, the second argument of `Device.fuse`, the refusals), `src/runtime/chunk.ts` (`fitChunk`, `learnRate` and `ChunkRate`; the package exports the type only), `src/core/fuse-report.ts` (`FuseReport.chunk`, the JSDoc of `mergeReports`), `src/runtime.ts` and `src/index.ts` (`ChunkRate`), `src/__api__/surface.md`. The planner (`src/core/fuse-plan.ts`) and the slot (`src/core/fuse-scope.ts`) did not change, as the draft expected. Tools in the container: bun 1.4.2, TypeScript 5.6.3, Node 22.22.0, vitest 3.2.7, Doorstop 3.2.
- **How the fences are placed.** The fence before the plan and the fence after it are items of the kernel queue on either side of the plan. Each waits for the items queued before it and then for `queue.onSubmittedWorkDone()`, which is what `device.wait()` does at that place. So the plan keeps the place where `fuse` was called (Rule 11.13), and a call that the host queues after the chunk is in neither the plan nor its time. A first version (`4be27be`) awaited `device.wait()` before it recorded the body, which put the plan after the calls queued in the meantime. `f2bb60e` replaced it. Rule 11.13 states the delivered behavior.
- **Functional validation, observed on 2026-10-19 on `f2bb60e`.** `src/runtime/chunk.test.ts` (6 tests): typecv's cases at typecv `f253716` (the first chunk is `min` capped at `max`, growth at most fourfold, a chunk past the budget shrinks to what fits, the mean rate, `chunks`, `longestMs` and `lastUnits`, `max` and `min` bound the fit, at least one unit, a chunk of no time and no units counts 0.001 ms and one unit), and `max` winning over `min` (D7). `src/runtime/device.test.ts` (34 tests, 6 of them new): on the fake device, a chunked plan is fenced before and after (`onSubmittedWorkDone` recorded first and last), its time is the 12.5 ms the fake clock moved, `FuseReport.chunk` and `chunkRates` hold the measured values, the second chunk's rate is the mean, a plan queued after a chunk and not awaited is out of the chunk's time, and a plan with no chunk (no second argument, or `{}`) does not fence and has no `chunk` row; the budget's default 250, the value given, the bounds 1 and 60000, and the `RangeError` for 0, -1, 60001, `NaN`, `Infinity` and `'250'` (D4); on the CPU tier `chunkSize` returns `max`, a chunked plan is measured and keeps its place in the queue; each refusal of a chunk, of a `key` and of `max` and `min`; a chunked plan inside another body is refused; `fuse()` of `typeshade/fuse` reports no `chunk` (D3). `src/core/fuse-report.test.ts` (6 tests): a merged report has no `chunk` row (D6). `bun run build`, `bun run lint` and `bun run format:check` pass. `bun run test`: 459 of 460 files and 10,551 tests pass, 4 skipped, 1 todo. The one failure is `src/scope-backtest.test.ts` ("resolves every fix commit in this repository"): `git rev-parse` cannot find `596c805` in the container's shallow clone. CI checks out the full history, and this change touches no file that test reads. `bun run gate:compile`: 163 examples, WGSL on Tint 163, GLSL ES 3.00 on WebGL2 124, render pipelines on Tint 121, 21 entry calls, 0 failures. `bun run gate:journeys` did not run in the container. CI's `user journeys (packed tarball, WebGPU)` on the pull request runs it.
- **Both halves.** No `"use typeshade"` source and no ambient declaration changes, so the editor's half does not move. The tests read the host half: the device owner and the report.
- **Bundle.** `bun scripts/bundle-boundary.ts` on `f2bb60e`: `typeshade/runtime` 38,932 bytes minified and gzipped (budget 39,000; 38,254 on `17f1c58`, so 678 bytes of growth), `typeshade/fuse` 81,292 (budget 86,000, unchanged). No budget moves. The runtime has 68 bytes of room left.
- **Document validation, observed on 2026-10-19.** `bun run docs:impact` listed review items only. Each was read, and the rows of `src/AGENTS.md` for `runtime.ts`, `runtime/` and `core/fuse-report.ts` were updated. `bun run docs:refs`: 0 dead references in 1,215 files. `bun run reqs:sync`, then `python scripts/doorstop-check.py -C -e -F` clean after `doorstop review` of RULE-1108 and RULE-1113 and `doorstop clear` of SURF-038, SURF-065, SURF-067, SURF-069 and SURF-071. `bun run bake:api-surface` lists `ChunkRate` on `.` and `./runtime` and the reshaped `DeviceOptions`, `Device` and `FuseReport`. `bun scripts/changes.ts` passes: the change touches Rules 11.8 and 11.13, surface §65, §69 and §71, and the exports `ChunkRate`, `FuseReport`, `Device` and `DeviceOptions`.
- **Downstream reads.** radiance at `3e4efb3`: no file calls `createDevice` or `fuse()` outside `vendor/`, so it owes nothing. typeshade.github.io and vscode-typeshade were not read. They stay open below.
- **Deviations.** None against "What changes" and D1 to D7. Two refinements are recorded:
  1. `device.chunkSize()` refuses a `key` that is not a non-empty string with a `TypeError`, as item 2 refuses one for `chunk.key`. Disposition: closed, stated in Rule 11.8.
  2. A chunked plan inside the body of another `fuse()` is refused by the kernel queue's own refusal (`the kernel queue: a call that joins it cannot run inside fuse() …`), since a chunked plan runs alone. Disposition: closed, stated in Rule 11.13 and surface §71.
- **Open.**
  - The hardware item of Validation, observed in part. typecv moved its pin to `41a140a` and retired its scheduler in typecv PR #54 (typecv `main` at `7eef646`, 2026-10-19). The owner's iPhone (iOS 18.7, Safari 27) then ran the lab's standard benchmark on that site without bounded submissions (typecv lab record `20261019225221735-85ed0ae6`, 22:52 UTC): pair model generation ran as chunks through `device.fuse(body, { chunk })` for all 22 pairs, the eight views registered in 40.2 s, and no device was lost in pair verification, where every earlier unbounded run on that device had lost it. The run then lost the device in typecv's bundle adjustment, in a kernel that is not chunked yet (`bundlePersistentCg`); that is typecv's next change, not this one's. The measured chunk times are not in the record (typecv's record format does not carry `chunkRates` yet), so "near the budget after the first chunks" is not observed. The Windows machine has not run.
  - typeshade.github.io and vscode-typeshade are not read. The pin move of each reads them.
  - Rule 11.11's Rationale quotes the runtime bundle as 38,254 bytes, the figure before this change. This proposal does not declare Rule 11.11, so the figure stays.
  - `bun run gate:journeys` and the CI checks of the pull request have not run.

## What it owes downstream

For each repository in `downstream`:

- **typecv.** The reason for this proposal. After the pin moves, `ShadeDevice` (`src/gpu/device.ts`) retires `fitChunk`, `learnRate`, the map `rates`, the method `learn` and the chunk branch of `planSteps`. Its `chunkSize` and `chunkRates` read the owner's. A chunk step runs through `device.fuse(body, { chunk })`. `ShadeDeviceOptions.timeBudgetMs` passes through to `createDevice({ timeBudgetMs })`. `ShadePlanReport.chunks` takes its rates from `device.chunkRates`, or the report moves to `FuseReport` (typecv decides). The three chunk tests of `tests/typeshade/plan-steps.test.mjs` move to the compiler; its bounded-submission tests stay. Record 0074 in `compiler-changes.md` when the pin moves.
- **typenn.** Nothing must change: no `src/kernels/*.shade.ts` file has a `while` loop, and the host loop iterates per training step. It may record per-step times through the report's `chunk` row. Record 0074 in `compiler-changes.md` when the pin moves.
- **typeshade.github.io.** The API entries of `createDevice`, `Device`, `FuseReport` and `ChunkRate` are generated from the JSDoc. The Korean entries for `createDevice` and `Device` are translated again. The guide pages that copy surface sections 65, 69 and 71 gain the chunked plan. Not read in this draft; the implementation reads the site at its pinned commit and records what it found. Record 0074 in `compiler-changes.md` when the pin moves.
- **vscode-typeshade.** The host references that describe `createDevice(options)` and `device.fuse(body)`. Not read in this draft; the implementation reads the plugin at its pinned commit and records what it found. Record 0074 in `compiler-changes.md` when the pin moves.

**radiance.** Not declared and not read in this draft. Its path tracer may have long dispatches. The implementation searches it before acceptance is recorded.

Each downstream item is pending. No downstream change exists.

## Open items

- **`timestamp-query` timing.** The draft times a chunk by wall time around the fence. Where the device has `timestamp-query`, the sum of the groups' `gpuTime` (change 0066) measures the GPU time alone. That is a later slice. Its reason: wall time is available on every tier, and the GPU time is not.
- **The sizing rule.** D2 decides between the rule that runs (fit and fourfold) and the rule of typecv's design note (halving and doubling). The draft proposes the rule that runs.
- **A budget for `configure()`.** D3. The draft proposes no.
- **Pipeline creation in the first chunk.** The first chunk of a key includes the creation of its pipeline, which makes the first rate too slow. The fourfold cap and the mean let the rate recover in a few chunks. Whether to measure pipeline creation apart is not decided. typecv's design note lists the same item.
- **Prediction of a run's time.** typecv's design note (step 2) uses the same rates to predict a run's remaining time (`etaMs`). That stays in the application, and this draft does not propose it.
