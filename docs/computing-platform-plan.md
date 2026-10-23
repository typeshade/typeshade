# TypeShade as a general-purpose computation platform

> **Status:** Architecture direction and implementation audit for review. This is not an
> accepted change proposal, a new language rule, or a change to the 1.0 public API.
>
> **Baseline:** `typeshade/typeshade` `main`, commit
> [`fa8ac7f`](https://github.com/typeshade/typeshade/commit/fa8ac7fbaa1ca4e1aec12aa93ed8d6580c08d258),
> examined on 2026-10-10 (Asia/Seoul). Statements about current behavior apply to
> that revision. Source inspection is evidence of implemented code paths, not proof
> that unrun builds or device-specific performance checks passed.
>
> **Related documents:** [1.0 roadmap](roadmap.md),
> [developer-experience contract](dx.md),
> [runtime architecture](runtime-architecture.md),
> [original `"use typeshade"` phase plan](use-typeshade-plan.md).

## Purpose and boundary

TypeShade should let an ordinary TypeScript application **author, compile, run,
and verify high-performance computation** without treating the GPU as a second
application written in another language. Its unit of value is not the WGSL text
it emits, but the correctly executed and reusable computation behind an ordinary
TypeScript function call.

The intended boundary is broader than shader compilation and narrower than a
domain framework:

- **Compiler:** define supported TypeShade semantics; lower TypeScript into
  typed IR; prove or refuse transformations; optimize; differentiate; emit
  target code and capability requirements.
- **Execution planning (incremental, not a second compiler):** connect already
  compiled operations; track resource accesses and dependencies; plan transfers,
  temporary memory, dispatch batching, and _proven-safe_ fusion.
- **Runtime:** implement host calls, device/resource ownership, residency,
  transfers, scheduling, synchronization, compilation/pipeline caches, fallback
  choices, and observable failures.
- **Verification and tooling:** make compiler choices, target compatibility,
  numerical differences, transfer costs, and measured performance inspectable
  by humans and coding agents.
- **Consumers:** implement game objects, scene graphs, tensors, ML models,
  renderers, Gaussian splats, GIS data structures, FFT libraries, codecs, and
  application-specific scheduling outside TypeShade core.

This preserves [`docs/dx.md`](dx.md)'s "a language, not a domain" principle.
It does **not** authorize a game engine, AI framework, Python interpreter, or
cloud GPU service inside TypeShade.

## Public entry points: one stack, several levels of use

The user-facing default is an imported function from `*.shade.ts`. Host code
must not be required to spell WGSL, create bind groups, or assemble dispatches.
The call contract must, however, make asynchronous GPU readback observable.

| User                     | Surface                                                                  | Promise                                                              |
| ------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Application author       | Ordinary imported TypeShade-powered functions or a published npm library | Use results without learning GPU plumbing                            |
| Numerical/library author | Imported functions plus `resident()`                                     | Reuse device-side values across calls and read explicitly            |
| Engine author            | `typeshade/runtime`, `packModule()`, `reflect()`                         | Own frame/pass structure and interoperate with GPU resources         |
| Compiler/back-end author | Typed IR, passes, emitters, CPU oracle                                   | Extend targets and optimization under an explicit semantics contract |

A domain library should be able to publish a JavaScript/TypeScript API that
does not expose TypeShade as a required concept to its callers. A library
author who needs precise control can use the existing program runtime
without requiring ordinary users to use it. See [#335](https://github.com/typeshade/typeshade/issues/335).

## Current `main`: implementation evidence and limits

The labels distinguish **implemented**, **partial**, **proposal**, and
**not observed**. "Implemented" means the named source path is present and
implements the described scope; it is not a claim of universal device support
or a freshly executed test suite.

| Capability                                                                                       | Status at baseline                              | Evidence and boundary                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript opt-in, typed functions, modules, IR                                                  | Implemented                                     | `src/compiler/ts/`, `src/core/ir/nodes.ts`; GPU subset of TypeScript, not all JavaScript                                                                                                |
| WGSL, GLSL ES 3.00, CPU interpretation/codegen                                                   | Implemented                                     | `src/core/backend.ts`, `src/core/backends/`, `src/core/cpu-codegen.ts`                                                                                                                  |
| Loop independence proof and automatic kernel lowering                                            | Implemented, scoped                             | `src/core/passes/parallel-loop.ts`; accepts proven patterns and reports `TS8070` on refusals; it is not arbitrary loop parallelization                                                  |
| Per-function IR optimization                                                                     | Implemented                                     | `src/core/passes/opt/`; constants, DCE, CSE, GVN, LICM and related passes, not cross-call graph fusion                                                                                  |
| Resource layout and capability checks                                                            | Implemented                                     | `src/core/manifest-types.ts`, `src/core/backend.ts`, `reflect()`; target limits still differ                                                                                            |
| Import from an ordinary TS/Vite host                                                             | Implemented, scoped                             | `src/compiler/ts/host-face.ts` and `src/vite.ts`; does not establish a bundler-free Node GPU deployment                                                                                 |
| Device residency and host read/write                                                             | Implemented                                     | `src/core/resident.ts`; `read()`, whole-value `write()`, `destroy()`, ordered calls                                                                                                     |
| Partial resident writes                                                                          | Proposal                                        | `changes/0048-partial-buffer-write.md` is a draft; no current partial-write overload in `Resident`                                                                                      |
| Program runtime and render/compute passes                                                        | Implemented                                     | `src/runtime/runtime.ts`, `src/runtime/program.ts`; user journey `journeys/engine/engine.mjs` has shadow, scene and tone-map passes                                                     |
| WebGL2 compute                                                                                   | Implemented, target-specific                    | `src/core/gl-compute.ts` and `src/runtime/gl.ts` (change 0054); phased execution is not native WebGPU compute performance                                                               |
| Function-level forward/reverse autodiff                                                          | Implemented, scoped                             | `src/core/passes/grad.ts`, `src/core/passes/grad-reverse.ts`, `src/core/passes/grad-check.ts`; reverse function VJP and checkpointing exist                                             |
| Storage-array/kernel/entry reverse autodiff                                                      | Not yet delivered as one end-to-end public path | Accepted change `0056` describes the broader scope; current `gradReverse()` rejects array-valued differentiation parameters; `PackOptions` and `Pack` do not yet carry derivative plans |
| Source-level CPU debugging and deterministic-operation report                                    | Implemented                                     | `typeshade/debug`, `compile().determinism`, `scripts/gpu-differential.ts` (test harness, not caller-facing automatic divergence mode)                                                   |
| Cross-call execution graph, automatic cross-kernel fusion and temporary-buffer lifetime analysis | Not observed                                    | A sequential `kernelQueue` exists in `src/core/resident.ts`; call ordering is not a dependence-aware execution planner                                                                  |
| Caller-facing GPU/oracle divergence report                                                       | Not observed                                    | Roadmap item 19; differential tests exist, but no general user-facing first-divergence workflow                                                                                         |
| Real GPU pass timing                                                                             | Not observed                                    | [#542](https://github.com/typeshade/typeshade/issues/542), `timestamp-query` request                                                                                                    |
| `tshc` check/sync                                                                                | Implemented                                     | `src/cli/run.ts`; `build`, `inspect`, `profile` and `explain` are not present as shipped CLI commands                                                                                   |
| Bundler-free Node.js compiled-module execution                                                   | Not yet established                             | Vite host import works; a standalone Node build/load path needs a separate acceptance test                                                                                              |
| Wasm tier                                                                                        | Draft                                           | [#459](https://github.com/typeshade/typeshade/issues/459), `changes/0042-wasm-tier.md`; not a shipped fourth tier                                                                       |
| CUDA compiler/runtime backend                                                                    | Not observed                                    | Not an available target in `src/core/tiers.ts`; would require native host bindings and a target lowering                                                                                |
| Python code emitter/compiled module bridge                                                       | Not observed                                    | Treat readable Python translation and high-performance Python bindings as distinct products                                                                                             |

**Important distinction for change 0056:** its proposal front matter says
`accepted`. That means the design was accepted, **not** that every item in its
multi-slice implementation plan has shipped. The current tree does have
function-level reverse mode and `gradCheck`. Do not treat this as proof that
`grad` already differentiates full storage-array GPU training graphs. Track
the implemented slices and the manifest/runtime work separately.

**Important distinction for WebGL2:** change 0054 has code on `main`, so the
runtime is not accurately described as WebGPU-only or all compute as
CPU-only on WebGL2. Its phased implementation and per-feature limitations
still require measurement and fallback diagnostics.

**Important distinction for call fusion:** the row "Cross-call execution graph, automatic cross-kernel
fusion and temporary-buffer lifetime analysis" describes the baseline. Change 0058 delivered a first slice of
it for kernel-function calls after the baseline. The status note under P3 says what.

## Compiler, execution planner and runtime: strict responsibilities

### Compiler owns semantics

- Define supported TypeShade types, precision, value/reference semantics,
  address spaces, bounds, side effects, synchronization and determinism.
- Derive read/write/effect summaries on the **existing** IR.
- Prove loop independence and transformations; preserve the source's
  computation or report why a target or transformation is invalid.
- Optimize _inside_ functions; optionally specialize and transform them
  when the transformation has an explicit correctness contract.
- Provide forward/reverse AD for the scopes it actually supports; expand
  through separate tested slices, not by assuming arrays or kernels work.
- Emit target code, reflection, host layout and capability requirements.

A runtime must not silently reinterpret an unsupported shader construct
as arbitrary CPU JavaScript inside the same shader entry. An allowed
whole-call fallback must preserve the authored contract and be observable.

### Planner owns relations **between** operations

The planner should reference existing typed functions and their effect
summaries; it must not duplicate function bodies or invent a second type
system. A minimal future plan describes:

- operation identity and called function/entry;
- read and write access to resources (whole resource first; subranges later);
- true dependencies, side-effect barriers, target constraints;
- temporary storage lifetime and transfer edges.

Do not introduce a global scheduler before there is measured evidence from
several independent calls. Begin with correct ordering and one-device
command batching. Add resource reuse, safe fusion, asynchronous overlap and
cost-guided placement only when deterministic tests and benchmarks justify
each step. A global Promise queue preserves order but does not prove
independence or optimize it.

### Runtime owns execution

- Own and select execution tiers (default and explicit, with observable
  rejection/fallback and supported-feature checks).
- Create/cache GPU programs, pipelines, bind groups and resources.
- Provide one coherent `Resident` contract across call and program runtimes;
  specify read/write visibility, asynchronous completion, failures and
  destruction.
- Keep results on the device where possible. Avoid hidden downloads just
  to feed another GPU operation.
- Interoperate with external GPU buffers and textures where legal; state
  device ownership and transfer/copy requirements.
- Measure time and transfers; distinguish CPU wall time, queue wait and
  hardware GPU time. Never claim a cache-miss count or speedup without
  actual measurement.

A GPU buffer is **not** directly shared with Wasm linear memory merely by
using `SharedArrayBuffer`. A WebGPU-to-Wasm data transfer still needs
WebGPU's supported mapping/copy/synchronization path.

### Tooling makes results independently checkable

Expose stable machine-readable diagnostics: source span, target/tier,
supported feature or refusal, transform decision and reason. Separate
**static estimate**, **measured value** and **unknown**. Build agent
workflows around a bounded `compile -> verify -> profile -> compare`
loop, never around trusting an LLM's asserted correctness.

Prefer a lightweight, versioned report shape over a new agent-specific
programming language. Keep the human-readable diagnostic derivable from the
same facts.

## Multi-target model

The TypeShade IR should define computation, not be tied permanently to
WGSL spelling. Preserve GPU-stage constructs where they are meaningful;
lower them only when the target can preserve their meaning.

| Target              | Proposed role                                                        | Caveat                                                                             |
| ------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| WGSL/WebGPU         | Existing portable GPU path, browser and supporting Node hosts        | Native binding and browser feature availability vary                               |
| GLSL ES 3.00/WebGL2 | Existing compatibility path, including phased compute                | Not hardware-equivalent to WGSL                                                    |
| JavaScript/CPU      | Existing correctness fallback and oracle                             | Oracle f64 and run-layer f32 must be distinguished                                 |
| WebAssembly         | Future CPU tier, SIMD and Node/browser reuse                         | No implicit access to GPU memory; draft 0042                                       |
| CUDA                | Future NVIDIA-native GPU target                                      | CUDA/PTX codegen, native host runtime, memory/lifetime rules and validation needed |
| Python              | Future reference source emitter **or** wrapper over compiled modules | Pure Python emission does not accelerate GPU work                                  |

Target capability handling should distinguish **native**, **semantics-preserving
lowering/fallback**, and **unsupported**, and report the chosen path. A
backend's existence is not a guarantee that every TypeShade program
executes on it or produces bit-identical floats.

The existing `ModuleDecl` is the authoritative expression/function IR.
Before widening it, separate calculations, resource/effect facts and
target-only shader constructs conceptually. A future _execution plan_ is a
small layer **above** that IR, not a reason to rewrite it.

## Roadmap reconciliation

The existing [1.0 roadmap](roadmap.md) remains the near-term scope
authority. This document proposes **later** platform work; it does not
promote it into 1.0 by implication. The [phase plan](use-typeshade-plan.md)
predates shipped host and runtime features and must be read with this
current-state audit.

| Existing roadmap                              | Observed at baseline                                                                                                                                                                                                                                      | Next acceptance concern                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0.2 Compute, 0.3 TS surface, 0.4 Textures     | Broadly shipped; target-specific exceptions remain                                                                                                                                                                                                        | Compatibility coverage, not repeated implementation                |
| 0.5 Item 15 (parallel loop), 16 (host import) | Shipped via 0013/0009/0016; `resident` exists                                                                                                                                                                                                             | Stable calls, queue/fallback and fresh-package journey             |
| 0.6 Boundary B1-B3                            | Explicitly deferred by [#198](https://github.com/typeshade/typeshade/issues/198)                                                                                                                                                                          | Do not reintroduce one-file/two-worlds implicitly                  |
| 0.6 B4-B7                                     | Open work with [#452](https://github.com/typeshade/typeshade/issues/452), [#453](https://github.com/typeshade/typeshade/issues/453), [#454](https://github.com/typeshade/typeshade/issues/454), [#455](https://github.com/typeshade/typeshade/issues/455) | Host boundary clarity and target diagnostics                       |
| 0.7 Forward `grad` and `gradCheck`            | Present; function-level reverse is present too                                                                                                                                                                                                            | Broader 0056 GPU/storage differentiation, versioned manifest       |
| 0.7 Item 19 (development divergence)          | Differential _gate_ exists; general caller mode does not                                                                                                                                                                                                  | First differing operation/input with tolerance provenance          |
| DX X4 `explain`                               | Planned, not an available CLI                                                                                                                                                                                                                             | Tier/transfer/transform decision and estimate vs measurement       |
| 0.8 API surface/freeze                        | Planned                                                                                                                                                                                                                                                   | Publish scope and compatibility guarantees                         |
| "After 1.0" `#97` phases 3-6                  | Still long-term                                                                                                                                                                                                                                           | Introduce minimal access/effect plan first                         |
| 0.5 Item 15a (call fusion)                    | Pulled forward and shipped after the baseline by change 0058, for kernel-function calls on WebGPU; WebGL2 runs the calls apart                                                                                                                            | Hardware measurement, WebGL2 fusion, reuse across scopes           |
| "After 1.0" reverse `grad`                    | **Stale as a single row**                                                                                                                                                                                                                                 | Split delivered function VJP from unfinished kernel/array plan     |
| Long-term plan Phase 16/17/20                 | Marked not started in old plan; core pieces now exist                                                                                                                                                                                                     | Update plan status without retroactively declaring full goals done |

## Recommended work order: no invented deadline or version

The identifiers below are **prioritization suggestions**, not approval
of a new 1.0 scope or a schedule.

### P0 — Status reconciliation and testable contract

- Align the phase plan, roadmap and runtime docs with the actual code.
- Preserve an explicit list of 0056 accepted design vs shipped slices.
- Record `main` revisions and the device configurations for evidence.
- Keep existing tests and public API contracts authoritative.

**Acceptance:** each major feature links its source/test, has a known
backend coverage scope and does not claim a draft API shipped.

### P1 — Normal TypeScript and Node consumption

- Keep Vite host import as the working browser path.
- Design a bundler-independent Node output/load mechanism; test packed
  npm package, generated .js/.d.ts, deterministic manifest/compatibility,
  CPU fallback and an optional WebGPU-native host.
- Keep public calls consistent across hosts; reading device results
  remains asynchronous and never secretly blocks.

**Acceptance:** an unmodified TypeShade algorithm/library is consumed by
fresh Node and browser projects; a missing GPU produces an explicit
supported fallback or a documented refusal.

### P2 — Shared memory/resource contract

- Finish only an approved partial-write change (draft 0048 is not accepted).
- Derive access/effect summaries usable by call and program runtimes.
- Add resource ownership, buffer/texture views, lifetime and copy rules
  incrementally, with transfer visibility.

**Acceptance:** compute/render composition shares resources on one
device without unnecessary CPU readback; lifetime and stale-host tests
cover each supported tier.

### P3 — Thin cross-operation execution plan

- Build on the existing IR and effect tables rather than a second IR.
- Start with dependencies, command batching and temporary-resource reuse.
- Add fusion and scheduling only when proved safe; benchmark resource
  pressure, register usage, dispatch savings and latency.
- Continue reverse AD through storage/kernel/entry support separately
  from function VJP.

**Acceptance:** at least one multi-kernel workload has validated
equal results and measured improvement over unplanned execution;
failing cases explain why optimization did not occur.

**Status after the baseline.** Change 0058 delivered a first slice of P3 for kernel-function calls
(Rule 11.13, surface §71). `typeshade/fuse` records the calls of a scope with their whole-`Resident`
reads and writes, the dependencies between them and a barrier between groups, and runs them in one
submission. It fuses the calls that follow each other at the same index into one dispatch on WebGPU,
a reduction last among them, and holds an intermediate the host never reads as a local of the fused
entry, or as a buffer for the lifetime of the scope. Each call that stays apart has its reason in the
report, in the author's words. The arrays and results are the bits of the calls run apart, held by
`gate:differential` on generated chains and by the journeys. On a software adapter (SwiftShader) a
chain over scratch arrays took 0.56 to 0.93 of the time of the calls apart, and the map chain over
residents of 1,048,576 elements took 1.00 to 1.04 of it, so no hardware speedup is claimed. The change
answers two of the decisions below for kernel functions: the minimal resource-access summary is the
whole-`Resident` reads and writes with the proof's write-at-`i` and read-at-`i` facts, and a fusion
requires exact equality, with no declared tolerance. It does not fuse on WebGL2, plans no transfer and
reuses no buffer across scopes.

### P4 — Additional targets and interop

- Prioritize a defined Wasm numeric contract and its fallback tier
  through [#459](https://github.com/typeshade/typeshade/issues/459).
- Prototype CUDA on a representative kernel with a native Node bridge;
  do not promise automatic Tensor Core/hardware RT usage without a
  specific lowering and benchmark.
- Treat Python's readable code generator and compiled-module bindings
  as different deliverables.

**Acceptance:** fixed inputs, numerical tolerance, target capabilities,
memory transfers and measured cost are comparable across delivered
backends.

### P5 — Verification, profiling and agent feedback

- Begin structured `explain`/diagnostic reports as early as P1.
- Add GPU timestamp measurement per [#542](https://github.com/typeshade/typeshade/issues/542).
- Integrate CPU/GPU divergence mode without confusing test-only scripts
  for end-user automatic verification.
- Version output schemas, preserve source/IR mapping, report unknowns.

**Acceptance:** an agent can compile, check, measure and compare a bounded
optimization attempt and reject a wrong or unsupported change without
guessing about performance.

## Consumer-driven acceptance tests

Use at least four **external** consumers. Their domain abstractions
remain outside TypeShade:

| Consumer                                     | Shared infrastructure it tests                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Particle simulation plus multi-pass renderer | Long-lived residency, compute -> draw, resource ownership and scheduling                                                                          |
| Gaussian splatting/inverse rendering         | Sorting, scatter/reduce, reverse AD, gradient storage, memory pressure and validation                                                             |
| Image/scientific batch pipeline              | Transfer overhead, streaming, fusion, CPU/Wasm fallback and Node/browser packaging                                                                |
| **MNIST digit-classification training**      | Batched linear algebra, loss/reduction, backward gradients, optimizer updates, weight residency, cross-tier correctness and repeatable benchmarks |

### MNIST as a staged training acceptance case

Use the original MNIST handwriting dataset (28 x 28 grayscale pixels, ten
classes, 60,000 training and 10,000 test examples). Its loader, model,
loss, training loop and optimizer belong in a separate example or
consumer package, **not** the TypeShade compiler/runtime. The journey
[`journeys/mnist/`](../journeys/mnist/README.md) is such an example: it
lives in this repository as a test, and nothing under `src/` depends on it.
Keep dataset downloads optional and external; record origin, preprocessing,
train/test split, random seeds and version information rather than
committing dataset binaries. A model should not see its test examples
during training.

**Status after the baseline.** Two pull requests merged after `fa8ac7f`:
[#555](https://github.com/typeshade/typeshade/pull/555) (commit `b43fbb36`)
and [#559](https://github.com/typeshade/typeshade/pull/559) (commit
`946b0ea7`). [`journeys/mnist/REPORT.md`](../journeys/mnist/REPORT.md)
records their results:

- Stages 1 to 3 below are met for the softmax-regression model on the CPU
  tier and on software WebGPU (SwiftShader).
- Five epochs on the full dataset (batch 32, rate 0.1, seed 123) raised test
  accuracy from 11.28% to 91.67% on both tiers. Mean training loss fell from
  2.30658388 to 0.28329244.
- The largest weight difference was 3.42490e-6 between the CPU tier and the
  f64 reference, and 7.74860e-7 between WebGPU and the CPU tier.
- Hardware GPU training is not validated: the only adapter was SwiftShader.
- Stages 4 and 5 are open. Stage 4 waits on change 0056's storage-array
  reverse mode, manifest plan and runner.

The report also records runtime findings that belong to P2 in this plan.
The device that the runtime requests keeps the default 128 MiB storage
binding limit, although the adapter advertises 1 GiB (draft 0051).
A `Resident.read()` makes the next writable binding upload the host copy
again. Every dispatch is submitted and awaited, except the dispatches of a `fuse` scope (change 0058),
which share one submission.

1. **CPU reference and inference.** Start with a 784-to-10 softmax
   regression classifier. Compare its logits and stable log-softmax /
   cross-entropy against an ordinary TypeScript reference for fixed
   inputs and weights. Define numerical tolerances, including the loss
   reduction order; record any target's precision limitations.
2. **Explicit end-to-end training.** Implement mini-batch forward,
   loss, backward and SGD with TypeShade kernels while the host owns
   dataset ingestion and epoch control. Initial backward kernels may be
   written explicitly until storage-array/compute-entry reverse AD is
   actually shipped; do **not** present the current function-only
   `grad()` as full model training. Keep weights and batch scratch
   resident where supported; log GPU transfers and synchronization.
3. **Convergence and differential checks.** Test individual operations
   and sampled gradients against the CPU reference or central finite
   differences. Require loss to decrease on a fixed small training set,
   finite weights/gradients throughout, reproducible seeds and
   measured held-out test accuracy. Establish any numeric accuracy
   threshold from a measured CPU baseline, not a guessed benchmark.
4. **Automatic differentiation integration.** Once change 0056 ships
   its storage/compute-entry gradient and manifest/runtime plan,
   replace the authored backward implementation with compiler-generated
   derivatives. Compare gradient components, training curves, transfer
   counts and memory limits under the same data and seed.
5. **Model and target expansion.** Train a small MLP
   (for example 784 -> 128 -> 10) on supported tiers. Report
   correctness and performance **separately** for CPU, WebGPU, WebGL2,
   and future Wasm/CUDA where available. Do not assume all targets
   can efficiently execute the same graph, or silently count CPU
   fallback as GPU training.

**Acceptance:** the TypeShade-based consumer completes multiple
mini-batch updates, shows verified loss reduction and model improvement
over its untrained baseline, reports CPU-reference numerical differences
and backend/tier choice, and attributes measured time to the appropriate
operations. This tests the ability to _train_, not merely to load
MNIST and run inference. A separate performance report should state
host and GPU timings, transfers, memory footprint, hardware and
runtime configuration. No speedup claim is valid without these
measurements.

This acceptance case exercises the existing [#535](https://github.com/typeshade/typeshade/issues/535)
/ [change 0056](../changes/0056-reverse-mode-grad.md) without
requiring a built-in `Tensor` class or a neural-network framework
inside TypeShade.

A stable key/value sort belongs in a reusable kernel package unless
evidence demonstrates it must be a compiler/runtime primitive; see
[#539](https://github.com/typeshade/typeshade/issues/539).
Algorithm implementations, optimizers for an ML model, ECS, scene
management, decode/UI and author-specific workflows belong to their
libraries.

## Research workbench: reproducing a paper

The test of this use is simple. A researcher moves a paper's computation
into TypeShade functions and checks it on the CPU. The researcher then runs
the **same algorithm** on WebGPU, and later on Wasm or CUDA.

1. Identify the equations, value types, assumptions and boundary conditions.
2. Write the TypeShade functions and kernels.
3. Check small inputs against the oracle. Use `gradCheck` where a derivative is involved.
4. Run on the GPU or Wasm tier and check the result within a stated tolerance.
5. Record the operation count, memory, GPU time, device, compile options, versions and inputs.
6. Compare correctness and measured performance separately, before and after each optimization.

Candidate cases are particle simulation, large image filters, and inverse
problems such as Gaussian splatting that need derivatives, sorting and
scatter. Each case is an external consumer and an acceptance test of the
core. None of them is a reason for a domain-specific core API.

## Agent experience

The value for a coding agent is not that TypeShade syntax is easy to guess.
The value is that TypeShade checks an agent's code independently of the
agent.

- Public types, memory layouts, input change contracts and target
  capabilities are machine-readable.
- A compile failure is a structured diagnostic: code, cause, source span,
  rule and a remedy an agent can apply.
- `explain` says where a call runs, why that target was chosen, which memory
  moves, and why a loop was not parallelized.
- A performance report keeps static estimates apart from measured GPU values.
  A number with no measurement behind it is not reported.
- The loop is compile, then oracle, differential or gradient check, then
  profile, then compare, then accept, fix or roll back. Each loop has an
  execution budget and a regression criterion, not an unbounded search.
- The manifest, the CLI and their JSON come first. An MCP server or a harness
  for one agent can be a separate consumer package.
- The compiler and the tests do the checking. No claim says that a model's
  own reasoning verifies a program.

`tshc analyze`, `tshc explain`, `tshc verify`, `tshc profile` and
`tshc diff` are proposed command names only. The shipped CLI has `check`, `sync`
and explicit Vite project initialization with `init` (`src/cli/run.ts`, change 0085).

## Future workloads and their technical limits

- **On-device AI:** residency, model loading, reductions and matrix products,
  quantization, mixed precision and a memory budget matter most. Tensor-core
  use is an optional per-target optimization.
- **Browser games and renderers:** compute-to-render resource sharing on the
  GPU, frame and pass composition, and resource lifetimes matter most.
  Ray tracing and BVH construction belong to a renderer. TypeShade supplies
  general computation and the resource contract. Nothing here assumes
  hardware ray tracing in a browser.
- **Cryptography:** integer and bit operations and verifiable parallel
  arithmetic are needed. Fast GPU execution does not make an implementation
  confidential or free of side channels.
- **VFX and radiance fields:** camera pose estimation, segmentation, training,
  rendering, materials and simulation are different workloads. Together
  they test whether one runtime is reusable.
- **GIS and maps:** wide coordinate ranges, tiles and geometry, and rendering
  in one TypeScript application test precision and composition.

A hardware-specific feature is exposed only when the browser standard, its
implementations and real devices support it. This plan does not assume that
WebGPU will expose CUDA tensor cores or hardware ray tracing.

## Existing issues and change records

These already represent parts of the scope. Link to them before
creating overlapping new issues:

- [#97](https://github.com/typeshade/typeshade/issues/97):
  CPU/GPU boundary management; B1-B3 deferred by
  [#198](https://github.com/typeshade/typeshade/issues/198).
- [#204](https://github.com/typeshade/typeshade/issues/204),
  [#335](https://github.com/typeshade/typeshade/issues/335):
  render passes, multiple entry points and program runtime.
- [#459](https://github.com/typeshade/typeshade/issues/459)
  / [change 0042](../changes/0042-wasm-tier.md): Wasm tier proposal.
- [#535](https://github.com/typeshade/typeshade/issues/535)
  / [change 0056](../changes/0056-reverse-mode-grad.md):
  reverse AD and storage/kernel expansion.
- [#539](https://github.com/typeshade/typeshade/issues/539):
  stable key/value sort.
- [#542](https://github.com/typeshade/typeshade/issues/542):
  hardware GPU timing.
- [change 0048](../changes/0048-partial-buffer-write.md):
  resident partial writes (draft).
- [change 0054](../changes/0054-webgl2-compute.md):
  WebGL2 compute (accepted with implementation paths present).

## Decisions still open

This document recommends constraints and priorities but does **not**
silently decide them:

- Should a standalone Node host compile on installation, at package
  build time, or support both through a stable generated manifest?
- What is the minimal resource-access summary that is safe without a
  general pointer/alias analysis?
- How is asynchronous host-call completion typed across CPU, Wasm and
  GPU, especially for plain arrays versus `Resident`?
- Which plan transformations require exact equality and which accept
  user-declared numerical tolerances?
- Does large-data reverse-mode training require a more explicit
  graph-level gradient memory model before broad auto-differentiation?
- How much driver-specific specialization belongs in target backends
  versus independent optimization passes?

Keep proposed public API and language changes under
[`changes/README.md`](../changes/README.md)'s approval process.
This document changes no public export, language rule, numbered surface
section, diagnostic code or example set.
