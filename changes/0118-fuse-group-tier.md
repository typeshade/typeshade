---
id: '0118'
title: Each group of a `fuse` report names the tier it ran on, and a group that ran on a later tier than its plan says why
status: implemented
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
    what: The page that copies surface §71, in English and in Korean, gains the group's `tier` in its `FuseReport` listing and its report examples, and the sentence on a group that ran on a later tier; `compiler-changes.md` records 0118 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's reference for `fuse` and its report, where it lists the fields of a group, gains `tier`; a fixture that pins a report's text changes; `compiler-changes.md` records 0118 when the pin moves.
  - repo: typenn
    what: Nothing must change in what runs. A test or a host that builds a `FuseReport` literal by hand gains `tier` on each group, or `tsc` refuses it; `compiler-changes.md` records 0118 when the pin moves.
  - repo: typecv
    what: Nothing must change in what runs. The same search for a `FuseReport` literal as for typenn; `compiler-changes.md` records 0118 when the pin moves.
  - repo: typeaudio
    what: `src/explain.ts` reads each group's `tier` and `why` and retires its inference from timing and `dispatches`; `docs/compiler-asks.md` marks ask P done; `compiler-changes.md` records 0118 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names tests and text its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0118, `status: implemented`. The front matter is the identity and lifecycle authority. The owner approved the proposal on 2026-11-02 (UTC) with D1 to D3 as drafted; see Approval and plan record. Pull request #990 implemented it on 2026-11-02; see Configuration and validation record. Downstream adoption is tracked apart.                                                                                                                                    |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                 |
| Request source                | Issue [#946](https://github.com/typeshade/typeshade/issues/946), filed 2026-11-02 from typeshade/typeaudio pull request #5 (`src/explain.ts`), where the engine's `explain` could not say which tier each group of a plan ran on. That repository's `docs/compiler-asks.md` records the ask as candidate P. The owner asked for the downstream loop (a workaround measured there, then a proposal here) in the same session.                                                  |
| Applicability / effectivity   | Rule 11.13 of `docs/language-design.md` and its items in `reqs/`; `docs/use-typeshade-surface.md` §71; `src/core/fuse-report.ts` (`FuseReport`), `src/core/fuse-plan.ts` (the settled groups), `src/core/host-kernel.ts` (the reasons a tier gives); `src/__api__/surface.md`; the tests and journeys that pin a report. The planner's facts F1 to F8, the fused entry, the tiers a call may run on and the order of the tiers do not change. No release version is assigned. |
| Review baseline               | `main` at `aaa33067a8877efcdbd8b4dfee2f74af20877a35` (the merge of pull request #956), read on 2026-11-02.                                                                                                                                                                                                                                                                                                                                                                    |
| Review and revision authority | Pull request [#959](https://github.com/typeshade/typeshade/pull/959) (branch `claude/proposal-0118-group-tier`). Git records the revisions of this file. The merge of that pull request with `status: accepted` records the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                        |

## What changes

**Before.** A `FuseReport` (surface §71, Rule 11.13) has one `tier`, the best tier any call of
the plan ran on. A group of its `groups` has `calls`, `fused`, `why`, `workgroupShapes`,
`gpuTime` and `indirect`, and no tier. A group's `why` says why it stands apart from the group
before it. A group that ran on a later tier than the plan's `tier` because the tiers before it
could not run its call says nothing: Rule 11.8 orders the tiers of each call, and §71 says that a
group on the CPU tier whose function lowers has no reason. On WebGL2 with the CPU tier after it,
a plan whose calls include a reduction, which has no WebGL2 program, reports `tier: 'webgl2'`,
and the group of the reduction, which ran on the CPU tier, is told apart from the others only by
what it lacks (no `workgroupShapes`, no draw counted in `dispatches`).

**After.**

1. **Each group names its tier.** A group of `FuseReport.groups` carries
   `tier: 'webgpu' | 'webgl2' | 'cpu'`, the tier its calls ran on. It is present on every group
   (D1). The calls of one group run on one tier: a fused group is one WebGPU dispatch, and on
   WebGL2 and on the CPU tier each call is a group of its own. The plan's `tier` stays the best
   tier of its groups, as it is today.
2. **A group below its plan's tier says why.** A group whose `tier` is a later tier than the
   plan's `tier`, and whose `why` gives no reason today, says `b runs on the CPU, ` or
   `b runs on WebGL2, ` and the reason the call layer had for each tier of the owner's policy
   before the one the group ran on, in the policy's order, the reasons of two tiers joined by
   `; ` (D2, D3). The reason is the one the `Error` of a call that no tier can run names for that
   tier (Rule 11.8), without the `webgl2: ` or `webgpu: ` prefix that error writes. The group of
   the reduction above says `peak runs on the CPU, WebGL2 runs no loop that reduces`. The
   sentences §71 has today keep their words: `b runs on the CPU, ` and the reason the host view's
   comment gives, for a function that runs on the CPU on every tier; `b runs apart from a, which
runs on the CPU`; `WebGL2 runs the calls apart`; and the `a and b run as two dispatches because`
   family.
3. **`mergeReports` keeps the tiers.** `mergeReports(reports)` keeps each group as its report held
   it, so a merged report's groups carry their tiers, and the merged `tier` stays the best of the
   reports' (Rule 11.13). Its signature does not change.
4. **What does not change.** The tiers a call may run on, their order under `configure({ prefer })`
   and `createDevice({ prefer })`, the choice of a call's tier, the groups the planner forms, the
   fused entry, `dispatches`, `submissions`, `workgroupShapes`, `gpuTime`, `indirect` and `chunk`.
   `Device.info` keeps describing the opened device and not each call's tier (Rule 11.8).

The listing, a plan run with `configure({ prefer: ['webgl2', 'cpu'] })` on a module whose
`peak` is a reduction:

```ts
const report = await fuse(() => {
  gain(out, mix, g); // a map: a WebGL2 draw
  peak(out); // a reduction: no WebGL2 program, so the CPU tier runs it
});
```

The report today, and after this change:

```json
{"tier":"webgl2","dispatches":1,"submissions":0,"groups":[{"calls":["gain"],"fused":false},{"calls":["peak"],"fused":false,"why":"WebGL2 runs the calls apart"}]}
{"tier":"webgl2","dispatches":1,"submissions":0,"groups":[{"calls":["gain"],"fused":false,"tier":"webgl2"},{"calls":["peak"],"fused":false,"tier":"cpu","why":"peak runs on the CPU, WebGL2 runs no loop that reduces"}]}
```

A plan whose groups all ran on the plan's tier gains `tier` on each group and no new sentence.

**Decisions, resolved at acceptance** (Approval and plan record).

- **D1.** `tier` is present on every group (the draft), or only on a group whose tier differs
  from the plan's. The draft chooses every group: a consumer then reads one field and never
  joins two, and a field that is sometimes absent is a second rule to learn, as `gpuTime`'s
  absence already is.
- **D2.** A group below its plan's tier says why in `why`, in the sentence family §71 has (the
  draft), or in a field of its own. The draft chooses `why`: the report explains a group in one
  place, in the author's words, and the sentence `b runs on the CPU, ` already exists for a
  function that runs on the CPU everywhere.
- **D3.** The reason is the call layer's own text for the tier (the draft), or a text written for
  the report. The draft chooses the call layer's text, so that a call inside a scope and a call
  outside one give one reason for one tier (one place per fact, `AGENTS.md`), and the test holds
  the two to each other.

## Why

**The problem.** An engine that explains a block to its developer has to say where each node
ran. typeshade/typeaudio's `explain` (its `docs/vision.md`: "where a node runs is reported,
never hidden") builds that from the report of the block's plan. On 2026-11-02, at `main`
`14566606`, a plan of `synth` (a kernel over `array<Voice>` with a nested block loop), `mixdown`,
`drive`, `gain` and `peak` (a reduction), run with `configure({ prefer: ['webgl2', 'cpu'] })`,
reported `tier: 'webgl2'`, while `synth` and `peak` ran on the CPU tier. The engine saw that
through timing and through `dispatches`, which counts the WebGL2 draws only, and inferred the
tier of each group from what the group lacked. An inference from an absence is wrong the day a
group gains a field for another reason (issue #946).

**The evidence in this repository.** `FuseReport.tier` is "the best tier any call of the plan
ran on" (`src/core/fuse-report.ts`, Rule 11.13, §71). `settle` in `src/core/fuse-plan.ts` already
computes the tier of each call before anything runs (`tierOf`, `tierOfEntry`) and keeps it in a
list the groups do not carry. `runChecked` in `src/core/host-kernel.ts` collects the reason of
each tier that cannot run a call, and uses it only when no tier can (`no tier it may use can run
it (webgl2: …; cpu: …)`). The facts the report needs exist at the place the report is made.

**Alternatives.**

- Keep the report and let the host read `Device.info`. Rejected: `Device.info` describes the
  opened device, and Rule 11.8 says that it does not describe each call's effective tier.
- A list of fallbacks on the report, apart from the groups. Rejected: the group is the unit the
  report explains, and a host that prints a group would join two lists by index.
- A `tier` only where it differs from the plan's (D1's alternative). Rejected for the reason D1
  gives.

**Assumptions.** The tier of a group is known when the plan is settled, and a driver's refusal
of a program after that moves a call to a tier that fuses nothing (`fuse-plan.ts`): the
implementation reports the tier the call ran on, which is the settled tier or the one the
refusal moved it to, and the test names which. Unresolved: none beyond D1 to D3.

## What it touches

- **Rule 11.13.** The sentence "The report is `{ tier, dispatches, submissions, groups }`" and the
  one on `tier` gain the group's `tier` and the `why` of a group below the plan's tier (items 1
  and 2). The facts, the fused entry and the tiers do not change.
- **surface 71.** The `FuseReport` listing of the section gains `tier` on a group; the
  sentences on `tier` and on `why` gain items 1 and 2; the report examples gain `"tier"` on each
  group; "The tiers" names the sentence of a group that fell to a later tier.
- **exports.** `FuseReport`, listed in `src/__api__/surface.md`, reshaped: each group gains a
  field, and nothing is removed. `mergeReports` keeps its signature.
- **codes, examples: none.** No diagnostic is added. The set of examples does not change; the
  host example `examples/hosts/loop-fuse/` and the journeys that pin a report change their
  expected text, which is validation.

**Implementation.** `src/core/fuse-report.ts`: the field and its comment. `src/core/fuse-plan.ts`:
`settle` writes `tier: tiers[i]` on each group it forms, and the `why` of item 2 from the reasons
of the skipped tiers; `tierOf` and `tierOfEntry` return those reasons beside the tier, from the
one place `runChecked` builds them (D3), so that `src/core/host-kernel.ts` and the planner share
the text. `src/__api__/surface.md` re-baked (`bun run bake:api-surface`). Rule 11.13 and its
`reqs/` item, synced and reviewed; §71.

**Validation.** `src/core/fuse-plan.test.ts` or `src/core/fuse-report.test.ts`: a plan with one
call the WebGL2 tier refuses reports that group's `tier` as `'cpu'`, its `why` as item 2 gives
it, and the plan's `tier` as `'webgl2'`; a plan on one tier carries that tier on every group and
no new sentence; `mergeReports` keeps the groups' tiers and the best `tier`. `src/fuse.test.ts`
on the recording device: each group of a WebGPU plan says `'webgpu'`, and a function that runs on
the CPU everywhere keeps today's sentence. The reason of item 2 held to the `Error` of the same
call outside a scope with `configure({ prefer: ['webgl2'] })` (D3). The host view's type of a
report, under `tsc`, in `src/compiler/ts/host-kernel.test.ts` or the api-surface drift arm.
`bun run gate:journeys` (the pinned reports of `journeys/loop-fuse` and of the import journey),
`bun run gate:boundary`, `bun run build`, `bun run docs:refs`, `bun run docs:impact`,
`bun run reqs:sync` and `python scripts/doorstop-check.py -C` for Rule 11.13 and §71.

### Draft impact estimate

Known work: one field and its comment; the settled tier on each group; the reasons of the skipped
tiers carried from the call layer to the planner; one sentence family in `why`; the rule, its
`reqs/` item and §71; the pinned reports in the unit tests, the journeys and the example's
expected output; the api-surface bake. Compatibility: a host that reads a report sees a new field
and no removed one; a host or a test that writes a `FuseReport` literal by hand (a test double)
must add `tier` to each group, or `tsc` refuses it, which is what What it owes downstream asks
typenn and typecv to search for. Bundle: a few bytes in the executor, measured at implementation
by `bun run gate:boundary`. Dependencies: none. Downstream: the two documentation repositories
copy §71; typeaudio adopts the field. Duration and cost: unknown, no basis for an estimate.
Decisions to resolve before acceptance: D1 to D3.

### Approval and plan record

The owner (Seungup) approved the proposal in the Claude Code session on 2026-11-02 (UTC), in
Korean ("추천대로", as recommended), in answer to the orchestrator's report that listed pull
request #959 with its open decisions and the draft's recommendations. D1 to D3 are accepted as
drafted: `tier` is present on every group; a group below its plan's tier says why in `why`, in
the sentence family §71 has; the reason is the call layer's own text for the tier. The approved
revision is the one this record is part of. The merge of
[#959](https://github.com/typeshade/typeshade/pull/959) with `status: accepted` records the
decision.

Responsibilities: an agent of this repository implements items 1 to 3, Rule 11.13 and §71 in
pull requests whose commits say `Change: 0118`. No milestone date is assigned. No duration or
cost estimate is established.

### Configuration and validation record

**Accepted revision.** The text merged by pull request
[#959](https://github.com/typeshade/typeshade/pull/959) with `status: accepted`, D1 to D3 as drafted
(Approval and plan record).

**Implementation.** Pull request [#990](https://github.com/typeshade/typeshade/pull/990), branch
`claude/0118-fuse-group-tier`, from `main` at `89d5fd7c`, by a Claude Code agent at the owner's
direction. Its commits say `Change: 0118`: `84c828ed` (items 1 to 3, Rule 11.13 and §71, `reqs/`,
the API surface, the tests, the journeys and `CHANGELOG.md`), `8c95563a` (the merge of `main` at
`bf4a0d19`, whose test #972 pins a report and gains `tier` on its two groups), `f617e2f4` (the
bundle budgets the boundary gate measured) and the commit that adds this record and sets
`status: implemented`.

**Delivered configuration.**

- `src/core/fuse-report.ts`: each group of `FuseReport.groups` has `tier` (item 1, D1); the
  comments of the plan's `tier`, of `groups` and of `mergeReports` (item 3).
- `src/core/host-kernel.ts`: `tierFit` words the reason of each tier for a checked kernel call, the
  WebGL2 programs of the call compiled; `runChecked` runs a call on the first tier that can run it
  and writes its `Error` from the same reasons (D3).
- `src/core/host-compute.ts`: `entryTierFit` does the same for an entry call, and `runEntry` runs
  from it; `entryHost` lends it to the planner.
- `src/core/fuse-plan.ts`: `tierOf` and `tierOfEntry` return the tier with the reasons of the tiers
  before it; `settle` writes `tier` on each group and the `why` of item 2 (D2); `runPlan` reports
  each group's `tier`. `src/core/fuse-group.ts`: `onLaterTier`, the sentence of item 2.
  `src/core/fuse-record.ts` and `src/core/fuse-scope.ts`: the entry host's type and comment.
- `docs/language-design.md` Rule 11.13, its `reqs/rules/RULE-1113.md` reviewed;
  `docs/use-typeshade-surface.md` §71; `reqs/surface/SURF-071.md` cleared after reading §71 against
  the rule, and `reqs/surface/SURF-038.md` cleared after reading §38, which the change leaves true.
- `src/__api__/surface.md` re-baked (`FuseReport` reshaped, nothing removed).
- Tests: `src/fuse.test.ts` (the pinned reports gain `tier`; the tests of the change: a reduction
  on the CPU tier of a plan on WebGL2 held to the `Error` of the same call with
  `configure({ prefer: ['webgl2'] })`, two reasons joined, a plan on one tier, a WebGL2 program the
  driver refuses, a group on the first tier of the owner's policy, each group of a WebGPU plan, the
  sentence of a function that runs on the CPU, a call that WebGPU refuses for its stores, a merged
  report); `src/core/fuse-report.test.ts` (literals with `tier`; a merged report keeps each group's
  tier).
- Journeys: `journeys/_harness.mjs` holds each group's tier on each tier;
  `journeys/loop-fuse/journey.mjs` pins the reduction's sentence on WebGL2;
  `scripts/user-journey.ts` holds the tier of each group of the host example's reports on WebGPU;
  `journeys/_host-import/src/auto-fuse.ts` and `scripts/automatic-fuse-journey.ts` hold the group
  tiers of the automatic plans. `journeys/README.md` says so.
- `scripts/bundle-budget.json`: the caps the change exceeds take the measured sizes (below).
  `CHANGELOG.md`.

**Functional validation.** By the implementing agent on 2026-11-02 (UTC), on Linux with Bun 1.4.4,
Node v22.23.4 (the container's; `.node-version` names 24.19.0), TypeScript 5.6.3 and Vitest 5.0.5:

- `bunx vitest run src/fuse.test.ts src/core/fuse-report.test.ts` on `main` at `bf4a0d19` with this
  pull request's two test files: 177 passed, 56 failed (the 9 tests of the change and 47 pinned
  reports that now carry `tier`); `src/core/fuse-report.test.ts` passed at run time and failed
  `tsc -p tsconfig.tests.json` (TS2353 and TS2339 on the group's `tier`). The same run on
  `f617e2f4`: 233 passed.
- `bunx vitest run src/core src/fuse.test.ts src/compiler/ts/host-kernel.test.ts src/api-surface.test.ts src/changes.test.ts src/doc-references.test.ts src/reqs.test.ts`
  on the tree of the commit that adds this record: 233 files, 4,111 passed, 3 skipped.
- `env -u NODE_OPTIONS bun run test` on `f617e2f4` (with the comment of `src/core/fuse-scope.ts`
  that the record commit carries): 520 files, 12,118 passed, 4 skipped, 1 todo.
- `bun run build`, `bun run lint` and `bun run format:check` on the tree of the commit that adds
  this record: passed.
- `bun run gate:boundary` on the same tree: passed, after the caps the change exceeds took the
  measured sizes (D-7).
- `bun run gate:journeys` with `TYPESHADE_CHROMIUM` set to the headless shell of Chromium 1243
  (SwiftShader), on the build of `8c95563a`: 34 journeys, 123 runs, every check passed. Among them
  `journeys/loop-fuse` on WebGPU, WebGL2 and the CPU tier with each group's tier and the reduction's
  sentence on WebGL2, the three reports of the host example `loop-fuse` with `tier` on each group,
  and the automatic plans of the import journey with their group tiers.
- CI on `f617e2f4`: all 26 checks passed, among them the required `typecheck + unit`,
  `traceability (Doorstop)`, `compile gate (Tint + WebGL2)` and
  `user journeys (packed tarball, WebGPU)`, the TypeScript 5.9.3 and 6.0.3 legs, the render and perf
  gates, the package smoke runs and `TypeNN candidate (build + CPU)`. On `84c828ed`,
  `source and policy checks` failed at the boundary gate, which `f617e2f4` resolves.

**Document validation.** On 2026-11-02, on the head of the pull request: `bun run docs:impact`
listed no _must fix_ item, and every _review_ item was read (the commit messages say what was
found); `bun run docs:refs` found no dead reference; `bun scripts/changes.ts --base origin/main`
reported Rule 11.13, surface §71 and export `FuseReport`, inside this proposal's declaration;
`bun scripts/ifchange.ts --base origin/main` passed; `bun run reqs:sync` changed only `RULE-1113`,
and `python3 scripts/doorstop-check.py -C` passed after `doorstop review RULE-1113` and
`doorstop clear SURF-038 SURF-071`, each after reading the item; `bun run precommit --message-file`
passed for each commit.

**Deviations.**

- D-1, open. Item 2 gives the reduction's sentence as
  `peak runs on the CPU, WebGL2 runs no loop that reduces`. The call layer's reason for WebGL2, for
  a function with no WebGL2 program, is `it runs on the CPU, ` and the face's reason: for a
  reduction, `it runs on the CPU, loop 1 reduces, which WebGL2 has no workgroup memory for` (the
  `Error` of the call with `configure({ prefer: ['webgl2'] })` gives it after `webgl2: `). D3 makes
  the reason the call layer's own text, so the delivered sentence is
  `peak runs on the CPU, it runs on the CPU, loop 1 reduces, which WebGL2 has no workgroup memory for`,
  and "runs on the CPU" stands twice. For a function that runs on the CPU on every tier, as a first
  group below its plan's tier, the face's reason stands once for each tier before the CPU tier. Next
  action: the owner decides between an amendment that gives item 2's example the call layer's words,
  and a later change to the call layer's words for a tier that has no program for the function (the
  `Error` of Rule 11.8), which this proposal does not declare.
- D-2, closed. The "today" report of the listing gives the group of `peak` the reason
  `WebGL2 runs the calls apart`. At the review baseline a group on the CPU tier whose function
  lowers had no `why` (`journeys/loop-fuse` pinned `undefined` for `total`), which is why item 2
  applies to it. The delivered report is the "after" line, with the call layer's reason (D-1).
- D-3, closed. Item 2 does not name a group below its plan's tier that ran on the first tier of its
  owner's policy (`configure({ prefer: ['webgl2', 'webgpu', 'cpu'] })`: a map on WebGL2 beside a
  reduction on WebGPU). No tier before its own had a reason, so the group says nothing; Rule 11.13
  and §71 say so, and `src/fuse.test.ts` pins it. Read as the text intends.
- D-4, closed. The planner now settles a call's tier with every check `runChecked` makes
  (`tierFit`), where before it read only whether the function has a program for the tier and
  whether the device or the context exists. A call that WebGPU refuses after the device check
  (a texture of the CPU tier's memory, pushes after a held length that its WGSL does not start from,
  stores after the loops or a device-held range that bind more storage buffers than the device
  allows) was settled on WebGPU and ran on a later tier. Its group had `workgroupShapes` and an F1
  reason as if it had run on WebGPU. It now reports the tier it ran on, no `workgroupShapes` (§71:
  absent exactly when the group does not run on WebGPU) and the sentence of item 2 when its plan ran
  on a better tier. A WebGL2 program the driver refuses is compiled when the plan is settled, so the
  report names the tier the refusal moved the call to (the proposal's Assumptions). Item 4 keeps the
  choice of a call's tier and `workgroupShapes`: the tier `runChecked` chooses does not change, and
  the settled tier and the shapes now agree with it. It follows from D3's one place for the reasons;
  `src/fuse.test.ts` pins the call that WebGPU refuses for its stores and the driver's refusal.
- D-5, closed. Validation names `src/core/fuse-plan.test.ts` or `src/core/fuse-report.test.ts` for
  the plan tests. A plan on WebGL2 needs the WebGL2 stand-in that only `src/fuse.test.ts` mocks
  (`vitest.config.ts` runs a file that calls `vi.mock` in a project of its own, `MOCKS`), so the
  plan tests are in `src/fuse.test.ts`, and `src/core/fuse-report.test.ts` holds the `mergeReports`
  test. The host view's type of a report under `tsc` is held by the api-surface drift arm, which
  Validation allows.
- D-6, closed. The Implementation has `tierOf` and `tierOfEntry` return the reasons "from the one
  place `runChecked` builds them". An entry call's reasons are built by `runEntry` in
  `src/core/host-compute.ts`, so `entryTierFit` there is the one place for an entry call, lent to
  the planner through `entryHost`, so that `typeshade/fuse` imports none of an entry's tiers (change
  0069).
- D-7, closed. The draft impact estimate gives the bundle "a few bytes in the executor". Measured
  by `bun run gate:boundary` against `main` at `bf4a0d19`: gzip bytes, single file,
  `typeshade/runtime` +191, `typeshade/fuse` +178, `typeshade/algorithms` +98, `typeshade/random`
  +85, `typeshade/emit` 0. The caps the change exceeds take the measured values in
  `scripts/bundle-budget.json` (`f617e2f4`), as the gate asks.

**Pending work.** The downstream deliveries of "What it owes downstream" (typeshade.github.io,
vscode-typeshade, typenn, typecv, typeaudio) are tracked in those repositories and are not presumed
complete. D-1 waits for the owner's decision.

## What it owes downstream

- **typeshade.github.io.** The page that copies §71, in English and in Korean: the `FuseReport`
  listing, the report examples and the sentence on a group that fell to a later tier;
  `compiler-changes.md` records 0118 when the pin moves.
- **vscode-typeshade.** The skill's reference for `fuse` and its report, where it lists a group's
  fields, gains `tier`; a fixture that pins a report's text changes; `compiler-changes.md` records
  0118 when the pin moves.
- **typenn, typecv.** Nothing must change in what runs. Each searches its tree for a `FuseReport`
  literal written by hand (`groups:` with `calls` and `fused`), which gains `tier` on each group;
  `compiler-changes.md` records 0118 in each when its pin moves.
- **typeaudio.** `src/explain.ts` reads each group's `tier` and `why` and retires its inference
  from timing and `dispatches`; `docs/compiler-asks.md` marks ask P done with this proposal's id;
  `compiler-changes.md` records 0118 when the pin moves.

Expected work is described; responsibilities are recorded at acceptance; actual downstream
changes, pins and records are tracked apart after compiler implementation.
