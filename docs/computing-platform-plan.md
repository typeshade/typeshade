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
  temporary memory, dispatch batching, and *proven-safe* fusion.
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

| User | Surface | Promise |
| --- | --- | --- |
| Application author | Ordinary imported TypeShade-powered functions or a published npm library | Use results without learning GPU plumbing |
| Numerical/library author | Imported functions plus `resident()` | Reuse device-side values across calls and read explicitly |
| Engine author | `typeshade/runtime`, `packModule()`, `reflect()` | Own frame/pass structure and interoperate with GPU resources |
| Compiler/back-end author | Typed IR, passes, emitters, CPU oracle | Extend targets and optimization under an explicit semantics contract |

A domain library should be able to publish a JavaScript/TypeScript API that
does not expose TypeShade as a required concept to its callers. A library
author who needs precise control can use the existing program runtime
without requiring ordinary users to use it. See [#335](https://github.com/typeshade/typeshade/issues/335).

## Current `main`: implementation evidence and limits

The labels distinguish **implemented**, **partial**, **proposal**, and
**not observed**. "Implemented" means the named source path is present and
implements the described scope; it is not a claim of universal device support
or a freshly executed test suite.

| Capability | Status at baseline | Evidence and boundary |
| --- | --- | --- |
| TypeScript opt-in, typed functions, modules, IR | Implemented | `src/compiler/ts/`, `src/core/ir/nodes.ts`; GPU subset of TypeScript, not all JavaScript |
| WGSL, GLSL ES 3.00, CPU interpretation/codegen | Implemented | `src/core/backend.ts`, `src/core/backends/`, `src/core/cpu-codegen.ts` |
| Loop independence proof and automatic kernel lowering | Implemented, scoped | `src/core/passes/parallel-loop.ts`; accepts proven patterns and reports `TS8070` on refusals; it is not arbitrary loop parallelization |
| Per-function IR optimization | Implemented | `src/core/passes/opt/`; constants, DCE, CSE, GVN, LICM and related passes, not cross-call graph fusion |
| Resource layout and capability checks | Implemented | `src/core/manifest-types.ts`, `src/core/backend.ts`, `reflect()`; target limits still differ |
| Import from an ordinary TS/Vite host | Implemented, scoped | `src/compiler/ts/host-face.ts` and `src/vite.ts`; does not establish a bundler-free Node GPU deployment |
| Device residency and host read/write | Implemented | `src/core/resident.ts`; `read()`, whole-value `write()`, `destroy()`, ordered calls |
| Partial resident writes | Proposal | `changes/0048-partial-buffer-write.md` is a draft; no current partial-write overload in `Resident` |
| Program runtime and render/compute passes | Implemented | `src/runtime/runtime.ts`, `src/runtime/program.ts`; user journey `journeys/engine/engine.mjs` has shadow, scene and tone-map passes |
| WebGL2 compute | Implemented, target-specific | `src/core/gl-compute.ts` and `src/runtime/gl.ts` (change 0054); phased execution is not native WebGPU compute performance |
| Function-level forward/reverse autodiff | Implemented, scoped | `src/core/passes/grad.ts`, `src/core/passes/grad-reverse.ts`, `src/core/passes/grad-check.ts`; reverse function VJP and checkpointing exist |
| Storage-array/kernel/entry reverse autodiff | Not yet delivered as one end-to-end public path | Accepted change `0056` describes the broader scope; current `gradReverse()` rejects array-valued differentiation parameters; `PackOptions` and `Pack` do not yet carry derivative plans |
| Source-level CPU debugging and deterministic-operation report | Implemented | `typeshade/debug`, `compile().determinism`, `scripts/gpu-differential.ts` (test harness, not caller-facing automatic divergence mode) |
| Cross-call execution graph, automatic cross-kernel fusion and temporary-buffer lifetime analysis | Not observed | A sequential `kernelQueue` exists in `src/core/resident.ts`; call ordering is not a dependence-aware execution planner |
| Caller-facing GPU/oracle divergence report | Not observed | Roadmap item 19; differential tests exist, but no general user-facing first-divergence workflow |
| Real GPU pass timing | Not observed | [#542](https://github.com/typeshade/typeshade/issues/542), `timestamp-query` request |
| `tshc` check/sync | Implemented | `src/cli/run.ts`; `build`, `inspect`, `profile` and `explain` are not present as shipped CLI commands |
| Bundler-free Node.js compiled-module execution | Not yet established | Vite host import works; a standalone Node build/load path needs a separate acceptance test |
| Wasm tier | Draft | [#459](https://github.com/typeshade/typeshade/issues/459), `changes/0042-wasm-tier.md`; not a shipped fourth tier |
| CUDA compiler/runtime backend | Not observed | Not an available target in `src/core/tiers.ts`; would require native host bindings and a target lowering |
| Python code emitter/compiled module bridge | Not observed | Treat readable Python translation and high-performance Python bindings as distinct products |

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

## Compiler, execution planner and runtime: strict responsibilities

### Compiler owns semantics

- Define supported TypeShade types, precision, value/reference semantics,
  address spaces, bounds, side effects, synchronization and determinism.
- Derive read/write/effect summaries on the **existing** IR.
- Prove loop independence and transformations; preserve the source's
  computation or report why a target or transformation is invalid.
- Optimize *inside* functions; optionally specialize and transform them
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

| Target | Proposed role | Caveat |
| --- | --- | --- |
| WGSL/WebGPU | Existing portable GPU path, browser and supporting Node hosts | Native binding and browser feature availability vary |
| GLSL ES 3.00/WebGL2 | Existing compatibility path, including phased compute | Not hardware-equivalent to WGSL |
| JavaScript/CPU | Existing correctness fallback and oracle | Oracle f64 and run-layer f32 must be distinguished |
| WebAssembly | Future CPU tier, SIMD and Node/browser reuse | No implicit access to GPU memory; draft 0042 |
| CUDA | Future NVIDIA-native GPU target | CUDA/PTX codegen, native host runtime, memory/lifetime rules and validation needed |
| Python | Future reference source emitter **or** wrapper over compiled modules | Pure Python emission does not accelerate GPU work |

Target capability handling should distinguish **native**, **semantics-preserving
lowering/fallback**, and **unsupported**, and report the chosen path. A
backend's existence is not a guarantee that every TypeShade program
executes on it or produces bit-identical floats.

The existing `ModuleDecl` is the authoritative expression/function IR.
Before widening it, separate calculations, resource/effect facts and
target-only shader constructs conceptually. A future *execution plan* is a
small layer **above** that IR, not a reason to rewrite it.

## Roadmap reconciliation

The existing [1.0 roadmap](roadmap.md) remains the near-term scope
authority. This document proposes **later** platform work; it does not
promote it into 1.0 by implication. The [phase plan](use-typeshade-plan.md)
predates shipped host and runtime features and must be read with this
current-state audit.

| Existing roadmap | Observed at baseline | Next acceptance concern |
| --- | --- | --- |
| 0.2 Compute, 0.3 TS surface, 0.4 Textures | Broadly shipped; target-specific exceptions remain | Compatibility coverage, not repeated implementation |
| 0.5 Item 15 (parallel loop), 16 (host import) | Shipped via 0013/0009/0016; `resident` exists | Stable calls, queue/fallback and fresh-package journey |
| 0.6 Boundary B1-B3 | Explicitly deferred by [#198](https://github.com/typeshade/typeshade/issues/198) | Do not reintroduce one-file/two-worlds implicitly |
| 0.6 B4-B7 | Open work with [#452](https://github.com/typeshade/typeshade/issues/452), [#453](https://github.com/typeshade/typeshade/issues/453), [#454](https://github.com/typeshade/typeshade/issues/454), [#455](https://github.com/typeshade/typeshade/issues/455) | Host boundary clarity and target diagnostics |
| 0.7 Forward `grad` and `gradCheck` | Present; function-level reverse is present too | Broader 0056 GPU/storage differentiation, versioned manifest |
| 0.7 Item 19 (development divergence) | Differential *gate* exists; general caller mode does not | First differing operation/input with tolerance provenance |
| DX X4 `explain` | Planned, not an available CLI | Tier/transfer/transform decision and estimate vs measurement |
| 0.8 API surface/freeze | Planned | Publish scope and compatibility guarantees |
| "After 1.0" `#97` phases 3-6, call fusion | Still long-term | Introduce minimal access/effect plan first |
| "After 1.0" reverse `grad` | **Stale as a single row** | Split delivered function VJP from unfinished kernel/array plan |
| Long-term plan Phase 16/17/20 | Marked not started in old plan; core pieces now exist | Update plan status without retroactively declaring full goals done |

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

Use at least three **external** consumers. Their domain abstractions
remain outside TypeShade:

| Consumer | Shared infrastructure it tests |
| --- | --- |
| Particle simulation plus multi-pass renderer | Long-lived residency, compute -> draw, resource ownership and scheduling |
| Gaussian splatting/inverse rendering | Sorting, scatter/reduce, reverse AD, gradient storage, memory pressure and validation |
| Image/scientific batch pipeline | Transfer overhead, streaming, fusion, CPU/Wasm fallback and Node/browser packaging |

A stable key/value sort belongs in a reusable kernel package unless
evidence demonstrates it must be a compiler/runtime primitive; see
[#539](https://github.com/typeshade/typeshade/issues/539).
Algorithm implementations, optimizers for an ML model, ECS, scene
management, decode/UI and author-specific workflows belong to their
libraries.

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
