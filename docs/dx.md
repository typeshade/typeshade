# The developer experience: the GPU is an optimization level

This document states what TypeShade asks of a TypeScript developer and what it promises in
return. The roadmap orders the work; this says what the work is for, and it gives the tests a
design has to pass to count as done. Every "holds on `main`" below is a claim about this tree;
everything else names the roadmap item or pull request it waits on.

## The claim

A C programmer does not read the assembly the compiler produced. That is not because assembly
is hard to read. It is because `-O2` means what `-O0` means: the optimized program computes what
the source says, so there is nothing in the output the programmer needs to check. A Python
programmer does not read the bytecode, and for the same reason.

TypeShade makes the same promise about the GPU:

- **The CPU oracle is `-O0`.** It is the meaning of the TypeScript the developer wrote. It runs
  in Node, in a test runner and in a debugger, with no device.
- **The GPU is `-O3`.** It computes the same thing, faster. The compiler proves the parts it
  can at compile time, and it checks the rest against the oracle.

So a developer does not learn the GPU; they turn it on. Correctness never depends on a device
being present. Once that contract holds, there is no reason to open the generated WGSL, just as
there is no reason to open the assembly.

## What the leap removes

Each language or library that changed how people program removed one category of thought from
the programmer's head.

| Leap      | Category removed                               |
| --------- | ---------------------------------------------- |
| C         | registers and instruction selection            |
| Python    | memory management and the compile step         |
| NumPy     | the loop: code is written over whole arrays    |
| PyTorch   | deriving gradients, and wiring devices by hand |
| TypeShade | the GPU as a separate world                    |

"The GPU as a separate world" is five things a TypeScript developer has to learn today before a
GPU does anything for them:

| #   | What the developer has to learn today                                                                              | How TypeShade removes it                                                                                                                       | Where it stands                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A second language, WGSL or GLSL                                                                                    | The source is TypeScript, and the compiler emits both targets from it                                                                          | **Holds on `main`**: `"use typeshade"`, surface document                                                                                                                                                                            |
| 2   | A second memory: buffers, uploads, readbacks                                                                       | Where data lives is a compiler decision. The developer passes plain values and plain arrays                                                    | Planned: the run layer (item 16) and the CPU/GPU boundary (#97, #198)                                                                                                                                                               |
| 3   | A second execution model: dispatches, workgroups, pipelines                                                        | An ordinary loop becomes a kernel when the compiler proves its iterations independent                                                          | Planned: item 15                                                                                                                                                                                                                    |
| 4   | A second failure mode: silently wrong pixels, results that differ by driver, validation errors far from the source | Errors are reported at compile time on the line that causes them. The oracle is the reference. Operations that may differ by driver are listed | **Partly on `main`**: every front-end diagnostic names its source line, and the determinism report lists driver-dependent operations (item 22). A GPU result that differs from the oracle at run time is not reported yet (item 19) |
| 5   | A second debugging world, with no breakpoints and no `console.log`                                                 | GPU code steps on the CPU with the same numbers                                                                                                | **Holds on `main`**: `typeshade/debug` steps a shader function, and `console.log` in a shader reaches the host when the function runs on the CPU. The GPU's log buffer is not there yet (item 6, half shipped)                      |

Rows 4 and 5 are where TypeShade can go further than Python or PyTorch. A program can be shown
correct before it runs. And a debugger can stop inside a GPU function, which PyTorch cannot do
inside a CUDA kernel. Both rest on the same asset: a compiler with a reference implementation
of its own semantics.

## A language, not a domain

C is not a language for operating systems, or for databases, or for games. It is a small,
general core, and each of those was built on it as a library or a program. TypeShade has to be
the same kind of thing for the parallel half of a TypeScript program. Graphics is where it
started, and machine learning is one place `grad` is useful. Neither is what TypeShade is for.

The test of that is the range of programs the one language already carries. Each row below is a
domain, what it needs from the language rather than from a library, and the example on `main`
that exercises it.

| Domain                            | What it needs from the language                                        | On `main`                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Maps and geodesy                  | Precision beyond `f32` at planetary scale; projections                 | The emulated `f64` (surface §39); `fp64-mercator-tiles`, `fp64-loran`, `fp64-rtc`                |
| Terrain and rendering             | Vertex and fragment stages, textures, depth, render targets            | `hillshade`, `shadow-compare`, `cube-env`, `msaa-resolve`, `_mrt-gate` (multiple render targets) |
| Simulation                        | Compute, state that persists between steps, workgroup memory, barriers | `particle-step`, `workgroup-reduce`                                                              |
| Data analysis                     | Atomics, reductions, integer arithmetic                                | `atomic-histogram`, `compute-reduction`                                                          |
| Image processing                  | Storage textures, two-dimensional dispatch                             | `storage-texture`; two-dimensional workgroups in #192                                            |
| Data formats and codecs           | Bit operations, packing, bitcasts                                      | `packed-bytes`, `packing-bitcast`                                                                |
| Interaction                       | Integer render targets for picking, clip planes                        | `id-pick`, `clip-planes`                                                                         |
| Optimization and inverse problems | Derivatives of ordinary functions                                      | `grad`, in #194                                                                                  |
| Procedural content                | Noise, hashing, signed distance functions                              | `ocean`, `raymarch-sphere`, `random(seed)` (surface §55)                                         |

The same list tells the language what not to grow. A feature belongs in the language when many
domains need it and it cannot be written in TypeShade itself: a numeric type, a control-flow
shape, a transformation of any function, such as `grad`. `grad` is in that set because
derivatives are domain-general, not because of machine learning:

- a surface normal from a height field or a signed distance function;
- a Newton step in a solver;
- a Jacobian in a physics integrator;
- the sensitivity of a simulation to its inputs;
- fitting parameters to data.

Everything domain-shaped, such as a projection, a color space, a noise function or a filter
kernel, belongs in a library written in TypeShade. That is how C has libpng and SQLite rather
than a PNG type and a query statement.

## Principles

Each principle comes with the question a reviewer asks of a new public API.

1. **The unit is the function call. The data is plain data.** A caller passes `number`,
   `Float32Array` and the vector types, and receives the same. There is no buffer type and no
   device type on the primary path.
   _Test:_ can a caller use the API without naming an IR module, a generated function name or
   a GPU object?
2. **Looking under the hood goes through one door, and that door speaks the source language.**
   The door is an `explain` report, the way SQL has `EXPLAIN`. It says, for example, "this loop
   runs on the CPU because line 9 reads `out[i - 1]`", or "this call uploads 4 MB every frame".
   The generated code is never the explanation.
   _Test:_ does the API require reading emitted WGSL, a reflection record or a generated name to
   understand what happened?
3. **Every failure points at the line the developer wrote.** This holds for a compile-time
   refusal, for a GPU result that differs from the oracle, and for a performance warning.
   _Test:_ does any failure this API can produce name generated text instead of the source?
4. **No ceremony, and one honest boundary.** There is no configuration and no device setup.
   `await` appears only where a result genuinely crosses back from the GPU. That is
   asynchronous in every browser, so it is shown once, where it costs something.
   _Test:_ does the caller write any step that a correct default could have taken for them?
5. **A transformation applies to any function.** `grad(fn, 'k')` takes a function and returns a
   function, whatever the domain the function comes from. The oracle checks every derivative
   against a finite difference. The same holds for any later transformation the compiler
   offers: it works on functions, not on one domain's objects.
   _Test:_ does the transformation need the function to be written in a particular domain's
   shape?
6. **Lower layers are escape hatches, never requirements.** `compile()`, `reflect()`, an
   explicit `@compute` entry and a workgroup shape stay public. Reaching one never requires
   rewriting code on the layer above it.
   _Test:_ is this API on the primary path, or is it an escape hatch that says so in its
   documentation?
7. **Nothing domain-shaped in the language.** A domain concept is a library written in
   TypeShade, not a built-in.
   _Test:_ could this be written as a TypeShade library? If it could, it is not a language
   feature.
8. **TypeShade code is shared the way TypeScript code is.** A library of TypeShade functions is
   an npm package, and it is imported by name.
   **Today this is the gap that blocks an ecosystem.** The compiler takes relative imports only.
   A multi-file program refuses a package import with TS8099:

   `Only relative imports are supported (got "shade-noise").`

   The check is in `src/compiler/ts/module.ts`. A single file reports the imported function as
   `TS8004 Unknown function`. So no library of TypeShade code can be published and used.
   _Test:_ can a developer use a library of TypeShade functions from npm without copying its
   source?

## The two layers

| Primary path: what a TypeScript developer uses               | Escape hatch: what an expert reaches for                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `import { f } from './x.shade.ts'`, then `f(args)` (item 16) | `compile(source)`, `reflect(module)`, the emitted WGSL and GLSL                                              |
| An ordinary `for` loop that becomes a kernel (item 15)       | An explicit `@compute([64])` entry with `declare`d bindings, and a two-dimensional workgroup once #192 lands |
| `grad(f, 'k')` on an imported function, returning a function | `grad(module, 'f', 'k')` on a `ModuleDecl` (#194)                                                            |
| `explain(f)` (planned)                                       | `compile().determinism`, `typeshade/debug`, `decodeShaderLog`                                                |

The primary path is not built yet. Every row of the left column waits on item 15, item 16 or
the `explain` report. The right column is what `main` offers today, plus #194 in review. That
order of work is deliberate: the escape hatches are the compiler, and the primary path is a
thin layer over them (the roadmap's rule "The run layer has no import").

## The bar

"Overwhelming" has to be measurable, or it is only a feeling. Each line below becomes a check in
CI once the thing it measures exists.

| Bar                                                                                                                           | How it is checked                                                                                         | Status                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| No GPU vocabulary in a compute program. A caller's file never names a device, buffer, bind group, pipeline, workgroup or WGSL | A test scans each domain's example application for those words, and fails on any                          | Waits on items 15 and 16                                           |
| A library of TypeShade code installs from npm and imports by name                                                             | A test installs a TypeShade package into a fresh project and imports a function from it                   | Relative imports only today                                        |
| Zero lines of configuration from install to a first GPU result                                                                | A test in a fresh project: install, write the example, run it                                             | Waits on item 16                                                   |
| Every program runs without a GPU                                                                                              | The run layer's CPU tier runs every example under the test runner, with no device                         | The compute runner has a CPU tier today, for portable kernels only |
| Every failure names a source line                                                                                             | Front end: every `TS80xx` diagnostic has a span. Run time: every refusal and every divergence carries one | Front end holds on `main`. Run time waits on item 19               |
| Development mode compares the GPU with the oracle automatically                                                               | A run under development mode reports the first differing invocation and expression                        | Waits on item 19                                                   |

## The demonstrations

No single program can stand for a general language. The bar is measured over one small program
per domain of the table above, each a single file with no GPU vocabulary:

- a particle simulation stepped every frame;
- an image filter over a camera frame;
- a map layer that stays exact at street level on a planetary scale;
- a histogram of a large data set;
- a parameter fit.

The last one shows the most at once, in a way nothing else on the web can: inverse rendering in
a browser tab. A render function is written in TypeScript. `grad` fits its
parameters to a target image. The loss over every pixel runs on the GPU, and the descent around
it is ordinary host code. A breakpoint inside the render function stops on the CPU, with the same
numbers.

<!-- doc-snippets: skip — the import of a .shade.ts, the parallel loop and grad on a function are items 16, 15 and 18, which the compiler does not take yet -->

```ts
import { grad } from 'typeshade'
import { render, loss } from './scene.shade.ts'

let params = [0.5, 0.5, 0.5, 1.0]
const dLoss = grad(loss, 'params') // a function, differentiated and checked by the compiler
for (let step = 0; step < 200; step++) {
  const g = await dLoss(params, target) // the pixels are compared on the GPU
  params = params.map((p, i) => p - 0.05 * g[i]!)
}
await render(params, canvas)
```

There is no device, buffer, workgroup or WGSL in it, and it can be stepped through line by line.

## What is not promised

- **Reading a GPU result is asynchronous, and stays visible.** An implicit blocking readback
  would hide a frame-time cliff inside an innocent-looking call.
- **Not every TypeScript construct runs on a GPU.** A construct that cannot is refused at
  compile time, with the reason and the ordinary-TypeScript fix. It is never silently moved to
  the CPU inside a function the developer asked to run on the GPU. The exception is a loop the
  compiler cannot prove parallel: item 15 runs that on the CPU, and says why, in `explain`.
- **Floating point may differ in the last places across drivers.** The determinism report
  lists every operation where that can happen, and the oracle's `f32` mode is the reference.
- **Rendering keeps some shader concepts.** A fragment entry is still a fragment entry. The
  path with the least to learn is computation, and that is the path this bar measures first.

## What this changes

- **Item 16 is taken before item 15.** Calling an imported function is the first thing a
  developer tries. It works on the CPU tier the day the plugin lands, and item 15 then makes the
  same call faster without changing it.
- **`grad`'s primary shape is `grad(f, 'k')` on an imported function.** The module-level
  `grad(module, 'f', 'k')` (#194) is its engine and its escape hatch.
- **The CPU/GPU boundary (#97, #198) is about residency, not uniforms.** The developer thinks
  "the shader reads my variable", not "this is a uniform or a storage buffer". Which it is, is
  the compiler's decision.
- **Packages come before domain features.** A package that ships TypeShade code, imported by
  name, is what lets each domain grow its own libraries. The compiler does not have to grow one
  feature per domain.
- **The roadmap gains the bar as items.** The `explain` report and the checks above are listed
  in `docs/roadmap.md` under "The DX bar".
