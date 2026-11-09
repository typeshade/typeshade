# CPU inout return storage measurement

Issue #961 reports repeated return-array allocation in the CPU code generated for methods.
The implementation gives each generated function with `inout` parameters one fixed-width
buffer in its module factory. Each return writes its parameter locals into that buffer and
publishes it after the return expression finishes. Nested calls consume their values before
an outer return publishes its own. Interpreter fallback calls retain the same shared return
slot contract and may replace its value.

This removes the generated return-array allocation per call. It does not remove copies of
by-value aggregates or other CPU allocations. Each buffer retains its function's most recent
argument values until that function runs again or the generated module becomes unreachable.
This lifetime tradeoff replaces an allocation on each call with one buffer per function.

## Measured configuration

Measured on 2026-11-06 UTC in this Linux cloud workspace, using Node 24.22.1 and V8
13.6.233.17-node.58. Bun 1.4.4 built the Node benchmark bundle. No GPU gate, build or other
benchmark ran concurrently with these two measurements.

Baseline: compiler `324251dfe7755f78041eb44a1bfe85e4294e12dd`. Candidate: the working-tree
implementation based on that revision. The retained JSON identifies both generated factories
by SHA-256 and marks the candidate dirty. The subsequent implementation commit records the
source change; no containing commit hash is invented here.

The benchmark compiles one kernel that calls methods on 512 voice objects for 128 frames.
Each voice performs three calls with `inout` receivers per frame. Both versions use the same
shader source, f32 precision, input generation and runtime. Input allocation is outside timing.
The benchmark checks every final state and output against exact, independently calculated
values after each sample. Each process warms both factories ten times and takes twenty samples
per version, alternating their order. Times are milliseconds per 128-frame block.

| Fresh process | Baseline median | Candidate median | Reduction |
| ------------- | --------------: | ---------------: | --------: |
| 1             |         1.71817 |          1.44721 |    15.77% |
| 2             |         2.17515 |          1.74152 |    19.94% |

Raw samples: [run 1](../scripts/benchmarks/cpu-inout/run-1.json) and
[run 2](../scripts/benchmarks/cpu-inout/run-2.json).

This is a CPU microbenchmark on V8. It is not TypeAudio's AudioWorklet workload, an audio
latency guarantee or a GPU performance result. The difference between processes also shows
why one timing does not establish a universal improvement. Timing has no pass/fail threshold.

## Reproduction

Use a baseline checkout and a candidate checkout with the same dependencies. Copy the candidate's
`scripts/bench-cpu-inout.ts` into the baseline checkout before saving its factory. This copies
only the benchmark, not the generator. Run each command from its respective repository root.

1. In the baseline checkout, run `bun scripts/bench-cpu-inout.ts --save-baseline /tmp/inout-baseline.json`.
2. In the candidate checkout, run `bun build scripts/bench-cpu-inout.ts --target=node --outfile=/tmp/inout-bench.mjs`.
3. With other work idle, run `node /tmp/inout-bench.mjs --baseline /tmp/inout-baseline.json`.
4. Run the Node command in a second fresh process and retain both JSON outputs.

The script refuses a changed shader source or an interpreter fallback. Every sample checks
its outputs, so a faster program that computes the wrong answer cannot produce a valid record.

## Bundle cost

Bun 1.4.4 measured baseline and candidate with the same installed dependencies. The baseline
checkout at `811179a6` carries only the independent namespace-inheritance fix over the shared
compiler baseline; its common-module faces, runtime and bundle budgets match `324251df`.
Single-file, split initial and split total gzip bytes each changed as follows:

- `typeshade/algorithms`: 50,085 to 51,383 (+1,298).
- `typeshade/random`: 33,351 to 33,393 (+42).

Runtime, emit and fuse sizes did not change. Only the six exceeded caps were raised to the
measured sizes. Floors are unchanged. The extra bytes come from the baked CPU functions and
factory buffers, not a new runtime dependency.
