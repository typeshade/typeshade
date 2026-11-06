---
id: '0121'
title: Each fuse report group carries the number of device dispatches it made
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
    what: Explain group dispatch counts in both languages and update report examples when the compiler pin moves; record 0121.
  - repo: vscode-typeshade
    what: Update the host reference and report fixtures with the required group count when the compiler pin moves; record 0121.
  - repo: radiance
    what: Audit report literals and explain displays for the required field; record 0121 when the compiler pin moves.
  - repo: typenn
    what: Update any hand-built report groups and their fixtures; record 0121 when the compiler pin moves.
  - repo: typecv
    what: Update any hand-built report groups and their fixtures; record 0121 when the compiler pin moves.
  - repo: typeaudio
    what: Read group.dispatches in explain instead of counting workgroupShapes; update candidate W and record 0121 when the compiler pin moves.
---

**Document control**

| Field                         | Record                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0121, accepted by the owner; effectivity requires the accepted merge. Front matter controls its lifecycle.                         |
| Date and attribution          | Authored 2026-11-06 UTC by Codex in response to the owner's request to progress unstarted issues. This is an authorship date, not approval. |
| Request source                | Issue [#985](https://github.com/typeshade/typeshade/issues/985), reporting TypeAudio experiment 6 at compiler pin `14566606`.               |
| Applicability / Effectivity   | Fuse execution and reporting on WebGPU, WebGL2 and CPU. Release version unassigned.                                                         |
| Review baseline               | Compiler `main` at `324251dfe7755f78041eb44a1bfe85e4294e12dd`, inspected on 2026-11-06 UTC.                                                 |
| Review and revision authority | Proposal [PR #1036](https://github.com/typeshade/typeshade/pull/1036). Git records revisions; the reviewed accepted merge records approval. |

## What changes

**Current behavior.** A plan reports its total `dispatches`. Each group reports its tier and
workgroup shapes, but no count. Shapes omit reduction folds, push stages and store-only entries.
They cannot determine the group's actual dispatch count.

**Approved behavior, not yet implemented.** Add required `readonly dispatches: number` to each `FuseReport.groups`
member. The count is a non-negative integer with the plan's existing unit:

- WebGPU: each encoded direct or indirect compute dispatch counts once. Reduction folds,
  push count/scan/store stages and store-only entries belong to their executing group.
- WebGL2: each draw used to execute the group counts once.
- CPU: zero device dispatches, regardless of the number of CPU iterations.

Every successfully returned report satisfies
`report.groups.reduce((n, group) => n + group.dispatches, 0) === report.dispatches`.
A group that encodes no device operation reports zero. An indirect dispatch still counts once
when its device-held dimensions are zero: the host must not read them to count the command.
A failing scope still rejects; this proposal adds no partial report.

`mergeReports` preserves each group's count and continues summing plan totals. Empty reports
keep their current shape. Submissions, timing, tier selection, group boundaries and fusion facts
retain their meanings. `workgroupShapes` remains shape information, not an operation count.

Rule 11.13 and surface §71 will state the group count and sum invariant. The misleading comment
that every fused group is one dispatch will distinguish the loop dispatch from reduction folds.

## Why

Issue #985 reports ten dispatches across five groups, but only three workgroup-shape entries.
Its consumer inferred one dispatch for a push and zero for a store-only call. The issue's
measurements are reported evidence, not a measurement repeated while drafting this proposal.

At the review baseline, `src/core/fuse-plan.ts` maintains `GpuCounts` for the plan and tracks
`run.group` while executing each settled group. Its report construction exposes no group count.
`src/core/fuse-report.ts` documents the omitted fold and store entries explicitly.

An optional field avoids changes to report literals but leaves consumers unable to distinguish
missing evidence from zero. A required field gives each returned report a checkable invariant.
Expanding `workgroupShapes` into an operation log is a different API and would still need a
meaning on WebGL2. This proposal adds the count directly.

## What it touches

- Rule 11.13: require group counts and equality with the plan total; synchronize and review its
  Doorstop item and dependent surface item in `reqs/`.
- Surface §71: update the report listing, JSON examples, reductions, CPU/WebGL2 explanations
  and `mergeReports` paragraph. No other section is expected to change.
- Export `FuseReport`: add the required field to its group type and bake `src/__api__/surface.md`.
  The function signature of `mergeReports` does not change.
- Execution: attribute increments at the same sites that already count plan operations, using
  the active settled-group index. Do not derive counts from shapes or reimplement dispatch rules.
- Tests and fixtures: update compiler report literals, host examples and journeys that compare
  full reports. The set of examples and diagnostic codes does not change.

### Impact estimate

Known compatibility impact: consumers reading reports continue to work. TypeScript consumers
constructing a group literal must add `dispatches`; serialized fixtures gain a field. The
implementation must document this required type field in `CHANGELOG.md` under `### Changed`.
Rule 13.9 requires a new minor release before `1.0.0` for this source-breaking type change.
The migration is to give each hand-built group its actual device-command count, using zero for CPU groups.
Rule 13.10 permits a source-breaking change before `1.0.0` without a deprecation window when
it does not silently change computed values. Existing report values retain their meaning.
No release version or calendar schedule is assigned.

Estimated work: extend accounting, update report types and fixtures, and verify each tier.
No new runtime dependency or GPU query is proposed. CPU overhead, bundle growth and delivery
time are unestimated; measure them before delivery. Change 0118 already supplies group tiers.

The owner's approval covers the required field, command-count semantics including
zero-dimensional indirect dispatches, the sum invariant and the declared downstream obligations.
Release handling follows Rules 13.9 and 13.10; this proposal does not authorize publication of a release.

### Approval and plan record

On 2026-11-06 UTC, the owner replied "승인" (approved) in the task conversation after receiving
the link to proposal [PR #1036](https://github.com/typeshade/typeshade/pull/1036).
The reviewed proposal revision was `aed075dbd7c678948699dcac28c8e7edfdedd35e`.
This revision records that decision and the existing release policy; it adds no implementation scope.
PR #1036 merged as accepted at `07639439021f00143c3fa31f01e14ed289d26a98`,
the implementation baseline.

Codex handles the compiler implementation and its validation under the owner's task request.
The sequence is accepted-proposal merge, implementation PR with the required evidence, then
compiler merge after required checks pass. No milestone dates were agreed.
Downstream adoption remains separate: its obligations are approved, but individual assignees
and pin schedules remain unassigned. Neither approval nor compiler delivery establishes adoption.

### Configuration and validation record

Implementation is in progress on `feat/985-group-dispatches` from the accepted merge above.
On 2026-11-06 UTC, the affected four test files passed all 329 tests; build and bundle
boundary, lint, format, compile gate (203 examples; no failures), and journeys
(35 journeys, 126 runs) passed. Documentation references have no dead links,
and Doorstop passes after reviewing RULE-1113 and clearing SURF-038 and SURF-071.
Cost measurements and the final implementation record are pending.
Configuration: Bun 1.4.4, Node 24.22.1, TypeScript 5.6.3, Vitest 5.0.5, Doorstop 3.2.
Node differs from the repository's 24.19.0 pin; pinned CI remains required.

Required functional evidence:

- A recording WebGPU device observes push, store-only, fused and reduction-fold commands.
  Group counts equal these observations and sum to the plan total. A deliberately wrong count
  must fail the test.
- Cover direct and indirect entry calls, a zero-work group, a multi-loop call, mixed tiers,
  CPU-only plans and the empty plan.
- A real WebGL2 execution compares group counts with observed draws. A WebGPU journey checks
  its report against recorded device calls and checks values against an independent reference.
- `mergeReports` retains group objects and counts, and satisfies the sum invariant across
  reports with different tiers.
- Run affected tests, build, lint, format, bundle boundary, compile and journey gates.

Required document evidence: bake the API surface; synchronize requirements; review suspect
links; pass Doorstop, document references, documentation impact, IfChange and proposal scope.
Record deviations and unperformed checks explicitly. Compiler completion does not establish
any downstream's adoption.

## What it owes downstream

The website was searched at `bca213452566152ed4b1b55dbdf8294c10d9a33a`. Its
[src/i18n/en.ts](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/i18n/en.ts) and [src/i18n/ko.ts](https://github.com/typeshade/typeshade.github.io/blob/bca213452566152ed4b1b55dbdf8294c10d9a33a/src/i18n/ko.ts) explain fusion reports and workgroup shapes. Update both
languages to distinguish counts from shapes and update displayed report examples.

The editor was searched at `db3f4171d6ea4689d6048d2252b6553da4599906`. Its
[plugins/typeshade/skills/typeshade/references/host.md](https://github.com/typeshade/vscode-typeshade/blob/db3f4171d6ea4689d6048d2252b6553da4599906/plugins/typeshade/skills/typeshade/references/host.md) describes `FuseReport` and workgroup
shapes. Update the report reference and matching fixtures.

TypeAudio's issue evidence identifies its explain module and candidate W in its compiler asks.
Replace the shape-length inference with `group.dispatches`. That repository was not read in
this drafting session; its exact implementation and pin require confirmation before downstream adoption.

Radiance, TypeNN and TypeCV must audit hand-built reports before adopting the required field.
Their current report literals were not inspected here. Do not infer that no change is needed.
Each adopting repository records 0121 in its compiler-change record. All downstream work is
pending, and assignments are unconfirmed.
