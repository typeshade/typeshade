# TypeShade MNIST computation validation

## Answer and scope

Current main can train a 784-input, 10-class softmax-regression model using generated CPU
computation, and can express every numerical training stage as an explicit WebGPU compute
kernel. The experiment requires no language change, public API change, ML framework or
TypeShade Core dependency. Its host training controller and dataset loader are TypeScript.

The full-data CPU experiment uses 60,000 training images and 10,000 test images. Five epochs
at batch size 32, rate 0.1 and seed 123 produced 91.67% test accuracy, compared with 11.28%
before training. Training mean loss decreased from 2.30658388 to 0.28329244. All parameters
were finite and changed. Software WebGPU reached the same 91.67% test accuracy and 0.28329244 training mean loss.
Both CPU and software WebGPU repeated parameters exactly on this machine. Maximum full-weight
CPU/f64-reference difference was 3.42490e-6; WebGPU/CPU difference was 7.74860e-7.
See [full-results.json](full-results.json) for all measured epochs and checks.

The available WebGPU adapter is **SwiftShader software rendering**, not a hardware GPU.
This validates WebGPU dispatch, WGSL arithmetic and residency. It cannot establish hardware
GPU training performance. Hardware GPU training remains unvalidated. The execution report
separates runtime tier from adapter/hardware classification.

For complete hardware GPU training with the explicit backward implementation, the missing
prerequisite is a real WebGPU GPU adapter and a run of the existing validation commands on
that device. No further compiler feature is required for this softmax model. For replacing
the explicit backward with automatic storage-backed reverse AD, the remaining 0056 compiler,
manifest and runtime stages are required. These are different objectives.

A 784 → 128 → 10 MLP is deferred. The current experiment establishes and measures the smaller
model and exposes the missing AD and performance capabilities without expanding model scope.

## Inspected implementation

The updated inspection used `origin/main` at `fa8ac7fbaa1ca4e1aec12aa93ed8d6580c08d258`
on 2026-10-10 UTC. It is the same main baseline as the original PR implementation. The
experiment remains on `feat/mnist-training`, PR #555, separate from documentation PR #554.

| Area                     | Implemented and evidenced on main                                                                                                                                                                                                                | Boundary                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shader authoring         | `compile()` in [../../src/compiler/ts/compile.ts](../../src/compiler/ts/compile.ts) reads `"use typeshade"` and builds IR. The journey's source passes compiler, editor, plain tsc and GPU execution checks.                                     | A `.shade.ts` module is not ordinary host TypeScript.                                                                                              |
| Host import / Vite       | [../../src/vite.ts](../../src/vite.ts) and host-face generation produce callable modules. Existing host-import journeys and Vite tests execute them.                                                                                             | Pure helpers run on CPU; a successfully awaited host call alone does not prove GPU execution.                                                      |
| Runtime                  | `createRuntime()` in [../../src/runtime/runtime.ts](../../src/runtime/runtime.ts) loads a packed manifest and dispatches reached bindings through named pipelines.                                                                               | Program-runtime tiers are WebGPU and WebGL2. The experiment requires WebGPU and has no CPU fallback in this path.                                  |
| Residency                | `resident()`, `ResidentArrayState.bufferFor()`, `write()` and `destroy()` in [../../src/core/resident.ts](../../src/core/resident.ts). Same-size writes reuse buffers; read copies data to the host.                                             | There is no public subrange write. The experiment writes fixed-size input batches, then releases handles and the runtime.                          |
| Automatic parallel loops | `proveLoop()`, `treeLoops()` in [../../src/core/passes/parallel-loop.ts](../../src/core/passes/parallel-loop.ts), and `lowerKernel()` in [../../src/core/passes/kernel-lower.ts](../../src/core/passes/kernel-lower.ts).                         | Only proved loops lower. The MNIST shader uses explicit compute invocations, so it does not claim that automatic loop lowering trained this model. |
| Reduction / scatter      | Scalar reductions have tree lowering. Integer scatter uses atomics. CPU f32 scatter follows tree order (0056 slice 2a, #548).                                                                                                                    | GPU proof refuses f32 scatter. `TS8070` exposes the CPU path; accepted 0056 does not supply GPU lowering.                                          |
| CPU / differential       | `compileModule()` interprets IR; `compileModuleJs()` generates JS. Existing differential gates compare GPU output to the f32 oracle.                                                                                                             | f64 is the independent mathematical reference; f32 rounding and reduction order are separate numerical questions.                                  |
| Forward / reverse AD     | [../../src/core/passes/grad.ts](../../src/core/passes/grad.ts) and [../../src/core/passes/grad-reverse.ts](../../src/core/passes/grad-reverse.ts) implement scalar/vector AD and checkpointed reverse loops. #546 and #547 deliver these slices. | Array parameters, storage binding differentiation and void compute entries remain refused.                                                         |
| Gradient check           | [../../src/core/passes/grad-check.ts](../../src/core/passes/grad-check.ts) compares AD with f64 central differences.                                                                                                                             | It checks supported function parameters, not an unsupported storage-array derivative.                                                              |
| Fallback                 | `runKernel()` in [../../src/core/host-kernel.ts](../../src/core/host-kernel.ts) tries configured tiers, then CPU if allowed.                                                                                                                     | The experiment bypasses that ambiguity by requiring a named program-runtime WebGPU pipeline for each stage.                                        |

The existing tests for grad, reverse grad, gradCheck, parallel loops, host kernels, CPU code
generation and Vite were rerun: eight test files and 241 tests passed during capability
inspection. The experiment also invokes grad and gradCheck on 30 actual MNIST logit-loss
points in each mode. This checks the supported derivative of the loss primitive against
both finite differences and explicit deltas. It does not claim whole-model automatic AD.

[0056](../../changes/0056-reverse-mode-grad.md) remains `accepted`. Scalar reverse AD and
CPU f32 scatter are implemented slices. GPU f32 scatter lowering, storage-array reverse AD,
derivative manifest plans and their runtime runner remain unfinished. The standalone
[probe-capabilities.mjs](probe-capabilities.mjs) records executable minimal reproductions,
expected `SD0118` refusals and the `TS8070` warning. These are unsupported forms, not newly
identified compiler bugs. No new AD system was added for this experiment.

## Computation responsibility and execution

| Stage              | TypeShade responsibility                                              | Independent check                                                                             | CPU run          | WebGPU run                                  |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------- |
| Forward            | All 784-element dot products and bias additions; 10 logits per sample | f64 logits, including nonzero offsets and short batches                                       | Generated f32 JS | `forward` compute entry                     |
| Softmax            | Maximum subtraction, exp and denominator                              | Large common offsets, finite results; probabilities checked through `delta * count + one_hot` | Generated f32 JS | `objective` compute entry                   |
| Loss               | Stable cross-entropy and per-batch mean                               | f64 cross-entropy and mean                                                                    | Generated f32 JS | `objective` and `reduce`                    |
| Backward           | All weight and bias gradients                                         | f64 explicit gradients and 34 finite-difference coordinates                                   | Generated f32 JS | `backward` compute entry                    |
| Gradient reduction | Serial sum across the batch in each parameter's invocation            | Same per-parameter f64 sum; batch-count normalization                                         | Generated f32 JS | Inside `backward`; one writer per parameter |
| SGD                | Direct in-place weight and bias updates                               | Independent parameter update                                                                  | Generated f32 JS | `update` compute entry                      |
| Evaluation         | Logits, argmax, losses and batch accuracy count                       | Pre/post accuracy and scalar reference                                                        | Generated f32 JS | `forward`, `objective`, `reduce`            |

Host TypeScript performs file loading, normalization, deterministic initialization, batch
selection and control. It combines batch evaluation totals into dataset-level metrics.
This is recorded as CPU evaluation bookkeeping; it does not replace forward, backward,
gradient reduction or optimization. There is no PyTorch, TensorFlow or ONNX Runtime path.

Each training batch has four compute dispatches: forward, objective, backward and update.
A full five-epoch run has 37,500 training dispatches (1,875 batches per epoch). Evaluation
adds compute reduction dispatches and reads two scalar statistics per batch. No CPU
reference function is called by the WebGPU training backend.

Execution classifications are explicit:

- **CPU-only training:** generated f32 CPU backend, zero CPU/GPU transfers.
- **All training kernels on WebGPU:** observed software WebGPU execution, no CPU fallback;
  hardware GPU training is not validated because only SwiftShader was available.
- **Entire training on a hardware GPU:** pending a run on a physical GPU adapter.
- **Partial GPU training with CPU learning operations:** not used in this experiment.

## Residency, transfers and synchronization

The original subset runner uploaded its complete dataset to a resident buffer. That design
would need 188,160,000 pixel bytes for the full training set, exceeding the device's default
128 MiB storage binding limit. The adapter advertised a 1 GiB limit, but the runtime-created
device used 134,217,728 bytes. Adapter limits are not device limits.

The updated runner keeps the entire dataset on the Node and browser **host**, using one
binary localhost transfer to the browser for each backend. It streams only the current
batch to two fixed-size resident input buffers. At batch size 32, those writes carry
100,352 pixel bytes and 128 label bytes. A short final evaluation batch is padded to the
same capacity and uses its actual count. There is no out-of-bounds or stale-row reduction.

Weights, bias, gradients, logits, deltas, losses and statistics retain their resident handles.
The update shader changes the resident parameters directly. There is no host tensor copy
between forward and backward, or between backward and update. Runtime batch uniforms are
uploaded for the relevant dispatches. A separate freshness probe measured 16 uploaded bytes
for a repeated reduction without readback and 24 bytes after reading statistics: an extra
8-byte statistics reupload. `Resident.read()` calls `sync()`, which marks the host copy fresh.
The next writable binding upload sends that host copy even when the shader overwrites it.
This is avoidable transfer overhead, not a correctness bug. In the full run this accounts for
11,249 extra uploads (89,992 bytes), in addition to input streaming, uniforms and first-use
storage uploads. Evaluation reads loss and correct-count scalars; final
reads retrieve weights and bias. The Node/browser setup transfer is not a GPU transfer. The full training backend observed
123,757 queue writes totaling 2,073,695,488 bytes and 11,252 readbacks totaling 121,400 bytes.
These include initial/epoch training-set evaluation and final parameter reads. Approximately
2.07 GB of input transfer is expected from five training passes plus six evaluation passes;
it is not a single upload of the 188.4 MB host dataset.

A two-batch resident reuse test observed **zero additional buffer allocations** after warmup
and **zero readbacks** across both training batches. It observed 165,984 live requested GPU
buffer bytes in that training-only probe. Estimated full tensor payload at batch size 32 is
165,976 bytes, including a statistics handle that the training-only probe does not bind.
Buffer counters track requested API sizes after pipeline creation, not physical VRAM.
Readback staging, uniforms and buffer lifetime are tracked separately from tensor payload.
The test checks that tracked live buffer bytes return to zero after destruction.

Every dispatch is currently submitted and awaited. This introduces four completion waits
per training batch. It makes stage timing and failure attribution clear, but it is not an
optimized training schedule. Existing `Frame` APIs can record several ordered dispatches
in one submission; a later performance experiment can compare batched submission without
changing the compiler. The browser bridge also adds one host preparation call per batch.

`Resident.write()` replaces a complete value and copies its host array. A public subrange
write could reduce host copying for larger buffers, but this example needs no Core change:
its batch-sized writes stay bounded and reuse the same GPU allocation. Uniform and tensor
buffers are reused; evaluation readback staging still requires runtime allocations.

## Numerical evidence and timing semantics

Stage and parameter comparisons use `abs(actual - expected) <= 2e-5 * (1 + abs(expected))`.
This is an absolute allowance of `2e-5` plus relative allowance of `2e-5`. It covers the 784
sequential f32 multiply/adds, exp/log implementation differences and accumulated updates.
It is a conservative test threshold, not a proof of a universal error bound or a cross-driver
bit-exact promise. Actual worst errors are retained instead of only pass/fail flags.

F64 stage comparisons use `1e-12 * (1 + abs(expected))`. Explicit backward checks perturb
24 deterministic weight coordinates and all 10 biases by `h = 1e-5`; the central-difference
threshold is `1e-7 * (1 + abs(expected))`. Perturbations and loss computation use f64, so the
check avoids differentiating quantized f32 parameter stores. Supported gradCheck tests use
its own `1e-7 * max(1, abs(difference))` threshold. Repeated CPU parameters must match exactly;
WebGPU repeats must pass the general tolerance. Observed repeat errors are recorded.

All reported stage and epoch timings are host wall time. Forward includes input preparation,
logits and softmax/loss. Backward includes parameter-gradient reduction. Epoch time excludes
training-set evaluation. Queue write timing measures CPU **enqueue cost**, not GPU transfer
completion. Map timing measures the asynchronous readback wait. Browser setup and per-batch
bridge times are reported separately and must not be added blindly to forward/epoch totals:
they overlap with those totals. Transfer counters include evaluation and uniforms.

The adapter exposes `timestamp-query`, but the default runtime device did not enable that
feature, and this experiment did not implement query instrumentation. No GPU kernel time or
physical VRAM measurement is claimed. Hardware, seed, dataset hashes, batch size, epochs,
tool versions and actual commands are retained with each result set.

## Findings and priorities

| Category                             | Evidence and actual behavior                                                                                                                                       | Expected capability / recommended direction                                                                                                                                  | Priority                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Compiler Bug                         | No new TypeShade compiler bug was identified. Correctness tests and capability probes pass with expected refusals.                                                 | Keep bug fixes separate; add a failing reproduction before any future compiler change.                                                                                       | No action                                       |
| Missing Language Feature             | No missing language feature blocks explicit softmax kernels. They use existing arrays, loops, exp/log and compute entries.                                         | Do not add Tensor/Layer/Optimizer language APIs for this example.                                                                                                            | No action                                       |
| Missing Backend Lowering             | `lowerKernel()` cannot lower shared-index f32 scatter. The probe emits `TS8070`; CPU tree handling is implemented.                                                 | Deliver the GPU f32 scatter slice of accepted 0056, with scratch-limit handling and differential evidence. MNIST's owner-per-parameter backward needs none.                  | P1 for automatic AD                             |
| Runtime Limitation                   | A host kernel can silently select a later allowed tier. Program-runtime WebGPU-only selection fails instead of using CPU. Default device features omit timestamps. | Require/record the execution tier in validation. Use an explicitly supplied feature-enabled device for a separate timestamp experiment.                                      | P0 for reporting; P2 for profiling              |
| Memory / Residency Limitation        | Default storage binding is 128 MiB; whole training pixels require 188.16 MB. `write()` replaces the entire resident value.                                         | Existing batch streaming solves this model. Consider optional subrange writes separately if measurements justify them.                                                       | Resolved for this model; P2 for large workloads |
| Automatic Differentiation Limitation | `gradReverse()` requires supported function parameters and differentiable return types; array, binding and void-entry probes produce `SD0118`.                     | Complete 0056 storage adjoints, memory/accumulation rules, derivative manifests and runtime plans. Keep explicit backward until those tests pass.                            | P1                                              |
| Performance Bottleneck               | Scalar dot-product loops, per-parameter serial batch sums, four synchronized submissions and browser transport.                                                    | Benchmark submission batching first, then tiled GEMM/workgroup reductions under existing APIs. Change lowering only after a distinct reproducible bottleneck is established. | P2                                              |
| Developer Experience Issue           | Compiler diagnostics, host-call behavior and adapter/device limits describe different layers. A successful call does not establish GPU use.                        | Provide reproducible tier/refusal reports and clear host/device memory accounting. This experiment supplies probes and reports without changing public APIs.                 | P0 for evidence                                 |

P0 means required validation/reporting and is handled here. P1 concerns automatic AD as a
future capability; it is not a dependency of explicit-backward training. P2 is a measured
performance follow-up. No new GitHub bug issue or compiler PR was opened because this task
found unsupported features and experiment bottlenecks, rather than a new Core defect.

## Executed full-data benchmark

All rows use 60,000/10,000 images, seed 123, batch 32, rate 0.1 and five epochs on main above.
CPU is generated f32 JavaScript. WebGPU is SwiftShader software rendering. The timings are
host wall time; shared-machine load and browser submission costs prevent hardware-speed claims.

| Epoch | CPU / WebGPU training loss | Training accuracy (both) | CPU epoch seconds | Software WebGPU epoch seconds |
| ----- | -------------------------- | -----------------------: | ----------------: | ----------------------------: |
| 1     | 0.33160464 / 0.33160465    |                  90.380% |             4.487 |                        25.630 |
| 2     | 0.30641759 / 0.30641759    |                  91.080% |             3.912 |                        25.559 |
| 3     | 0.29510682 / 0.29510683    |                  91.445% |             3.944 |                        26.379 |
| 4     | 0.28818098 / 0.28818100    |                  91.672% |             3.619 |                        26.661 |
| 5     | 0.28329244 / 0.28329244    |                  91.810% |             3.653 |                        31.843 |

Final test mean loss was 0.28669834 on both paths; final test accuracy was 91.67%.
CPU epoch-5 forward/backward/update host times were 1.278/1.822/0.551 seconds.
Software WebGPU epoch-5 times were 16.844/8.815/6.175 seconds. Its complete training-backend
transfer telemetry recorded 13.964 seconds of batch bridge/preparation calls, 0.558 seconds
of browser-host setup, 1.043 seconds of queue-write enqueue cost and 6.408 seconds of readback
map waits. These intervals overlap other reported times and are not GPU timestamp durations.

The full-data numerical runs preceded the final allocation/device metadata additions. The
compute shader and numerical loops did not change; the final reporting path was checked by
the additional small GPU, reuse, release and runner tests. The full-result record distinguishes
these measurement configurations rather than inventing an implementation commit for a run.
