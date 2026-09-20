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

## 2. The architectural split

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

## 3. What `use typeshade` means

A `"use typeshade"` source file is a TypeShade program.

For example:

```ts
"use typeshade"

class Particle {
  position: vec3
  velocity: vec3
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

## 4. The host-side goal

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

## 5. Why Numba is useful

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

## 6. Why PyTorch is useful

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

## 7. Why TypeGPU is useful

TypeGPU demonstrates how much host-side type safety can be retained while controlling WebGPU resources.

Its most relevant lesson is architectural rather than syntactic:

> Host-side GPU orchestration is a separate concern from shader authoring.

TypeShade should not absorb a full TypeGPU-style pipeline DSL into `use typeshade`.

Instead, compiler metadata can become the contract consumed by a runtime. The runtime can construct the low-level objects internally while still exposing typed host-side operations.

## 8. GPU classes and CPU classes

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

## 9. The CPU/GPU data boundary

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

## 10. Rendering is not the center of the runtime

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

## 11. Reflection becomes an internal contract

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

## 12. Possible execution model

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

## 13. CPU execution and verification

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

## 14. Proposed package boundaries

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

The important boundary is that backend-specific objects do not leak into the TypeShade language.

## 15. What this design explicitly avoids

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

## 16. Design principles

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

## 17. Relationship to the existing roadmap

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
