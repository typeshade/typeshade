# Refactoring execution plan

This plan separates compiler responsibilities while preserving authored programs, diagnostics,
emitted output and public APIs. File length alone does not justify a split.
The [1.0 roadmap](roadmap.md) remains the product scope authority.

## Baselines and authority

Reviewed on 2026-11-16 (UTC):

- `main`: `273125b3378b258e654322e6338dd41014b23911`.
- [PR #1272](https://github.com/typeshade/typeshade/pull/1272):
  `96a2f419e3a130caedb5b6caa5ba423fd91fd6d3`, open; all 26 reported checks succeeded.
- [PR #1278](https://github.com/typeshade/typeshade/pull/1278):
  `8c62c95cc8143392db7e7335db9c0c9c533c76ee`, open; the A6 amendment must precede #1272.
- [PR #1257](https://github.com/typeshade/typeshade/pull/1257):
  `58e8187a9320dc8b8b9643e335dfa8bcc10d6372`, the draft Resident-to-Buffer transition.

These are review baselines, not claims that the open branches have shipped.
Recheck their heads and checks before integration.

The owner authorized this work in the conversation on 2026-11-16: "진행하세요".
This authorizes internal refactoring, not merging the prerequisite language amendment.
Under [change control](../changes/README.md#when-a-change-needs-one), an internal refactor
needs no language proposal. Each implementing PR must preserve that scope.

[Owner decisions](owner-decisions.md) remain constraints: OD-1 preserves the independent language,
OD-3 keeps compiler responsibilities off authors, and OD-7 preserves inference from uses.
OD-2 and OD-5 syntax, OD-6 release status, and OD-8's unresolved decorator semantics remain unchanged.
OD-4 requires concrete evidence before a merge decision.

## Document responsibilities

| Document                                              | Responsibility                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Roadmap](roadmap.md)                                 | Near-term product scope and the 1.0 acceptance bar.                                            |
| [Computing platform plan](computing-platform-plan.md) | Responsibility boundaries and later platform priorities; not additional 1.0 commitments.       |
| [Runtime architecture](runtime-architecture.md)       | Current and proposed runtime architecture, distinguished explicitly.                           |
| [Long-term phase plan](use-typeshade-plan.md)         | Historical phases; reconcile each feature against source and tests before updating its status. |
| [Proposal 0100 plan](typeshade-plan.md)               | Execution and measurements for proposal 0100, not the project master plan.                     |
| This plan                                             | Internal refactoring order, dependencies and completion evidence.                              |

The computing platform plan's status reconciliation already distinguishes delivered function VJP
from remaining kernel/storage differentiation. Preserve that distinction when updating the phase plan.
Likewise, test-only differential gates do not establish a delivered end-user divergence mode.

## Work sequence

| ID  | Status                                       | Files and responsibility                                                                                                                                     | Exit evidence                                                                                                                |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| R0  | In progress                                  | This plan; reconcile PR dependencies and document authority.                                                                                                 | Identified baselines, open items and links; documentation checks.                                                            |
| R1  | In progress on a branch based on #1272       | `src/compiler/ts/abstract-const.ts`: separate candidate construction and batch validation from constant analysis.                                            | Equal diagnostic text and order, compiler/editor parity, unchanged generated output, at most two edited compiles per module. |
| R2  | Not started                                  | `src/compiler/ts/context.ts`, `src/compiler/ts/lower/function.ts`, `src/language-service/diagnostics.ts`: explicit analysis lifetimes and shared results.    | Repeated compilation isolation and parity on the same source; no new semantic IR or query framework.                         |
| R3  | Not started                                  | `src/compiler/ts/host-face.ts`: separate export analysis, declaration generation and runtime wrapper generation.                                             | Generated JS, declarations and metadata agree; packed consumers pass.                                                        |
| R4  | Deferred until the Buffer transition settles | `src/core/host-kernel.ts`, `src/core/resident.ts`, `src/runtime/resource.ts`, `src/runtime/program.ts`: ownership, visibility, lifetime and execution state. | Resource sharing, disposal, failure rollback and downstream tests on the resulting Buffer API.                               |
| R5  | Not started                                  | `src/core/passes/kernel-lower.ts`, `src/core/backends/`, validation scripts: separate transformation, execution and verdict responsibilities where useful.   | Source mapping and output preserved; relevant backend and differential gates.                                                |

Each row is a PR series, not a deadline or a file-size target. Keep documentation and tests
with each implementation slice. Record actual checks in that slice's PR.

## First implementation boundary

Constant tracking and use inference stay together. Candidate construction consumes their facts.
Validation applies candidates together, compiles the edited text, maps errors to original offsets,
and checks that the edits introduce no errors. Both CLI and editor use this path.

The first slice extracts internal modules under `src/compiler/ts/remedies/`:

- `candidates.ts`: candidate ordering, declaration edits and replacement construction.
- `validate.ts`: batch checks, edited compilation, offset mapping and the bounded cache.

Analysis supplies projection spans and reached source regions explicitly. The validator must not
import the analysis implementation at runtime. The compiler callback remains the only re-entry point.
Preserve cache policy and diagnostic decisions in this extraction; change them separately if needed.
Keep existing internal imports working where that avoids unrelated caller churn.

## Integration and open items

1. Land #1278 through its existing approval process before #1272.
2. Recheck #1272's head, unresolved review items and regression evidence.
3. Review R1 as a separate diff against the pinned #1272 head.
4. Retarget and revalidate R1 after its prerequisites land; do not merge it into #1272's branch.
5. Start runtime restructuring after #1257's contract and consumer migration settle.

[Issue #1280](https://github.com/typeshade/typeshade/issues/1280) records diagnostic disagreement
already present on `main` `273125b3`. It is not evidence of a regression introduced by #1272.
Keep it open; a refactor must not silently change the recorded behavior.
[Issue #1281](https://github.com/typeshade/typeshade/issues/1281) records a possible widening of
suggested edits. That design decision is outside this refactor.
The other open items in #1272 remain its integration checklist, even though CI is green.

## Verification procedure

1. Record the base and candidate revisions, Node, Bun and TypeScript versions.
2. Run focused inference, abstract-constant, remedy and compiler/editor parity tests.
3. Compare representative diagnostic and emitted-output snapshots against the unchanged base.
4. Run the build, lint, formatting, API snapshots, emit goldens and bundle boundary checks.
5. Run documentation impact and reference checks; resolve affected prose in the same PR.
6. Run any further gates required by the touched behavior, including GPU gates for emit or runtime changes.
7. Record skipped or unavailable checks and baseline failures separately from new failures.

Compare compile and editor latency on the same corpus and environment before claiming a performance
improvement. A structural extraction alone establishes no speedup.
