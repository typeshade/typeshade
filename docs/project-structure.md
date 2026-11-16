# Project structure and refactoring review

Review date: 2026-11-16. Extraction baseline: `5df77cb5`.
The [execution plan](refactoring-plan.md) records branch and merge status.
The tree below shows responsibility groups, not a claim that every file received a manual audit.
Tests live beside their implementation unless they exercise a package-wide contract.

## Project hierarchy

```text
typeshade/
├── src/
│   ├── compiler/ts/            TypeScript syntax to shared shader IR
│   │   ├── lower/             Expressions, statements, functions and class bodies
│   │   ├── remedies/          Suggested-edit construction and validation
│   │   └── *.ts               Source collection, inference, linking and host analysis
│   ├── language-service/      Documents, projection, analysis cache and editor features
│   ├── core/
│   │   ├── ir/                Shared types, nodes, visitors and source spans
│   │   ├── passes/            Validation, optimization and kernel transformations
│   │   ├── backends/          WGSL and GLSL writers over the shared emitter
│   │   ├── debug/             Debug sessions and stepping
│   │   ├── libm/              Numeric implementations
│   │   ├── spec-conformance/  Specification-derived checks and fixtures
│   │   ├── testing/           Differential and generated-program instruments
│   │   └── *.ts               CPU execution, host calls, ownership and fusion
│   ├── runtime/               Devices, resources, programs and rendering
│   ├── rhi/                   Backend command/resource interfaces and implementations
│   ├── cli/                   Command-line compilation and migration
│   ├── algorithms/            Common shader algorithms and generated host faces
│   ├── random/                Random shader functions and generated host faces
│   ├── __api__/               Committed public API and author-name snapshots
│   └── *.ts                   Package entry points and cross-cutting contract tests
├── examples/                  Authored shader examples and emit goldens
├── journeys/                  Packed-package consumer and browser journeys
├── scripts/                   Build, validation, measurements and maintenance
├── docs/                      Language rules, architecture, roadmap and owner decisions
├── changes/                   Controlled proposals and implementation evidence
├── reqs/                      Generated requirement and surface traceability
├── perf/                      Performance fixtures and evidence
├── experiments/               Isolated investigations
├── .github/                   CI workflows and review ownership
├── .githooks/                 Shared commit checks
├── .claude/                   Local agent hooks and commands
└── package.json, tsconfig*.json, vitest.config.ts, bun.lock
                              Build, test and dependency configuration
```

## File review and resulting boundaries

Paths are relative to the repository root. A linked PR identifies an implementation that may
still await integration. A compatibility facade retains existing imports; it does not own every
implementation named by those imports.

| Files                                                                               | What works                                                                                          | Problem or remaining constraint                                                                                                                                          | Disposition                                                                                                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compiler/ts/abstract-const.ts`                                                 | One place tracks numeric origins and use-driven decisions.                                          | Diagnostic wording still reads origin maps, carried values and refusal state. Extracting it mechanically would expose that state or introduce callbacks for each lookup. | Retain coherent analysis. R1 extracts candidate construction and validation, not inference.                                                        |
| `src/compiler/ts/remedies/candidates.ts`                                            | Candidate ordering and edit construction have explicit inputs.                                      | Ordering affects the remedy selected for an author.                                                                                                                      | Keep order and baseline comparisons; merged in #1283.                                                                                              |
| `src/compiler/ts/remedies/validate.ts`                                              | Validation owns edited compilation, offset mapping and bounded caching.                             | Compiler re-entry and exception cleanup require a clear lifetime.                                                                                                        | Preserve the callback boundary and bounded compile count; merged in #1283.                                                                         |
| `src/compiler/ts/remedies/contracts.ts`                                             | Shared edit contracts do not import the analysis implementation.                                    | These are internal contracts, not a second semantic IR.                                                                                                                  | Keep the module small and data-only.                                                                                                               |
| `src/compiler/ts/context.ts`                                                        | Lowering scope and binding rules remain together.                                                   | Source spelling previously shared this module despite having independent synchronous scopes.                                                                             | Move spelling state to `written-context.ts`; merged in #1284.                                                                                      |
| `src/compiler/ts/written-context.ts`                                                | Linked origins and written class/type names have explicit save/restore boundaries.                  | Nested compilation and exceptions must restore each independent scope.                                                                                                   | Boundary tests cover both; no asynchronous context redesign.                                                                                       |
| `src/compiler/ts/lower/function.ts`                                                 | Declaration collection, specialization and body filling share the facts inference needs.            | It also owned signature checks and stage reachability. Body orchestration remains substantial.                                                                           | Stage checks moved in #1285; signatures moved in [#1286](https://github.com/typeshade/typeshade/pull/1286). Keep inference orchestration coherent. |
| lower/function-signature.ts under src/compiler/ts                                   | Parameters, declared results, stage attributes and inferred entry IO share one validator.           | Inferred results become available only after the body settles.                                                                                                           | [#1286](https://github.com/typeshade/typeshade/pull/1286) keeps that call order and compatibility exports.                                         |
| `src/compiler/ts/stage-restrictions.ts`                                             | Both stage checks now have one phase entry point.                                                   | Their resolution and deduplication rules differ; combining algorithms would change behavior.                                                                             | Preserve separate walks and their order; merged in #1285.                                                                                          |
| `src/compiler/ts/function-call-graph.ts`                                            | Shares the existing emitted-name collector with inherited diagnostics.                              | Emitted names are not declaration identity.                                                                                                                              | Document the distinction; do not use it as a universal call graph.                                                                                 |
| `src/language-service/service.ts`                                                   | `DocumentCacheEntry` already shares analysis across diagnostics, symbols, tokens, hover and output. | Cache validity includes imported documents; cross-document refusals have additional dependencies.                                                                        | Retain the existing owner and invalidation rules; verify analysis-cache tests.                                                                     |
| `src/language-service/diagnostics.ts`                                               | Filtering consumes compiler analysis and TypeScript facts without compiling again.                  | Large compatibility tables encode language-specific exceptions and deduplication.                                                                                        | No speculative filter rewrite; preserve paired compiler/editor behavior.                                                                           |
| `src/compiler/ts/host-face.ts`                                                      | A single compile supplies exports and metadata consistently.                                        | It also generated declarations and executable wrappers.                                                                                                                  | [#1288](https://github.com/typeshade/typeshade/pull/1288) retains analysis and delegates generation.                                               |
| host-face-contracts.ts, host-types.ts and host-face-shared.ts under src/compiler/ts | Explicit export records, type conversion, refusal wording and class identity.                       | The public `HostExport` type must keep its shape and import paths.                                                                                                       | [#1288](https://github.com/typeshade/typeshade/pull/1288) changes only its snapshot definition location.                                           |
| host-view.ts and host-module.ts under src/compiler/ts                               | Separate TypeScript declaration and JavaScript generators consume analyzed records.                 | Both must agree on classes, bindings, resource overloads and runtime names.                                                                                              | [#1288](https://github.com/typeshade/typeshade/pull/1288): 118 complete host faces match the baseline.                                             |
| `src/runtime/resource.ts`                                                           | Typed accessors and resource constructors share one layout contract.                                | Region ownership, dirty ranges and per-device state were mixed with those views.                                                                                         | [#1289](https://github.com/typeshade/typeshade/pull/1289) extracts resource-state.ts on the Buffer baseline.                                       |
| resource-state.ts under src/runtime                                                 | Owns allocation, finalization, dirty ranges, snapshots and per-owner copies.                        | Device-ahead visibility and failure retention cannot be changed independently of calls and disposal.                                                                     | [#1289](https://github.com/typeshade/typeshade/pull/1289) preserves object identity and lifecycle order; depends on #1257.                         |
| `src/core/resident.ts`, `src/core/host-kernel.ts`, `src/runtime/program.ts`         | Device copies, kernel dispatch and pipeline recording already have distinct owners.                 | The pending Buffer transition changes their shared contract.                                                                                                             | Retain these boundaries in this pass; do not fork the pending contract or merge R4 first.                                                          |
| `src/core/passes/kernel-lower.ts`                                                   | One coordinator builds a complete WebGPU kernel plan.                                               | WebGL2 construction and reusable IR operations were embedded in the same file.                                                                                           | [#1290](https://github.com/typeshade/typeshade/pull/1290) separates the two responsibilities.                                                      |
| kernel-lower-ir.ts and kernel-lower-gl.ts under src/core/passes                     | Both tiers use shared iteration, range and rewrite operations; WebGL2 owns its plan builder.        | Source spans and reduction/scatter ordering must survive extraction.                                                                                                     | [#1290](https://github.com/typeshade/typeshade/pull/1290): kernel tests, emit goldens and 118 complete host faces preserve behavior.               |
| `src/core/emit.ts`, `src/core/backends/wgsl.ts`, `src/core/backends/glsl.ts`        | Shared IR and emission walk already separate traversal from target spelling.                        | A second IR or independent traversal would duplicate semantics.                                                                                                          | Retain the existing architecture; no file-size-driven split.                                                                                       |
| `scripts/gate-browser.ts`, `scripts/gate-children.ts`, `scripts/compile-gate.ts`    | Browser setup and child-process lifetime are separate from gate-specific verdicts.                  | Instruments must fail on deliberately broken input, and cleanup must not hide a failure.                                                                                 | Preserve the current boundaries and policies.                                                                                                      |

## Dependency direction

The compiler keeps analysis and generation separate:

```text
language-service/service.ts → compiler compile/analysis
function.ts → function-signature.ts → shared compiler context and IR
host-face.ts → host-view.ts / host-module.ts → contracts and host type conversion
kernel-lower.ts / kernel-lower-gl.ts → kernel-lower-ir.ts → shared IR
resource.ts → resource-state.ts → region/layout and resource ownership
```

The resource row describes #1289 on its Buffer prerequisite. Generators do not import the host
analysis coordinator. Resource state does not import the resource facade or compiler. Existing
facade exports preserve caller paths while the implementation dependencies point inward.

## Completion evidence and limits

The PRs carry exact commands, baselines, tool versions and results. Local checks use Node
24.19.0, Bun 1.4.4 and TypeScript 5.6.3. CI supplies the wider TypeScript matrix, GPU gates and
packed consumer journeys. Do not add test totals across PRs: many suites overlap.

- R1: candidate/validation separation is merged. Further analysis-dependent sentence extraction
  is not justified by this review. Issues #1280 and #1281 remain separate behavior/design work.
- R2: source spelling and stage checking are merged. Signature extraction and cache-boundary
  verification merged in #1286 as `bd796a11`, after 26 checks passed.
- R3: host analysis/generation separation merged in #1288 as `b334eadd`, after 26 checks passed.
- R4: resource-state separation is implemented in #1289, based on #1257. The TypeNN consumer migration merged in typeshade/typenn#27 after CPU and GPU checks passed.
  Retarget to main and revalidate only after the Buffer contract integrates.
- R5: shared kernel IR/WebGL2 separation merged in #1290 as `ec746bcf`, after 26 checks passed. Existing backend and gate
  boundaries were reviewed and retained.

These extractions establish responsibility boundaries, not a compile-time or runtime speedup.
On the integrated Buffer baseline, R4 grows by six gzip bytes in its single-file form and five
bytes in its initial split and aggregate forms. Its PR records the measured caps. A passing refactor does not resolve unrelated
language-design questions or certify every file in the project.
