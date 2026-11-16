# Refactoring execution plan

This plan separates compiler responsibilities while preserving authored programs, diagnostics,
emitted output and public APIs. File length alone does not justify a split.
The [1.0 roadmap](roadmap.md) remains the product scope authority.

## Baselines and authority

Initial review baselines on 2026-11-16 (UTC):

- `main`: `273125b3378b258e654322e6338dd41014b23911`.
- [PR #1272](https://github.com/typeshade/typeshade/pull/1272):
  `96a2f419e3a130caedb5b6caa5ba423fd91fd6d3`, subsequently merged; all 26 reported checks succeeded before integration.
- [PR #1278](https://github.com/typeshade/typeshade/pull/1278):
  `8c62c95cc8143392db7e7335db9c0c9c533c76ee`, subsequently merged before #1272.
- [PR #1257](https://github.com/typeshade/typeshade/pull/1257):
  `58e8187a9320dc8b8b9643e335dfa8bcc10d6372`, the draft Resident-to-Buffer transition.

These identify the original review configuration. The integration record below identifies completed merges.
Recheck the current head and checks before each remaining integration.

The owner authorized this work in the conversation on 2026-11-16: "진행하세요".
The owner subsequently delegated suitable integrations: "완료되거나 메인에 병합이 가능하거나 적절한 타이밍이라면 병합까지 맡길게".
This covers the reviewed refactoring sequence and its prerequisites. Required checks, scope review
and dependency ordering still apply; new language design decisions remain outside this internal refactor.
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

| ID  | Status                                                     | Files and responsibility                                                                                                                                     | Exit evidence                                                                                                                |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| R0  | Merged in #1282                                            | This plan; reconcile PR dependencies and document authority.                                                                                                 | Identified baselines, open items and links; documentation checks.                                                            |
| R1  | First slice merged in #1283                                | `src/compiler/ts/abstract-const.ts`: separate candidate construction and batch validation from constant analysis.                                            | Equal diagnostic text and order, compiler/editor parity, unchanged generated output, at most two edited compiles per module. |
| R2  | Source spelling merged; stage-validation slice in progress | `src/compiler/ts/context.ts`, `src/compiler/ts/lower/function.ts`, `src/language-service/diagnostics.ts`: explicit analysis lifetimes and shared results.    | Repeated compilation isolation and parity on the same source; no new semantic IR or query framework.                         |
| R3  | Not started                                                | `src/compiler/ts/host-face.ts`: separate export analysis, declaration generation and runtime wrapper generation.                                             | Generated JS, declarations and metadata agree; packed consumers pass.                                                        |
| R4  | Deferred until the Buffer transition settles               | `src/core/host-kernel.ts`, `src/core/resident.ts`, `src/runtime/resource.ts`, `src/runtime/program.ts`: ownership, visibility, lifetime and execution state. | Resource sharing, disposal, failure rollback and downstream tests on the resulting Buffer API.                               |
| R5  | Not started                                                | `src/core/passes/kernel-lower.ts`, `src/core/backends/`, validation scripts: separate transformation, execution and verdict responsibilities where useful.   | Source mapping and output preserved; relevant backend and differential gates.                                                |

Each row is a PR series, not a deadline or a file-size target. Keep documentation and tests
with each implementation slice. Record actual checks in that slice's PR.

## Git branch strategy

The owner requested branch-based execution on 2026-11-16: "진행은 깃브렌치 전략으로 하자."
Use `main` as the integration baseline. Give each reviewable slice its own branch, worktree
and pull request. Keep a branch focused on one responsibility and its tests and documentation.

| Work                   | Branch                                   | Review base                                         | Integration target             |
| ---------------------- | ---------------------------------------- | --------------------------------------------------- | ------------------------------ |
| Plan and status, #1282 | `codex/refactor-execution-plan` (merged) | `main`                                              | `main`                         |
| First R1 slice, #1283  | `codex/abstract-const-remedies` (merged) | `main`                                              | `main`                         |
| Further R1 slices      | `codex/refactor-r1-<slice>`              | Updated `main`, or the specific prerequisite branch | `main`, after the prerequisite |
| R2 through R5 slices   | `codex/refactor-r<stage>-<slice>`        | Updated `main`, or the specific prerequisite branch | `main`, after the prerequisite |

The future branch names are conventions; those branches do not exist until work starts.
The plan branch records status and does not accumulate implementation commits.

1. Fetch the integration baseline before starting a slice.
2. Create its branch and separate worktree from the recorded base commit.
3. Push its first reviewable commit and open a draft PR with its scope and dependencies.
4. Push fixes to the same branch and record validation for the current head.
5. Mark the PR ready when its required checks pass, following the repository's review rules.
6. Integrate prerequisites before their dependent PRs.
7. Retarget a dependent PR to `main` and verify that its diff contains only its own slice.
8. Rerun affected checks after changing the base or resolving conflicts.
9. Merge through the repository's approval and check requirements.
10. Remove a completed worktree and branch only after verifying that its work is integrated and its worktree is clean.

A dependent PR may temporarily target its prerequisite's branch to show the incremental diff.
That target is for review only: do not merge the dependent work into the prerequisite branch.
If a squash merge changes the prerequisite's ancestry, replay only the dependent commits onto
the new `main`. Record the old and new heads, and use `--force-with-lease` only when updating
that task branch after checking its remote head. Never rewrite `main` or another task's branch.

Independent slices can start from `main` while a prerequisite waits. Work that changes the same
analysis or resource contract follows its dependency order. R4 still waits for #1257's Buffer contract.

## First implementation boundary

Constant tracking and use inference stay together. Candidate construction consumes their facts.
Validation applies candidates together, compiles the edited text, maps errors to original offsets,
and checks that the edits introduce no errors. Both CLI and editor use this path.

The first slice extracts internal modules under `src/compiler/ts/remedies/`:

- `candidates.ts`: candidate ordering, declaration edits and replacement construction.
- `validate.ts`: batch checks, edited compilation, offset mapping and the bounded cache.
- `contracts.ts`: shared internal edit and diagnostic contracts.

Analysis supplies projection spans and reached source regions explicitly. The validator must not
import the analysis implementation at runtime. The compiler callback remains the only re-entry point.
Preserve cache policy and diagnostic decisions in this extraction; change them separately if needed.
Keep existing internal imports working where that avoids unrelated caller churn.

## Integration and open items

Completed on 2026-11-16 after checking the current heads, required checks, conflicts and review threads:

- #1278 merged as `1f4d726ddde75e3d9381e02092082de07eb33a1c`.
- #1272 merged next as `4bf416e79ca402459455e99fe520cea5dcbe50f7`.
- #1282 merged as `fa60da805834bff38a3290d6dc7da9c178a34ed7`.
- #1283 merged as `397071cbdbfb1cc3d91611e6c44e5d7639e1187e`, after all 26 checks passed on its synchronized head.
- #1284 merged as `f4855c8fd9c86f46340b941c8b9330bbab7c35dc`, after all 26 checks passed on `92601bf`.

1. Validate the R2 entry-stage checking slice against `main` at `f4855c8`.
2. Keep subsequent R1 slices separate from new inference behavior.
3. Start runtime restructuring after #1257's contract and consumer migration settle.

[Issue #1280](https://github.com/typeshade/typeshade/issues/1280) records diagnostic disagreement
already present on `main` `273125b3`. It is not evidence of a regression introduced by #1272.
Keep it open; a refactor must not silently change the recorded behavior.
[Issue #1281](https://github.com/typeshade/typeshade/issues/1281) records a possible widening of
suggested edits. That design decision is outside this refactor.
The other open items recorded in #1272 remain follow-up issues; its merge does not close them.

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

## First slice verification record

[PR #1283](https://github.com/typeshade/typeshade/pull/1283) contains the first R1 slice at
`ae05785e29115ed79072d0d12bb0dec760ba860a`, based on the #1272 head above.
It extracts constant-division candidate construction and module-wide edit validation.
Other analysis-dependent refusal construction remains with the analysis.
The PR is merged into `main`; the integration record above identifies its merge commit.
[PR #1282](https://github.com/typeshade/typeshade/pull/1282) records this plan.

Local verification on 2026-11-16 UTC used Node 24.19.0, Bun 1.4.4 and TypeScript 5.6.3:

- The four focused inference, constant, differential and remedy suites passed 497 tests before and after extraction.
- Five validator boundary tests passed, including exception cleanup and original-position mapping.
- Six API, emit-golden, example and ambient-parity suites passed 560 tests.
- A separate comparison of 43 complete source literals preserved compiler/editor diagnostics and WGSL/GLSL byte for byte.
- Build, lint, format, bundle boundary, documentation references, documentation impact and precommit checks passed.

These results cover the first extraction, not the entire R1 or project plan.
The full unit suite, newer TypeScript matrix, GPU gates, packed consumer journeys and performance
benchmarks were not run locally. Broader integration checks remain in CI.

On 2026-11-16, all 26 reported CI checks passed for the first-slice head above, including
the TypeScript matrix, GPU gates, packed consumer journeys, package smoke and TypeNN candidate.
PR #1283 was then marked ready for review. Those results apply to its original review base.
After retargeting, head `64246e8d61e6a5777bf58c7ba51b22d01c1cb0f4` incorporated `main` at `4bf416e`.
All 26 CI checks passed again, and 512 focused and traceability tests passed locally before integration.
The synchronization changes only the prerequisite documents and traceability records; the refactored source is unchanged.

## R2 source spelling context slice

Merged in [PR #1284](https://github.com/typeshade/typeshade/pull/1284).
Branch: `codex/refactor-r2-written-context`, based on `main`
`397071cbdbfb1cc3d91611e6c44e5d7639e1187e`.

`src/compiler/ts/written-context.ts` owns source spelling: linked-file origins, original class
names and type text. `context.ts` keeps lowering scopes and bindings, with compatibility re-exports.
`source-file.ts` imports the two scope boundaries directly from their owner.

The linked origin and written-struct table retain their independent synchronous lifetimes.
This extraction preserves the current save/restore behavior instead of changing inference or
introducing asynchronous context. Boundary tests exercise nested compilation, exceptions,
source-file identity and the independence of the two scopes.

This is the first R2 slice. Function lowering stages and compiler/editor analysis results remain
separate follow-up work. R3 and R5 have not started. R4 remains blocked on the Buffer transition;
#1257's reviewed head still has a failing TypeNN candidate check.

## R2 entry-stage validation slice

Branch: `codex/refactor-r2-stage-validation`, based on `main`
`f4855c8fd9c86f46340b941c8b9330bbab7c35dc`.

`lower/function.ts` retains body construction, inherited diagnostic handling and recursion checks.
It hands completed functions to `checkEntryStageUses` in `stage-restrictions.ts` before definite
assignment and reference-alias checks. This phase owns both existing stage checks and their tables.
The existing internal table exports remain available from `lower/function.ts`.

The two stage walks preserve their order, diagnostic wording and resolution rules. Their algorithms
are not unified: the compute-only walk follows declaration identity, while the other walk uses
emitted names. `function-call-graph.ts` holds the existing emitted-name collector shared with
inherited-body diagnostics. It does not introduce a new graph model.

Boundary tests preserve nearest-helper reporting, one diagnostic per operation and entry,
source-ordered diagnostics from both restriction families, unreachable helpers and builtin-name
shadowing. Each case checks the compiler and editor on the same source.
