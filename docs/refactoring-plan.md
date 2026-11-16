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
The reviewed R0–R5 sequence is complete on main `ad05431a`. The integration record below includes its prerequisites.

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

| ID  | Status                                         | Files and responsibility                                                                                                                                     | Exit evidence                                                                                                                |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| R0  | Merged in #1282                                | This plan; reconcile PR dependencies and document authority.                                                                                                 | Identified baselines, open items and links; documentation checks.                                                            |
| R1  | Extraction merged; remaining analysis retained | `src/compiler/ts/abstract-const.ts`: separate candidate construction and batch validation from constant analysis.                                            | Equal diagnostic text and order, compiler/editor parity, unchanged generated output, at most two edited compiles per module. |
| R2  | Merged in #1284, #1285 and #1286               | `src/compiler/ts/context.ts`, `src/compiler/ts/lower/function.ts`, `src/language-service/diagnostics.ts`: explicit analysis lifetimes and shared results.    | Repeated compilation isolation and parity on the same source; no new semantic IR or query framework.                         |
| R3  | Merged in #1288                                | `src/compiler/ts/host-face.ts`: separate export analysis, declaration generation and runtime wrapper generation.                                             | Generated JS, declarations and metadata agree; packed consumers pass.                                                        |
| R4  | Merged in #1289 after #1257                    | `src/core/host-kernel.ts`, `src/core/resident.ts`, `src/runtime/resource.ts`, `src/runtime/program.ts`: ownership, visibility, lifetime and execution state. | Resource sharing, disposal, failure rollback and downstream tests on the resulting Buffer API.                               |
| R5  | Merged in #1290                                | `src/core/passes/kernel-lower.ts`, `src/core/backends/`, validation scripts: separate transformation, execution and verdict responsibilities where useful.   | Source mapping and output preserved; relevant backend and differential gates.                                                |

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

Branch patterns in this table are naming conventions; the integration record identifies the delivered slices.
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
analysis or resource contract follows its dependency order. R4 followed this order: prepare on #1257, integrate that contract, then retarget and merge the focused extraction.

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
- #1285 merged as `5df77cb59f52d92c32ced92741647b8109e6da47`, after all 26 checks passed.
- #1286 merged as `bd796a11c01e97b6b599b4cb8b3b71ae2663dd13`, after all 26 checks passed on `d66f33b7`.
- #1288 merged as `b334eadd806c2baa75b0e8ae0ef065eb083ba78d`, after all 26 checks passed on `eaf5c635`.
- #1290 merged as `ec746bcffc237dcd46022a952252aaa81ff02159`, after all 26 checks passed on `753744e7`.
- #1257 merged as `3b579904d5e024d5e8380f9f0ab1e261e6968ee8`, after all 28 checks passed on `0d696ac0`.
- #1289 merged as `ad05431a6409e0332083f4764dd425b7db4652d7`, after all 26 checks passed on `9311fc5a`.

The reviewed refactoring sequence is complete. Analysis-dependent R1 wording remains with
inference because no further independent boundary was justified. The Buffer prerequisite and
TypeNN migration are integrated; R4 was retargeted to main with only its five-file extraction.

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

This was the first R2 slice. At its merge, function lowering and compiler/editor analysis remained
follow-up work, and R3 and R5 had not started. The implementation record below supersedes that
status. R4 subsequently integrated after the Buffer transition; its TypeNN failure and remediation are recorded below.

## R2 entry-stage validation slice

Merged in [PR #1285](https://github.com/typeshade/typeshade/pull/1285) as `5df77cb59f52d92c32ced92741647b8109e6da47`, after all 26 checks passed.

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

## Remaining sequence implementation record

The owner requested completion of the remaining sequence on 2026-11-16, with independent work
continuing while checks or prerequisites wait. The [project structure review](project-structure.md)
records the hierarchy, file responsibilities, retained boundaries and limitations.

| Stage | PR                                                        | Baseline            | Local evidence                                                                        | Integration result                     |
| ----- | --------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| R2    | [#1286](https://github.com/typeshade/typeshade/pull/1286) | `5df77cb5`          | 1,600 tests; 12 diagnostic/emit comparisons; analysis-cache reuse and invalidation    | Merged as `bd796a11`; 26 checks passed |
| R3    | [#1288](https://github.com/typeshade/typeshade/pull/1288) | `5df77cb5`          | 541 tests covered; 118 identical complete host faces; API definition-path-only change | Merged as `b334eadd`; 26 checks passed |
| R4    | [#1289](https://github.com/typeshade/typeshade/pull/1289) | #1257 at `0d696ac0` | 131 tests; measured runtime bundle caps; unchanged lifecycle/state objects            | Merged as `ad05431a`; 26 checks passed |
| R5    | [#1290](https://github.com/typeshade/typeshade/pull/1290) | `5df77cb5`          | 406 tests; 118 identical complete host faces; shared IR and both tier plans           | Merged as `ec746bcf`; 26 checks passed |

R1 review: `divisionSentence` reads origin and carried-value maps, and `readingsRemedy` depends
on the same refusal facts. Keep that analysis-dependent wording with its analysis. The extracted
candidate and validator modules are the useful boundary; introducing a lookup callback per fact
would add indirection without separating an independent responsibility.

R2 review: signatures and post-inference entry-IO checks now share a module. The service already
owns analysis by document/dependency key and diagnostics consume it. Tests verify that one analysis
serves diagnostics, hover, symbols, tokens and output, and refreshes after an imported file changes.
No additional analysis cache, universal query framework or semantic IR is introduced.

R5 review: backend writers already use the shared emission walk; gate browser setup and child
cleanup already have dedicated modules. Preserve these boundaries instead of rewriting them to
satisfy a file-size target. Further work needs a concrete coupling or correctness problem.

## R4 prerequisite resolution

R4 changes internal ownership only. It does not restore the removed public `Resident` contract.
At #1257 head `58e8187a`, the TypeNN candidate check failed before tests because four files imported that removed type.
At that head, the downstream workflow pinned TypeNN to `3a7d66c623722cae4c1288a4a59e88bac1689fed`.
A read-only inspection also found `write` and `destroy` calls in that consumer.
The accepted proposal 0138, Amendments A10 and A11, describes its migration; a type alias alone would not complete it.

All five steps of this integration procedure are complete:

1. Migrate and validate the pinned TypeNN consumer against the Buffer contract under proposal 0138.
2. Update the downstream pin deliberately and pass the candidate build and CPU tests.
3. Resolve #1257 against current main, including changes moved into the host generator modules.
4. Integrate #1257 only after its current-head checks and review conditions pass.
5. Retarget #1289 to main, preserve only its resource-state extraction, and repeat affected checks.

TypeNN [PR #27](https://github.com/typeshade/typenn/pull/27) merged as `6ee9a603`, after CPU and Chromium/WebGPU CI passed. Its 684 CPU tests also pass locally. The migration preserves f32/u32 reads, uses set/dispose, and lands a stale parameter before replacement. #1257 now pins that validated consumer revision.

At retargeting, main `3b579904` matched the tested prerequisite `0d696ac0` exactly.
The diff contained only the five resource-state implementation, budget and architecture files.
#1289 then merged as `ad05431a` after all 26 current-head checks passed.
The former blocker is distinct from issues #1280 and #1281.

## Buffer prerequisite integration evidence

The former TypeNN blocker was reproduced on #1257 at `58e8187a` and migrated in TypeNN #27.
That PR pins the approved Buffer candidate and passed both CPU and Chromium/WebGPU CI before merging.
Its 684 CPU tests caught two migration details: disposed-handle wording and replacement of a stale parameter.
The latter now reads device-written storage before set, preserving a replacement that aliases the host array.

#1257's integration with main `b334eadd` preserves the accepted Buffer behavior in the extracted
host modules. Eleven local suites pass 564 tests; 118 complete host faces match its Buffer baseline.
The API snapshot changes only the HostExport definition path relative to that baseline.
Build, lint, formatting, bundle boundaries, documentation references and Doorstop pass.
The downstream gate pins TypeNN's merged revision `6ee9a603` deliberately.

The combined runtime bundle measures 171,171 gzip bytes, split initial 52,020 and aggregate 173,626.
The fuse bundle measures 115,529 bytes and split aggregate 116,533. The five exceeded caps record
those measurements; floors remain unchanged. These costs do not establish a performance benefit.

The final prerequisite synchronization `0d696ac0` includes main `ec746bcf` and the kernel separation.
Five affected suites pass 143 tests, and the 118 host faces remain identical to the Buffer baseline.
The full TypeNN build and 684 CPU tests also pass against integrated compiler `1aba11a9`.
