---
id: '0066'
title: A fuse scope's report gives each group its GPU time in nanoseconds when the device has timestamp queries, and gives none when it has not
status: draft
rules:
  - '11.13'
surface:
  - 71
exports:
  - FuseReport
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The fuse report copy of §71 in en and ko gains gpuTime and the rule for its absence. The API reference lists the field from the pinned compiler's JSDoc with no hand edit. compiler-changes.md records 0066 when the pin moves.
  - repo: vscode-typeshade
    what: The fuse section of the skill, which proposal 0058 already owes, gains the gpuTime field and its absence. compiler-changes.md records 0066 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Document                      | Proposal 0066; this file is the proposal source.                                                                                                                                                                                                                                     |
| Revision context              | 2026-10-13, UTC. The date means the authorship of this draft. It is not an approval date.                                                                                                                                                                                            |
| Request source                | The owner's request in a Claude Code session of 2026-10-13. The request cites gap C13 of the gap analysis of `origin/main` at `96dbaa9f` (2026-10-13): the tree has no timestamp query, issue #542 tracks timestamps, and the fuse report has counts only.                           |
| Attribution                   | Drafted by Claude Haiku 5.5, in a Claude Code session, at the owner's request. Git authorship of the containing commit is not an approval signature.                                                                                                                                 |
| Current lifecycle state       | `draft`. No decision has accepted it. Acceptance requires a merged `accepted` status in this file.                                                                                                                                                                                   |
| Applicability / effectivity   | The fuse plan in `src/core/fuse-plan.ts` (`FuseReport`, `runPlan`), the dispatch batch in `src/core/host-entry.ts` (`DispatchBatch.flush`), the call layer's device request in `src/core/host-entry.ts` (`gpuDevice()`), Rule 11.13 and surface §71. No release version is assigned. |
| Review baseline               | `origin/main` at `96dbaa9f` (commit `96dbaa9f`, "Copy flat f32, i32 and u32 arrays as bytes in pack and readInto (#648)").                                                                                                                                                           |
| Review and revision authority | No pull request is assigned yet. Git records revisions. The pull request's review and merge record the decision.                                                                                                                                                                     |

## What changes

The report of a `fuse` scope (surface §71) counts the dispatches and the submissions of its plan,
and it names each group. It holds no time. This proposal adds `gpuTime` to each group. It is the
GPU time, in nanoseconds, that the device measured for the group's compute passes. The property is
present only when the device measured it. Otherwise it is absent, and it is not 0.

```ts
const report = await fuse((scope) => {
  // the calls of the scope
});
report.groups;
// With timestamp-query:  [{ calls: ['add', 'mul', 'relu'], fused: true, gpuTime: 412800 }]
// Without the feature:   [{ calls: ['add', 'mul', 'relu'], fused: true }]
```

Rule 11.13 gains six points for the report:

1. The call layer's device requests `timestamp-query` when the adapter reports it. The request is
   optional. An adapter without the feature gives a device without it, and no refusal applies. The
   request is made in `gpuDevice()`. Proposal 0051 (revision 2) lists the feature in its
   `callDevice()` report, so this proposal depends on 0051 only for that report.
2. Each compute pass that a plan records on WebGPU writes two timestamps, at its beginning and at
   its end, through the `timestampWrites` of `beginComputePass`. A group's `gpuTime` is the sum,
   over its passes, of the end time minus the beginning time. A fused group has one pass. A
   reduction group has its loop pass and its fold passes (Rule 7.2).
3. The dispatch batch of the plan resolves the timestamps into a buffer, and copies that buffer to a
   map-read buffer, in the same command encoder as the passes. The plan makes no extra submission.
   Its `submissions` count is the same with the feature and without it.
4. After the submission, the plan maps the copy and converts its 64-bit values to numbers of
   nanoseconds. It sets each group's `gpuTime` before the promise of `fuse()` resolves.
5. A group has no `gpuTime` when one of these holds: the device lacks the feature; the group runs
   on WebGL2 or on the CPU tier; creating the query set throws; or mapping the copy rejects. The
   last two cases leave the results of the plan, and every other report field, as they are.
6. A group's time is the GPU time its passes take. Gaps between passes are in no group's time. A
   browser may round a timestamp to a coarser step. The value is what the device reports, and no
   test assumes a step.

Surface §71 gains a paragraph on `gpuTime`, with the example above. `FuseReport`'s `groups` element
gains `readonly gpuTime?: number`. No other field of `FuseReport` changes.

## Why

The gap (C13). The tree has no timestamp query. Issue #542 tracks timestamps in general. The fuse
report counts dispatches and submissions only. A kernel function or a fuse dispatch exposes no
encoder, so a host cannot time a group from outside the call layer. TypeNN's kernel-graph view
needs a time for each group, so that it can show which group costs most. This need comes from the
gap analysis. No device measurement supports it in this draft.

Why the report. Only the plan knows which passes form a group. A host profiler sees each pass
but cannot map it to a call or to a group. The report is the place where the plan states its own
groups, so the time goes there.

The alternatives, with the reason each was not chosen:

1. A separate export `profile(body)` that returns times. It adds an export and a second way to run
   a scope. The time and the counts should come from one run. Rejected.
2. Timing outside the report, with the device's own tools. The call layer owns the encoder, so a
   host cannot place a timestamp inside a group. Rejected.
3. An option, `fuse(body, { timing: true })`, so that the default path makes no query set. It stays
   open as decision 1.
4. Timing of a call outside a scope. A call outside a scope has no report. A later proposal may
   give such a call one. Not part of this proposal.

Issue #542 covers timestamps in general. This proposal covers the report of a `fuse` scope only.

### Unresolved decisions

1. The default request. Proposed: request `timestamp-query` whenever the adapter reports it, as the
   owner asked. The other choice requests it only when the host opts in. The cost of the feature on
   a device is not measured here.
2. The name and the unit. Proposed: `gpuTime`, in nanoseconds, the unit of WebGPU's timestamps,
   with the unit in the JSDoc. The alternative, `gpuNanoseconds`, names the unit in the key.
3. A runtime's device. Proposed: this proposal does not request the feature for a device from
   `createRuntime()`. A host that passes `configure({ runtime })` gets groups without `gpuTime`
   until a later step adds the feature to the runtime's request (0051).
4. A failed read of the timestamps. Proposed: the affected groups have no `gpuTime`, and the
   promise of `fuse()` does not reject (point 5).

## What it touches

- **Rule 11.13.** The report's six points above. Its "Enforced by" line gains the tests below.
- **Surface §71.** The report paragraph gains `gpuTime`, its absence and the example.
- **Exports.** `FuseReport`: the `groups` element gains `gpuTime?`. `src/__api__/surface.md` is
  regenerated by `bun run bake:api-surface`.
- **Codes.** None. A missing timestamp is not a refusal.
- **Code.**
  - `src/core/fuse-plan.ts`: the `FuseReport` interface (line 122), `runPlan` (line 747) and the
    report that `runPlan` returns (line 808).
  - `src/core/host-entry.ts`: `gpuDevice()` (line 703) adds `timestamp-query` when the adapter
    reports it. `DispatchBatch.flush` (lines 1136 to 1214) sets `timestampWrites` on the pass at
    line 1187, and resolves and copies the timestamps at lines 1197 to 1214, before the submission
    at line 1214.
  - The fold passes of `reduceOnGpu` (`src/core/host-kernel.ts`, line 676) take the same batch, so
    they need no separate path. The implementation confirms this in its first commit.
- **Tests owed.** `src/fuse.test.ts`, on its fake device (`fakeGpu`, options at lines 660 to 680).
  The fake gains the feature, `createQuerySet`, `resolveQuerySet`, `timestampWrites`, and a staging
  buffer that maps to 64-bit values (the `mapped` option). Cases:
  1. With the feature, each WebGPU group of a three-call chain has a number `gpuTime`. The sum of
     the groups equals the fake's total pass duration.
  2. Without the feature, no group has a `gpuTime` key. The rest of the report equals the report of
     case 1 without that field.
  3. With the feature, a group on the CPU tier and a group on WebGL2 (the fake context) have no
     `gpuTime` key.
  4. In one plan, `submissions` and `dispatches` are equal with and without the feature.
  5. A reduction group sums its loop pass and its fold passes.
  6. A query set that cannot be created, and a copy whose mapping rejects, each leave the groups
     without `gpuTime` and the results equal.

### Acceptance

These are the measurable results the implementation must show. None of them has run.

1. On the fake device with the feature, every WebGPU group has a number `gpuTime`. The sum of the
   groups equals the fake's total pass duration exactly (case 1).
2. On a real device with `timestamp-query`, for a plan of three groups run 20 times warm: the sum
   of the groups' `gpuTime` divided by the bracket time is at least 0.9 and at most 1.05. The
   bracket time is the difference of two timestamps, written in the same encoder, before the first
   pass and after the last pass. Gaps between passes fall in the bracket and not in the sum. The
   values 0.9 and 1.05 are proposals. No measurement supports them yet.
3. On a device without the feature, and on the fake device without it, no group has the key. The
   report equals the report with the feature except for `gpuTime`.
4. On a real device, `submissions` and `dispatches` are equal with and without the feature.
5. On SwiftShader, run the journey `journeys/loop-fuse` and record whether the adapter reports
   `timestamp-query`. If it does not, the groups have no `gpuTime`, which is the expected result.
   The record reports what the run shows. Not run.

### Configuration and validation record

This record does not yet apply. Delivery requires the implementation commits with `Change: 0066`,
the results of the tests named above with their date and configuration, and the real-device
measurement with its adapter and browser named.

## What it owes downstream

- **typeshade.github.io.** The fuse report copy of §71, in en and ko, gains `gpuTime` and the rule for
  its absence. The API reference reads the field from the pinned compiler's JSDoc. The site checkout
  at `/home/user/typeshade.github.io` names no `FuseReport` in `src` or `content` at its current
  state, so each page is found when the pin moves. `compiler-changes.md` records `0066` then.
- **vscode-typeshade.** The skill's fuse section, which proposal 0058 already owes, gains the field.
  `compiler-changes.md` records `0066` when the pin moves.
- **TypeNN's kernel-graph view (outside `scripts/changes.ts`).** It is the consumer the gap analysis
  names. This record does not declare it in `downstream`, as the record of 0058 does not declare its
  consumers. Its work is owed when its pin moves.
