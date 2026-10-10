# MNIST softmax regression

This experiment uses TypeShade for logits, stable softmax cross-entropy, mean reduction,
explicit backward gradients and mini-batch SGD updates. The model has 784 inputs, 10 classes,
7,840 weights and 10 biases. The host owns dataset loading, normalization, initialization,
batching, evaluation and logging. No dependency or API is added to TypeShade Core.

## Run

Run from the repository root. Install the repository's development dependencies first.

```bash
bun install
bun run build
node --test journeys/mnist/test.mjs
node journeys/mnist/run.mjs --download --train 1024 --test 1000 --epochs 5
```

The download option caches the official MNIST gzip IDX files from
`https://storage.googleapis.com/cvdf-datasets/mnist/`. The loader checks magic numbers,
counts, dimensions, payload lengths and labels. It normalizes pixels to `Float32Array`
values in `[0, 1]` by division by 255. Each run records SHA-256 hashes of the compressed files.
Check those hashes against [results.json](results.json) to reproduce the recorded dataset.
The cache is ignored by Git. Download only missing files; pass `--data DIRECTORY` to use an
existing cache of the four original gzip files.

On a proxy-only network, Node 24 can honor the inherited proxy with
`NODE_USE_ENV_PROXY=1 node journeys/mnist/run.mjs --download`. Older Node versions can use
files downloaded with a proxy-aware client in the directory selected by `--data`.

Defaults are seed 123, learning rate 0.1, batch size 32 and five epochs. The LCG initializer
creates weights in `[-0.01, 0.01)` and zero biases. Training visits the first selected images
in fixed order, with contiguous batches and an actual count for the final incomplete batch.
There is no shuffling. Set `--train 60000 --test 10000` for the complete dataset; this size
was not measured here. The full training pixel buffer is 188,160,000 bytes, exceeding
a common 128 MiB WebGPU storage-binding limit; this runner does not stream dataset chunks
or request higher device limits. Use smaller subsets on that device. Set `--seed`, `--rate`, `--batch` and `--epochs` to change the experiment.

## WebGPU

```bash
./node_modules/.bin/playwright install --only-shell chromium
node journeys/mnist/test-webgpu.mjs
node journeys/mnist/run.mjs --tier webgpu --train 1024 --test 1000 --epochs 5
node journeys/mnist/test-mnist.mjs --webgpu
```

`test-mnist.mjs` expects the default dataset cache. It verifies real MNIST training against
the independent f64 training reference, repeats CPU training and optionally repeats WebGPU
training and compares the parameters. The small tests need no dataset or download.

The Node host compiles and packs the shader. A local Vite server serves the browser's
runtime module. Playwright executes the TypeShade program runtime with `prefer: ['webgpu']`.
The runner prints adapter information and checks the runtime tier. An unavailable adapter
fails the run; it does not train on a CPU fallback. `--software` explicitly requests
SwiftShader. `TYPESHADE_CHROMIUM` can select an installed browser binary.

The dataset, parameters, logits, deltas, losses and gradients use `resident()` handles.
Initial storage uploads happen on first use. Weights and intermediate tensors stay on the
device through training. Batch uniforms change each dispatch. Evaluation reads two floats
per batch; final parameter reads bring back weights and bias. No tensor readback occurs
between forward, backward and update. Each dispatch is submitted and awaited so its measured
time includes completion. This favors transparent validation over throughput.

Transfer counters observe actual `queue.writeBuffer` and `buffer.mapAsync` calls, including
uniforms and staging. The training report includes initial/epoch evaluations and final
parameter reads, but excludes the separately created test-set evaluation backends.
Forward time includes logits and the objective; backward and update times are separate.
These are host wall times, including submission and, for WebGPU, Playwright transport.
They exclude pipeline compilation. Epoch time excludes evaluation; total time includes
training-set evaluations. They are not GPU timestamp measurements.
Memory is an estimate of the tensor payload bytes, not a measured peak. It excludes runtime
buffers, staging, pipelines, JavaScript objects, dataset decompression and browser transport.
There are host copies as well as resident device copies.

## Independent checks

[reference.mjs](reference.mjs) implements the model, loss, gradients and training in plain
JavaScript f64, without TypeShade imports. [cpu.mjs](cpu.mjs) compiles the shader and runs
its entries through `compileModuleJs` (f32 by default); tests also run the f64 interpreter
and f64 generated CPU computation. No generated function fell back to the interpreter in
the recorded f32 code-generation inspection.

The eight Node tests check forward values, stable loss at large logit offsets, mean reduction,
explicit gradients, updates, incomplete batches and nonzero offsets, IDX validation,
training improvement and repeatability. Central differences check 24 weight coordinates
and all 10 biases at `h = 1e-5`, with tolerance `1e-7 * (1 + abs(expected))` against the
independent f64 loss. These checks do not differentiate the f32 quantization of parameter
stores. Numerical comparisons generally use `2e-5 * (1 + abs(expected))`; f64 stage checks
use `1e-12`. Repeated CPU parameters must match exactly. WebGPU repeatability and CPU/GPU
agreement use the general tolerance; no cross-driver bit-exact guarantee is claimed.

The repository unit suite invokes the Node tests from
[../../examples/mnist-training.test.ts](../../examples/mnist-training.test.ts).
[journey.mjs](journey.mjs) registers eight stage checks with the existing packed-package
journey gate, which compares WebGPU, WebGL2 and the CPU oracle to the independent reference.
Use `bun run gate:journeys` after building to run it.

## Inspection and limitations

The inspected main is `fa8ac7fb` (2026-10-10). Its authoring and runtime surfaces are described
in [../../AUTHORING.md](../../AUTHORING.md) and implemented in the compiler, CPU code generator,
Vite host-face generation and program runtime. A `"use typeshade"` module becomes shared IR;
`compileModule` interprets it and `compileModuleJs` generates JavaScript. Pure helper host
imports through Vite run on the CPU at f32. Compute imports and packed program dispatches
can execute on WebGPU. The existing host-import journey tests resident chaining.

Forward scalar/vector AD and reverse scalar/vector AD are implemented. Reverse mode uses
checkpointed function memory; `gradCheck` is present. Proposal
[0056](../../changes/0056-reverse-mode-grad.md) remains **accepted**, not fully implemented.
The scalar reverse-mode slice is delivered. Commit `a34a97ae` (#548) delivers f32 scatter
sums in tree order on the CPU tier. GPU f32 scatter lowering, storage-array reverse AD and
the derivative manifest/runtime plan are pending stages. Acceptance is not availability.
The Node tests exercise implemented scalar AD and assert the current array-parameter and
void-entry refusals. `SD0118` on these forms is an unsupported feature, not a compiler bug.

The backward kernel is deliberately explicit: each invocation owns one weight gradient
and optionally one bias gradient, summing the mini-batch deltas. It needs no atomic or scatter
accumulation and no AD of storage writes. There is no compiler workaround or semantic/API
change in this experiment. The source is in a journey rather than the registered
`examples/*.shade.ts` set, so the proposal criteria in
[../../changes/README.md](../../changes/README.md) do not apply.

The implementation is a correctness baseline: sequential per-sample dot products and
per-parameter batch sums, no tiled matrix multiply, workgroup reduction or optimizer framework.
Serial dispatch synchronization limits performance. Hardware GPU validation and performance
remain pending. Software WebGPU validates shader execution and residency, not GPU acceleration.
This work is on a separate feature branch and does not modify documentation PR #554.

## Executed results

[results.json](results.json) records the actual 2026-10-10 runs and installed tool versions.
Only the first 1,024 training images and first 1,000 test images were used, with the defaults.

| Measurement                         |       Generated CPU f32 | WebGPU on SwiftShader software adapter |
| ----------------------------------- | ----------------------: | -------------------------------------: |
| Initial training mean loss          |              2.30445101 |                             2.30445105 |
| Final training mean loss            |              0.44649846 |                             0.44649848 |
| Initial training accuracy           |                14.7461% |                               14.7461% |
| Final training accuracy             |                90.2344% |                               90.2344% |
| Initial test accuracy               |                    9.9% |                                   9.9% |
| Final test accuracy                 |                   80.9% |                                  80.9% |
| Final test mean loss                |              0.66244285 |                             0.66244288 |
| Epoch 5 forward / backward / update | 20.65 / 29.23 / 9.18 ms |            317.88 / 182.61 / 174.15 ms |
| Epoch 5 total                       |                59.17 ms |                              674.99 ms |
| Estimated tensor payload            |         3,280,856 bytes |                        3,280,856 bytes |

The real-data test repeated both CPU and WebGPU training; parameters matched exactly within
each tier on this machine. Maximum weight difference from the independent f64 training
reference was `1.07e-7` on CPU. Maximum WebGPU/CPU weight difference was `7.45e-8`.
All parameters were finite and changed. WebGPU stage checks against the independent f64
reference passed; the largest absolute stage difference was `1.98e-7`.
The recorded WebGPU training run observed 1,417 uploads (3,301,840 bytes) and 194 readbacks
(32,936 bytes), including uniforms and evaluations as described above.

The adapter reported vendor `google`, architecture `swiftshader`, `isFallbackAdapter: true`.
The actual runtime tier was `webgpu`. These timings are from software rendering in a shared
cloud environment and are not a hardware GPU benchmark. No full-dataset result is claimed.

The final repository validation passed: build, lint, format, 413 unit test files
(8,857 tests passed, 4 skipped, 1 todo), compile, differential, render, bundle-boundary,
packed journeys and their host-import checks. Documentation references had zero dead links.
The change-scope check required no proposal. The impact review covered only this new README's
references; those descriptions match the implementation. Hardware GPU training, full-dataset
training, alternate TypeScript-version CI legs and a local Doorstop audit were not run.
