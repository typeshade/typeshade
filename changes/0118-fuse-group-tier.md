---
id: '0118'
title: Each group of a `fuse` report names the tier it ran on, and a group that ran on a later tier than its plan says why
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
| Identity and status           | Proposal 0118, `status: draft`. The front matter is the identity and lifecycle authority. No approval is recorded; see Approval and plan record.                                                                                                                                                                                                                                                                                                                              |
| Date and attribution          | Authored 2026-11-02 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                 |
| Request source                | Issue [#946](https://github.com/typeshade/typeshade/issues/946), filed 2026-11-02 from typeshade/typeaudio pull request #5 (`src/explain.ts`), where the engine's `explain` could not say which tier each group of a plan ran on. That repository's `docs/compiler-asks.md` records the ask as candidate P. The owner asked for the downstream loop (a workaround measured there, then a proposal here) in the same session.                                                  |
| Applicability / effectivity   | Rule 11.13 of `docs/language-design.md` and its items in `reqs/`; `docs/use-typeshade-surface.md` §71; `src/core/fuse-report.ts` (`FuseReport`), `src/core/fuse-plan.ts` (the settled groups), `src/core/host-kernel.ts` (the reasons a tier gives); `src/__api__/surface.md`; the tests and journeys that pin a report. The planner's facts F1 to F8, the fused entry, the tiers a call may run on and the order of the tiers do not change. No release version is assigned. |
| Review baseline               | `main` at `aaa33067a8877efcdbd8b4dfee2f74af20877a35` (the merge of pull request #956), read on 2026-11-02.                                                                                                                                                                                                                                                                                                                                                                    |
| Review and revision authority | No pull request is assigned yet. Git records the revisions of this file. The review and merge of its pull request with `status: accepted` will record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                          |

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

**Decisions, to resolve at acceptance** (Approval and plan record).

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

This record does not yet apply. Acceptance will require: the owner's decision in the conversation
or a review on this proposal's pull request, with D1 to D3 resolved; the approved revision (the
merged text) and its scope; an agent assigned to implement items 1 to 3, Rule 11.13 and §71 in
pull requests whose commits say `Change: 0118`; and the validation above named as required. No
approver, date, milestone, duration or cost is recorded here.

### Configuration and validation record

This record does not yet apply. Delivery will require: the accepted revision; the implementing
pull requests and commits; the delivered configuration (the files above at their commits); the
executor, the test, the journey and the gate runs with their dates and results, functional
validation (the tests, `gate:journeys`, `gate:boundary`) apart from document validation
(`docs:refs`, `docs:impact`, `reqs:sync`, Doorstop); each deviation with its disposition; and the
pending work. A planned result is not a completed one.

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
