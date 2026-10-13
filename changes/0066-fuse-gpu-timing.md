---
id: '0066'
title: A fuse scope's report gives each group its GPU time in nanoseconds when the device has timestamp queries, and gives none when it has not
status: accepted
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
    what: The API reference lists gpuTime from the pinned compiler's JSDoc in English with no hand edit. The Korean entry content/api/ko/fusereport.json is translated again from the new source. The site has no page that copies §71. compiler-changes.md records 0066 when the pin moves.
  - repo: vscode-typeshade
    what: The fuse section of the skill (SKILL.md and references/host.md), which the pin pull request for 0058 wrote, gains the gpuTime field and its absence. compiler-changes.md records 0066 when the pin moves.
---

<!-- doc-refs: skip-file — an accepted proposal not yet implemented names files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                      | Proposal 0066; this file is the proposal source.                                                                                                                                                                                                                                                                                                |
| Revision context              | 2026-10-13, UTC. The date means the authorship of the draft. It is not an approval date. The owner's decisions of 2026-10-13 (Asia/Seoul) are recorded under Approval and plan record. A verification pass of the same date read every citation again at `96dbaa9f` and corrected the claims about the site, the editor and the dispatch batch. |
| Request source                | The owner's request in a Claude Code session of 2026-10-13. The request cites gap C13 of the gap analysis of `origin/main` at `96dbaa9f` (2026-10-13): the tree has no timestamp query, issue #542 tracks timestamps, and the fuse report has counts only.                                                                                      |
| Attribution                   | Drafted by Claude Haiku 5.5, in a Claude Code session, at the owner's request. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                            |
| Current lifecycle state       | `accepted`, by the owner's decision of 2026-10-13 (see Approval and plan record). The merge of PR #651 records the acceptance. No implementation exists.                                                                                                                                                                                        |
| Applicability / effectivity   | The fuse plan in `src/core/fuse-plan.ts` (`FuseReport`, `runPlan`), the dispatch batch in `src/core/host-entry.ts` (`DispatchBatch.flush`), the call layer's device request in `src/core/host-entry.ts` (`gpuDevice()`), Rule 11.13 and surface §71. No release version is assigned.                                                            |
| Review baseline               | `origin/main` at `96dbaa9f` (commit `96dbaa9f`, "Copy flat f32, i32 and u32 arrays as bytes in pack and readInto (#648)").                                                                                                                                                                                                                      |
| Review and revision authority | [PR #651](https://github.com/typeshade/typeshade/pull/651), the proposal-only pull request. Git records revisions. The review and merge of PR #651 record the decision.                                                                                                                                                                         |

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
   request is made in `gpuDevice()`, beside any feature that `configure({ features })` names
   (proposal 0051, revision 2). A feature named there is required, and a refusal applies (C2). The
   feature of this proposal is optional, and no refusal applies. Proposal 0051 lists the enabled
   features in its `callDevice()` report, so this proposal depends on 0051 only for that report
   (decision 5).
2. Each compute pass that a plan records on WebGPU writes two timestamps, at its beginning and at
   its end, through the `timestampWrites` of `beginComputePass`. Only the batch of a plan does
   this: a call outside a scope has no report, and its batch writes none. The plan tags each
   dispatch it adds to the batch (`DispatchBatch.add`, `src/core/host-entry.ts` line 1105) with the
   index of its group, so the batch can name the passes of each group. A group's `gpuTime` is the sum,
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

The gap (C13). The tree has no timestamp query. Issue #542 asks for `timestamp-query` through `typeshade/runtime`, with a timing that names its tier. The fuse
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
3. An option, `fuse(body, { timing: true })`, so that the default path makes no query set. The owner decided
   decision 1 on 2026-10-13: the request is made whenever the adapter reports the feature, with no option.
4. Timing of a call outside a scope. A call outside a scope has no report. A later proposal may
   give such a call one. Not part of this proposal.

Issue #542 covers the program runtime. This proposal covers the report of a `fuse` scope only.

### Decisions of the owner

The owner adopted the proposed answer of decisions 1 to 4 on 2026-10-13. No decision is open.

1. The default request. Decided: request `timestamp-query` whenever the adapter reports it, as the
   owner asked. The other choice requests it only when the host opts in. The cost of the feature on
   a device is not measured here.
2. The name and the unit. Decided: `gpuTime`, in nanoseconds, the unit of WebGPU's timestamps,
   with the unit in the JSDoc. The alternative, `gpuNanoseconds`, names the unit in the key.
3. A runtime's device. Decided: this proposal does not request the feature for a device from
   `createRuntime()`. A host that passes `configure({ runtime })` gets groups without `gpuTime`
   until a later step adds the feature to the runtime's request (0051).
4. A failed read of the timestamps. Decided: the affected groups have no `gpuTime`, and the
   promise of `fuse()` does not reject (point 5).

### Decisions taken by default

Each is a naming or consistency choice inside an established pattern. The owner confirmed both on
2026-10-13.

5. The relation to proposal 0051. Default: the request for `timestamp-query` is optional and
   separate from `configure({ features })`, so an adapter without it never makes a call fail. The
   name joins `DeviceReport.features` when the device has it. Reason: a required feature refuses
   the first call (0051, C2), and a profiling aid must not.
6. The type of the field. Default: a plain `number` of nanoseconds, a whole number. Reason: the
   report holds numbers elsewhere, and a `bigint` would break `JSON.stringify` of a report. A
   64-bit counter holds more than a number does only past 2^53 nanoseconds, about 104 days.

## What it touches

- **Rule 11.13.** The report's six points above. Its "Enforced by" line gains the tests below.
- **Surface §71.** The report paragraph gains `gpuTime`, its absence and the example.
- **Exports.** `FuseReport`: the `groups` element gains `gpuTime?`. `src/__api__/surface.md` is
  regenerated by `bun run bake:api-surface`.
- **Codes.** None. A missing timestamp is not a refusal.
- **Code.**
  - `src/core/fuse-plan.ts`: the `FuseReport` interface (line 122), `runPlan` (line 750) and the
    report that `runPlan` returns (line 806). The `groups` element is an inline type.
  - `src/core/host-entry.ts`: `gpuDevice()` (line 703) adds `timestamp-query` when the adapter
    reports it. `DispatchBatch.flush` (from line 1139) sets `timestampWrites` on the pass at
    line 1187, and resolves and copies the timestamps after the read copies (lines 1206 to 1213), before
    the submission at line 1214. `DispatchBatch.add` (line 1105) takes the group tag.
  - The fold passes of `reduceOnGpu` (`src/core/host-kernel.ts`, line 676) take the same batch, so
    they need no separate path. The implementation confirms this in its first commit.
- **Tests owed.** `src/fuse.test.ts`, on its fake device (`fakeGpu`, line 694, and `FakeOptions`, line 660).
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

### Approval and plan record

- **Decision.** The owner approved the proposal and adopted the recommended answer of every
  decision, in the project conversation on 2026-10-13 (Asia/Seoul). The owner then asked for the
  proposal to move to `accepted`. The merge of PR #651 records the acceptance.
- **Approved revision.** This file at the commit that PR #651 merges. Git records that commit.
- **Scope.** Decisions 1 to 4 as written above, and defaults 5 and 6. No decision is open.
- **Responsibilities and milestones.** Unassigned. No schedule, owner or estimate is established.
- **Required validation.** The tests and the acceptance list above. None has run.

### Configuration and validation record

Implementation commits on `claude/impl-0066-fuse-gpu-timing` (draft PR #669), each with
`Change: 0066`:

1. `ae50332c`: the `gpuTime` field of `FuseReport`'s groups, its JSDoc and `src/__api__/surface.md`.
2. `3ae3232f`: the timestamp writes, the resolve and readback in `DispatchBatch.flush`, the
   `timestamp-query` request in `gpuDevice()`, the group tag of `PlanRun`, and four `gpuTime`
   cases in `src/fuse.test.ts`.
3. `e83c0bf5`: the merge of `origin/main` at `eeb73543` (#667, proposal 0069). The one conflict,
   in `src/fuse.test.ts`, kept both test blocks. A fifth case covers an entry group of a plan.
4. `bc0350a4`: the rule text of Rule 11.13, the paragraph of surface §71, and this record.
5. The verification commit: the cap on the query set (see Deviations), cases 3 and 5 of the test
   list, and a test that each flush frees its query set.

Checks, on 2026-10-13, with Bun and Node of the worktree (versions not recorded here):

- `bun run build`: exit 0.
- `bun run lint`: exit 0. `bun run format:check`: passes.
- `npx vitest run src/fuse.test.ts src/core/fuse-group.test.ts src/core/fuse-entry.test.ts
src/reqs.test.ts src/api-surface.test.ts`: 5 files, 370 tests, all pass.
- `bun run bake:api-surface`: regenerated `src/__api__/surface.md` once, for the `gpuTime` field.
- `bun scripts/changes.ts --base origin/main`: passes. Pending under the proposal: Rule 11.13 and
  surface §71, which this commit records.
- `bun run docs:refs`: 0 dead references.
- `bun run docs:impact`: no must-fix item. Its review items are the 0058 records and the 0066
  record, which describe the report as it stood, and the prose named above.
- `bun run gate:boundary`: passes. `typeshade/runtime` is 30389 bytes against a budget of 30450,
  so `scripts/bundle-budget.json` needs no change. `typeshade/emit` 92614 of 97500;
  `typeshade/fuse` 77492 of 86000.
- `bun run gate:compile` with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`: exit 0. 163 examples,
  163 on Tint, 124 on WebGL2, 121 render pipelines, 0 failures.
- `bun run reqs:sync`: wrote 169 files under `reqs/`. `python3 scripts/doorstop-check.py -C -e -F`
  reports `RULE-1113: unreviewed changes` and `SURF-038` and `SURF-071: suspect link: RULE-1113`.
  These are open, and a reviewer must read Rule 11.13 and surface §71 before the stamps clear.

Not run:

- Acceptance 2 (a real device with `timestamp-query`, the 0.9 to 1.05 ratio). No such device is
  available in this session. Open.
- Acceptance 4 on a real device (equal `submissions` and `dispatches`). The fake device checks the
  equality (the `keeps the counts` case). Open for a real device.
- Acceptance 5 (the `journeys/loop-fuse` run on SwiftShader). Not run. Open.

Deviations. Found by the independent verification, closed in the verification commit, and made
part of Rule 11.13 point 5 and surface §71 by it:

- A query set holds at most 4,096 queries. A flush of more than 2,048 passes would have asked for
  more, and WebGPU reports that as a validation error, which the error scope of the flush turns
  into a failed plan. A flush of more than 2,048 passes now makes no query set, and its groups have
  no `gpuTime`. Point 5 of the approved text lists the cases without a time, and this is a new one.
  Disposition: closed.
- `DispatchBatch.add` now reads the group tag before its `await`, not after it. Disposition: closed.

Otherwise none in the approved text. The fake device returns zeros for results, as before, so
the value of each result is not checked against the chain. The equality of results is checked
only by the counts.

## What it owes downstream

- **typeshade.github.io.** Facts, read at the site's `0c56a88`. The site has no page that copies
  §71. It lists `FuseReport` in its API reference. The English entry is generated from the pinned
  compiler's JSDoc, so `gpuTime` appears with no hand edit. The Korean entry,
  `content/api/ko/fusereport.json`, is a hand translation keyed by a hash of the English source.
  The new JSDoc changes the hash, and `bun run check:api-ko` names the entry. The `groups` text is
  translated again. `compiler-changes.md` records `0066` when the pin moves.
- **vscode-typeshade.** Facts, read at the editor's `bbb2d9e`. The pull request that pinned
  proposal 0058 already wrote the fuse section of `plugins/typeshade/skills/typeshade/SKILL.md`
  (the "Read the report" bullet) and of `references/host.md`. Both gain `gpuTime` and its absence.
  `compiler-changes.md` records `0066` when the pin moves.
- **TypeNN's kernel-graph view (outside `scripts/changes.ts`).** It is the consumer the gap analysis
  names. This record does not declare it in `downstream`, as the record of 0058 does not declare its
  consumers. Its work is owed when its pin moves.
