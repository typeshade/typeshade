# Roadmap to 1.0.0

This is the order of work between the first published `0.1.0` and `1.0.0`, and the two rules
that decide what is in it. It was written against `main` at 5891d46 and against the TypeGPU
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

## Two rules

**Make what does not compile, compile.** The priority is the order in which the missing pieces
block real shaders, and correctness bugs in what already compiles come before new surface. A
feature that one target has no spelling for (atomics, workgroup memory, storage textures on
GLSL ES 3.00) is accepted by the front end, emitted for the target that has it, and reported
as a target diagnostic by the one that does not. That is the rule the compile gate already
follows: an example can be WGSL-only, and the gate says so, and nothing crashes.

**The run layer is small on purpose.** It exposes three verbs and nothing else: import the
module, call an entry, draw to a canvas. It hides the device, the buffers, the layouts, the
bind groups, the pipelines and the fallback tiers. It never grows into a typed wrapper over
every WebGPU object, which is TypeGPU's shape and a good one, but a different product. A
caller who needs a raw `GPUBuffer` or a hand-built pipeline uses `compile()` and `reflect()`,
which stay the public escape hatch, and mixes the emitted WGSL into their own WebGPU code.

## The shape of "just run"

The two rules meet here. A shader file is a TypeScript module today, and `.shade.ts` files
already import each other. What is missing is the other direction: an ordinary `.ts` file
importing a `.shade.ts` and calling it, the way a `.ts` file imports a `.tsx` component. The
first block below is `add.shade.ts`; the second is the application file that imports it.

```ts
"use typeshade"
declare const a: storage<array<f32>>
declare const b: storage<array<f32>>
declare let out: storage<array<f32>>

@compute([64, 1, 1])
export function add(@builtin("global_invocation_id") id: vec3u) {
  out[id.x] = a[id.x] + b[id.x]
}
```

```ts
import { run } from 'typeshade/run'
import * as kernel from './add.shade.ts'

const { out } = await run(kernel.add, { a, b, out: a.length })
```

`run` reads the bindings from the module's reflection, allocates what the caller passed as a
length, uploads the typed arrays, dispatches enough workgroups to cover the largest array,
reads the `read_write` bindings back and returns them by name. The struct layouts come from
`wgslLayout`, which `reflect()` computes already. The tier order is the compute runner's:
WebGPU, then WebGL2 through the GLSL emit, then the CPU oracle, and the caller can pin one.
A fragment and vertex pair gets one verb of the same size: `mount(canvas, module)` returns a
handle whose `draw(uniforms)` takes plain objects.

The import works through a bundler plugin (`typeshade/vite`, built on unplugin so the same
code serves Rollup, webpack, esbuild and Rspack). It replaces a `.shade.ts` import with the
compiled module: the WGSL, the GLSL, the reflection and the CPU function, with the TypeScript
types of the source kept, so the editor sees the same names on both sides. Without the plugin
the runtime path stays: `compile(source)` at run time is what the Playground does today.

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
| 4   | Atomics: `atomic<u32>` and `atomic<i32>` in storage and workgroup memory, `atomicAdd`, `atomicSub`, `atomicMin`, `atomicMax`, `atomicAnd`, `atomicOr`, `atomicXor`, `atomicLoad`, `atomicStore`, `atomicExchange`                                                                         | M      |                                                                                                                                                                                                                                                                                             | WebGPU only. GLSL ES 3.00 reports a target diagnostic. The CPU oracle runs invocations in order, so its atomics are plain reads and writes.                                                        |
| 5   | Workgroup and private variables, `workgroupBarrier`, `storageBarrier`                                                                                                                                                                                                                     | M      |                                                                                                                                                                                                                                                                                             | Needs a spelling for a module-level variable that is not a resource; the design issue decides it. WebGPU only. The oracle needs a workgroup-ordered execution mode for a barrier to mean anything. |
| 6   | `console.log` inside a function                                                                                                                                                                                                                                                           | M      | [#76](https://github.com/typeshade/typeshade/issues/76)                                                                                                                                                                                                                                     | CPU oracle and stepper first, then the WebGPU log buffer, which needs 4.                                                                                                                           |
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

### 0.4 Just run

| #   | Item                                                                                                                                           | Size | Issue                                                   | Notes                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `compileTsSources` keeps the structs and bindings `compileTsSource` accepts                                                                    | S    | [#74](https://github.com/typeshade/typeshade/issues/74) | Blocks 15. An import graph that drops declarations cannot be the plugin's front end.                                                                                      |
| 15  | `typeshade/run`: `run(entry, bindings)` for compute, `mount(canvas, module)` for a vertex and fragment pair, tiers WebGPU then WebGL2 then CPU | L    |                                                         | Grows out of the compute runner, which handles one input and one `u32` output today. The design issue fixes the calling convention above and what a struct binding takes. |
| 16  | `typeshade/vite`: the unplugin that turns a `.shade.ts` import into the compiled module with its types                                         | M    |                                                         | Blocks nothing, but without it the second half of 1.0.0 is a runtime `compile()` call and not an import.                                                                  |
| 17  | Examples and guide sections for 4, 5, 6, 10, 11 and 15, and the site re-pinned                                                                 | M    |                                                         | The site's checks refuse an example the compiler refuses, so this is also the acceptance test.                                                                            |

### 0.5 Finish and freeze

| #   | Item                                                                                                                                                                                                                                                               | Size | Issue                                                   | Notes                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| 18  | Conditional compilation through override axes                                                                                                                                                                                                                      | L    | [#67](https://github.com/typeshade/typeshade/issues/67) | One source, many pipelines. Wanted for `run` variants; the design is filed. |
| 19  | The public surface for 1.0: which subpaths are stable (`typeshade`, `typeshade/run`, `typeshade/vite`, `typeshade/debug`, `typeshade/shade`, `typeshade/language-service`), the IR authoring layer marked unstable, `src/__api__/surface.md` baked as the contract | M    |                                                         | A `1.0.0` is a promise about this file.                                     |
| 20  | Changelog, semver rules, deprecation policy, the release checklist in `RELEASING.md` run once for real                                                                                                                                                             | S    |                                                         |                                                                             |

### After 1.0

| Item                                                                           | Why later                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f16` and the `h` vectors                                                      | A device feature on WebGPU and nothing exact on GLSL ES 3.00. A new scalar touches every table in the compiler, so it waits for the surface to freeze first.                             |
| Pointers and reference parameters                                              | WGSL `ptr` and GLSL `inout` can both carry it, but it is a language decision about what a parameter is. Value copies stay the rule until 1.0 and the decision gets its own design issue. |
| Subgroup operations                                                            | A WebGPU extension with no WebGL2 equivalent and no oracle meaning yet.                                                                                                                  |
| Three.js, React and other framework packages                                   | The run layer is the general answer; a framework package is a thin adapter over it and belongs in its own repository once `run` is stable.                                               |
| An ESLint plugin, a scaffolding CLI, a WGSL to TypeShade generator, a minifier | The compiler and the language service already diagnose in the editor and in CI. The rest is tooling around a stable 1.0, and none of it changes what compiles.                           |

## How the order was chosen

Items 1 to 3 are first because they are small and because everything with a side effect
(atomics, barriers, `textureStore`, `console.log`) lands on the call statement. Items 4 to 6
are the constructs a compute shader cannot do without, and they are the first WebGPU-only
surface, so they also set the rule for target diagnostics. Textures come next because a
renderer asks for shadow maps and storage writes before it asks for anything in the run
layer. The run layer comes after the language is complete so that it wraps a compiler that
does not change under it. The freeze is last because a surface promise is only worth making
once about a compiler that already does everything above.

## Versions

| Version | Contents                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1.0   | `main` today: the language in `docs/use-typeshade-surface.md`, WGSL and GLSL ES 3.00, the oracle, the language service, `reflect`, the compute runner. |
| 0.2.0   | Items 1 to 9.                                                                                                                                          |
| 0.3.0   | Items 10 to 13.                                                                                                                                        |
| 0.4.0   | Items 14 to 17.                                                                                                                                        |
| 0.5.0   | Items 18 to 20, then release candidates until nothing moves.                                                                                           |
| 1.0.0   | The surface in `surface.md` at 0.5, with the two meanings above holding.                                                                               |
