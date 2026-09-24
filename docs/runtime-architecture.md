# TypeShade Runtime Architecture

> Status: design direction
>
> This document records the architecture discussed for the next layer above the TypeShade compiler. It is not a commitment to a final public API.

## 1. The problem

TypeShade already provides a GPU-oriented TypeScript source language:

`"use typeshade"` opts a TypeScript source file into the TypeShade compiler. The compiler lowers that source into TypeShade IR and can emit WGSL, GLSL ES 3.00, CPU evaluation, and reflection.

That is deliberately smaller than a graphics framework. Today, the host application still owns the device, resources, pipelines, bindings, command encoding, dispatch and readback.

The next question is therefore not "how do we put WebGPU inside `use typeshade`?" It is:

> How can an ordinary TypeScript application import and use a TypeShade program without turning the language into a renderer framework or forcing every caller to assemble low-level GPU objects?

## 2. The user problem comes first

The central design question is not:

> How do we execute a `use typeshade` function?

It is:

> **How can a developer build a real application whose CPU and GPU parts are written as one coherent TypeScript program?**

This distinction matters because TypeShade is intended to be useful for programs larger than isolated shaders.

Consider rebuilding a map engine such as MapLibre from scratch with TypeScript and TypeShade. The application contains:

```
Map
├── Camera
├── Map state
├── Sources
├── Tiles
├── Styles
├── Geometry
├── Symbol placement
├── Collision
└── Renderer
```

Those responsibilities naturally span both CPU and GPU execution:

```
CPU                              GPU
────────────────────────────────────────
Map state                        projection
Camera                            vertex processing
Network                           geometry processing
Tile management                   collision
Style parsing                     rasterization
Event handling                    fragment processing
Application logic                 parallel computation
```

The developer does not want to build two unrelated programs and manually connect them through WebGPU plumbing. They want to build **one application**, while making the CPU/GPU execution boundary explicit enough to understand.

This gives TypeShade a stronger product definition:

> **TypeShade should make CPU + GPU applications possible to author as one TypeScript-centered program, with `"use typeshade"` defining the GPU-program boundary.**

The compiler, runtime and backend are implementation layers in service of that programming model.

### The long-term goal: GPU should disappear from the application model

The runtime should ultimately make GPU execution an implementation detail of a TypeScript application without making GPU semantics invisible in the language.

The distinction is important:

- `"use typeshade"` remains the explicit boundary for code whose semantics are governed by TypeShade;
- the runtime owns device selection, resource lifetime, residency, synchronization, pipeline creation and backend plumbing;
- the application should normally express operations and data flow rather than construct GPU API objects;
- compiler analysis may determine which operations can use a GPU representation, but automatic placement is a later optimization and must not silently change the language semantics.

The desired end state is therefore not:

```
TypeScript -> shader source -> WebGPU plumbing
```

but:

```
TypeScript application
        |
        | TypeShade program boundary
        v
TypeShade IR / runtime
        |
   +----+----+
   |         |
  CPU       GPU
   |         |
   +----+----+
        |
      result
```

A developer should be able to care about the operation being performed and the correctness of its result without manually managing the GPU objects required to execute it.

This does **not** mean that arbitrary TypeScript is implicitly promoted to GPU execution. TypeShade must retain a strong semantic boundary. Automatic CPU/GPU placement, when introduced, is an optimization over code that has already entered the TypeShade execution model and whose semantics can be preserved.

### Verification is part of the runtime experience

The existing CPU evaluator should become more than a compiler test helper. It is a foundation for development-time verification:

```
                 TypeShade program
                       |
              +--------+--------+
              |                 |
           CPU oracle        GPU execution
              |                 |
              +--------+--------+
                       |
                    compare
                       |
              source-level trace
```

Where the runtime can compare a CPU oracle with GPU execution, diagnostics should eventually identify the invocation, relevant source span and observed difference rather than only reporting a backend mismatch. This should be a development/debugging capability, not a promise that every GPU operation has an efficient or bit-identical CPU implementation.

### IR is also the extensibility boundary

The same IR that enables multiple backends can eventually support program transformations such as differentiation, specialization and optimization. Automatic differentiation is therefore a possible future consumer of the compiler architecture, not a reason to add a high-level autodiff API before the IR semantics are mature.

A useful long-term progression is:

```
TypeShade source
      |
      v
     IR
   / |  \\
  /  |   \\
CPU GPU  future transforms
 |   |       |
oracle exec  autodiff / optimization
```

The immediate priority remains a reliable host/runtime boundary. These future transformations should be driven by real workloads and concrete IR requirements rather than frozen into the public API early.

### What the developer should think about

The developer should think about application concepts:

- maps and cameras;
- simulations and state;
- geometry and data processing;
- image and signal processing;
- rendering;
- interaction and application logic.

They should not have to make GPU API mechanics the primary abstraction:

- `GPUDevice`;
- bind-group construction;
- pipeline layout construction;
- command encoders;
- queue submission.

Those mechanisms are runtime/backend responsibilities unless the developer explicitly chooses the low-level escape hatch.

### What `"use typeshade"` means at the application level

`"use typeshade"` is more than an instruction to emit WGSL or GLSL.

It identifies a TypeScript-authored region whose **execution semantics are GPU semantics**.

For example:

```ts
class Map {
  // ordinary TypeScript / host-side application logic
}
```

and:

```ts
"use typeshade";

class Tile {
  // TypeScript syntax with TypeShade GPU semantics: a struct the GPU lays out
  origin: vec2;
  zoom: f32;
}
```

can be parts of the same application while representing different execution domains.

The goal is not to erase that distinction. The goal is to make the distinction useful without forcing developers to manually manage every backend detail.

### GPU classes are part of this model

GPU classes already exist in TypeShade. The architectural question is therefore not how to invent GPU classes, but how GPU classes participate in a larger CPU + GPU application.

A host-side class may own, control or coordinate GPU state represented by a TypeShade class:

```
CPU application object
        |
        | owns / controls
        v
GPU module or GPU value
```

The exact host representation is still open. What matters is that CPU classes do not silently become GPU classes, and GPU classes do not silently execute as ordinary CPU classes.

### A real library is the capability test

The strongest validation of this architecture is not that a small shader can compile. It is that a developer can build a **useful, reusable TypeScript library** whose implementation spans CPU and GPU execution.

For example, ViewShade can serve as a flagship consumer of TypeShade. A map-oriented workload can combine:

- tile requests and source management;
- spatial indexing and geometry preparation;
- GPU rendering and parallel processing;
- tile caching and GPU residency;
- progressive refinement;
- incremental pyramid generation; and
- standard tiled image output that existing clients can consume.

The important property is that this is one library, not a collection of unrelated CPU code and hand-written WebGPU programs:

```
ViewShade
├── request planner
├── source tile cache
├── GPU rendering
├── progressive refinement
├── pyramid generation
└── standard tile output
        |
        v
   TypeShade runtime
        |
        v
   TypeShade GPU programs
```

The same principle should apply outside mapping. A numerical library, image-processing library, simulation engine, geometry processor, or other GPU-accelerated library should be buildable on the same foundation.

This leads to a practical acceptance criterion:

> **If a useful TypeScript library cannot be built cleanly with TypeShade, the solution is not complete merely because the underlying shader compiler works.**

The library should not need to expose TypeShade or WebGPU as part of its public API unless that is intentionally part of the library's purpose. Typeshade should be an implementation technology that enables the library to provide a high-level developer experience.

This also changes how runtime work should be evaluated. Features should be prioritized when they enable real application/library capabilities such as GPU-resident data, module composition, execution, synchronization, caching, and CPU/GPU interoperability—not simply because they expose another piece of the underlying GPU API.

### A concrete design test

Every proposed language or runtime feature should be evaluated against a real application such as a MapLibre-scale map engine:

> If a developer were rebuilding this application from scratch, does this feature make it easier to express the program and its CPU/GPU relationship?

If a proposal primarily exposes WebGPU plumbing without improving that programming model, it should remain a lower-level escape hatch rather than becoming a core TypeShade abstraction.

## 2. Current state and target state

### Current state

The compiler is the center of the project today:

```
TypeScript source
      |
      | "use typeshade"
      v
TypeShade compiler
      |
      +-- TypeShade IR
      +-- WGSL
      +-- GLSL ES 3.00
      +-- CPU evaluation
      +-- reflection
```

The repository also contains a lower-level programmatic/IR-oriented authoring surface used by compiler tests and examples. That is useful infrastructure, but it is not the intended product-level mental model. The product-facing direction starts from `"use typeshade"`.

A further limitation today is that `.shade.ts` is not yet a normal importable TypeScript module. Examples are compiled through the compiler rather than imported and executed like ordinary host modules. A future host integration therefore needs a module/loader boundary in addition to a runtime.

### Target state

The long-term goal is to let an ordinary TypeScript application consume a compiled TypeShade module without making the TypeShade language itself responsible for application orchestration.

The target is not:

```
TypeScript -> magic GPU execution
```

It is:

```
ordinary TypeScript
       |
       | explicit host-side ownership
       v
TypeShade runtime
       |
       v
compiled TypeShade module
       |
       v
GPU backend
```

## 3. The architectural split

The intended layering is:

```
ordinary TypeScript
       |
       | host application
       v
TypeShade runtime
       |
       +-- device
       +-- GPU values/resources
       +-- module handles
       +-- dispatch / invocation
       +-- synchronization / residency
       |
       v
TypeShade compiler
       |
       +-- TypeScript AST + type information
       +-- TypeShade IR
       +-- reflection / metadata
       |
       +-- WGSL
       +-- GLSL ES 3.00
       +-- CPU oracle
       |
       v
backend
  WebGPU / WebGL2 / future targets
```

The compiler and runtime have different jobs:

- **Compiler:** define and compile the GPU programming model.
- **Runtime:** make compiled programs callable from ordinary TypeScript.
- **Backend:** translate runtime operations to a concrete execution API.

A runtime must not redefine the language, and `use typeshade` must not become a place for application or renderer orchestration.

## 4. What `use typeshade` means

A `"use typeshade"` source file is a TypeShade program.

For example:

```ts
"use typeshade";

class Particle {
  position: vec3;
  velocity: vec3;
}

@compute([64, 1, 1])
export function update(/* GPU inputs */) {
  // GPU program
}
```

The `class` above is already a GPU class. It is not a normal JavaScript/CPU class with an annotation.

This distinction must remain visible in the language model.

The following do **not** belong inside `use typeshade` merely to make the runtime convenient:

- application classes
- canvas ownership
- renderer objects
- WebGPU/WebGL context setup
- pipeline builder objects
- command encoders
- UI lifecycle
- application state management

Those are host/runtime concerns.

## 5. The host-side goal

The desired experience is closer to importing an ordinary TypeScript module:

```ts
import { Simulation } from "./simulation.shade"

const device = await typeshade.device()

const simulation = device.create(Simulation)

simulation.update(dt)
```

This is a direction, not a frozen API.

The important property is the boundary:

```
CPU TypeScript
      |
      | call / transfer
      v
GPU program
```

The runtime may manage pipelines, bind groups, queues, resource layouts and caching internally. The caller should not have to reconstruct compiler reflection by hand for normal use.

The raw compiler/reflection path remains available for applications that need direct WebGPU/WebGL control.

The first half of this exists (change 0009, surface §64): `import { height } from "./terrain.shade.ts"` in an ordinary host file, through the `typeshade/vite` plugin, and `height([0.5, 0.5], k)` runs the module's function on the CPU tier at `f32`, with no device. The first GPU call exists too (change 0016, surface §67): an imported `@compute` entry is `await entry(bindings, workgroups)`, which `typeshade/runtime` dispatches on a device it requests itself, and a fragment entry drawn into a canvas is the rest of the second half of roadmap item 16.

## 6. Why Numba is useful

Numba demonstrates a valuable rule: GPU execution should remain distinguishable from CPU execution.

Its CUDA model has an explicit host-to-kernel relationship:

```
host code
   |
   | launch
   v
GPU kernel
```

This is useful for TypeShade because it prevents a runtime from making GPU execution look indistinguishable from ordinary synchronous CPU execution.

TypeShade should therefore automate repetitive GPU setup without pretending that the GPU is the CPU.

The exact amount of explicit dispatch syntax is still an open design question.

## 7. Why PyTorch is useful

PyTorch demonstrates a different part of the problem: a device/runtime abstraction can make device-resident values useful from ordinary host code.

The reusable idea is not PyTorch's tensor API itself. It is the separation:

```
host object
   |
   +-- value / resource identity
   +-- device
   +-- backend implementation
   +-- execution
```

A future TypeShade runtime can use the same principle for GPU values, modules and resources.

This also gives the runtime a natural place for:

- device selection
- resource lifetime
- residency
- synchronization
- pipeline caching
- backend selection
- CPU fallback/testing where supported

## 8. Why TypeGPU is useful

TypeGPU demonstrates how much host-side type safety can be retained while controlling WebGPU resources.

Its most relevant lesson is architectural rather than syntactic:

> Host-side GPU orchestration is a separate concern from shader authoring.

TypeShade should not absorb a full TypeGPU-style pipeline DSL into `use typeshade`.

Instead, compiler metadata can become the contract consumed by a runtime. The runtime can construct the low-level objects internally while still exposing typed host-side operations.

## 9. GPU classes and CPU classes

GPU classes already exist in TypeShade.

The future problem is interoperability, not introducing GPU classes.

The intended relationship is approximately:

```
CPU object
   |
   | owns / controls
   v
GPU module or GPU value
```

A CPU application object can therefore manage a GPU simulation, renderer-independent compute module, image-processing program, geometry operation, or other GPU workload.

A GPU class must not silently become a CPU class, and a CPU class must not silently execute inside a shader.

The exact representation of the host-side handle is intentionally left open.

## 10. The CPU/GPU data boundary

The boundary should be explicit enough to preserve execution semantics, but not require ad-hoc methods on every GPU value.

The preferred direction is a runtime-level boundary:

```text
CPU value
   |
   | upload / create
   v
GPU value
   |
   | GPU execution
   v
GPU value
   |
   | read / materialize
   v
CPU value
```

This is why a public language construct such as `value.cpu()` is not required by this design.

Transfer, materialization, synchronization and ownership belong to the runtime.

The runtime may eventually optimize transfers, keep values resident, or avoid readback entirely when a subsequent GPU operation consumes the value.

## 11. Rendering is not the center of the runtime

A TypeShade runtime must support more than canvas rendering.

The same model should be applicable to:

- compute
- simulation
- image processing
- geometry processing
- numerical workloads
- audio workloads where the backend permits it
- rendering
- offscreen GPU work

A canvas is therefore one possible host integration, not the definition of the runtime.

Rendering-specific pipeline configuration remains a backend/runtime concern.

## 12. Reflection becomes an internal contract

Reflection is already useful today for applications that manage WebGPU/WebGL themselves.

With a runtime, reflection can become part of the internal contract:

```
TypeShade source
      |
    compile
      |
 IR + reflection
      |
      v
 runtime module
      |
      +-- resource layout
      +-- entry points
      +-- value layout
      +-- target metadata
      +-- pipeline/cache information
```

Normal callers should not need to inspect this metadata.

Advanced callers can still use `compile()` and `reflect()` as the low-level escape hatch.

## 13. Possible execution model

There are two useful levels of control.

### High-level

```ts
simulation.update(dt)
```

The runtime determines the required GPU work from the compiled module and its metadata.

### Explicit

```ts
simulation.update.dispatch({
  workgroups: [1024, 1, 1],
})
```

This makes dispatch visible when the application needs direct control.

Whether both forms should exist, and what guarantees the high-level form provides, is unresolved.

The design should prefer explicit semantics over hidden heuristics.

## 14. CPU execution and verification

The compiler already has a CPU evaluation path used as an oracle for tests.

That creates an opportunity for a runtime to expose CPU execution as a development/testing backend without changing the source language:

```
                 TypeShade program
                       |
              +--------+--------+
              |                 |
           CPU backend       GPU backend
              |                 |
           test/debug       production
```

This should be treated as a verification and development capability first. It must not imply that every GPU program can always be faithfully or efficiently executed on the CPU.

## 15. Proposed package boundaries

A future package layout could be:

```
@typeshade/compiler
  language
  parser/lowering
  IR
  emitters
  reflection
  language service

@typeshade/runtime
  device
  modules
  GPU values
  execution
  synchronization
  caching

@typeshade/webgpu
  WebGPU backend

@typeshade/webgl2
  WebGL2 backend
```

These names are illustrative and are not API commitments.

What ships today is one package, not these four. It has two subpaths for the host side, both from change 0009. `typeshade/vite` is the build-time plugin that compiles an imported `.shade.ts`. `typeshade/runtime` is the op library that the generated module imports to run the CPU tier. It is not API: only the generated modules name it.

The important boundary is that backend-specific objects do not leak into the TypeShade language.

## 16. What this design explicitly avoids

### A renderer framework

TypeShade is not intended to own:

```
App -> Canvas -> Renderer -> Scene
```

### A hidden GPU language

The compiler should not silently decide that arbitrary TypeScript runs on the GPU.

`"use typeshade"` remains a strong language boundary.

### A second type system

TypeShade should continue mapping TypeScript authoring constructs onto the existing TypeShade type/IR model rather than inventing an unrelated parallel language.

### A mandatory low-level WebGPU API

A normal caller should not have to manually construct bind groups and pipelines just to call a compiled TypeShade module.

### A giant automatic scheduler

Runtime automation should begin with clear module/resource execution semantics. Broad graph scheduling, fusion and aggressive placement are later optimization problems, not prerequisites for the runtime boundary.

## 17. Design principles

1. **TypeScript is the host language.**
2. **`"use typeshade"` is the GPU-program boundary.**
3. **GPU semantics stay explicit in the language.**
4. **CPU/GPU execution remains distinguishable.**
5. **Runtime removes repetitive host plumbing, not semantic visibility.**
6. **Compiler metadata is reusable by the runtime.**
7. **Backend APIs stay below the runtime boundary.**
8. **Rendering is one workload, not the definition of the system.**
9. **The CPU oracle is a verification asset, not a promise of universal CPU fallback.**
10. **Low-level compiler/reflection APIs remain the escape hatch.**

## 18. Developer experience

The runtime is only useful if the language surface remains approachable.

The intended progression for a developer is:

```
TypeScript knowledge
      |
      v
"use typeshade"
      |
      +-- familiar TS syntax
      +-- Typeshade GPU types
      +-- explicit resources
      +-- explicit shader stages
      |
      v
compiled module
      |
      v
host runtime
```

The documentation should teach this from the top down rather than making compiler internals the first concept.

That means the product documentation should explain, in one continuous model:

- what TypeScript constructs mean inside `use typeshade`;
- which TypeScript/JavaScript concepts are intentionally preserved;
- which concepts change because execution is on the GPU;
- how GPU classes differ from host classes;
- how resources and shader stages are represented;
- how a host application loads and executes a module;
- when data crosses the CPU/GPU boundary;
- when the user needs low-level backend control.

TypeScript and MDN concepts can be used as references and comparisons, but TypeShade should define its own semantics instead of implying that browser/JavaScript semantics automatically apply inside GPU code.

The website should therefore have two complementary levels:

1. **Language and runtime guide** — the primary developer experience.
2. **Compiler/IR internals** — implementation-facing material for contributors and advanced users.

Playground tooling should eventually reflect the same model: edit `use typeshade` source, see diagnostics and generated shader output, inspect reflection when needed, and make the boundary between source language and backend visible.

## 19. Broader programming model

TypeShade should be general-purpose GPU programming rather than an ML-specific framework.

The runtime model should accommodate:

- rendering
- compute
- simulation
- image and signal processing
- geometry
- numerical algorithms
- data-parallel workloads
- other GPU workloads supported by the chosen backend

This is why the abstraction is a device/runtime and not a tensor-only API.

A tensor or array abstraction may be built later on top of the runtime, but it should not define the core language.

## 20. Open design questions

The following remain deliberately unresolved:

- What is the exact host-side representation of a GPU value? For a value a host call passes on the CPU tier, Rule 8.21 answers it: numbers, booleans, tuples, flat column-major arrays and objects.
- What is the exact host-side representation of a GPU class/module?
- How does a `.shade.ts` module become importable? Answered for the CPU half by change 0009 (surface §64): through the Vite plugin, with a generated host view that `tsc` reads through `moduleSuffixes`.
- Does `device.create()` instantiate GPU state directly, or create a host handle first?
- Is `module.method()` enough for common execution, or should explicit dispatch always be visible?
- If both high-level and explicit execution exist, what semantics and performance guarantees does each provide?
- How are resources declared, created, resized and destroyed?
- How are uniform/storage/texture/sampler resources mapped to host values?
- What synchronization guarantees exist after a host call?
- When does a value become CPU-readable?
- Can the runtime infer pipeline state from reflection, and which state must remain explicit?
- How much WebGPU/WebGL2 behavior can share one runtime abstraction?
- What is the minimum viable runtime before introducing scheduling or graph execution?
- What guarantees can the CPU oracle provide, and where must GPU-only behavior remain GPU-only?
- How should errors map back to original TypeScript source spans?
- How should the language service understand imported TypeShade modules? A host file reads the generated host view, not the source (surface §64); the editor needs nothing more for it.

These questions should be answered by small implementation proposals, not by prematurely freezing a large runtime API.

## 21. Relationship to the existing roadmap

This document does not replace `docs/use-typeshade-plan.md` or `docs/roadmap.md`.

The existing roadmap already identifies the host boundary, runtime, generated module/import experience and device-resident state as later work. This document narrows the architectural intent behind those items.

The implementation order should remain incremental:

1. finish and stabilize the `use typeshade` language surface;
2. keep compiler output and reflection as the stable lower-level contract;
3. introduce a minimal host import/runtime path;
4. add device/resource lifetime and execution;
5. add backend adapters and caching;
6. add verification/debugging around the existing CPU oracle;
7. only then consider larger scheduling/optimization layers.

The runtime should grow from the compiler's existing IR and metadata rather than creating a second execution language.

---

**Status:** architectural direction only. Public APIs should be designed and implemented in separate proposals with concrete compiler/runtime constraints and tests.
