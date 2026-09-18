# Roadmap to 1.0.0

This is the order of work between the first published `0.1.0` and `1.0.0`, and the rules that
decide what is in it. It was written against `main` at 5891d46 and against the TypeGPU
documentation as of September 2026. Each item links the issue that tracks it where one exists;
an item without a link gets its issue when it is picked up.

## What 1.0.0 means

Two things, and both have to hold.

1. **A `"use typeshade"` file can say what a WebGPU shader needs to say.** Every construct in
   the gap table below is either in `1.0.0` or listed under "after 1.0" with the reason.
2. **Importing that file from ordinary TypeScript runs it.** The test is the one NumPy and
   PyTorch pass: the caller writes the call and gets the result, and the device, the buffers,
   the layouts, the bind groups and the pipeline exist but are not the caller's problem.

The first is the compiler finishing its job. The second is a small layer on top of it, and
its size is a rule, not an accident.

## What makes it more than a shader compiler

A typed compiler over a small language, with a CPU oracle that agrees with the GPU bit for
bit, can do three things for the caller that a shader library cannot. They are the reason to
build the second half of 1.0.0 the way this document does, and none of them exists for the
web today.

1. **Loops become kernels.** The caller writes an ordinary `for` over arrays. The compiler
   proves the iterations independent and turns the loop into a compute entry and a dispatch;
   when it cannot, it says which line stops it and runs the loop on the CPU. The words
   `@compute`, `storage`, `global_invocation_id` and workgroup size leave the caller's world.
2. **Functions have derivatives.** `grad(f, 'k')` differentiates `f`'s IR and returns a
   function. The language has no pointers, no recursion and only constant-bounded loops, so
   forward mode is one IR pass, and the oracle checks every derivative against finite
   differences. Inverse rendering, texture fitting and parameter estimation run in the page.
3. **Results are verified.** The oracle equality the test suite uses becomes a caller-facing
   mode: a GPU result that differs from the CPU is reported down to the invocation and the
   expression, an index the compiler cannot prove in range does not compile, and the
   operations whose results may differ by driver are listed.

PyTorch's three beats are eager execution, autograd and a device the caller never names. The
first two items above and the calling rule below bring them to shaders. The third beat is the
one only a compiler with a reference implementation can play.

## Two rules

**Make what does not compile, compile.** The priority is the order in which the missing pieces
block real shaders, and correctness bugs in what already compiles come before new surface. A
feature that one target has no spelling for (atomics, workgroup memory, storage textures on
GLSL ES 3.00) is accepted by the front end, emitted for the target that has it, and reported
as a target diagnostic by the one that does not. That is the rule the compile gate already
follows: an example can be WGSL-only, and the gate says so, and nothing crashes.

**The run layer has no import.** A `.shade.ts` module imported from a `.ts` file exports the
names it declares, and calling one is the whole API: a helper runs on the CPU as the function
it is, a function with a parallel loop runs on the GPU. Nothing else is exposed. The device,
the buffers, the layouts, the bind groups, the pipelines and the fallback tiers exist inside
the generated module and are not named anywhere in user code. The layer never grows into a
typed wrapper over every WebGPU object, which is TypeGPU's shape and a good one, but a
different product. A caller who needs a raw `GPUBuffer` or a hand-built pipeline uses
`compile()` and `reflect()`, which stay the public escape hatch, and mixes the emitted WGSL
into their own WebGPU code.

## The shape of "just run"

The rules meet here. A shader file is a TypeScript module today, and `.shade.ts` files
already import each other. What is missing is the other direction: an ordinary `.ts` file
importing a `.shade.ts` and calling what it exports, the way a `.ts` file imports a `.tsx`
component and renders it. The first block below is `terrain.shade.ts`; the second is the
application file that imports it. The loop form and `grad` are items 15 and 18 and do not
compile yet, which is why the first block is excluded from the docs snippet test.

<!-- doc-snippets: skip the loop-as-kernel form and the array parameter are item 15 and grad is item 18, none of which the compiler accepts yet -->

```ts
'use typeshade'
export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w)
}

export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size)
    out[i] = height(p, k)
  }
}
```

```ts
import { grad } from 'typeshade'
import { height, render } from './terrain.shade.ts'

height(vec2(0.5, 0.5), k) // on the CPU, the function as written
const img = new Float32Array(512 * 512)
await render(k, 512, img) // the loop ran on the GPU; img is filled
const dHeight = grad(height, 'k') // (p: vec2, k: vec4) => vec4, a new function
```

**A function is called with the parameters it declares.** `height` has scalars and vectors
and no loop, so the call is the call; it runs on the CPU through the code the oracle already
generates, and vectors and matrices are plain values there. `render` has a loop the compiler
proved parallel, so the call dispatches it: the generated code uploads the arrays, runs the
loop body as a compute entry over the trip count, reads the written arrays back and fills the
caller's `Float32Array` in place, the way the function would have on the CPU. A call that ran
on the GPU is `await`ed because reading a GPU buffer back is asynchronous in every browser;
TypeScript allows `await` on a `void` call, so the source signature is the host signature and
nothing has to be generated for the editor. A caller who passes a device array instead of a
`Float32Array` keeps the result on the GPU for the next call, and the round trip happens once
at the end of the chain.

The proof is the compiler's, and its refusal is part of the product. A loop is parallel when
every write goes through an index that differs between iterations and no iteration reads what
another writes; the IR has no pointers, no aliasing beyond declared bindings and no recursion,
and it already knows every loop's bound, so the analysis is on the IR it has. When the proof
fails the diagnostic names the line: "this loop runs on the CPU because line 9 reads
`out[i - 1]`". A loop with a reduction (`sum += x[i]`) is recognised as one and lowered to the
workgroup reduction that item 4 and item 5 make possible.

A hand-written `@compute` entry with `declare` bindings stays available for the kernels the
proof does not cover, and its host call takes the module's bindings as one trailing object
and returns the written ones by name. A fragment entry called from the host takes the canvas
and its uniforms and draws one frame; a module with no `@vertex` entry gets the full-screen
triangle.

The tier order is the compute runner's: WebGPU, then WebGL2 through the GLSL emit, then the
CPU oracle, and the choice looks at the size (the runner knows the cliff where the CPU stops
being cheaper), at where the data already lives and at what the page has. A test pins a tier
with one optional global, `configure({ prefer: ['cpu'] })` from `typeshade`, which with
`grad` is the whole of what the layer adds to the package's top level.

The import works through a bundler plugin (`typeshade/vite`, built on unplugin so the same
code serves Rollup, webpack, esbuild and Rspack). It replaces a `.shade.ts` import with the
generated module: the WGSL, the GLSL, the reflection, the CPU code and the calls above, under
the names the source exports. The generated module imports `typeshade/runtime`, which is a
package path users never write. Without the plugin the runtime path stays: `compile(source)`
at run time is what the Playground does today.

## Priority order

Size is a rough cost: S is one PR of a day, M a PR series of a week, L a series that needs a
design issue first. "Blocks" names what cannot start before it.

### 0.2 Compute complete

The language can express the compute shaders people write with TypeGPU today.

| #   | Item                                                                                                                                                                                                                                                                                      | Size   | Issue                                                                                                                                                                                                                                                                                       | Notes                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A call as a statement, and `void` helpers                                                                                                                                                                                                                                                 | S      | [#47](https://github.com/typeshade/typeshade/issues/47)                                                                                                                                                                                                                                     | Blocks 4, 5, 10 and 11. Nothing with a side effect has a place to stand without it.                                                                                                                |
| 2   | `.length` on a runtime-sized storage array emits `arrayLength`                                                                                                                                                                                                                            | S      | [#46](https://github.com/typeshade/typeshade/issues/46)                                                                                                                                                                                                                                     | The standard bounds guard returns every invocation today.                                                                                                                                          |
| 3   | Correctness in what compiles: block scope, negative literals, shifts of 32 or more, division by a constant zero, float `%=` on GLSL                                                                                                                                                       | S each | [#38](https://github.com/typeshade/typeshade/issues/38), [#40](https://github.com/typeshade/typeshade/issues/40), [#71](https://github.com/typeshade/typeshade/issues/71), [#68](https://github.com/typeshade/typeshade/issues/68), [#20](https://github.com/typeshade/typeshade/issues/20) | Bugs before features. Each is small and each is a wrong program emitted without a diagnostic.                                                                                                      |
| 4   | Atomics: `atomic<u32>` and `atomic<i32>` in storage and workgroup memory, `atomicAdd`, `atomicSub`, `atomicMin`, `atomicMax`, `atomicAnd`, `atomicOr`, `atomicXor`, `atomicLoad`, `atomicStore`, `atomicExchange`                                                                         | M      |                                                                                                                                                                                                                                                                                             | WebGPU only. GLSL ES 3.00 reports a target diagnostic. The CPU oracle runs invocations in order, so its atomics are plain reads and writes. Blocks the reductions in 15.                           |
| 5   | Workgroup and private variables, `workgroupBarrier`, `storageBarrier`; classes with methods, a constructor and static functions (#86)                                                                                                                                                     | M      |                                                                                                                                                                                                                                                                                             | Needs a spelling for a module-level variable that is not a resource; the design issue decides it. WebGPU only. The oracle needs a workgroup-ordered execution mode for a barrier to mean anything. |
| 6   | `console.log` inside a function                                                                                                                                                                                                                                                           | M      | [#76](https://github.com/typeshade/typeshade/issues/76)                                                                                                                                                                                                                                     | CPU oracle and stepper first, then the WebGPU log buffer, which needs 4 and is the readback path 19 reuses.                                                                                        |
| 7   | Boolean vectors, `any`, `all`, vector `select`                                                                                                                                                                                                                                            | S      |                                                                                                                                                                                                                                                                                             | `vec2b`, `vec3b`, `vec4b` as an element kind; a comparison of vectors already produces one in the IR.                                                                                              |
| 8   | Builtin breadth: `reflect`, `refract`, `faceForward`, `transpose`, `determinant`, `frexp`, `ldexp`, `modf`, `countOneBits`, `reverseBits`, `countLeadingZeros`, `countTrailingZeros`, `firstLeadingBit`, `firstTrailingBit`, `extractBits`, `insertBits`, the coarse and fine derivatives | S      |                                                                                                                                                                                                                                                                                             | One PR, one table, every entry in both docs tables and the oracle.                                                                                                                                 |
| 9   | Argument checks for the ambient math functions                                                                                                                                                                                                                                            | S      | [#57](https://github.com/typeshade/typeshade/issues/57)                                                                                                                                                                                                                                     | `dot(vec3, vec2)` compiles today.                                                                                                                                                                  |

### 0.3 Textures

| #   | Item                                                                                                                        | Size | Issue | Notes                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---- | ----- | ---------------------------------------------------------------------------------- |
| 10  | Storage textures and `textureStore`                                                                                         | M    |       | Needs 1. WebGPU only for the write; the GLSL backend reports the target.           |
| 11  | Depth textures, comparison samplers, `textureSampleCompare` and `textureSampleCompareLevel`                                 | M    |       | Shadow maps are the first thing a renderer asks for. Both targets have a spelling. |
| 12  | `texture_cube`, `texture_cube_array`, `texture_3d`, `texture_1d`, `textureGather`, `textureSampleBias`, `textureSampleGrad` | M    |       | GLSL ES 3.00 has cube and 3d; the array and gather forms decide per target.        |
| 13  | Multisampled load on `texture_2d_ms`                                                                                        | S    |       | The type exists and nothing reads it.                                              |

### 0.4 Loops become kernels

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                       | Size | Issue                                                   | Notes                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `compileTsSources` keeps the structs and bindings `compileTsSource` accepts                                                                                                                                                                                                                                                                                                                | S    | [#74](https://github.com/typeshade/typeshade/issues/74) | Blocks 16. An import graph that drops declarations cannot be the plugin's front end.                                                                                                                                                           |
| 15  | A parallel `for` becomes a compute entry: the independence proof on the IR, the diagnostic that names the line when it fails, array parameters as inputs and outputs, reductions lowered to the workgroup pattern, the generated dispatch, device-resident arrays that stay on the GPU across calls, tiers WebGPU then WebGL2 then CPU behind `typeshade/runtime`, `configure({ prefer })` | L    |                                                         | Needs 4 and 5 for reductions. Grows out of the compute runner, which handles one input and one `u32` output today. The design issue fixes the proof's rules, the refusal wording, what a struct array takes and how a device array is spelled. |
| 16  | `typeshade/vite`: the unplugin that turns a `.shade.ts` import into the generated module under the source's export names                                                                                                                                                                                                                                                                   | M    |                                                         | Without it the second half of 1.0.0 is a runtime `compile()` call and not an import.                                                                                                                                                           |
| 17  | Examples and guide sections for 4, 5, 6, 10, 11 and 15, and the site re-pinned                                                                                                                                                                                                                                                                                                             | M    |                                                         | The site's checks refuse an example the compiler refuses, so this is also the acceptance test.                                                                                                                                                 |

### 0.5 Derivatives and verification

| #   | Item                                                                                                                                                                                                                                                                           | Size | Issue | Notes                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ----- | ------------------------------------------------------------------------------ |
| 18  | `grad(f, param)` in forward mode as an IR pass: every `f32` and float vector becomes a value and a derivative, `if` and constant-bounded `for` differentiate through, the discontinuous builtins (`floor`, `step`, `sign`, `round`) have a zero derivative and the docs say so | M    |       | The result is an ordinary function that 15 can run on any tier.                |
| 19  | Divergence report: in a development mode a GPU result is compared with the oracle per invocation and the first differing expression is named, using the log buffer from 6                                                                                                      | M    |       | The oracle equality the suite already asserts, made into a caller-facing mode. |
| 20  | Gradient check: the oracle compares every `grad` result against a finite difference and reports the parameter and the input where they part                                                                                                                                    | S    |       | Built on 18 and 19.                                                            |
| 21  | Bounds proofs: an index the compiler can bound from the loop and the array length compiles; one it cannot is refused with the range it could establish                                                                                                                         | M    |       | The loop analysis of 15 already computes the bounds.                           |
| 22  | Determinism report: `compile()` lists the operations in a module whose result may differ by driver (the transcendentals, `fma` where a target has no fused form)                                                                                                               | S    |       | The table exists in the emitter; this surfaces it.                             |

### 0.6 Finish and freeze

| #   | Item                                                                                                                                                                                                                                                                                                                             | Size | Issue                                                   | Notes                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 23  | Conditional compilation through override axes                                                                                                                                                                                                                                                                                    | L    | [#67](https://github.com/typeshade/typeshade/issues/67) | One source, many pipelines. Wanted for tier and variant selection in 15; the design is filed. |
| 24  | The public surface for 1.0: which subpaths are stable (`typeshade`, `typeshade/vite`, `typeshade/debug`, `typeshade/shade`, `typeshade/language-service`, and `typeshade/runtime` as the path generated modules import and users do not), the IR authoring layer marked unstable, `src/__api__/surface.md` baked as the contract | M    |                                                         | A `1.0.0` is a promise about this file.                                                       |
| 25  | Changelog, semver rules, deprecation policy, the release checklist in `RELEASING.md` run once for real                                                                                                                                                                                                                           | S    |                                                         |                                                                                               |

### After 1.0

| Item                                                                           | Why later                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reverse-mode `grad`                                                            | Forward mode covers a few parameters at a time, which is what fitting a shader's constants needs. Many parameters (a neural field's weights) want reverse mode, which needs the tape and the memory rules a design issue has to settle. |
| Fusing a chain of device-resident calls into one dispatch                      | The IR of every call is in the generated module, so a runtime can compose two kernels and compile once with a cache. Worth doing after 15 has shown where the round trips actually cost.                                                |
| `f16` and the `h` vectors                                                      | A device feature on WebGPU and nothing exact on GLSL ES 3.00. A new scalar touches every table in the compiler, so it waits for the surface to freeze first.                                                                            |
| Pointers and reference parameters                                              | WGSL `ptr` and GLSL `inout` can both carry it, but it is a language decision about what a parameter is. Value copies stay the rule until 1.0 and the decision gets its own design issue.                                                |
| Subgroup operations                                                            | A WebGPU extension with no WebGL2 equivalent and no oracle meaning yet.                                                                                                                                                                 |
| Three.js, React and other framework packages                                   | Calling the module is the general answer; a framework package is a thin adapter over it and belongs in its own repository once item 15 is stable.                                                                                       |
| An ESLint plugin, a scaffolding CLI, a WGSL to TypeShade generator, a minifier | The compiler and the language service already diagnose in the editor and in CI. The rest is tooling around a stable 1.0, and none of it changes what compiles.                                                                          |

## How the order was chosen

Items 1 to 3 are first because they are small and because everything with a side effect
(atomics, barriers, `textureStore`, `console.log`) lands on the call statement. Items 4 to 6
are the constructs a compute shader cannot do without, and they are the first WebGPU-only
surface, so they also set the rule for target diagnostics; they are also what a reduction
loop lowers to, so 15 depends on them. Textures come next because a renderer asks for shadow
maps and storage writes before it asks to be called from the host. The loop-to-kernel layer
comes after the language is complete so that it wraps a compiler that does not change under
it, and derivatives and verification come after that because both are passes over the same
IR and both are checked by the oracle the layer already runs. The freeze is last because a
surface promise is only worth making once about a compiler that already does everything
above.

## Versions

| Version | Contents                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1.0   | `main` today: the language in `docs/use-typeshade-surface.md`, WGSL and GLSL ES 3.00, the oracle, the language service, `reflect`, the compute runner. |
| 0.2.0   | Items 1 to 9.                                                                                                                                          |
| 0.3.0   | Items 10 to 13.                                                                                                                                        |
| 0.4.0   | Items 14 to 17.                                                                                                                                        |
| 0.5.0   | Items 18 to 22.                                                                                                                                        |
| 0.6.0   | Items 23 to 25, then release candidates until nothing moves.                                                                                           |
| 1.0.0   | The surface in `surface.md` at 0.6, with the two meanings above holding and the three things a shader library cannot do.                               |
