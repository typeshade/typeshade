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

## What the numbers do not say

- A timing depends on the machine, the browser and what else it runs; a baseline is compared only
  with a run on the same adapter key, and a software baseline only on the processor it names.
- The GPU time is rounded by the browser, so a case under its step reads as the step.
- The corpus is four cases of what a host writes today. A change that speeds one kernel shape and
  slows another is seen only where the corpus holds both; add a case to `scripts/perf-gate.ts`
  with the change that needs it, and record the baseline again.
- Nothing here measures the CPU tier or WebGL2.
