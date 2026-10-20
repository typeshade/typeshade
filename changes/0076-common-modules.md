---
id: '0076'
title: 'Two common modules on the SciPy layout, `typeshade/linalg` and `typeshade/optimize`, give a kernel the small dense linear algebra and the robust-fitting skeleton that TypeCV wrote for itself, each held to the CPU oracle on every tier'
status: draft
rules:
  - '11.20'
surface:
  - 72
  - 74
  - 75
exports:
  - qrInsertRow9
  - qr9x8
  - solveTriangular9
  - nullVector9
  - secondSingular9
  - svd4
  - solve3
  - solve6
  - inv3
  - inv4
  - det3
  - det4
  - Linear3
  - Linear6
  - Inverse3
  - Inverse4
  - NullVector9
  - Svd4
  - sampleIndices8
  - dynamicMaxTrials
  - scoreBlock
  - selectSequential
  - batchCounts
  - lmStep3
  - lmStep6
  - lmLambda
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typecv
    what: 'After the pin moves, the copies of the module functions in `src/gpu/pair-models.shade.ts`, `projective.shade.ts`, `numerics.shade.ts`, `consensus.shade.ts` and `triangulation.shade.ts` become imports from `typeshade/linalg` and `typeshade/optimize` (What it owes downstream lists each). The condition: the digest `PREVIOUS_RESULTS` of `tests/typeshade/pair-batch.test.mjs` and every other result test stay bit for bit. A function whose module form changes a digest stays in typecv. `compiler-changes.md` records 0076 when the pin moves.'
  - repo: typenn
    what: Nothing must change. Its kernels (`src/kernels/optim.shade.ts`, `matmul.shade.ts`) are f32 SGD, Adam and a matrix product, with no small dense solve and no least-squares step. `compiler-changes.md` records 0076 when the pin moves.
  - repo: radiance
    what: Nothing must change. Its kernels read the inverse world matrix that the host writes (`packages/radiance/src/kernels/layout.shade.ts`), and its rotation and matrix code is host TypeScript (`packages/radiance/src/math/`). The later `typeshade/spatial` may concern it. `compiler-changes.md` records 0076 when the pin moves.
  - repo: typeshade.github.io
    what: A guide page for each new module, en and ko, that teaches its device face and its host face. The page of `typeshade/algorithms` names the four modules and the SciPy map. The API reference is generated from the pinned compiler's source. Not read in this draft; the implementation reads the site before acceptance is recorded.
  - repo: vscode-typeshade
    what: The skill's references gain the two modules, the SciPy map and the robust-fitting layout, so that the assistant suggests an import before an author writes a QR, a triangular solve or a RANSAC selection again. Not read in this draft; the implementation reads the plugin before acceptance is recorded.
---

<!-- doc-refs: skip-file — this draft names files, sections and tests that a later implementation adds, and files of other repositories, which this tree does not have -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0076. This file is the proposal source. It has status `draft`. Its recommendations are proposals, not decisions.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Revision context            | Drafted 2026-10-20, Asia/Seoul. This date is the authoring context. It is not an approval date.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Request source              | The owner, Seungup, approved the drafting of this proposal in the project conversation of 2026-10-20 (Asia/Seoul): to publish TypeCV's reusable GPU patterns as common modules of the compiler, as `typeshade/random` is one. In the same conversation the owner asked that the modules follow SciPy's layout (D1). That is the attribution of the request. It is not an approval of the proposal. No GitHub issue is recorded for this draft.                                                                                                      |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Current lifecycle state     | `draft`. No approval and no implementation exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Applicability / effectivity | Two new package subpaths, `typeshade/linalg` and `typeshade/optimize`, each a shader package of change 0024 under Rule 11.20 (sources under `src/linalg/` and `src/optimize/`). Rule 11.20 of `docs/language-design.md`. Sections 72 (amended), 74 and 75 (new) of `docs/use-typeshade-surface.md`. `scripts/bake-common-modules.ts`, `scripts/common-modules-arm.ts`, `scripts/bundle-boundary.ts`, `scripts/bundle-budget.json`, `package.json`, `src/api-subpaths.ts`, `reqs/`, `CHANGELOG.md`, `src/AGENTS.md`. No release version is assigned. |
| Review baseline             | `origin/main` at `78d9d39e1c9774ec286bcb29c25b2b177ffafdba` (commit "Amend proposal 0064 (A1): WebGL2 lowers depth bias to polygonOffset within a bound (#700)"), read on 2026-10-20. Proposal ids 0000 to 0075 were read on that commit and on the remote branches fetched in the worktree. Id 0076 was not in use on any of them. The consumers were read at typecv `909aa54` (typecv `main` `329043c` plus the triangulation change, compiler pin `d70b539`), typenn `61259c3` and radiance `3e4efb3`.                                           |
| Proposal review             | No pull request is assigned yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Revision authority          | Git records the revisions of this file. The review and merge of the proposal pull request will record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                                                                                |

## What changes

**Before.** The compiler publishes two common modules (Rule 11.20, change 0072). `typeshade/algorithms` holds the maps, the reductions, the scan, the compaction and the histogram over arrays (surface §72). `typeshade/random` holds the generators and the hashes (§73). §72 lists "matrix products and `f64` linear algebra" as a later delivery under change 0072's D6.

TypeCV wrote its own small dense linear algebra and its own RANSAC skeleton in `"use typeshade"`, in `f64`. Each copy has its own tests on its own tiers (Why). A second consumer that needs a 9×9 null vector or a sequential-equivalent RANSAC writes them again.

**Proposed.** Two more common modules, under Rule 11.20, named on SciPy's layout (D1):

- `typeshade/linalg` (scipy.linalg): small dense linear algebra in `f64` at fixed sizes. A streaming QR, a Householder QR, triangular solves, the null vector of a 9×9 factor, its second singular value, a one-sided Jacobi SVD with a fixed sweep cap, SPD solves, and 3×3 and 4×4 inverses and determinants.
- `typeshade/optimize` (scipy.optimize, with scikit-image's `skimage.measure.ransac` as the reference of the robust fit): the robust-fitting skeleton and one Levenberg–Marquardt step. Hypothesis sampling over `typeshade/random`, a block score over a residual function the application gives, the sequential-equivalent selection with the adaptive trial budget, the workgroup counts of change 0075, and a host-loop recipe on `device.fuse(body, { chunk })` of change 0074.

`typeshade/algorithms` and `typeshade/random` stay as they are. They are the NumPy level of the layout.

### The SciPy map

Decision D1 records the reason and the alternative. The map binds later deliveries too, so that each later module takes its name from it.

| TypeShade module       | SciPy or reference module                                                                                                   | Delivery                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `typeshade/algorithms` | NumPy (`numpy` ufuncs, reductions, `cumsum`, `histogram`)                                                                   | Change 0072, delivered    |
| `typeshade/random`     | NumPy (`numpy.random`)                                                                                                      | Change 0072, delivered    |
| `typeshade/linalg`     | `scipy.linalg`                                                                                                              | This proposal             |
| `typeshade/optimize`   | `scipy.optimize` (`least_squares`, `method='lm'`); robust fitting after `skimage.measure.ransac`, since SciPy has no RANSAC | This proposal             |
| `typeshade/sparse`     | `scipy.sparse.linalg` (one PCG iteration as kernels, Schur blocks)                                                          | Later, recorded name only |
| `typeshade/spatial`    | `scipy.spatial.transform` (rotations, projection, distortion, DLT rows)                                                     | Later, recorded name only |
| `typeshade/ndimage`    | `scipy.ndimage` (Gaussian pyramid, convolution, difference of Gaussians)                                                    | Later, recorded name only |

**The naming rule (proposed).** Where SciPy has a module of that name, the TypeShade module takes the same name. A function takes SciPy's function name in camelCase where the semantics match, as `typeshade/algorithms` spells `exclusiveScan`: `solve_triangular` becomes `solveTriangular`. A function at a fixed size carries the size as a suffix (D3): `solveTriangular9`. Where SciPy has no function of those semantics, the draft names the function after the nearest reference and says which, in the table of its module. These names are the exports of a module. They are not names of the language, so §9 of `docs/language-design.md` does not change (as for change 0072).

### Rule 11.20 (amended)

The proposed amendment changes three things. The rest of Rule 11.20 stays.

1. The list of modules gains `typeshade/linalg` and `typeshade/optimize` (change 0076).
2. **A function that computes in `f64` (D2).** The CPU tier gives the bits of the binary64 oracle, as today. Each GPU tier gives, under each flavor of the emulated double (change 0073, `'float'` and `'integer'`), the bits of the f32 oracle run on the module that the fp64 pass lowered under that flavor. The differential gate holds both. So the "oracle" of an `f64` function on a GPU tier is the emulation run with f32 rounding, which `src/core/fp64/df64-known-answer.test.ts` already does for the `df64_*` bodies. Inference: an `f64` result is then not the same bits on the CPU tier and on a GPU tier. That is true of every emulated double today; the amendment states it.
3. **A device helper that the host face cannot call.** A helper that takes a function (Rule 8.18) or that is generic (Rule 8.9) has no host face (Rule 8.20). The module's tests hold it through the instances their test kernels make.

The amendment adds no rule for workgroup memory. Neither module uses workgroup memory or a barrier (D4). Change 0072's D4 (the helpers a kernel composes over its own workgroup memory) stays deferred.

### `typeshade/linalg` (surface §74, new)

Every function is an `f64` device helper at a fixed size (D3). A matrix is row-major in an `array<f64, N>`. Each helper takes its arguments by value and returns a value, as typecv's helpers do. A fixed-size array is a host value (Rule 8.21), so each helper is also a plain CPU function of the host face (surface §64), as `xorshift32` is in `typeshade/random`. The module has no kernel function in this delivery (D3).

| Function                                                                                                | SciPy or reference                                          | Contract (draft)                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qrInsertRow9(r: array<f64, 81>, row: array<f64, 9>): array<f64, 81>`                                   | Nearest: `scipy.linalg.qr_insert(..., which='row')`, R only | One row appended to the upper triangular factor `r` by Givens rotations, so a factor of any number of rows fits in 81 words without `A^T A`. typecv's `appendRow` (`src/gpu/projective.shade.ts`).                                                                                                                                             |
| `qr9x8(a: array<f64, 72>): array<f64, 72>`                                                              | `scipy.linalg.qr(a, mode='r')`                              | Householder QR of a 9×8 matrix in place. The triangle stays on and above the diagonal. The inner QR of typecv's `secondSingular` (`src/gpu/pair-models.shade.ts`).                                                                                                                                                                             |
| `solveTriangular9(r: array<f64, 81>, b: array<f64, 9>, n: u32, trans: u32): array<f64, 9>`              | `scipy.linalg.solve_triangular(a, b, trans, lower=False)`   | `R z = b` (`trans` 0) or `R^T y = b` (`trans` 1) on the leading `n`×`n` block of an upper triangular `r`. typecv's `backSolve` and `forwardSolve`.                                                                                                                                                                                             |
| `nullVector9(r: array<f64, 81>): NullVector9`                                                           | Nearest: `scipy.linalg.null_space`, one vector              | The unit null vector of a 9×9 upper triangular factor: a back-substitution at the smallest pivot, refined by four inverse iterations on `R^T R`, with every pivot below 1e-14 of the largest raised to that floor. With it, the second-smallest and the largest singular values, and `ok`. typecv's `solvePairModelNull`, without its storage. |
| `secondSingular9(r: array<f64, 81>, x: array<f64, 9>): f64`                                             | Nearest: `scipy.linalg.svdvals`, one value                  | The second-smallest singular value of `r`, given its unit null vector `x`: a Householder reflection, `qr9x8` of the 9×8 block, six inverse iterations. 0 for a rank loss. typecv's `secondSingular`.                                                                                                                                           |
| `svd4(a: array<f64, 512>, rows: u32): Svd4`                                                             | `scipy.linalg.svd`                                          | One-sided Jacobi SVD of a `rows`×4 matrix, `rows` at most 128, with a fixed cap of 160 sweeps and a `converged` flag. Never forms `A^T A`. typecv's `linear` (`src/gpu/triangulation.shade.ts`).                                                                                                                                               |
| `solve3(a: array<f64, 9>, b: vec3f64): Linear3`, `solve6(a: array<f64, 36>, b: array<f64, 6>): Linear6` | `scipy.linalg.solve(a, b, assume_a='pos')`                  | Diagonal equilibration, then Cholesky, for a symmetric positive definite `a`. `ok` is 0 for a pivot at or below 1e-14. typecv's `solve3` and `solve6` (`src/gpu/numerics.shade.ts`).                                                                                                                                                           |
| `inv3(a: array<f64, 9>): Inverse3`, `inv4(a: array<f64, 16>): Inverse4`                                 | `scipy.linalg.inv`                                          | The adjugate over the determinant. `ok` is 0 when the determinant is outside (1e-30, 1e30) in magnitude. `inv3` is typecv's `inverse3`, with the flag as a field instead of word 9. `inv4` has no typecv source (Rule 13.3 measures it first).                                                                                                 |
| `det3(a: array<f64, 9>): f64`, `det4(a: array<f64, 16>): f64`                                           | `scipy.linalg.det`                                          | The cofactor expansion along the first row.                                                                                                                                                                                                                                                                                                    |

The structs `Linear3`, `Linear6`, `Inverse3`, `Inverse4`, `NullVector9` and `Svd4` are exported types of the host face (Rule 8.20). Each has the result's fields and `ok: u32`.

Excluded from this delivery: `f32` forms (D3), an `eigh` (no consumer source), a general `m`×`n` QR, `lu`, `cholesky` and `cho_solve` as separate functions, and batched kernel functions over many matrices. Each is a later amendment of this proposal or a proposal of its own.

### `typeshade/optimize` (surface §75, new)

The module has a device face and a host face. The application keeps its model: its residual, its model width and its minimal solver (D4).

| Face   | Function                                                                                                                                                                                                      | SciPy or reference                                                                                | Contract (draft)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device | `sampleIndices8(seed: u32, trial: u32, n: u32, k: u32): array<u32, 8>`                                                                                                                                        | Nearest: `numpy.random.Generator.choice(n, k, replace=False)`, as `skimage.measure.ransac` draws  | `k` (at most 8) distinct indices below `n`, sorted, by bounded sorted insertion over `xorshift32` of `typeshade/random`. The stream starts at `seed ^ ((trial + 1) * 0x9e3779b9)`, and 0 becomes `0x85ebca77`. typecv's sampler in `preparePairModels`.                                                                                                                                                                                            |
| Device | `dynamicMaxTrials(count: u32, total: u32, sampleSize: u32, logFailure: f32, maximum: u32, minimum: u32): u32`                                                                                                 | `skimage.measure.ransac`'s `_dynamic_max_trials`                                                  | The adaptive trial budget in `f32`, with the bounded series for `log(1 - p)` below `p = 0.125`, one conservative extra trial and the clamp to `[minimum, maximum]`. typecv's `adaptiveTrials`. Also a CPU function of the host face.                                                                                                                                                                                                               |
| Device | `scoreBlock(trial: u32, start: u32, count: u32, threshold: f64, residual: (trial: u32, point: u32) => f64): vec2f64`                                                                                          | `skimage.measure.ransac`: `residuals < residual_threshold`, the inlier count and the residual sum | The inlier count and the sum of inlier residuals of points `[start, start + count)` for one trial, folded in ascending point order. A point is an inlier when `residual(trial, point) <= threshold * threshold`. The application's residual returns a value above the threshold for a point it excludes. The fold order is that of typecv's `scorePairModelsOracle`. No host face (Rule 8.20).                                                     |
| Host   | `selectSequential(state: array<u32>, best: array<f64>, partials: array<f64>, valid: array<u32>, models: array<f64>, start: u32, trials: u32, maximum: u32, minTrials: u32, sampleSize: u32, logFailure: f32)` | `skimage.measure.ransac`'s loop, sequential                                                       | A kernel function, one iteration per search. It walks the batch's trials in order and stops where a sequential RANSAC would stop: a trial counts only while its index is below the budget the trials before it set, and a better trial (more inliers, or as many at a lower cost) shrinks the budget at once by `dynamicMaxTrials`. The result does not depend on the batch size or the tier. typecv's `selectPairModel` without its refit branch. |
| Host   | `batchCounts(counts: array<u32>, groups: array<u32>, state: array<u32>, start: u32, maximum: u32)`                                                                                                            | Change 0075's counts words                                                                        | A kernel function. Triple `k` of `counts` is `[groups[k % E], 1, 1]` when the batch at `start` runs for its search, else `[0, 1, 1]`, with `E = groups.length`. A batch runs when `start` is 0, or when `start` is below the search's budget and below `maximum`. typecv's `batchRuns` and `writeCount`.                                                                                                                                           |
| Device | `lmStep3(a: array<f64, 9>, g: array<f64, 3>, lambda: f64): Linear3`, `lmStep6(a: array<f64, 36>, g: array<f64, 6>, lambda: f64): Linear6`                                                                     | Nearest: `scipy.optimize.least_squares(method='lm')`, MINPACK's damped step                       | One damped Gauss–Newton step: `lambda * max(a[jj], 1e-10)` added to each diagonal element, then `solve3` or `solve6` of `typeshade/linalg`. typecv's step in `refine` (`triangulation.shade.ts`), `poseStep` (`pnp.shade.ts`) and the bundle's blocks.                                                                                                                                                                                             |
| Device | `lmLambda(lambda: f64, improved: bool): f64`                                                                                                                                                                  | Nearest: MINPACK's damping update                                                                 | `max(1e-10, lambda / 3)` after an improving step, `lambda * 10` after a rejected one. typecv's update in `refine` and `acceptPoseStep`.                                                                                                                                                                                                                                                                                                            |

**The layout (draft).** The host-face kernels read and write a documented layout, because a kernel function cannot take a function (Rule 8.20). The application's own kernels write the same layout.

- `state`: 8 `u32` words per search. Word 0 the budget, 1 the trials counted, 2 the valid models, 3 the best count, 4 the winning trial, 5 the batches, 6 free for the application, 7 the population. The application writes word 7 and sets word 0 to its maximum before the first batch.
- `valid`: one word per trial of a batch, per search. `models`: `W` words per trial, where `W = models.length / valid.length` is the model width. `partials`: two `f64` words (count, cost) per block of a trial. `best`: `W + 3` words per search (the model, the count, the cost, the normalized MSAC cost).
- `counts`: the `[x, y, z]` triples of change 0075 that the application's entries dispatch with `{ indirect: counts, offset }`.

**The shape of one batch (illustrative, not an accepted example).** The application writes its minimal solver and its scoring as `@compute` entries that dispatch indirectly, and calls the module's kernels between them:

```ts
'use typeshade';
import { sampleIndices8, scoreBlock } from 'typeshade/optimize';
import { nullVector9, qrInsertRow9 } from 'typeshade/linalg';

function sampson(trial: u32, point: u32): f64 {
  // The application's residual of model `trial` at `point`, from its own bindings.
}

@compute([8])
export function scoreModels(@builtin('global_invocation_id') gid: vec3u): void {
  const i: u32 = gid.x;
  if (i >= control.trials * control.blocks) return;
  const v = scoreBlock(i / control.blocks, (i % control.blocks) * 64, 64, control.threshold, sampson);
  partials[i * 2] = v.x;
  partials[i * 2 + 1] = v.y;
}
```

**The host-loop recipe (D7).** §75 documents the loop as a pattern, not as a helper. It is typecv's loop of `src/gpu/pair-estimation.ts`:

1. Size the batch with `device.chunkSize(key, remaining, 32)` (change 0074).
2. Run the batch in `device.fuse(body, { chunk: { key, units: trials } })`: `batchCounts`, the application's entries with `{ indirect }`, then `selectSequential`.
3. Read `state` after every `K` batches (typecv: `K = 4`), and leave the loop when the budget is met.

A batch after the budget is met dispatches zero workgroups in each indirect entry (change 0075). The module's kernel functions still run at their trip counts, which the arrays' lengths fix.

### What stays

- `typeshade/algorithms` and `typeshade/random` do not change. §73 does not change.
- The language, its names and its diagnostics do not change. No code and no example is added (`examples: []`): a module item is a stable export with a contract, not a lesson.
- `resident()`, `createDevice()`, `fuse()` and the program runtime do not change. The modules are callers of them.

### What is excluded

- `typeshade/sparse`, `typeshade/spatial` and `typeshade/ndimage`. The map records their names. Each is a later proposal.
- Workgroup memory, barriers and subgroup operations in either module (D4).
- A host-loop helper, `typeshade/fuse` or otherwise (D7). A helper is a runtime change and a proposal of its own.
- PnP's sampler. typecv's `samplePnP` draws three unsorted indices by skipping, which is not the stream of `sampleIndices8` (D6).

## Why

### The problem

typecv (read at `909aa54`) wrote, in `"use typeshade"` and in `f64`, each item of the two tables:

| Item                         | typecv source                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming Givens QR          | `appendRow` in `src/gpu/projective.shade.ts`, line 11                                                                                                                      |
| Triangular solves            | `forwardSolve`, `backSolve` in `src/gpu/pair-models.shade.ts`                                                                                                              |
| Null vector, singular values | `solvePairModelNull` (back-substitution, four inverse iterations, eight power iterations) and `secondSingular` (Householder QR of the 9×8 block) in `pair-models.shade.ts` |
| Jacobi SVD                   | `linear` in `src/gpu/triangulation.shade.ts`, line 144, with a cap of 160 sweeps; `triangulatePair` in `projective.shade.ts` (4×4)                                         |
| SPD solves, inverse          | `solve3`, `solve6` in `src/gpu/numerics.shade.ts`; `inverse3` in `projective.shade.ts`                                                                                     |
| Sampling                     | `preparePairModels` (sorted insertion over `randomWord`); `samplePnP` in `src/gpu/pnp.shade.ts` (three indices)                                                            |
| Scoring                      | `scorePairModels` (64-lane workgroup tree) with its CPU twin `scorePairModelsOracle` in `src/gpu/consensus.shade.ts`; `scorePnP` with `scorePnPOracle`                     |
| Selection, adaptive budget   | `selectPairModel` (consensus), `selectPnP` (PnP), `adaptiveTrials` (numerics)                                                                                              |
| Counts words                 | `planPairModelBatch`, `summarizePairModelWork` (change 0075) in `pair-models.shade.ts`                                                                                     |
| LM step                      | The damping and the update in `refine` (triangulation), `poseStep` and `acceptPoseStep` (PnP), the blocks of `bundle.shade.ts` and `joint-focal.shade.ts`                  |
| Host loop                    | `src/gpu/pair-estimation.ts`: `device.chunkSize('scorePairModels', ...)`, the batch plans, `PROGRESS_INTERVAL = 4`                                                         |

Facts from this table:

- typecv wrote a CPU twin (`*Oracle`) for each workgroup kernel, because an entry that reaches a barrier has no CPU tier (`src/core/host-compute.ts`, line 324). The twin folds in another order than the workgroup tree. Inference: on WebGPU the cost sums of `scorePairModels` are not the bits of the CPU tier, so a tie on the count can select another trial on another tier. Not measured in this draft.
- typecv holds its search to a digest on the CPU tier: `PREVIOUS_RESULTS` in `tests/typeshade/pair-batch.test.mjs`.
- typecv's `docs/gpu-sfm-research.md`, section "Long kernels under a GPU watchdog", cites the literature that shaped these kernels: batched small QR and SVD with one thread per matrix (Boukaram et al., arXiv:1707.05141; MAGMA's `gesvj_batched`), and Kornia's batched RANSAC (PR #4979), which checks its termination between batches as `selectPairModel` does.

The case of change 0072 holds again. One consumer wrote the library, with its own oracle twins and its own digest, and a second consumer would write it again.

### What the language allows today (measured)

Measured on 2026-10-20 at `78d9d39`, in this worktree, with `compile()` (the compiler's half) and `createTypeshadeLanguageService().getDiagnostics` (the editor's half) on the same source. Scratch programs only, not tests of the repository:

- A type parameter for a size is refused on both halves. `function first<N extends number>(a: array<f32, N>)` called as `first(a)` is `TS8002` ("This call does not say what "N" is"), and `first<3>(a)` is `TS8002` ("Unsupported type syntax "3"") on both halves.
- A generic over the element type compiles (Rule 8.9). With arithmetic on `T extends f32 | f64`, the two halves disagree: the compiler accepts `let s: T = a[0] * b[0]`, and the editor refuses it with `TS2322`. With `as T` on each arithmetic result both accept it, and the `f64` instance lowers to `df64_*` calls. A literal in such a body (`0.1 as T`) is refused by both, `TS8003`. Inference: a factorization, which needs literals (0, 1, 1e-13), cannot be written once for both precisions today.
- A helper that takes a function (Rule 8.18), imported from a sibling file, and called in the loop of a kernel function: both halves accept it, the compiler gives no `TS8070`, and the host view declares the kernel function. On a GPU tier, under Tint, and inside an `@compute` entry: not measured.
- A fixed-size `f64` array by value (`array<f64, 81>`), returned from a helper and called in a kernel function's loop, compiles with no diagnostic. `@inout` on a fixed-size `f64` array (Rule 8.25) compiles on both halves.

The disagreement on arithmetic over a type parameter is a gap of Rule 12.7 that this draft found. It is not part of this proposal. It is listed under Open items.

### Why a module of the compiler repository

The reasons of change 0072 ("Why a module of the compiler repository") apply unchanged: the oracle is the reference, the language is proven by its library, one pin, and the change control is here. One reason is new. A sequential-equivalent selection and an adaptive budget are the parts of RANSAC where a subtle error changes results without failing a test. typecv proves its own with a digest. A module proves it once, with the differential gate, for every consumer.

### Alternatives

D1 to D7 below record each alternative with its cost. Two further alternatives:

- **Leave it in typecv.** No compiler work. A second consumer copies typecv's files, and the copies drift as the two `randomWord` copies of 0072's survey did.
- **Port SciPy's general algorithms (any `m`×`n`, any precision).** Not possible today: the language has no size parameter and no literal under a type parameter (measured above). A general algorithm would take a capacity array and a runtime size, which costs private memory per invocation (D3).

## What it touches

- **Rule 11.20 (amended).** The list of modules, the reading of an `f64` function per flavor (D2), and the device helpers with no host face.
- **Surface §72 (amended).** Its first paragraph ("two common modules") names the four modules and links the map in §74. Its "Not yet" paragraph moves "`f64` linear algebra" to §74. The rest of §72 does not change.
- **Surface §74 (new).** `typeshade/linalg`: the map, the naming rule, the table, the per-flavor reading, what it is held to, and what is not yet.
- **Surface §75 (new).** `typeshade/optimize`: the table, the layout, the shape of a batch, the host-loop recipe, what it is held to, and what is not yet.
- **Surface §73.** Not declared. `typeshade/optimize` imports `xorshift32` from it, and §73 does not change.
- **Exports.** The names of the two tables and their six structs, on the two new subpaths. No export is removed or reshaped. The root exports none of them.
- **Codes.** None. A refusal is the compiler's existing diagnostics.
- **Examples.** None.
- **Package and scripts.** `package.json` gains `./linalg` and `./optimize` with the `typeshade` and `default` conditions. `src/api-subpaths.ts` lists them. `scripts/bake-common-modules.ts` gains the two modules in `COMMON_MODULES`. `scripts/common-modules-arm.ts` gains the `f64` path of D2 and the test kernels of D5. `scripts/bundle-boundary.ts` and `scripts/bundle-budget.json` gain the two host faces.
- **Documents.** `CHANGELOG.md`, `src/AGENTS.md` (two rows), `reqs/` (RULE-1120, SURF-072, and two new items) through `bun run reqs:sync`.

### Draft impact estimate

- **Technical work (known).** Two shader packages, `src/linalg/` and `src/optimize/`, each with `index.shade.ts` and the baked `face.ts`, `view.ts` and `index.ts`. The sources start as typecv's functions at `909aa54`, moved without a change of operation order, so typecv's bits are the first reference.
- **Technical work (estimate).** About 900 lines of `"use typeshade"` (typecv's functions above are about 700) and about 600 lines of tests and arm rows. Not measured. The basis is the size of the typecv sources and of change 0072's tests.
- **Bake (assumption).** `publicName` in `scripts/bake-common-modules.ts` strips a final `Map` or `All`. No proposed name ends so. Whether the bake writes an export with no host face (`scoreBlock`) to `index.ts`, or leaves it to the `typeshade` condition only, is not read. The implementation decides it and records it.
- **Bundle.** Unknown until measured. `typeshade/algorithms` measured 38,483 bytes and `typeshade/random` 23,622 bytes minified and gzipped (change 0072's record). `typeshade/linalg` has no kernel function, so its face is CPU functions and an empty manifest. An inference only.
- **Compatibility.** Additive. A host that imports neither subpath sees no change.
- **Dependencies.** Change 0072 (implemented), change 0073 (implemented; the flavors), change 0074 (accepted, implemented in PR #697; the chunk), change 0075 (accepted; implemented on `main` by the merge of PR #699; the counts). No package is added.
- **Tools.** None added.
- **Effort and date.** Unestimated. No milestone is set.

### Decisions for the owner

- **D1. Module boundaries and names.** The draft recommends the SciPy layout: `typeshade/linalg` and `typeshade/optimize` in this proposal, with the robust-fitting skeleton in `optimize` beside the LM step, so that one module holds fitting. The map above binds the later names (`sparse`, `spatial`, `ndimage`). Alternatives and their costs:
  - The RANSAC skeleton in its own `typeshade/consensus`, and the LM step in `typeshade/linalg` or a later `typeshade/solvers` (the names from typecv's files). Cost: one more module, one more row set in the differential gate, one more bundle budget, and names that follow one consumer instead of a reference a reader knows.
  - Widen `typeshade/algorithms` with all of it. Cost: `algorithms` mixes the NumPy level with the SciPy level, its bundle grows past its budget (42,000 bytes; 38,483 measured), and §72 grows into three topics.
- **D2. `f64` and the flavor.** The draft recommends that a GPU tier, under each flavor of change 0073, give the bits of the f32 oracle run on the module that the fp64 pass lowered under that flavor, and that the CPU tier give the binary64 oracle's bits. Precedent: `src/core/fp64/df64-known-answer.test.ts` evaluates the lowered IR under f32 rounding. Assumption, to be measured first: the oracle can run a lowered module whose `df64_*` bodies read the `_fp64` guard (a texture read, which the oracle runs only with `gpuStubs`). The arm does the lowering internally, so `compileModule` and `CpuPrecision` are not reshaped. Alternative: an envelope against the binary64 oracle. Cost: a bound that must be measured per function and per flavor (the determinism report's `emulated` rows state no number), and a gate that cannot see a reordering inside the bound.
- **D3. Size and precision.** The draft recommends one function per size, the size in the name (`solveTriangular9`, `inv3`), in `f64` only. Reason: the language has no size parameter, and a literal under a type parameter is refused (measured). typecv's functions are `f64` at sizes 3, 4, 6, 8 and 9. Alternatives and their costs:
  - A capacity array and a runtime size (`solveTriangular(r: array<f64, 81>, b, n)` for every `n` up to 9): one name per function, but each call holds the capacity in private memory, and a 3×3 solve then copies 81 words. The literature in Why reports register spills past size 30.
  - `f32` forms now, with an `F32` suffix: twice the exports and the arm rows, with no consumer that asks for them. The owner's scope named `f32` and `f64`. This draft narrows it to `f64`, and the owner decides.
  - Wait for a size parameter in the language: a language proposal first, with no date.
- **D4. How the skeleton takes the model.** The draft recommends two parts. The device face takes the model's residual as a function parameter (Rule 8.18): `scoreBlock(..., residual)`, which the application calls in its own scoring entry or kernel. The host face's kernels (`selectSequential`, `batchCounts`) read and write the documented layout. The scoring folds one block per lane serially, with no workgroup memory, as typecv's CPU twin does, so every tier runs it and change 0072's D4 stays deferred. Alternatives and their costs:
  - A per-block workgroup tree, as typecv's `scorePairModels`. It has no CPU tier (a barrier), so it fails Rule 11.20 as written. Admitting it amends Rule 11.20 and needs the oracle's `dispatch` in the host face, which change 0072's Amendment 1 declined. It also needs change 0072's D4.
  - No device face: the application writes the whole scoring against the layout. Cost: each consumer writes the fold order again, which is where the tiers can differ.
  - The selection as an `@compute([1])` entry over named bindings instead of a kernel function. It is the fallback if the kernel function's one-lane writes (`state[8 * s + c]`, `best[s * (W + 3) + x]`) do not meet the proof's R3 with a runtime `W`. Not measured.
- **D5. Test cost.** Each function gains the shape of change 0072's tests: `src/common-modules.test.ts` holds the bake and each contract on the CPU tier, and the common-module arm of `scripts/gpu-differential.ts` runs it on WebGPU and WebGL2, each tier alone. A device helper runs through a test kernel function that the arm writes (one loop over many inputs), not through an export. The draft recommends that, under D2, every `f64` row runs under both flavors: about 20 functions, two tiers, two flavors. Estimate: 80 arm calls or more, against change 0072's 158 calls. Not measured. Alternative: one flavor in the gate (`recommendFp64Flavor` of the runner). Cost: the other flavor is held by no gate.
- **D6. The downstream migration.** The draft recommends that typecv replaces a copy only when the module's function gives typecv's bits: `PREVIOUS_RESULTS` and its other result tests unchanged on the CPU tier. A function that changes a digest stays in typecv, or the digest is recorded again with the owner's consent and its cause named. PnP's sampler stays in typecv, since its stream differs. radiance and typenn owe nothing. Alternative: typecv takes the module's functions at once and records new digests. Cost: a change of typecv's results with no measured reason.
- **D7. The host loop.** The draft recommends a documented pattern in §75 (the three steps above), since typecv's loop interleaves application work (refits, classification) that a helper would have to take as callbacks. Alternative: a helper, `runRobustFit(device, plans, { K })`. Cost: a runtime export and a change to `typeshade/runtime` or `typeshade/fuse` (bundle budgets of 39,000 and 86,000 bytes; change 0075's record measured 56 bytes left in the runtime's, on `c744805`), which is a proposal of its own.

### Required validation

Functional, each a test or a gate in this repository:

- `src/common-modules.test.ts`: the baked faces of both modules are the bake. Each function meets its contract on the CPU tier against plain JavaScript written in the test. `selectSequential` gives the same `state` and `best` for batch sizes 1, 7, 32 and 512 over one input, and stops where a sequential loop stops. `sampleIndices8` gives sorted, distinct indices below `n`. `batchCounts` writes `[0, 1, 1]` once the budget is met.
- Known answers, from typecv at `909aa54` on the CPU tier: each moved function gives typecv's bits on typecv's inputs. Inputs that `tests/typeshade/pair-batch.test.mjs` uses are copied into the test, with their source named.
- The common-module arm of `scripts/gpu-differential.ts`: every function on WebGPU and on WebGL2, each tier required alone, under D2's reading, under both flavors (D5). A function a tier refuses falls to the next tier (Rule 11.8), and the arm names each refusal. Typeshade/typeshade#689 (a second array's `.length` in GLSL) may refuse some kernels on WebGL2.
- Tint: the arm's kernels compile on Chromium's WebGPU (Tint), and the compile gate passes (`bun run gate:compile`).
- Both halves (`CLAUDE.md`, "A test reads both halves"): a `"use typeshade"` file that imports each device helper, `scoreBlock` with a residual among them, has no diagnostic from `compile()` and none from the language service's `getDiagnostics`, and `getHover` on `nullVector9` shows `NullVector9`.
- `journeys/_host-import/`: a `"use typeshade"` file imports from `typeshade/linalg` and `typeshade/optimize` by the package name through the packed tarball (`bun run gate:journeys`).
- `bun scripts/bundle-boundary.ts`: each host face imports no compiler and stays inside a budget set when measured.
- `bun run build`, `bun run lint`, `bun run format:check`, `bun run test`.
- Downstream (hardware and digest): typecv, with its pin moved and its copies replaced, keeps `PREVIOUS_RESULTS` and its other result tests, and its lab runs on the owner's devices.

Document: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and `python scripts/doorstop-check.py -C` after the rule and surface edits. `bun run bake:api-surface` lists the two subpaths and their exports, and nothing else moves. `bun scripts/changes.ts` passes on the implementing pull request.

### Approval and plan record

This record does not apply yet. Acceptance will require the owner's decision on D1 to D7, the merge of the proposal pull request with `status: accepted`, the approved revision and scope, and the assigned responsibilities. No approver, date or milestone is recorded here.

### Configuration and validation record

This record does not apply yet. Delivery will require the implementing commits with `Change: 0076`, the delivered configuration, the functional and document validation listed above with their observed results, and the disposition of each deviation. The checks in Required validation are requirements, not results.

## What it owes downstream

Each item is expected work. No downstream change exists.

- **typecv.** After the pin moves, under D6:
  - `src/gpu/pair-models.shade.ts`: `forwardSolve` and `backSolve` become `solveTriangular9`, `secondSingular` becomes `secondSingular9`, the body of `solvePairModelNull` calls `nullVector9`, `randomWord` and the sampling loop of `preparePairModels` become `sampleIndices8`, and `batchRuns` and `writeCount` become `batchCounts` where its conditions suffice (`summarizePairModelWork` also counts unsolved models, which stays typecv's). `dot9`, `normalized` and `residualNorm` go with them.
  - `src/gpu/projective.shade.ts`: `appendRow` becomes `qrInsertRow9` and `inverse3` becomes `inv3`. `basis3` and `triangulatePair` stay until `typeshade/spatial`.
  - `src/gpu/numerics.shade.ts`: `solve3` and `solve6` become imports from `typeshade/linalg`, and `adaptiveTrials` becomes `dynamicMaxTrials`. `CameraModel`, `project`, `unproject`, `transform` and `movePose` stay until `typeshade/spatial`.
  - `src/gpu/consensus.shade.ts`: `scorePairModels` and `scorePairModelsOracle` become one entry that calls `scoreBlock`, and `selectPairModel` calls `selectSequential` in a search. Its refit branch stays typecv's.
  - `src/gpu/triangulation.shade.ts`: the Jacobi loop of `linear` becomes `svd4`, and the damping of `refine` becomes `lmStep3` and `lmLambda`. `observationPartials` and its twin may take the same block fold.
  - `src/gpu/pnp.shade.ts`: `poseStep` and `acceptPoseStep` take `lmStep6` and `lmLambda`, and `selectPnP` may take `selectSequential`. `samplePnP` stays (D6).
  - `src/gpu/bundle.shade.ts` and `joint-focal.shade.ts`: the damping takes `lmStep3` and `lmStep6`. The PCG kernels stay until `typeshade/sparse`.
  - `src/gpu/pair-estimation.ts` follows §75's recipe as it does today.
  - Record 0076 in `compiler-changes.md` when the pin moves.
- **typenn.** Nothing must change. Read at `61259c3`: `src/kernels/` holds f32 maps, reductions, convolution, pooling, matmul, softmax, loss and the optimizers `sgdUpdate`, `adamFirst`, `adamSecond` and `adamUpdate`. No kernel solves a small system or takes a damped step. Record 0076 in `compiler-changes.md` when the pin moves.
- **radiance.** Nothing must change. Read at `3e4efb3`: the kernels (`packages/radiance/src/kernels/*.shade.ts`) read the inverse world matrix the host writes, and `Matrix4`, `Euler` and the controls are host TypeScript. `typeshade/spatial` may concern it later. Record 0076 in `compiler-changes.md` when the pin moves.
- **typeshade.github.io.** A guide page for each module, en and ko. The page of `typeshade/algorithms` gains the map. The API reference is generated. Not read in this draft. Record 0076 in `compiler-changes.md` when the pin moves.
- **vscode-typeshade.** The skill's references gain the two modules, the map and the layout. Not read in this draft. Record 0076 in `compiler-changes.md` when the pin moves.

## Open items

- **The later modules.** `typeshade/sparse` (one PCG iteration as three kernels and the Schur blocks of typecv's `bundle.shade.ts` and `joint-focal.shade.ts`: `bundleSchurPoint`, `bundleSchurCamera`, `advanceBundleCg`), `typeshade/spatial` (rotations, projection, distortion, DLT rows) and `typeshade/ndimage` (the SIFT front end's pyramid, convolution and difference of Gaussians). Each is a proposal of its own under the map.
- **`f32` forms.** D3. No consumer asks for them today.
- **The `f64` reading.** D2's assumption (the oracle runs a lowered module that reads the guard) is not measured.
- **Workgroup helpers.** Change 0072's D4 stays deferred. A cooperative scoring (one workgroup per model, typecv's research inference 3) needs it.
- **Many searches in one call.** The layout has a search axis, and typecv runs one search per call. Whether a consumer batches searches is not known.
- **A Rule 12.7 gap.** Arithmetic on a type parameter (`T extends f32 | f64`) compiles and is refused by the editor (`TS2322`), measured on 2026-10-20 at `78d9d39`. It is outside this proposal. It is a candidate for an issue on typeshade/typeshade.
- **The bake of an export with no host face.** `scoreBlock` takes a function. How `scripts/bake-common-modules.ts` publishes it is not read.
