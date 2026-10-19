---
id: '0071'
title: A host opens a device owner on `typeshade/runtime` that holds the tier, the resident arrays and their pool, the limits, the lost signal and the plans of its calls, and two owners coexist in one context
status: accepted
rules:
  - '11.8'
  - '11.11'
  - '11.13'
surface:
  - 65
  - 69
  - 71
exports:
  - createDevice
  - Device
  - DeviceOptions
  - DeviceStatistics
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The WebGPU concept page's runtime and call-layer paragraphs, en and ko, gain the device owner beside `configure({ runtime })` and `resident()`, with the rule that one `Resident` belongs to one owner. The kernel-function copy of §65 and the `fuse` copy of §71 gain `device.array()` and `device.fuse()`. The API reference is generated from the pinned compiler's source and lists the new exports with no hand edit. compiler-changes.md records 0071 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references/host.md gains the device owner, its options, `device.array()`, `device.release()`, `device.fuse()`, `device.dispose()`, and the rule that one `Resident` belongs to one owner. compiler-changes.md records 0071 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in other repositories -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0071. This file is the proposal source and the approved design of the change. It has status `accepted`.                                                                                                                                                                                                                                                                             |
| Revision context            | Drafted 2026-10-19, UTC. The date is the authoring context. It is not an approval date. The owner approved the proposal on 2026-10-19 (UTC) in the project conversation. See Approval and plan record.                                                                                                                                                                                       |
| Request source              | The repository owner, Seungup, asked in a Claude Code session of 2026-10-19 to identify the problem behind the two device layers of TypeNN and TypeCV, and then approved the drafting of this proposal in the same session. No GitHub issue is recorded for this draft.                                                                                                                      |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                                                          |
| Current lifecycle state     | `accepted`, by the owner's approval of 2026-10-19 (see Approval and plan record). The merge of PR #677 records the acceptance. No implementation exists.                                                                                                                                                                                                                                     |
| Applicability / effectivity | The call layer (`src/core/resident.ts`, `src/core/host-entry.ts`, `src/core/fuse-plan.ts`), the program runtime (`src/runtime/runtime.ts`), the public subpaths `typeshade/runtime` and `typeshade/fuse`, Rules 11.8, 11.11 and 11.13, surface §65, §69 and §71, the site and the editor. No release version is assigned.                                                                    |
| Review baseline             | `origin/main` at `06835f6` (commit "Merge pull request #675 from typeshade/claude/fix-glcontext-test-order"), read on 2026-10-19. Proposal ids 0000 to 0070 were read on `origin/main` and on every remote branch on 2026-10-19. Id 0071 was not in use on any of them. The consumers were read at typenn `61259c3`, typecv `f42f223` and radiance `3e4efb3`, each the `main` of 2026-10-19. |
| Proposal review             | [PR #677](https://github.com/typeshade/typeshade/pull/677), the proposal-only pull request, opened 2026-10-19 as a draft.                                                                                                                                                                                                                                                                    |
| Revision authority          | Git records the revisions of this file. The review and merge of PR #677 record the decision.                                                                                                                                                                                                                                                                                                 |

## What changes

A host that runs kernel functions today owns nothing. `configure()` sets a process-global tier
order and a process-global runtime (Rule 11.8). `resident()` makes a handle that no object owns
(Rule 11.8). `fuse()` records calls into a process-global slot (Rule 11.13). The device the calls
share is a module variable of `src/core/host-entry.ts` (`gpuDevice()`, `hostRuntime`). A library
that builds on the call layer therefore writes its own owner over that state. Two libraries did
(Why).

This proposal adds the owner to `typeshade/runtime`. It is one object, made by `createDevice()`.
It holds what the two libraries each hold today, and nothing an author writes changes.

### The owner, in six parts

1. **Open.** `createDevice(options)` opens the device the calls run on. `options.prefer` is the
   tier order of Rule 11.8, tried once, first that can open. `options.device` is a `GPUDevice` the
   host already has. `options.runtime` is a program runtime of `createRuntime()` (Rule 11.11),
   whose device the owner uses. The three are exclusive. `device.tier` is the tier that opened.
   `device.skipped` lists each earlier tier of `prefer` with the reason it did not open, as
   `createComputeRunner` reports `rejected` today (`typeshade/compute`).
2. **Own arrays.** `device.array(value)` and `device.array(length, element)` make a `Resident`
   that the owner holds, with the value rules of `resident()` (Rule 11.8, change 0065). The owner
   keeps a pool of released arrays, bounded by `options.poolBytes`. `device.release(r)` gives an
   array back: the owner keeps it for a later `array()` of the same element and length while the
   pool has room, and frees it otherwise. One `Resident` belongs to one owner for its whole life.
   `device.statistics` reports `live`, `liveBytes`, `pooledBytes`, `allocations`, `reuses`,
   `uploadBytes` and `readBytes`.
3. **Run.** `device.fuse(body)` records the calls of `body` and runs them as one plan on this
   owner's device, with the rules of Rule 11.13. It returns the `FuseReport`. A call inside the
   body that takes a `Resident` of another owner is refused with a `TypeError` naming both owners.
   `device.wait()` resolves when the device has completed every plan submitted so far. On WebGPU
   it is `queue.onSubmittedWorkDone()`. On the other tiers it resolves when the calls have settled.
4. **Report.** `device.limits` is the device's limits, as change 0051 defines `DeviceReport`'s
   `limits`, or an empty record on a tier with none. `device.lost` is a promise that resolves with
   `{ reason, message }` when the browser invalidates a WebGPU device. On the other tiers it never
   resolves.
5. **Close.** `device.dispose()` waits for the plans in flight, destroys every array the owner
   holds, pooled or not, each once, and destroys the runtime the owner made. It never destroys a
   `GPUDevice` or a runtime the host handed in. A use after `dispose()` is a `TypeError`.
6. **Coexist.** Two owners in one JavaScript context are independent. Each has its tier, its
   arrays, its pool and its plans. Opening a second owner changes nothing of the first. The
   process-global `configure()` and `fuse()` of today remain, and they describe the **default
   owner**: the one a bare kernel call outside any `device.fuse()` body uses. `configure({ runtime })`
   keeps its meaning for that owner.

```ts
import { createDevice } from 'typeshade/runtime';
import { add, relu } from './ops.shade.ts';

const dev = await createDevice({ prefer: ['webgpu', 'cpu'], poolBytes: 64 * 1024 * 1024 });
const a = dev.array(new Float32Array(n));
const b = dev.array(new Float32Array(n));
const sum = dev.array(n, 'f32');
const out = dev.array(n, 'f32');
const report = await dev.fuse(() => {
  add(sum, a, b);
  relu(out, sum);
});
dev.release(sum); // the next array(n, 'f32') takes it from the pool
const values = await out.read();
await dev.dispose();
```

### Before and after

Before, a library opens a runtime, configures the process, guards a singleton, pools arrays, reads
the limits through a cast, and undoes the configuration on dispose. TypeNN's `Device.open()`
(`src/runtime/device.ts`, lines 85 to 146 at `61259c3`) and TypeCV's `ShadeDevice.open()`
(`src/gpu/device.ts`, lines 114 to 176 at `f42f223`) each do this. After, each calls
`createDevice()` and keeps only what is its own: TypeNN's tensors and `adopt()`, TypeCV's bounded
step scheduling and its working-set budget.

Before, two libraries cannot share a page. Each `open()` calls `configure({ runtime, prefer })`,
which overwrites the other's. Each singleton guard sees only its own module variable, so neither
refuses the second open. After, each library opens its own owner, and the two run on one
`GPUDevice` or on two.

### What stays

- `resident()`, `configure()` and `fuse()` keep their signatures and their behaviour. An array of
  `resident()` belongs to the default owner.
- A kernel call outside any `device.fuse()` body runs on the default owner, as today.
- The program runtime (`createRuntime`, change 0025) is unchanged. An owner over a runtime shares
  that runtime's device, so a `Texture` or a program's buffer reaches a call as Rule 11.11 says.
- The planner's rules (Rule 11.13), the facts, the groups and the report are unchanged.

### What is excluded

- A pool policy a host can choose (first-fit, LRU, a reserved budget for small arrays). The owner
  has one policy (D3). A host that needs another keeps its own pool over `device.array()`.
- A history of reports. `device.fuse()` returns one report. A host keeps the history it wants (D4).
- A working-set budget over live bytes (TypeCV's `workingBytes`). A host enforces it over
  `device.statistics`.
- Bounded submission groups and progress events (TypeCV's `planSteps`). A host composes them from
  `device.fuse()` and `device.wait()`.
- A kernel call outside a `device.fuse()` body that picks its owner from its arrays (D2).
- A change to the tiers themselves, to the WebGL2 pass program (change 0054) or to the CPU tier.

## Why

### The problem

Two libraries built on the call layer each wrote the same owner, in the same week, without
knowing of the other. The facts, read on 2026-10-19:

| Concern                                        | TypeNN `Device` (`src/runtime/device.ts`, 398 lines, since 15502b6 of 2026-10-11) | TypeCV `ShadeDevice` (`src/gpu/device.ts`, 412 lines, since 7de5399 of 2026-10-16) |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Opens a runtime and calls `configure()`        | lines 117 to 127                                                                  | line 153                                                                           |
| One active owner per context                   | `activeDevice`, line 34                                                           | `active`, `opening`, lines 43 and 44                                               |
| A pool of released `Resident` arrays           | `live`, `free`, `poolBytes`, lines 48 to 52                                       | `live`, `free`, `pooled`, lines 59 to 61                                           |
| A history of `FuseReport`                      | 256 reports, `lastPlan`                                                           | 64 reports, in a re-declared `ShadePlanReport`                                     |
| `dispose()` resets `configure()`               | `resetConfiguration()`, lines 361 to 364                                          | lines 405 and 406                                                                  |
| Reads the limits through a cast                | `storageBindingLimit()`, lines 332 to 346                                         | constructor, lines 99 to 111                                                       |
| Frees the arrays of a failed plan, never pools | `execute.ts`, `plan()`                                                            | `drop()`, line 315                                                                 |

The two have already diverged. TypeNN falls back from WebGPU to the CPU tier and offers WebGL2.
TypeCV requires WebGPU and has no fallback. TypeNN pools `f32` by length, first fit, 64 MiB.
TypeCV pools `f32`, `f64` and `u32` by element and length, with LRU eviction and a reserved budget
for small arrays, 32 MiB. TypeCV watches `device.lost` and fences bounded groups with
`onSubmittedWorkDone()`. TypeNN has neither. A fix in one does not reach the other. Each has its
own tests of the same pool rules: `typenn/tests/buffer-pool.test.mjs` (14 tests) and
`typecv/tests/typeshade/device-pool.test.mjs` (7 tests).

TypeCV's architecture document states the coexistence problem (`docs/architecture.md`, lines 80
to 83 at `f42f223`):

> TypeShade runtime configuration is shared within a JS context. The current TypeCV device
> supports one active owner and serialized work; applications using other TypeShade consumers must
> coordinate configuration. Borrowing a GPUDevice preserves device ownership but does not isolate
> that shared configuration.

Radiance is a third, smaller variant. `PathTracer` (`packages/radiance/src/renderers/PathTracer.ts`,
lines 164 and 324 at `3e4efb3`) owns a `createRuntime()` and its `resident()` arrays and destroys
them itself. It has no pool and calls no `configure()`.

### Why the owner belongs to the compiler

The state the two owners wrap is the compiler's module state: `preferred` and `kernelQueue` in
`src/core/resident.ts`, `device` and `hostRuntime` in `src/core/host-entry.ts`, `fuseSlot` in
`src/core/fuse-plan.ts`. A package outside the compiler cannot scope that state. It can only wrap
it, which is what the two libraries did, and the wrapper is global for the same reason.

The roadmap claims the owner for the compiler. `docs/roadmap.md` says that "the device, the
buffers, the layouts, the bind groups and the pipeline exist but are not the caller's problem"
(line 21 at `06835f6`) and that "the device, the buffers, the layouts, the bind groups, the
pipelines and the fallback tiers exist inside the generated module and are not named anywhere in
user code" (line 78). Both libraries had to name the device and own it.

Change 0058 made the same argument for fusion. Its "Why" says of a planner in the consumer: "Every
consumer with a chain of kernels (an engine's post-process passes, a particle update) would write
the same" (`changes/0058-fuse-kernel-chain.md`, line 54). The argument holds for the owner. Two
consumers wrote the same owner, and the engine wrote a third part of it.

The compiler already designs around one consumer's private owner. Change 0065 read TypeNN's
`acquire` to shape `resident(length, element)` (`changes/0065-zeroed-resident.md`, line 255).
Change 0051 gives the call layer a `DeviceReport` that both owners' limit casts would use, and it
is accepted and not implemented at `06835f6` (no `callDevice` in `src/`). An owner in the compiler
gives these a place to land that every consumer reaches.

### Alternatives

- **A shared package outside the compiler** (`@typeshade/device` or a copy in each consumer).
  Rejected. It cannot scope the module state above, so two instances still overwrite each other's
  `configure()`. It also lives outside this repository's change control, so a rule it implies
  (one `Resident`, one owner) is in no rule text.
- **`configure()` returns a handle, and nothing else changes.** Partial. It scopes the tier and
  the runtime but leaves the pool, the limits, the lost signal and the lifecycle to each consumer.
  The pool is where the two owners diverged most.
- **Fold the owner into `Runtime`** (`createRuntime()` gains `array()`, `release()`, `fuse()` and
  a pool). Possible, and D1 asks the owner. Rejected as the draft's default for two reasons. The
  CPU tier has no runtime, and TypeNN's `auto` falls to it. A WebGL2 runtime is not the context
  the calls use (`configure()` refuses one, Rule 11.8), and TypeNN destroys it at once for that
  reason (`device.ts`, line 134).
- **Pick the owner from the arrays of a bare call.** Deferred (D2). It makes a bare call's device
  depend on its arguments, which Rule 11.8 does not say today, and it leaves a call with no array
  argument undefined.

### Assumptions

- Change 0051 lands before or with part 4. Until it does, `device.limits` is an empty record on
  every tier, and the implementation says so in its record.
- A `fuse` body is synchronous (Rule 11.13), so the owner active for a body is set and restored
  around the body without a race. Nothing in this proposal depends on async context tracking.
- A `Resident` is bound to one `GPUDevice` by its buffer. The rule "one `Resident`, one owner"
  states what the buffer already requires.

## What it touches

- **Rule 11.8.** Gains the owner: `createDevice()`, `device.array()`, `device.release()`, the pool's
  bound, the rule that one `Resident` belongs to one owner, the default owner that `configure()`
  and `resident()` describe, and `device.dispose()`.
- **Rule 11.11.** Gains `createDevice({ runtime })`: an owner over a program runtime shares its
  device, and the runtime's lifetime stays the host's.
- **Rule 11.13.** Gains `device.fuse()`: the calls of a body run on that owner, and a `Resident`
  of another owner is refused.
- **Surface §65.** The kernel-function section gains `device.array()` beside `resident()`.
- **Surface §69.** The runtime section gains `createDevice()` and its three ways to open.
- **Surface §71.** The `fuse` section gains `device.fuse()` and the refusal.
- **Exports.** `createDevice`, `Device`, `DeviceOptions` and `DeviceStatistics` on
  `typeshade/runtime` and on the root. No export is removed or reshaped.

### Draft impact estimate

- **Technical work.** A `Device` class in `src/runtime/device.ts` over the state of
  `src/core/resident.ts`, `src/core/host-entry.ts` and `src/core/fuse-plan.ts`. That state gains
  an owner parameter, with the default owner where none is given. The pool is one map keyed by
  element and length. `bun run gate:boundary` holds the runtime bundle's size. The bundle cost is
  unknown until measured.
- **Compatibility.** No existing call changes. `resident()`, `configure()` and `fuse()` keep their
  behaviour as the default owner's. A program written at `06835f6` runs unchanged.
- **Dependencies.** Change 0051 for `device.limits` (accepted, not implemented). Change 0065 for
  `device.array(length, element)` (accepted; `ZeroedState` exists in `src/core/resident.ts` at
  `06835f6`). No package is added.
- **Tools.** None added.
- **Validation work.** Listed below.
- **Downstream.** The site and the editor, as the front matter says. TypeNN, TypeCV and Radiance
  are consumers, not repositories `scripts/changes.ts` lists (change 0067, D4), so this record does
  not declare them. What each would retire is under "What the consumers retire". Whether to list
  them in `DOWNSTREAM_REPOS` is a code change outside this proposal, and the owner's decision (D6).
- **Effort and date.** Unestimated. No milestone is set.

### Decisions for the owner

- **D1. Shape.** A separate `Device` made by `createDevice()` (the draft), or methods on `Runtime`
  made by `createRuntime()`. The draft's reasons are under Alternatives.
- **D2. A bare call's owner.** A kernel call outside any `device.fuse()` body runs on the default
  owner, and refuses a `Resident` of another owner (the draft). The alternative picks the owner
  from the arrays.
- **D3. The pool policy.** One policy, keyed by element and length, bounded by `poolBytes`, the
  oldest free array evicted first (the draft, TypeCV's rule). The alternative is TypeNN's: refuse
  an array that does not fit, evict nothing.
- **D4. Report history.** None in the owner (the draft). The alternative is a ring of `n` reports,
  `n` an option.
- **D5. The name.** `createDevice` and `Device` (the draft, the word both consumers chose, and
  PyTorch's). The roadmap's item X1 keeps GPU vocabulary out of a compute program. The owner is
  a host object, not a word an author writes in a `"use typeshade"` file. The alternative is
  `Host` or `Session`.
- **D6. Register the consumers.** Add `typenn` and `typecv` to `DOWNSTREAM_REPOS`, so that
  `scripts/downstream-impact.ts` lists what each owes when its pin moves. Change 0067 D4 decided
  no. This is a code change in its own pull request, not part of this proposal.

### Required validation

Functional, each a test under `src/runtime/` or `src/`:

- Two owners open in one context. Each keeps its tier, its arrays and its pool. Disposing one
  changes nothing of the other.
- `device.fuse()` refuses a `Resident` of another owner with a `TypeError` naming both.
- `device.release()` then `device.array()` of the same element and length returns the same
  handle, and `statistics.reuses` counts it. An array past `poolBytes` is freed and
  `statistics.pooledBytes` does not grow.
- `device.dispose()` destroys each array once, pooled or not, and never a `GPUDevice` or a
  runtime the host handed in. A use after it is a `TypeError`.
- `prefer: ['webgpu', 'cpu']` on a host without WebGPU opens the CPU tier and reports the reason
  in `device.skipped`. `prefer: ['webgpu']` rejects, naming the reason.
- `device.wait()` resolves after `onSubmittedWorkDone()` on WebGPU, on the fake device of
  `src/runtime/runtime.test.ts`.
- `device.limits` equals change 0051's report on the same device, once 0051 is implemented.
- `resident()`, `configure()` and `fuse()` pass their existing tests unchanged.
- `bun run gate:boundary` passes, and the implementation records the runtime bundle's size before
  and after.

Document validation: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` pass after the rule and surface edits. The API surface bake
of `AGENTS.md` lists the four exports.

### Approval and plan record

- **Decision.** The owner, Seungup, approved the proposal on 2026-10-19 (UTC) in the project
  conversation, after the identification report of the same session and after reading the draft
  as PR #677 presented it. The word of the decision was "승인" (approval).
- **Decisions D1 to D5.** The approval takes the draft's defaults: D1 a separate `Device` made by
  `createDevice()`, D2 a bare call runs on the default owner and refuses a `Resident` of another
  owner, D3 one pool policy keyed by element and length with the oldest free array evicted first,
  D4 no report history in the owner, D5 the names `createDevice` and `Device`.
- **Decision D6.** Not decided by this approval. The registration of `typenn` and `typecv` in
  `DOWNSTREAM_REPOS` is a code change in its own pull request. It stays open until the owner
  decides it there.
- **Review and merge reference.** PR #677. Its merge with `status: accepted` is the agreement
  (`changes/README.md`, The lifecycle, step 2). The commit that contains this record is known to
  Git, not to this file.
- **Approved revision and scope.** The text of this file at the merge of PR #677: "What changes",
  parts 1 to 6, with "What stays" and "What is excluded". The front matter is the declared scope.
- **Responsibilities.** The implementation is not assigned. No milestone or date is agreed. No
  duration or cost estimate is established.
- **Required validation.** The functional and document validation listed under "Required
  validation" is required at implementation. Change 0051 is a dependency of part 4, and the
  implementation's record states what `device.limits` reports while 0051 is not implemented.

### Configuration and validation record

This record does not yet apply. Delivery will require: the accepted revision, the implementing
pull requests with their `Change: 0071` lines, the delivered configuration (commit, bun and
TypeScript versions), the observed results of each test above, the bundle sizes, and the
disposition of each deviation from the approved text.

## What it owes downstream

- **typeshade.github.io.** The WebGPU concept page's runtime and call-layer paragraphs, en and ko,
  gain the owner beside `configure({ runtime })` and `resident()`, with the rule that one
  `Resident` belongs to one owner. The kernel-function copy of §65 and the `fuse` copy of §71 gain
  `device.array()` and `device.fuse()`. The API reference is generated from the pinned compiler's
  source and lists the new exports with no hand edit. `compiler-changes.md` records 0071 when the
  pin moves.
- **vscode-typeshade.** The skill's `references/host.md` gains the owner, its options and its
  methods, and the one-owner rule. `compiler-changes.md` records 0071 when the pin moves.

### What the consumers retire

The consumers are not declared downstream repositories. This list is the expected work, read at
the commits in Review baseline, for their owners. It is not an obligation of this record.

- **TypeNN** (`61259c3`). `src/runtime/device.ts` keeps `Device` as the tensor owner: `tensor()`,
  `createParameter()`, `adopt()`, `release()`, `materialize*()` and `dataset()`. It retires
  `selectRuntime()`, `resetConfiguration()`, `activeDevice`, the pool (`live`, `free`, `acquire()`,
  `takeFree()`, `recycle()`) and `storageBindingLimit()`, and holds a `typeshade/runtime` owner
  instead. `tests/buffer-pool.test.mjs` keeps the tests of tensor ownership and retires the pool
  rules this proposal tests.
- **TypeCV** (`f42f223`). `src/gpu/device.ts` keeps `ShadeDevice` as the scheduler: `enqueue()`,
  `planSteps()`, `reserveWorkingBytes()`, `onProgress` and the counters. It retires `active`,
  `opening`, the pool (`allocateTyped()`, `recycle()`, `drop()`, `evictOldestFree()`), the limit
  cast, `lost` and the `configure()` reset. `docs/architecture.md`, lines 80 to 83, no longer
  holds: two consumers coexist. `tests/typeshade/device-pool.test.mjs` retires the pool rules
  this proposal tests.
- **Radiance** (`3e4efb3`). `PathTracer` may open an owner over its runtime for its `resident()`
  arrays. Nothing requires it to.
