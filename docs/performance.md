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

| Case      | Source                                            | What runs                                                                       |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `chain`   | `journeys/loop-fuse/ops.shade.ts`                 | `add`, `mul`, `relu` over `n` elements: one fused dispatch                      |
| `chain/4` | the same                                          | the same over `n / 4` elements: the proof of the instrument                     |
| `reduce`  | the same                                          | `add`, `mul`, then the sum `total`: the loop dispatch and the folds of partials |
| `tonemap` | `examples/hosts/host-kernel/host-kernel.shade.ts` | `exposure`, then the reduction `peak`, over `n` pixels                          |
| `batch`   | `journeys/mnist/batch.shade.ts`                   | one softmax-regression batch of 128 rows: forward, objective, backward, update  |

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
SwiftShader, a software device, with three samples and `n = 262144`. Those numbers say what one
instruction costs on a CPU executing WebGPU. They are not a GPU's cost and the job compares them
with nothing: it keeps the proof of the instrument and the shape of the report, so that a change
that breaks the corpus or the measurement fails there.

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
  with a run on the same adapter key.
- The GPU time is rounded by the browser, so a case under its step reads as the step.
- The corpus is four cases of what a host writes today. A change that speeds one kernel shape and
  slows another is seen only where the corpus holds both; add a case to `scripts/perf-gate.ts`
  with the change that needs it, and record the baseline again.
- Nothing here measures the CPU tier or WebGL2.
