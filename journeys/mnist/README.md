# MNIST softmax regression with TypeShade

This is a computation-validation experiment, not an ML framework. TypeShade computes every
logit, softmax/loss, weight/bias gradient, mini-batch gradient sum and SGD update. The
TypeScript host loads data, selects batches, controls epochs and aggregates evaluation
metrics. TypeShade Core, its public APIs and dependencies are unchanged.

Read [REPORT.md](REPORT.md) for the main implementation audit, execution/residency analysis,
unsupported-feature reproductions and prioritized compiler/runtime findings.

## Run from the repository root

Use Node 24, or Node 22.6+ with `--experimental-strip-types` as shown below. Install the
repository's existing development dependencies. TypeShade itself still supports its declared
Node range; this experiment's directly executed TypeScript needs Node type stripping.

```bash
bun install
bun run build
./node_modules/.bin/tsc -p journeys/mnist/tsconfig.json
node --experimental-strip-types --test journeys/mnist/test.mjs
node --experimental-strip-types journeys/mnist/run.ts --download
```

The defaults now select the **complete 60,000/10,000 MNIST dataset**, seed 123, batch size 32,
learning rate 0.1 and five epochs. The model has 784 inputs, 10 outputs, 7,840 weights and
10 biases. Initialization uses an LCG, weights in `[-0.01, 0.01)` and zero biases. Pixels are
normalized to f32 by division by 255. Batches are contiguous and deterministic, without
shuffling. The final short batch uses its actual count.

`--download` caches only missing official gzip IDX files from
`https://storage.googleapis.com/cvdf-datasets/mnist/`. The loader validates IDX headers,
counts, dimensions, exact payload size and labels. Runs log SHA-256 hashes. Compare them with
the retained results to reproduce the dataset. Cache files and parameter arrays are not
committed. `--data DIRECTORY` selects an existing cache containing the four original gzip
files. On a proxy-only network, Node 24 can honor inherited proxy settings with
`NODE_USE_ENV_PROXY=1` before the command.

Set `--train`, `--test`, `--batch`, `--rate`, `--seed` and `--epochs` to change the experiment.
For a quick subset run:

```bash
node --experimental-strip-types journeys/mnist/run.ts --train 1024 --test 1000 --epochs 5
```

## WebGPU and independent validation

```bash
./node_modules/.bin/playwright install --only-shell chromium
node --experimental-strip-types journeys/mnist/test-webgpu.mjs
node --experimental-strip-types journeys/mnist/run.ts --tier webgpu
node --experimental-strip-types journeys/mnist/test-mnist.mjs --train 60000 --test 10000 --epochs 5 --webgpu
node --experimental-strip-types journeys/mnist/probe-capabilities.mjs
```

The full-data validation command expects the default dataset cache. It repeats CPU and
WebGPU training, compares full trained parameters against the independent f64 reference
and CPU results, checks finite changed weights and verifies loss/accuracy improvement.
The small Node/WebGPU tests and capability probes need no dataset download.

The Node host compiles and packs the shader. A local Vite server transfers the dataset once
as binary to the browser host. TypeShade's program runtime executes the compute entries
with `prefer: ['webgpu']`. No CPU fallback is allowed. The runner reports both adapter and
runtime/device information. `--software` explicitly requests SwiftShader; a default launch
can also select software rendering, so inspect the reported adapter. `TYPESHADE_CHROMIUM`
selects an installed browser binary.

The full dataset remains in host memory. GPU input buffers hold only one batch. Existing
`resident().write()` updates pixels and labels in those fixed-size buffers, while parameters,
gradients and intermediate buffers stay resident. SGD updates GPU-resident parameters
without readback. Evaluation reads two statistics per batch; final parameter reads occur
only after training. Handles and the runtime are released when the backend finishes.

Each dispatch is submitted and awaited for clear correctness and timing attribution. Stage
and epoch times are **host wall times**, including synchronization and browser transport.
Forward includes input preparation and the objective. Backward includes gradient reduction.
Epoch time excludes evaluation; total time includes training-set evaluations. Pipeline
compilation is outside these training timings. Queue-write measurements are enqueue cost,
and map measurements are readback wait time; neither is a GPU timestamp transfer duration.
A zero enqueue sample is not proof of a zero-cost GPU transfer.

Memory reports separate host tensor payload, resident GPU tensor payload and tracked peak
requested buffer bytes. The latter include staging/uniforms observed after pipeline
creation, but exclude driver, texture and pipeline allocations. They are not physical VRAM
measurements. Transfer counts include uniforms and training-set evaluations, but exclude
separate test-set backends. Browser-host dataset setup is not a GPU upload.

## Tests and automatic differentiation

[reference.mjs](reference.mjs) independently implements f64 forward, loss, backward, SGD
and training, without TypeShade imports. [cpu.mjs](cpu.mjs) compiles the same shader and
runs `compileModuleJs` at f32. Tests also use the f64 interpreter and generated f64 CPU path.
[train.ts](train.ts) and [dataset.ts](dataset.ts) own host training control and data handling.

Ten Node tests check logits, stable softmax/loss, mean reduction, explicit gradients,
updates, nonzero offsets, incomplete batches, IDX validation, independent training and
repeatability. Finite differences check 24 weight coordinates and all 10 biases at `h = 1e-5`.
They use f64 perturbations/loss and tolerance `1e-7 * (1 + abs(expected))`. Stage comparisons
at f64 use `1e-12 * (1 + abs(expected))`; f32, WebGPU and full-parameter comparisons use
`2e-5 * (1 + abs(expected))`. [REPORT.md](REPORT.md) explains the error allowances and timing
limits. Repeated CPU parameters must match exactly; GPU repeat errors are measured.

Supported `grad()` and `gradCheck()` run on 30 actual MNIST logit-loss points in each AD mode.
The array-parameter, storage-binding and void-entry forms produce the expected `SD0118`
refusals. F32 scatter emits `TS8070`; its current GPU lowering is unavailable. Proposal
[0056](../../changes/0056-reverse-mode-grad.md) is accepted and partially implemented.
The experiment's backward kernel is deliberately explicit, with one writer per parameter.
No new automatic differentiation implementation is introduced.

The repository unit suite invokes the Node tests and host TypeScript check through
[../../examples/mnist-training.test.ts](../../examples/mnist-training.test.ts).
[journey.mjs](journey.mjs) registers eight independent stage checks on the CPU oracle,
WebGPU and WebGL2 in the packed-package gate. Run `bun run gate:journeys` after building.
The WebGPU test also checks buffer reuse without readback and release after destruction.

## Execution-overhead diagnostics (not a GPU kernel benchmark)

The same model can now execute in four explicitly selected modes, without changing
the shader or its SGD semantics. They isolate two independent costs:

| Mode | Training-loop host | GPU submissions per training batch |
| --- | --- | --- |
| `baseline` | Node -> Playwright per stage | Four (one per compute entry) |
| `browser` | Entire training epoch inside Chrome | Four |
| `submit` | Node -> Playwright per stage | One ordered frame |
| `combined` | Entire training epoch inside Chrome | One ordered frame |

The default remains `baseline` for compatibility. Evaluation still reads
two statistics per batch and is excluded from each epoch's training-wall time.
All variants use the same data, model, seed and numerical operations. Browser
epoch mode times stages from Chrome, not Node. In batched modes the Forward and
Backward stage numbers **do not** represent GPU completion; the final update
wait includes completion of the whole frame. Compare `epochMs` or the
benchmark's `trainingWallMs`, not the per-stage times.

Run a four-way comparison without downloading MNIST (deterministic synthetic data):

```bash
node --experimental-strip-types journeys/mnist/perf-probe.mjs --count 256 --epochs 2 --repeats 3
```

With the already-downloaded real MNIST data:

```bash
node --experimental-strip-types journeys/mnist/perf-probe.mjs --mnist --count 1024 --epochs 5 --repeats 3
```

For native Windows hardware WebGPU, use a real installed browser and confirm
its adapter rather than assuming headless Chromium selected your physical GPU.
For example, with Chrome installed and the NVIDIA driver working:

```powershell
$env:TYPESHADE_BROWSER_CHANNEL = 'chrome'
$env:TYPESHADE_HEADED = '1'
$env:TYPESHADE_REQUIRE_HARDWARE = '1'
node --experimental-strip-types journeys/mnist/perf-probe.mjs --mnist --count 1024 --epochs 5 --repeats 3
```

`TYPESHADE_REQUIRE_HARDWARE=1` refuses explicit software mode, a software
adapter, and a runtime device whose NVIDIA adapter information does not match
the initial probe. This is a device identity check, not a substitute for
corroborating Windows/Chrome GPU diagnostics. `TYPESHADE_BROWSER_CHANNEL` and
`TYPESHADE_HEADED` are opt-in; Linux CI's default launch behavior is unchanged.

The probe checks trained GPU parameters and loss/accuracy against the same
generated-f32 CPU reference for every mode, and prints actual GPU queue
submission counts. It retains per-mode, per-epoch host-wall measurements with
the same workload. These numbers measure application execution overhead;
they do not measure GPU timestamp kernel durations. Repeat under stable
conditions and record CPU/GPU load before drawing conclusions. Changing
submission grouping can improve throughput without requiring any TypeShade
compiler or WGSL modifications. This experiment changes **no TypeShade Core
runtime API** and makes **no RTX 2080 performance claim** until measured.

Run the full GPU training under an individual mode using
`node --experimental-strip-types journeys/mnist/run.ts --tier webgpu --execution combined`.
For the CPU/WebGPU numerical regression comparator, add
`--execution combined` to `journeys/mnist/test-mnist.mjs --webgpu`.

## Recorded results

[results.json](results.json) preserves the original PR revision `0a7a3513` subset measurements:
1,024/1,000 images, loss 2.30445 → 0.44650 and test accuracy 9.9% → 80.9%. That older runner
kept the subset dataset GPU-resident. Its timings and transfers describe that revision.

[full-results.json](full-results.json) records the additional full-data runs, stage timings,
transfer counters, reference errors, capability probes and memory/reuse checks.
The additional full-data run uses the same main, seed, batch size, rate and five epochs.
Generated CPU training improved test accuracy from **11.28% to 91.67%**, and training mean
loss from **2.30658388 to 0.28329244**. CPU repeated parameters matched exactly. The maximum
full-weight difference against the independent f64 training reference was **3.42490e-6**;
maximum bias difference was **1.27672e-6**, within the stated tolerance.

The resident batch-32 reuse probe estimated **165,976 bytes** of GPU tensor payload, observed
**165,984 requested live buffer bytes**, and observed zero new buffer allocations/readbacks
for the next training batch. Tracked live bytes returned to zero after destruction.
The adapter advertised a 1 GiB storage binding limit; the actual default runtime device
limit was 128 MiB. Batch streaming removes the full-dataset GPU buffer-size problem.

All observed WebGPU execution used `google / swiftshader`, with `isFallbackAdapter: true`.
Hardware GPU training and hardware performance remain unvalidated. The example is a
correctness baseline with serial dot products, serial parameter-gradient sums and synchronized
submissions. It makes no performance improvement claim. Full-data WebGPU also reached **91.67%** test accuracy and **0.28329244** training mean loss.
Repeated parameters matched exactly on this software adapter. Maximum full-weight difference
between WebGPU and CPU was **7.74860e-7**; bias difference was **7.15256e-7**.
Its five epoch training times were 25.63, 25.56, 26.38, 26.66 and 31.84 seconds, excluding
evaluation. These are software WebGPU host timings, not hardware GPU kernel measurements.
The full training backend observed 123,757 uploads (2,073,695,488 bytes) and 11,252 readbacks
(121,400 bytes), including training-set evaluations. Input preparation and browser-host setup,
upload enqueue cost and readback wait time are reported separately in the JSON. Current
small-run telemetry also records requested buffer allocations and actual device limits.

The additional validation passed: 10 Node tests, host TypeScript checks, 241 existing capability
tests across eight Vitest files, final targeted tests, build and the packed-journey/host-import
gate. The prior revision's full unit/compile/differential/render results remain in the original
result record; they are not presented as reruns of the added reporting code. Actual additional
commands and final documentation/style check results are retained in the full result record.
