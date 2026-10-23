# TypeCV compiler experiments, 2026-10-23 UTC

This record preserves two measured compiler candidates and the scripts needed to resume the
work on another machine. The candidates remain experimental. This change does not enable
either candidate in TypeShade or change TypeCV's source or compiler pin.

## Configuration

- TypeCV: [`56ff7f43464b370e15d507d343cd539b474d5d00`](https://github.com/typeshade/typecv/commit/56ff7f43464b370e15d507d343cd539b474d5d00), after #208.
  All tracked files and the hashes of all 111 `src` files were unchanged throughout rebuilding.
  The complete source manifest is [typecv-source.json](records/typecv-source.json).
- Pinned compiler: `d36ac5027356b96e87a9ad900dfd8e6ea4ab55dc`. Latest-main control:
  `1d8272addfb71b9942da7bc66f6ab15b915dbb0e`. Both candidates start at that control.
- Node 24.19.0, Bun 1.4.3, Linux, Playwright 1.56.1, Chromium 154 through
  `TYPESHADE_CHROMIUM=/usr/bin/chromium`. TypeCV's plugin build externalizes TypeScript to its
  own installed TypeScript 5.9.3; the standalone compiler typecheck uses its pinned TypeScript 5.6.3.
- The existing TypeCV browser harness explicitly selects SwiftShader. This is a software
  adapter experiment. It establishes no native RTX, Apple or Safari performance result.
- Each compiler builds the same public GPU entry with the existing `fuse: true` configuration.
  Only the local `node_modules/typeshade` target changes. Generated bundles are not committed.

The raw reports serialized `GPUAdapterInfo` directly, which omitted its accessor properties.
A separate metadata probe using the same browser harness captures explicit fields in
[browser-info.json](records/browser-info.json). It was taken after the measurements.

## Candidates

[effects.patch](effects.patch) replaces the whole-function CSE/LICM refusal for ordinary
writing helpers with expression-level effect checks and transitive written-root exclusions.
Inout writes retain their caller-root translation. Atomics, barriers, collection operations
and opaque helpers retain the conservative whole-function boundary. No floating-point
reassociation or f64 specialization is added.

[matrices.patch](matrices.patch) wires the existing bounded integer loop unroller into the
experimental O2 pipeline and adds scalar replacement for fully indexed, non-escaping local
arrays of 3, 6, 9 or 36 scalar/vector elements. The existing unroll limits remain eight
iterations and 64 body nodes. Dynamic indices, whole-array escapes and effectful initializers
keep their arrays. In the actual TypeCV bundle, only `cacheBundleSchurCross` acquired three
scalar locals. The dynamically indexed arrays in `solve6` remain arrays. This is a limited
applicability result, not delivery of general 3x3/6x6 scalarization.

The patches apply independently to the control revision. Their combination was not measured.
Production-file fingerprints are in [effects-source.json](records/effects-source.json) and
[matrix-source.json](records/matrix-source.json).

## BA results

The four controlled cases use the complete public `bundleAdjustGpu` call: allocation, upload,
solver plans, terminal numerical readback and a completion fence. They use fixed inputs,
three LM iterations, at most 64 CG iterations, float-emulated f64, no pool, explicit serial
reduction, checkpoints and one dispatch per submission. The last case forces observation
windows with a smaller working budget. Device creation and fixture cloning precede timing.

There are two warmups and five measured runs per variant/case. Variant order rotates and
reverses between measured rounds. The table reports warm wall-time medians, in milliseconds.

| Case                              | Pinned | Latest control | Effects | Arrays/loops |
| --------------------------------- | -----: | -------------: | ------: | -----------: |
| Fixed focal, 8 cameras            |  660.2 |          691.7 |   636.7 |        639.8 |
| Shared focal, 8 cameras           |  688.7 |          733.4 |   746.7 |        698.8 |
| Fixed focal, 17 cameras           |  738.7 |          748.0 |   742.0 |        843.1 |
| Shared focal, 6 cameras, streamed | 3487.8 |         4317.6 |  3837.6 |       3566.6 |

Relative to the latest control, effects ranges from -11.1% to +1.8%; arrays/loops ranges from
-17.4% to +12.7%. Individual sample ranges overlap substantially. The pinned and latest control have identical
extracted WGSL/GLSL shader strings; their timing differences are an internal warning about
session noise, not evidence of compiler acceleration. GPU timestamp medians do
not uniformly improve. In these controlled runs, timed groups equal dispatches, and dispatch,
submission, upload and readback counts match across all four variants.

The additional shared-focal 8-camera Schur-cache case asserts that `cacheBundleSchurCross`
actually executes. The cache requires the unbounded route, so this case keeps automatic
scheduling and its dispatch counts vary. Its warm medians are 202.1 / 215.8 / 210.9 / 246.3 ms
in the same variant order. Arrays/loops is +14.1% relative to the control in this session.
This case checks the candidate's active scalarized path but does not isolate GPU-kernel speed.

Across all 140 BA calls, the maximum numerical coordinate and cost difference from the pinned
reference is zero. This is a numerical comparison, not a byte-identity or ground-truth surface
claim. The corruption instrument rejects changed and non-finite coordinates. Solver failures,
wrong memory paths, wrong Schur-cache admission, leaked resident buffers and GPU errors fail
the runner. No numerical tolerance was relaxed.

Logical resident peaks match across variants: 421004, 463404, 864056 and 56696 bytes for the
four controlled cases; 636672 bytes for the cache case. These counters exclude physical VRAM,
register allocation/spills, staging and pipeline caches.

The gzip column uses Python gzip level 9 with a zero timestamp. Bundle and shader-string
fingerprints are in [bundle-hashes.json](records/bundle-hashes.json).

| Public GPU bundle | Raw bytes | gzip bytes |
| ----------------- | --------: | ---------: |
| Pinned            |   6288372 |    1018132 |
| Latest control    |   6292169 |    1019457 |
| Effects           |   6172373 |    1012450 |
| Arrays/loops      |   6319718 |    1023974 |

The first-use samples share a GPUDevice/driver cache and start in fixed variant order.
Their cold timings are retained in the raw reports but are not fair independent cold-build
comparisons. Full SfM/MVS/TSDF wall time, real scans, native GPUs and physical GPU memory were
not measured. Neither candidate is justified as a new default by this experiment.

Raw records: [controlled cases](records/ba-pinned-latest-effects-matrices.json),
[active Schur cache](records/ba-pinned-latest-effects-matrices-cached.json).

## Validation and the reported GLSL division error

Each candidate built canonically, rebuilt TypeCV and passed its four existing WebGPU
reduction/streaming checks, including the 320-camera sparse ring, cached shared-focal
certificate and streamed geometry. Effects passed 208 optimizer/effect tests; arrays/loops
passed 207. The existing GVN source-shape assertion now inspects GVN at O0; its original
two-call requirement is retained, and the full O2 oracle also checks a vector that changes
sign across the loop back edge. These are focused checks, not the complete compiler release
gates or the full TypeCV browser suite.

The owner reported an integer division-by-zero compiler error in an expanded corpus from
an unavailable working session. Its failing seed, generated source and unpublished changes
could not be recovered with the available tools. This study does not claim to recover that
session or confirm its reported failure. It checks the corresponding main sources and both
experimental candidates independently.

On the main control and both candidates, fragment compilation passed 1024 exact corpus seeds
(6154 shaders per variant), including scalar signed/unsigned division/remainder helpers and
literal-zero calls. Broken-source and numerical-comparison probes detect planted failures.
The supplied error was not reproduced. All 6154 fragment programs per variant also compiled and linked successfully. The script
proves it rejects an unmatched varying at link time. Records: [main](records/glsl-int-main-linked.json),
[effects](records/glsl-int-effects-linked.json), [arrays/loops](records/glsl-int-matrices-linked.json). No speculative integer or
f64 patch is included. The supplied failing seed/source is still needed for an exact replay.

## Reproduction

Use separate TypeCV and compiler worktrees. Keep the ordinary checkout intact. Install each
checkout's dependencies and build the compiler canonically. Apply one experimental patch
only to its own compiler worktree at the control revision, using `git apply --unidiff-zero`
(the patches omit context-only blank lines so they are clean text artifacts).

From the TypeCV worktree, create `.compiler-study/bundles` and `.compiler-study/records`.
Retain a source manifest and build the pinned dependency with `npm run build`. Copy
`dist/gpu/index.js` to `.compiler-study/bundles/pinned.js`. For each other compiler, point only
that worktree's local dependency directory at the compiler worktree, run `npm --prefix /path/to/typecv run build:gpu`
and retain the resulting bundle as `latest.js`, `effects.js` or `matrices.js`. Restore any
dependency links after the study. TypeCV's tracked package and source files stay unchanged.

Run these commands from that TypeCV worktree, replacing `STUDY` with this directory's path:

```sh
TYPESHADE_CHROMIUM=/usr/bin/chromium node "$STUDY/run.mjs" pinned latest effects matrices
TYPESHADE_CHROMIUM=/usr/bin/chromium node "$STUDY/run.mjs" pinned latest effects matrices --cache
PROBE_COMPILER_ROOT=/path/to/compiler PROBE_REVISION=main TYPESHADE_CHROMIUM=/usr/bin/chromium bun "$STUDY/check-glsl-integers.mjs" 1024
```

The source manifest's format is shown in the committed record. The runner reads that file
and writes its own raw reports. Use the same harness/launch flags and keep other GPU/CPU
workloads stopped during timed runs. The GLSL checker runs separately from timing. Scripts
include explicit metadata and linker instrumentation added after the original compile-only
probe; the measured solver inputs and schedules remain as documented above.
