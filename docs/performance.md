# Performance measurement

<!-- doc-refs: skip-file — names the baseline files `perf/<vendor>-<architecture>.json` a machine records, which exist only once one has -->

This document is the procedure for measuring what the compiled kernels cost on a device, and
where the numbers go. The gate is `bun run gate:perf` (`scripts/perf-gate.ts`). It is a
measurement of the delivered configuration, and the step every optimization proposal's
validation asks for ("a register or time measurement on a hardware adapter"), which the
proposals before it recorded as not run.

## What the gate measures

The gate runs a fixed corpus through the runtime, as a host runs it: the Vite plugin's module of
each shader file, `fuse` scopes over `Resident` arrays, on a WebGPU device in headless Chromium.

| Case      | Source                                            | What runs                                                                                     |
| --------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `chain`   | `journeys/loop-fuse/ops.shade.ts`                 | `add`, `mul`, `relu` over `n` elements: one fused dispatch                                    |
| `chain/4` | the same                                          | the same over `n / 4` elements: the proof of the instrument                                   |
| `reduce`  | the same                                          | `add`, `mul`, then the sum `total`: the loop dispatch and the folds of partials               |
| `tonemap` | `examples/hosts/host-kernel/host-kernel.shade.ts` | `exposure`, then the reduction `peak`, over `n` pixels                                        |
| `batch`   | `journeys/mnist/batch.shade.ts`                   | one softmax-regression batch of 128 rows: forward, objective, backward, update                |
| `branch`  | `journeys/loop-fuse/branch.shade.ts`              | a loop whose body chooses a costly helper or the input, for one element in four (change 0097) |

For each case the gate reports:

- the wall time of one run, in milliseconds, from the first call of the scope to
  `queue.onSubmittedWorkDone()`: the median, the least and the most of the samples;
- the GPU time of the run's compute passes, from the fuse report's `gpuTime` (change 0066), where
  the device has `timestamp-query`; `n/a` where it does not. Chromium rounds each timestamp to a
  coarser step, so the GPU time is the coarse one a host sees;
- the dispatches and the submissions of one run.

Each case runs `--warmup` times first (5), to build its pipelines and warm the caches, then
`--samples` times (20); the cases take turns, so that drift in the machine falls on all of them
alike. `--n` is the element count (1,048,576).

**The proof of the instrument.** The chain also runs over a quarter of the elements. The gate
fails unless four times the work costs at least 1.3 times the time, by GPU time where the device
measures it and by wall time otherwise. A device and a sample count that cannot show that
difference cannot show a regression either; raise `--n` or `--samples` until they can.

## Two devices

**CI.** `.github/workflows/ci.yml`'s `perf gate (instrument, SwiftShader)` job runs the gate on
SwiftShader, a software device, with seven samples and `n = 262144`. Those numbers say what one
instruction costs on a CPU executing WebGPU. They are not a GPU's cost. The job keeps the proof
of the instrument and the shape of the report, so that a change that breaks the corpus or the
measurement fails there, and it checks the run against the runner's own baseline (A software
baseline, below).

**A machine.** The numbers that matter come from a hardware adapter, on the machines
`docs/hardware-notes.md` records. `--hardware` launches Chromium without the software flags, so
the page gets the machine's own adapter.

## Change 0105: SwiftShader render comparison

On 2026-10-30, `scripts/bench-copy-elision.mjs` compared the committed WGSL goldens at
`6d61f62af7c5c9397e2d092e7807b5b2525d411a` (before 0105) and `72d34e21` (after 0105).
The two shader source files did not change between those revisions. The current compiler's
output also matched the measured goldens. This isolates change 0105; it does not measure the
combined effect of changes 0103 through 0105.

The adapter was `google-swiftshader`, Chromium headless 156.0.8078.4, on an AMD EPYC 9V74
host exposing five logical CPUs. Each of two fresh browser runs warmed each variant ten times
and measured 101 samples per variant and resolution, alternating before/after order each pair.
The table reports render-pass timestamp medians in milliseconds. Pipeline creation and pixel
readback are outside these timestamps. Negative changes mean less time.

| Example                    | Resolution | Run A before → after | Change A | Run B before → after | Change B |
| -------------------------- | ---------- | -------------------- | -------- | -------------------- | -------- |
| `rt-renderer-class`        | 48×48      | 1.635 → 1.717        | +4.96%   | 1.525 → 1.518        | −0.45%   |
| `rt-renderer-class`        | 96×96      | 6.084 → 6.095        | +0.18%   | 5.973 → 5.977        | +0.06%   |
| `capsule-corp-namek-class` | 48×48      | 6.958 → 6.971        | +0.18%   | 7.193 → 7.142        | −0.71%   |
| `capsule-corp-namek-class` | 96×96      | 30.255 → 30.038      | −0.72%   | 31.418 → 30.843      | −1.83%   |

These runs do not establish a consistent speedup across these cases. Some differences change
sign between runs; the small Namek 96×96 reduction is not a demonstrated general improvement.
No confidence interval or significance test was used. Results apply to this software adapter,
these inputs, and these resolutions; storage-repeat and dynamic-index microbenchmarks remain
unmeasured.

At times 0, 1.25 and 3, before/after RGBA8 pixels were byte-identical in all 12 conditions per
run. Repeated after renders also matched, and every image contained multiple colors. The
script first verifies rejection of invalid WGSL and detection of a changed pixel. The existing
performance gate passed with 21 samples, five warmups and `n = 262144`: four times the chain
work took 3.56 times the timestamp duration. This local run did not compare against CI's
different-machine baseline. The existing RT render golden passed exactly; the 16 local-place
compiler tests and the build passed.

Raw samples, shader hashes, full revisions, pipeline-creation times, wall times, medians,
minima, maxima and median absolute deviations are retained in
`artifacts/copy-elision-101-a.json` and `artifacts/copy-elision-101-b.json`. The initial 21-sample
exploratory run is `artifacts/copy-elision-swiftshader.json`. Gate and test logs are beside them.

To repeat from the repository root, install dependencies and Playwright Chromium, then run:

```sh
node scripts/bench-copy-elision.mjs --samples 101 --warmup 10 --output artifacts/copy-elision-repeat.json
```

The script reads the two revisions with Git; their history must be available. Use `--base`
and `--head` to choose other compatible goldens. It checks the adapter is SwiftShader and
returns a nonzero exit code on a pixel mismatch. It does not enforce a performance threshold.

## Reduction: omit the final workgroup barrier

On 2026-10-30, the working tree based on `72d34e21` changed `reductionEntries` in
`src/core/passes/kernel-lower.ts` to omit only the barrier after stride 1. Lane 0 performs
both that combine and the output store. The initial barrier and the barriers before every
subsequent cross-lane read remain: eight barriers instead of nine per tree. The 256-lane
tree, arithmetic order, dispatch count and submission count are unchanged. The baked
`sum`, `maxAll` and `minAll` host faces in `src/algorithms/face.ts` were regenerated.
This is an internal performance change with no public API or language-rule change.

The existing performance gate was first run twice per version, with 31 samples after ten
warmups at `n = 262144`. Unchanged controls also moved, so those sequential runs alone were
not used to attribute a speedup. Their logs are `artifacts/barrier-before-a.log`,
`artifacts/barrier-after-a.log`, `artifacts/barrier-before-b.log` and
`artifacts/barrier-after-b.log`.

The follow-up `scripts/bench-reduction-barrier.mjs` compiles the same two source files with
both compiler checkouts, then runs both sets of modules through one runtime and SwiftShader
device. It alternates before/after order every pair, warms each case ten times, and records
61 samples per variant. Two fresh browser runs used the same Chromium and CPU as the
0105 comparison above. Every paired reduction result was exactly equal, including warmup.
Both versions passed the full-size versus quarter-size timing instrument.

| Case                          | Run A before → after (ms) | Change A | Run B before → after (ms) | Change B |
| ----------------------------- | ------------------------- | -------- | ------------------------- | -------- |
| `reduce`                      | 90.915 → 87.125           | −4.17%   | 92.102 → 89.764           | −2.54%   |
| `tonemap`                     | 92.862 → 86.243           | −7.13%   | 92.105 → 89.070           | −3.30%   |
| `chain` (unchanged control)   | 3.105 → 3.115             | +0.32%   | 3.263 → 3.222             | −1.24%   |
| `quarter` (unchanged control) | 0.824 → 0.820             | −0.54%   | 0.865 → 0.876             | +1.30%   |

These are medians of compute-pass timestamps, not wall times. Both interleaved runs observed
less time for the reduction cases; the size of the reduction varied. They establish an
observed SwiftShader benefit for these cases, not a hardware-GPU speedup or a guaranteed
percentage. No statistical significance claim is made. Raw paired samples, wall times,
returned values, dispatch counts, source/module hashes and the exact compiler diff are in
`artifacts/barrier-interleaved.json` and `artifacts/barrier-interleaved-repeat.json`.

Validation passed: build and incremental rebuild; 123 kernel-tree, fused-entry and generated
kernel differential unit tests; 14 common-module tests; the complete GPU differential gate
(kernel, chain, GLSL, compute and common-module arms); and the compile gate (194 examples,
194 WGSL compilations, 134 GLSL pairs, 125 render pipelines, plus entry-call checks).
The new structural regression test also failed against the old nine-barrier code, as intended.
It checks that every cross-lane dependency retains its barrier in both reduction entries.
Logs are retained under `artifacts/barrier-*.log`; the structural test's expected failure is
`artifacts/barrier-test-before.log`.

To repeat, give the script a baseline checkout with its dependencies installed, and build
the current checkout first. Run from the current repository root:

```sh
bun scripts/bench-reduction-barrier.mjs --base /path/to/baseline --samples 61 --warmup 10 --n 262144 --output artifacts/barrier-repeat.json
```

## Recording a baseline

Run on the machine the baseline is for, after `bun run build`. On Windows, in PowerShell:

```powershell
bun run build
$env:TYPESHADE_CHROMIUM = "C:\Path\To\chrome.exe"   # optional; Playwright's own Chromium otherwise
bun run gate:perf --hardware --record
```

1. The gate prints the adapter (`vendor-architecture`, the device where the browser gives it) and
   the table.
2. `--record` writes `perf/<vendor>-<architecture>.json`: the adapter, the browser, the commit,
   the time, `n`, the sample counts and the rows. A software device is refused as a baseline.
3. Commit the file with a `Change: none, <reason>` line: a baseline changes no rule.

A baseline is the configuration it names: the commit, the browser and the adapter. Record a new
one when the browser or the driver changes, or when a change is meant to move the numbers (an
optimization proposal records the baseline before and the run after in its configuration and
validation record).

## A software baseline

Until a hardware baseline exists, the baseline is SwiftShader's (the owner's decision of
2026-10-26). A software device's time is the processor's, so such a baseline is compared only
with a run on the machine that recorded it, and the record names the processor (`cpu`).
`--software` lets `--record` write one and `--check` read one; without it a software device is
refused as a baseline, as before.

The machine that checks is the CI runner, so the runner records the baseline. The
`perf gate (instrument, SwiftShader)` job runs with `--software --check --tolerance 0.5 --record`:
it checks the run against the committed `perf/google-swiftshader.json`, then records the run,
prints the record between `--- record ---` and `--- end of record ---` in the job's log, and
uploads it as the artifact `perf-google-swiftshader`. One runner differs from the next by up to
a third on a case (two runs of the same commit differed by 29% on `branch`), so the tolerance is
a half, and the job is not a required check: a red run on the same code is read, not bypassed.

To record a new baseline:

1. Open the job's log of the run on `main`, or of the pull request that is meant to move the
   numbers, and copy the record between the two marker lines.
2. Write it to `perf/google-swiftshader.json`. Do not record from another machine: its numbers
   are that machine's, and the check on the runner would fail or pass for the wrong reason.
3. Commit the file with a `Change: none, <reason>` line: a baseline changes no rule.

A hardware baseline, when the owner records one, is a file of its own beside it, and the
procedure above does not change.

## Holding a change to the baseline

On the same machine:

```powershell
bun run build
bun run gate:perf --hardware --check [--tolerance 0.25]
```

For each case of the baseline the gate prints the baseline's median, this run's median and the
change, by GPU time where both have it and by wall time otherwise, and fails on a case slower
than the baseline by more than the tolerance (a quarter). The baseline's `n` must be the run's.
With no baseline for the adapter, `--check` compares nothing and says so.

## TypeCV: loop invariants that depend on locals

On 2026-10-30, `src/core/passes/opt/licm.ts` was extended to place invariant
computations immediately before a loop when their local inputs are available there.
The existing function-top hoisting cannot use those inputs. The new step accepts only
literal integer `start < end` loop heads that prove the body executes, and only the
body's initial sequence of declarations. It stops at a store or control flow, preserves
conditional operands, and excludes all names declared or mutated anywhere in the loop.
Hidden callee reads, effectful calls, barriers and raw code retain their exclusions.
This is an internal code-generation change, with no public API or arithmetic-rule change.

The inspected consumer was TypeCV at `e40c878809370719faef7dac3e34b80a92c4ce3d`.
Both versions compiled the same P3P source: baseline TypeShade `72d34e21` versus the
working compiler with the LICM extension. The earlier reduction-barrier change does not
affect this explicit compute entry. In the emitted `refineLengths`, three `df64_add`
renormalizations now run once before the loop instead of once per iteration: 3 calls
instead of up to 36 at the 12-iteration limit. The renormalizations, opaque zero and
`_fp64_g` guard are retained. A P3P address expression also moves out of two inner loops;
the joint-focal module similarly hoists integer address calculations. The float-matching
module is byte-identical. These are generated-code observations, not measured speedups.
Before/after WGSL and their diffs are retained as `artifacts/licm-p3p*` and
`artifacts/licm-joint-focal*`.

`scripts/bench-typecv-licm.mjs` alternates both generated modules on the same runtime
and SwiftShader device. The full workload repeats TypeCV's 111 known-pose and degenerate
fixtures eight times (888 problems); the quarter workload has 222. Timings are compute-pass
timestamps, after warmup, excluding output readback. An unchanged control runs the baseline
module on both sides. Every workload passed the geometric checks, and before/after readback
values matched. The maximum ray error was `4.313047271151573e-11`, orthogonality error
`4.447553436648377e-13`, and normalized truth-pose error `2.368378453844778e-8`.
The full/quarter workload ratio passed the timing sensitivity check in both versions.

| Workload                             | Run B before → after (ms) | Change B | Run C before → after (ms) | Change C |
| ------------------------------------ | ------------------------- | -------- | ------------------------- | -------- |
| P3P, 888 problems                    | 13.917 → 13.237           | −4.89%   | 14.205 → 14.359           | +1.09%   |
| P3P, 222 problems                    | 4.122 → 4.101             | −0.50%   | 4.072 → 4.122             | +1.22%   |
| Identical-code control, 888 problems | 13.380 → 13.219           | −1.20%   | 14.263 → 13.814           | −3.15%   |

Runs B and C each used 61 samples after ten warmups in fresh browser processes. The
initial 31-sample run A showed +3.75% for the full workload. **There is no consistent
SwiftShader speedup in these measurements.** The control also moves; neither the
favorable run nor the static call-count reduction establishes a performance benefit.
The change is retained as a conservative elimination of repeated generated computations,
not as a demonstrated runtime performance improvement. Raw samples, readbacks, source and
module hashes, revisions, compiler diffs and geometry metrics are in
`artifacts/licm-p3p-a.json`, `artifacts/licm-p3p-b.json` and `artifacts/licm-p3p-c.json`.

Validation includes 18 scoped LICM regression tests (three fail on the old compiler),
the optimizer/effects suites, 353 unchanged example/golden checks, the compile gate,
the full GPU differential gate, and 14 common-module tests. An isolated TypeCV checkout built with the changed compiler
passed all 53 shade tests and four SwiftShader application tests, including P3P branch
generation, float matching and cached Schur operators/focal refinement. Test logs are
under `artifacts/licm-*.log`.

To reproduce, build this checkout and supply dependency-equipped compiler and TypeCV
checkouts. Run from this repository root:

```sh
bun scripts/bench-typecv-licm.mjs --base /path/to/baseline-typeshade --typecv /path/to/typecv --samples 61 --warmup 10 --repeats 8 --output artifacts/licm-repeat.json
```

## TypeCV: reuse storage loads and sink aggregate copies

On 2026-10-30, two internal O2 passes were added after inspecting TypeCV's generated
joint-focal WGSL. They change neither the public API nor floating-point operation order:

- `src/core/passes/opt/loop-load-reuse.ts` caches a small storage slice before a fixed-count
  outer loop and expands only the inner loop that exposes the reuse. The outer loop has
  2–8 iterations, the inner loop has 2–4, at most eight values are cached, and expansion
  is limited to 192 expression nodes. The pass rejects external writes (including writes
  through a different binding), effectful calls, barriers, conditional reads and varying
  addresses. It preserves enclosing guards and storage access declarations.
- `src/core/passes/opt/sink-aggregate-init.ts` moves an immediately preceding aggregate copy
  into the else branch when the true branch first overwrites the entire destination.
  It rejects conditions with effects or destination reads, partial overwrites and
  overwrites whose expression reads the destination.

In `cacheBundleSchurRows`, three `schurCross` values previously read in each of six
iterations are loaded once: 18 logical storage reads become 3. Two other three-by-three
loops similarly change from 9 reads to 3. An instrumented IR-oracle test verifies the
18-to-3 count. These counts are not hardware memory-transaction or bandwidth measurements.
In `updateBundleCandidate`, the 96-byte `p`-to-`moved` array copy now occurs only when the
pose is not updated; the other branch writes its result directly through `movePose_into`.
Backend zero-initialization and register allocation can affect the eventual cost.
The joint-focal WGSL grows from 95,005 to 95,919 bytes (0.96%); P3P and float-matching
WGSL are unchanged by these two passes. The generated-code comparison is retained in
`artifacts/memory-joint-focal.diff`.

The comparison uses TypeCV `e40c878809370719faef7dac3e34b80a92c4ce3d` and a baseline
compiler containing the earlier barrier and scoped-LICM changes. Thus it isolates these
two new passes. `scripts/bench-typecv-memory.mjs` captures buffers from TypeCV's actual
bundle-adjustment fixture (12 cameras, 256 points, 3,072 observations) after Schur-cross
construction. It dispatches the actual Schur-row and candidate-update entries from the
two compiled modules on the same SwiftShader device, alternating execution order.
The update workload replaces the step vector with deterministic nonzero sine values
and checks that the candidate changes. Every before/after output is finite and exactly
equal. Active-path assertions prevent an early-exit workload from passing. Timings use
compute-pass timestamps after warmup, excluding readback; a four-dispatch workload checks
timestamp sensitivity. The control executes identical baseline Schur code on both sides.

| Workload                     | Run A before → after (ms) | Change A | Run B before → after (ms) | Change B | Run C before → after (ms) | Change C |
| ---------------------------- | ------------------------- | -------- | ------------------------- | -------- | ------------------------- | -------- |
| Schur rows                   | 98.350 → 88.110           | −10.41%  | 95.692 → 88.049           | −7.99%   | 100.353 → 90.969          | −9.35%   |
| Candidate update             | 0.949 → 0.972             | +2.39%   | 0.937 → 0.944             | +0.75%   | 0.988 → 1.003             | +1.48%   |
| Identical-code Schur control | 94.836 → 95.397           | +0.59%   | 96.422 → 97.126           | +0.73%   | 99.092 → 98.406           | −0.69%   |

Run A uses 31 pairs after six warmups; B and C each use 61 pairs after ten warmups
in fresh browser processes. Schur's median paired changes are −9.88%, −8.10% and
−8.54%. **The Schur entry consistently improves in these SwiftShader measurements.**
This measures caching and targeted inner-loop expansion together; it does not isolate
their individual contributions, establish reduced physical memory bandwidth, or measure
an end-to-end application speedup. Candidate-update paired changes are −1.89%, +0.18%
and +1.23%; its copy reduction shows no consistent speed benefit. Raw samples, readbacks,
compiler diffs, source and module hashes are in `artifacts/memory-bench-a.json`,
`artifacts/memory-bench-b.json` and `artifacts/memory-bench-c.json`.

The isolated TypeCV build passes 53 shade tests and three SwiftShader application tests:
Schur operators and certificates against independent scalar algebra, focal refinement
quality and rejection checks, and joint bundle-adjustment objective, gauge and local
boundary checks. Compiler validation includes optimizer/effects regressions, unchanged
example goldens, the compile gate and the GPU differential gate. Logs use the
`artifacts/memory-` prefix.

To reproduce, build this checkout and the supplied TypeCV checkout, and supply a compiler
baseline with dependencies installed. Run from this repository root:

```sh
bun scripts/bench-typecv-memory.mjs --base /path/to/baseline-typeshade --typecv /path/to/typecv --samples 61 --warmup 10 --output artifacts/memory-repeat.json
```

The first run saves an input fixture beside its report. Pass its path with `--fixture`
on subsequent runs to reuse exactly the same input buffers.

## Synthesizing helpers from call-site requirements

On 2026-10-30, `src/core/passes/specialize-calls.ts` added a module-level O2 emit stage
between structural lowering and fp64 lowering. It operates before the existing
per-function optimizer, which cannot see enough of the call graph to synthesize helpers.
It is shared by WGSL and GLSL emission; O0/O1, authored modules, entry signatures and
externally bound layouts remain unchanged.

The stage performs two bounded transformations:

- A literal boolean argument selects a helper variant with that parameter substituted
  and removed. Equal requirements share the same generated helper; dynamic calls retain
  the original. Dead branches and statements following unconditional returns disappear.
  Other arguments retain their evaluation count and order.
- A nonescaping, immutable struct result used only through a subset of its fields selects
  a helper with a smaller return struct. Local struct constructors are decomposed into
  field snapshots at the original evaluation point. Cleanup removes unused snapshots and
  reconstructs only the demanded result. Early returns and validity checks are preserved,
  including checks that depend on a field the caller never receives.

This first stage performs context-specific function synthesis and sharing. The additional
restructuring stage below fuses producer/consumer chains and outlines arithmetic regions.
Neither performs a general algorithm search. This specialization stage rejects opaque helpers, raw modules, inout
parameters and effectful callees. A helper-only module is left intact. Boolean cloning
rejects recursive call graphs. Cloning is limited to 16 variants, 768 source expression
nodes per helper and 4,096 copied source nodes per module, with three rounds for constants
forwarded through helper calls. Only declarations involved in specialization are pruned;
unrelated shared preludes remain available.

TypeCV's joint-focal module creates eight boolean-specialized helpers and one projected
`project` helper. The latter returns `pixel` and `ok`; `du/dv` calculations still participate
in its validity predicate. The generated helpers go through the existing pointer and
return-into lowering. Joint-focal WGSL changes from 95,919 to 96,874 bytes (+1.00%); P3P
and float-matching remain byte-identical. Before/after WGSL and diffs are retained under
`artifacts/calls-`. In the class-based Namek example, calls to `SDF_polarY` share a helper
returning only `point`, while `NamekTrees_nearest` gets a helper returning only `position`
and `height`. Its two WGSL/GLSL emit goldens were deliberately regenerated.

The TypeCV benchmark uses the same 12-camera, 256-point, 3,072-observation capture as the
memory experiment. The baseline includes all previous optimizations and excludes only
this call-specialization stage. For `bundleCandidateMetrics`, it copies the captured
current geometry into the candidate buffer, copies the current focal scale and sets
the candidate-valid flag. Every observation must produce a finite, nonsentinel result;
before/after readbacks must match exactly. The update workload retains its deterministic
nonzero step. The control runs identical baseline candidate-metrics code twice.

| Workload                       | Run B before → after (ms/dispatch) | Change B | Run C before → after (ms/dispatch) | Change C |
| ------------------------------ | ---------------------------------- | -------- | ---------------------------------- | -------- |
| Candidate metrics              | 0.981 → 0.989                      | +0.87%   | 1.036 → 1.060                      | +2.36%   |
| Candidate update               | 0.566 → 0.560                      | −1.11%   | 0.596 → 0.626                      | +4.98%   |
| Identical-code metrics control | 0.985 → 1.003                      | +1.89%   | 1.105 → 1.064                      | −3.67%   |

B and C each alternate 61 pairs of 16-dispatch batches after ten warmups in fresh
SwiftShader browser processes. The table divides each batch's summed compute timestamps
by 16; it excludes readback. Median paired metrics changes are −0.27% and +1.35%; update
changes are −0.05% and +0.76%. The initial single-dispatch run A also showed no clear win.
**These measurements establish no TypeCV speedup.** They also do not exclude a small
regression. The new stage supplies structural optimization capability; its smaller
intermediate results are not evidence of lower physical memory traffic or call-stack cost.
Reports retain raw samples, exact readbacks, source hashes and compiler sources in
`artifacts/calls-bench-a.json`, `artifacts/calls-bench-b.json` and `artifacts/calls-bench-c.json`.

The consumer build also grows: its main GPU chunk changes from 2,560.84 to 2,584.65 kB
(gzip 433.65 → 437.87 kB), and its fuse-plan chunk from 414.65 to 427.23 kB
(gzip 106.79 → 109.65 kB). These are Vite's reported build sizes, not runtime speed measurements.

Validation includes 14 new specialization regressions, 299 optimizer/effects/profile/common
tests in total, 353 example/golden checks, the full compile and GPU differential gates,
a TypeCV build, 53 shade tests and 16 SwiftShader application tests. The latter include
bundle adjustment, Schur operators, triangulation, PnP, P3P and two-view geometry.
The class-example render comparison matches every RGBA8 byte at 48×48 and 96×96 for
times 0, 1.25 and 3, with a nonblank-output and repeatability check.
Logs and the render comparison are retained as `artifacts/calls-*.log` and
`artifacts/calls-render.json`.

A separate 31-pair render run after six warmups also matches every pixel. Namek's
median GPU time is 6.901 → 7.112 ms at 48×48 (+3.05%) and 30.285 → 30.851 ms at
96×96 (+1.87%). The unchanged RT example moves +5.19% and −1.63%, respectively.
The short initial render run is therefore not evidence of a speedup; neither is this
longer run. Its raw samples are in `artifacts/calls-render-a.json`.

To reproduce the TypeCV comparison after building both checkouts:

```sh
bun scripts/bench-typecv-memory.mjs --base /path/to/baseline-typeshade --typecv /path/to/typecv --fixture /path/to/captured-fixture.json --workload calls --batch 16 --samples 61 --warmup 10 --output artifacts/calls-repeat.json
```

Omit `--fixture` to capture new inputs from the built TypeCV checkout. The render script
also accepts `--head WORKTREE` to compare current emit goldens against a committed baseline.

## Combining calls, splitting aggregates and outlining shared regions

The initial call-specialization implementation above did not complete the planned
producer/consumer fusion or arithmetic outlining. These are now a separate O2 stage,
`src/core/passes/restructure-calls.ts`, immediately after specialization and before fp64
lowering. This stage changes the computation's function boundaries, not only its signatures.

It builds a new helper from an aggregate-producing argument and its consumer. Producer
bodies are copied into that helper with fresh locals and argument snapshots; the consumer's
complete body becomes the helper's body. Thus a consumer's early return exits the new
helper, never its caller. Equal call graphs share the helper even when the callers use
different local names. Calls remain under their original enclosing conditions.
Effectful trees, inout parameters and opaque functions are excluded. Producer bodies must
have a single trailing return; consumers may have multiple returns. Expansion is limited
to four argument-tree levels, 12 captured inputs, eight fused helpers, 1,600 copied source
expression nodes per helper and 6,400 per module; cleaned helpers over 2,400 nodes are refused.

`src/core/passes/scalarize-locals.ts` then splits small local arrays and plain structs into
individual values, including f64 values and vectors. Fixed local-array producer loops can
expand up to 16 iterations within a 256-node budget, using the existing integer-loop proof;
the general unroller keeps its original eight-iteration limit. Dynamic indexes, override-sized
arrays and aggregates in for initialization/update headers retain their original representation.
Whole-value assignments snapshot every RHS component before writing any destination component.
Whole-value uses reconstruct a value when still needed. A regression executes a 12-element
producer whose consumer needs only two elements: its instrumented storage reads change from
12 to 2, with the same result. This count belongs to that regression, not to the TypeCV pose,
whose transform needs all 12 elements.

Finally, `src/core/passes/outline-regions.ts` finds arithmetic regions repeated across functions.
It abstracts caller-local values into parameters while preserving operand order, literal values
and types, and creates shared helpers. Loads, helper calls and conditional expressions remain
intact as captured arguments, so no short-circuited operand is hoisted out of its condition.
Candidates contain 12–128 expression nodes and at most eight inputs; at most eight regions
are selected using a source-node cost estimate. Overlapping regions with only one remaining
use are restored. This is bounded structural outlining, not unrestricted algorithm substitution
or a hardware register-allocation model.

In TypeCV joint-focal, two fused helpers and four arithmetic helpers are generated. In the
candidate-metrics path, `cameraAt`, `poseAt`, `transform` and the projected `project` body are
combined; the local 12-element pose array and its copy into `transform` disappear. Shared
helpers include the three-term affine coordinate expression, camera-center arithmetic,
a radial-validity predicate and the projection derivative expression. The derivative-based
validity checks still execute. P3P and float-matching remain unchanged. Joint-focal WGSL grows
from 96,874 to 99,004 bytes (+2.20%); removing intermediate objects does not imply smaller text.
Before/after code and diffs are retained as `artifacts/structure-*.wgsl` and
`artifacts/structure-*.diff`.

Validation passes build, 307 related unit/profile/common-module tests (eight new restructuring
regressions), 353 example/golden checks, the compile gate and the full GPU differential gate.
Six emit goldens were deliberately refreshed for `capsule-corp-namek-class`, `null-values`
and `rt-renderer-class`, in WGSL and fragment GLSL. The two class renderers match every RGBA8
byte against the previous specialization-only baseline at 48×48 and 96×96, at times 0, 1.25
and 3. The isolated TypeCV build passes all 53 shade tests and 16 SwiftShader application tests.
Logs and readbacks use the `artifacts/structure-` prefix.

The TypeCV consumer's main GPU chunk grows from 2,584.65 to 2,629.22 kB
(gzip 437.87 → 445.84 kB), and its fuse-plan chunk from 427.23 to 443.42 kB
(gzip 109.65 → 113.13 kB). These additional emitted-code and compiler-code costs must be
considered alongside any execution-time result.

The benchmark uses the preceding section's captured geometry and active-path/output checks,
with the specialization-only compiler as baseline. It alternates 61 pairs of 16-dispatch
batches after ten warmups, checks dispatch counts and timestamp sensitivity, and requires
finite, exactly equal before/after output values. Use the same `--workload calls --batch 16`
command with that baseline. The render script accepts `--base-dir /path/to/baseline` together
with `--head WORKTREE` to compare uncommitted compiler snapshots without creating commits.

| Workload                       | Run A ms/dispatch before → after | Paired change A | Run B ms/dispatch before → after | Paired change B | Run C ms/dispatch before → after | Paired change C |
| ------------------------------ | -------------------------------- | --------------- | -------------------------------- | --------------- | -------------------------------- | --------------- |
| Candidate metrics              | 1.036 → 0.996                    | −2.55%          | 1.048 → 1.020                    | −3.89%          | 1.005 → 0.961                    | −4.34%          |
| Candidate update               | 0.578 → 0.561                    | −2.18%          | 0.558 → 0.569                    | +1.05%          | 0.568 → 0.558                    | +1.09%          |
| Identical-code metrics control | 1.042 → 1.022                    | +0.17%          | 1.045 → 0.980                    | −0.55%          | 1.030 → 0.991                    | −0.50%          |

Each timing column gives the median of summed timestamps divided by the batch size.
Each paired column instead takes the median percentage change of matched before/after
batches. These are different statistics: the control's unpaired median changes are
−1.90%, −6.25% and −3.86%, showing substantial run variation. Candidate metrics improves
in all three paired comparisons while the paired control stays within 0.6%; candidate
update has no consistent improvement. This is evidence for a small candidate-metrics
benefit on this SwiftShader fixture, not an end-to-end, hardware-GPU or bandwidth result.
The reports are `artifacts/structure-bench-a.json`, `artifacts/structure-bench-b.json` and
`artifacts/structure-bench-c.json`; all before/after output values match exactly.

## Connecting local call chains and caching writable storage

The next O2 extension follows producer/consumer edges through local variables.
`src/core/passes/connect-local-calls.ts` proposes an expanded call tree only when each
intermediate local has one use and is never mutated. It commits the substitution and
removes the original declarations only after the existing fusion stage accepts the tree.
The scan stays within one straight-line block and 32 statements; control flow, external
writes, opaque statements and effectful calls end availability. Changes to an argument
or to a hidden callee read invalidate that snapshot. Conditional operands retain their
guards. Existing fusion depth, input-count, helper-count and node budgets still apply.
Multiply used values and producers consumed under a later guard remain materialized.

`src/core/passes/storage-load-reuse.ts` is a separate module-level O2 stage after
restructuring and before fp64 lowering. It caches repeated scalar, vector, f64 and vec64
storage loads across statements inside a block. A write through **any** external root
invalidates all available storage loads, including a write through a differently named
binding: different binding names do not establish disjoint memory. Local index mutations
invalidate dependent loads. Effectful calls, atomics and synchronization end the region.
Only unconditionally evaluated value operands are rewritten; assignment targets remain
places. Branches have independent caches. Raw modules and opaque functions are skipped.

The same stage can hoist invariant loads from the unconditional prefix of a proven
2–64-iteration integer loop. No external write or effectful call may occur anywhere in
that loop, and the load cannot depend on any loop-local declaration or mutation. The
stage does not unroll the loop. It uses at most eight preheader loads per loop and a
32-cache budget per function; unused speculative block caches are restored. It never
changes a resource's declared `read_write` access to `read`.

An instrumented regression for a local-variable chain reduces a 12-element producer's
storage reads from 12 to 2. A repeated-field regression changes two reads to one, and a
six-iteration accumulation changes six reads to one without reordering the accumulation.
Aliased bindings, intervening writes and hidden writes, barriers, changing indices,
conditional reads and zero-trip loops have rejection/parity regressions.

Against the preceding restructuring-only compiler snapshot, TypeCV joint-focal changes
from 99,004 to 99,237 WGSL bytes (+0.24%). `bundleSchurPointAt` and
`updateBundleCandidate` each load a focal-vector value once before a three-iteration
loop instead of once per iteration (3 logical loads → 1 per reached loop). These counts
are not hardware memory transactions. The earlier 18 → 3 Schur-row transformation is
unchanged. P3P and float-matching WGSL are byte-identical, and TypeCV's fused-helper count
remains two: this consumer has no additional accepted local-call chain in this snapshot.

Five class examples do gain fused helpers: Namek 0 → 1, generic-class 0 → 3,
optional-fields 0 → 1, RT renderer 4 → 6 and shape-inheritance 0 → 3. This is ten more
generated helpers, not a measured GPU call-stack reduction. Their WGSL can grow:
RT changes from 20,967 to 24,224 bytes (+15.53%), and shape-inheritance from 3,101 to
4,238 (+36.67%). The TypeCV main GPU chunk grows from 2,629.22 to 2,630.64 kB
(gzip 445.84 → 446.31 kB); its fuse-plan chunk grows from 443.42 to 453.86 kB
(gzip 113.13 → 115.02 kB).

The baseline is the saved pre-extension compiler, including all previous optimizations.
`scripts/bench-compiler-regions.mjs` compares focused local-chain and storage-region
fixtures on SwiftShader with independent exact-integer output expectations, including
a write-between-reads regression. These are synthetic fixtures, not TypeCV throughput.
`scripts/bench-typecv-memory.mjs --workload regions` instead dispatches TypeCV's actual
point-Schur and candidate-update entries on the captured BA fixture. It activates the
point solver, supplies the same deterministic nonzero vectors to both versions, checks
finite exact readbacks and nonempty changed outputs, and compares an unchanged point
entry as its control. Both scripts alternate before/after order and check that four
times the dispatches takes more time. Timings exclude output readback.

Three fresh-browser runs use 61 measured before/after pairs, ten warmups and 16
dispatches per sample. Focused fixtures contain 8,192 invocations; the TypeCV fixture
contains 12 cameras, 256 points and 3,072 observations. The timing runs ran alone, after
the GPU correctness checks finished. Percentages below are medians of paired percentage
changes, with negative values meaning less time.

| Focused fixture                             | Run A   | Run B   | Run C   |
| ------------------------------------------- | ------- | ------- | ------- |
| Local producer/consumer chain, 12 → 2 loads | −52.39% | −55.09% | −55.26% |
| Two cross-statement reads → one             | +1.98%  | +0.35%  | −0.30%  |
| Six-iteration invariant read → one          | −24.44% | −27.97% | −27.80% |
| Reuse on each side of an intervening write  | −0.71%  | +1.20%  | −0.69%  |
| Identical-code chain control                | +2.80%  | −2.08%  | +0.21%  |

The chain's separate before/after dispatch medians in run B are 0.242 → 0.111 ms;
the loop's are 0.155 → 0.113 ms. These medians and the paired percentages are different
statistics. The chain and loop fixtures show repeatable benefits substantially larger
than their control's variation. The two-read and write-boundary fixtures do not show
a consistent timing benefit. Every before/after output matches an independent exact
integer expectation: 81,920 checked f32 values per run across five cases and both versions.

| Actual TypeCV entry                | Run A  | Run B  | Run C  |
| ---------------------------------- | ------ | ------ | ------ |
| Point Schur                        | −1.30% | −0.15% | −1.77% |
| Candidate update                   | −3.46% | −2.63% | −2.31% |
| Identical-code point-Schur control | −0.88% | −0.21% | +0.61% |

Candidate update's separate time medians are 0.563 → 0.537, 0.557 → 0.549 and
0.539 → 0.528 ms per dispatch in A/B/C. Its paired improvement repeats in all three runs;
the control stays within 0.9%. Point-Schur's benefit is small and not clearly separated
from variation, especially in run B. All measured before/after TypeCV output values are
finite and exactly equal. These measurements concern these entries and fixtures; they
do not establish an end-to-end TypeCV speedup or physical memory-bandwidth reduction.
The raw samples, shaders or module hashes and source snapshots are retained in
`artifacts/regions-focused-{a,b,c}.json` and `artifacts/regions-typecv-{a,b,c}.json`.
The earlier `regions-focused-smoke` and three-sample render run are correctness checks
only: other GPU tests were active then, so their timings are not used here.

Validation passes the compiler and consumer builds, 333 related tests (26 new
regressions), all 353 golden checks, all 194 examples in the compile gate, the complete
GPU differential gate, 53 TypeCV shade tests and 16 TypeCV WebGPU application tests.
Eleven WGSL/GLSL goldens were deliberately refreshed for six affected examples; the
final check runs without baking. RT and Namek match the previous compiler at both
48×48 and 96×96, at times 0, 1.25 and 3: zero differing bytes in all twelve frames.
The common-module bake check, targeted lint/format checks and documentation references
also pass. Logs use the `artifacts/regions-` prefix.

To reproduce against the saved pre-extension compiler (or an equivalent source snapshot):

```sh
bun scripts/bench-compiler-regions.mjs --base /path/to/pre-extension-compiler --samples 61 --batch 16 --output artifacts/regions-focused-repeat.json
bun scripts/bench-typecv-memory.mjs --base /path/to/pre-extension-compiler --typecv /path/to/typecv --fixture artifacts/memory-bench-a-fixture.json --workload regions --samples 61 --warmup 10 --batch 16 --output artifacts/regions-typecv-repeat.json
```

## Integration bundle cost

The complete optimization series was integrated with main `64a9a5db` on 2026-10-30.
Paired source builds use the same Linux host, Bun 1.4.4 and dependencies, retaining all
exports at gzip level 9. The baseline contains no changes from this optimization series.
These are compiler/runtime bundle sizes, separate from the shader and TypeCV chunk sizes above.

| Entry   | Single file, before → after | Split initial, before → after | Split aggregate, before → after |
| ------- | --------------------------- | ----------------------------- | ------------------------------- |
| runtime | 134,408 → 143,872           | 36,462 → 36,460               | 136,477 → 145,808               |
| emit    | 101,183 → 110,453           | 101,183 → 110,453             | 101,183 → 110,453               |
| fuse    | 95,844 → 105,237            | 13,771 → 13,770               | 96,260 → 105,745                |

All values are gzip bytes. Algorithms remains 47,439 bytes and random remains 31,308
in each build form. The additional optimization passes account for a shipping-size cost;
the runtime and fuse split initial chunks do not grow. The boundary scan still finds no
front-end compiler imports, external dependencies or prohibited dynamic execution.
Seven exceeded caps in `scripts/bundle-budget.json` take the measured candidate values;
the runtime/fuse initial caps and every floor remain unchanged.

Integration tests retain constructor and method ABI assertions at O1, or in GLSL modules
without entry specialization. O2 assertions cover the corresponding fused, specialized,
outlined and cached output. Existing oracle, editor and control-flow checks remain in place.

## What the numbers do not say

- A timing depends on the machine, the browser and what else it runs; a baseline is compared only
  with a run on the same adapter key, and a software baseline only on the processor it names.
- The GPU time is rounded by the browser, so a case under its step reads as the step.
- The corpus is four cases of what a host writes today. A change that speeds one kernel shape and
  slows another is seen only where the corpus holds both; add a case to `scripts/perf-gate.ts`
  with the change that needs it, and record the baseline again.
- Nothing here measures the CPU tier or WebGL2.
