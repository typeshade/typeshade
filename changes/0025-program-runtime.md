---
id: '0025'
title: A host loads a compiled program into a public runtime that handles the device, the resources, the pipelines, the bindings and the console, with no compiler in its bundle, and can emit the program again at load time without the TypeScript front end
status: accepted
rules:
- '6.8'
- '8.24'
- '11.7'
- '11.8'
- '11.10'
- '11.11'
surface:
- 64
- 65
- 66
- 67
- 69
exports:
- Pack
- PackBinding
- PackEntry
- PackOptions
- packModule
- Resident
- resident
- configure
- typeshade
- TypeshadeViteOptions
- createRuntime
- runtime
- Runtime
- RuntimeOptions
- Program
- LoadOptions
- ComputePipeline
- RenderPipeline
- RenderState
- Frame
- RenderPass
- PassTargets
- Geometry
- Bindings
- Texture
- TextureOptions
- Sampler
- SamplerOptions
- repack
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The API reference gains typeshade/runtime (public now) and typeshade/emit; the Playground's WebGPU runner (src/lib/shader-runtime.ts with shader-bindings.ts and compute-runner.ts, 2,445 lines at b3bfddf) moves onto the program runtime and keeps its WebGL2 path until the program runtime's WebGL2 proposal; PRODUCT.md names entry point ② (#335); the WebGPU concept page (ConceptsWebgpuPage, en and ko), whose Device row says no TypeShade code touches a WebGPU object and whose No runtime section says there is no TypeShade object to create at startup; the Console tab shows the tier and the source line the way the printed line does; the Korean guide sections AUTHORING.md changes, which check:guide lists
- repo: vscode-typeshade
  what: The skill's references/host.md, whose line "The runtime creates the device and the pipelines" becomes false and which gains the program runtime beside the raw compile() path and the plugin's console option; the MCP server's run tool prints its console lines in the same form, pinned by tools.test.ts; docs/design.md §4, which declines a rendering preview because it "would still need its own device and its own copy of the bindings", records that the program runtime now provides both
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Issue #335 settled four entry points on one stack and made the second of them, the program
runtime, a public layer of this package. This proposal is that layer. On 2026-09-28 the maintainer
added two requirements, which shape every part below:

- **The static path stays.** A host that wants only the compiled program and its reflection keeps
  taking them, as it does today, and never loads a runtime.
- **A host that develops dynamically gets the runtime, and its bundle does not carry the whole
  compiler.** The runtime carries no compiler at all. The one part that must emit shader text at
  run time carries the IR and the backends, and never the TypeScript front end.

After this change a host takes a compiled program in one of four ways. The sizes were measured on
`main` at `a88335b` with bun 1.3.11 (`--minify --target=browser`, then `gzip -9`):

| The host wants                                                                          | It uses                                                         | What its bundle carries of TypeShade                                                                      |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ① The shader text and its layouts, for an engine of its own                             | `packModule()` at build time, or the manifest the plugin writes | nothing                                                                                                   |
| ② The device, resources, pipelines, bindings and console handled, and the frame its own | `typeshade/runtime`                                             | the runtime. The op library it grows from is 20,606 bytes gzipped today                                   |
| ② and a program emitted again at load time (the console on demand; later, placement)    | `typeshade/runtime` and `typeshade/emit`                        | the runtime, plus the IR and the backends: 70,714 bytes gzipped, against 1,425,482 for the whole compiler |
| ④ A function imported and called                                                        | the module itself, through `typeshade/vite`                     | the call layer, now built on ②                                                                            |

The rest of this section is the manifest (1), the runtime (2), the call layer on it (3), the
console lines (4) and the load-time emitter (5).

### 1. The compiled program has a manifest, with a version

`Pack` becomes the manifest, the one plain object a host needs to run a program. It stays JSON,
so it survives `JSON.stringify`, a bundler's module, a worker message and an HTTP response
unchanged. Today it lacks most of what running a program takes: a host that reads it still has to
call `reflect()` for byte offsets, still meets fields neither carries, and still re-derives what the
call layer computes privately (measured at `a88335b`):

- **No version.** No output of the compiler carries one: not `Pack`, not `reflect()`, not
  `ConsoleLog`, not the literals the plugin writes.
- **No byte layout.** `reflect()` lays out struct bindings only. A top-level `storage<array<f32>>`
  gets no layout, and no public output reports an element stride.
- **No resource description.** `Pack` has a type string to parse (`texture_2d<f32>`,
  `sampler_comparison`); `reflect()` has the kinds, but no element type for a storage array.
- **Missing bindings.** `Pack` lists the module's own bindings. The `_fp64` guard the WGSL declares
  and the `_console` buffer of the recorded variant are absent.
- **No entry details in `Pack`.** No workgroup size, inputs and outputs, overrides or features.
  `reflect()` has them, but drops `interpolate`.
- **Two vertex layouts that disagree.** For `f32`, `vec3`, `vec2` parameters, `reflect()` gives
  offsets 0, 16, 32 and a stride of 40; `Pack` gives 0, 4, 16 and 24. For a struct parameter,
  the idiomatic form, `reflect()` gives none.
- **No WebGL2 conventions.** A storage array becomes a data texture on WebGL2, and which sampler
  goes with which texture is decided in `host-face.ts`. No output says either, so a host of its own
  cannot fill one.
- **The call layer's data is private and needs TypeScript.** The per-entry bindings with `writes`,
  the layouts with strides and the WebGL2 names come from `host-face.ts`, which imports
  `typescript`.

After this change the manifest carries, in schema 1:

- `schema` and `compiler`: the manifest's version and the package version that wrote it. A reader
  refuses a schema it does not know, and names both.
- **Each binding**: its name, group and slot; its resource (a uniform or storage buffer, a
  texture with its dimension, sample type and depth, a storage texture with its format and access,
  a sampler and whether it compares); the stages that reach it; its byte layout with every offset,
  size and stride, under the rules of its space; and the line that declares it. The `_fp64` guard
  is a binding like any other.
- **Each entry**: its stage, its workgroup size, its inputs and outputs with their locations,
  builtins and interpolation, the bindings it reaches and which of them it writes, and its line.
  A vertex entry carries its vertex layout, one per entry, with formats.
- The overrides, with their types and defaults, and the WebGPU features the program needs.
- `wgsl`, and, when the build records the console, `console`: the recorded variant's WGSL, its log
  table and the bindings it adds.
- `gl`: what the WebGL2 tier uses today, as data. Each fragment entry's GLSL ES 3.00 program, its
  uniform block names and its texture-sampler pairs, and each storage array's data-texture layout.
- `ir`, on request only (section 5): the program as portable IR, for the load-time emitter.

The layouts are the ones the emitted WGSL assumes. Rule 6.8 already holds `reflect()` to them, and
it now holds the manifest too. `reflect().vertex` changes to the manifest's offsets, which are the
tight ones the call layer already uploads.

`packModule(m, options)` produces the manifest. The builder moves out of `host-face.ts` into a file
of `src/core` that imports no TypeScript, so the plugin, `packModule` and the load-time emitter
compute one manifest from the IR alone. The plugin's generated module exports it as its default
export:

```ts
import brick from './brick.shade.ts'; // the manifest, typed from the host view
import { fs } from './brick.shade.ts'; // the call layer, as today (surface §67)
```

A module's default export has no host face today: the host view types it `never`, with the
sentence "a default export has no host face; export a name instead". So the default export is
free for the program, and the host view types it with the program's bindings and their host
values (Rule 8.21). `tsc` then checks a binding's name and value where the host writes them.

### 2. The program runtime

`typeshade/runtime` becomes public. It is what #335 decision 1 describes: it takes the host's
device or requests one, records into an encoder the host hands it or into a frame of its own,
binds by name, packs by the manifest's layouts, caches pipelines, and records and prints the
console. It automates what the compiler knows and nothing else, so it is not a typed wrapper over
every WebGPU object. A frame of an engine with two materials, a shadow pass and a shared camera:

```ts
import { createRuntime, resident } from 'typeshade/runtime';
import shadow from './shadow.shade.ts';
import brick from './brick.shade.ts';

const rt = await createRuntime({ programs: [shadow, brick] }); // or { device }, the host's own
const [shadowPass, brickPass] = await Promise.all([
  rt.load(shadow).render({ depth: { format: 'depth32float', compare: 'less' } }),
  rt.load(brick).render({
    targets: ['rgba16float'],
    depth: { format: 'depth24plus', compare: 'less' },
  }),
]);

// light, lights, cmp (a comparison sampler) and wall (a mesh) are made the same way.
const camera = resident({ viewProj, eye, time: 0 }); // one buffer, bound by every draw
const shadowMap = rt.texture({ size: [2048, 2048], format: 'depth32float' });
const hdr = rt.texture({ size: [1280, 720], format: 'rgba16float' });
const depth = rt.texture({ size: [1280, 720], format: 'depth24plus' });

function frame(t: number) {
  camera.write({ viewProj, eye, time: t });
  const f = rt.frame();
  f.pass({ depth: shadowMap }, (p) => p.draw(shadowPass, { light }, wall));
  f.pass({ color: [hdr], depth }, (p) => p.draw(brickPass, { camera, lights, shadowMap, cmp }, wall));
  return f.submit(); // the console lines print here
}
```

**The device.** `createRuntime({ device })` uses the host's device, and never destroys it or
installs a handler on it. Without one, the runtime requests a device with the features and limits
the programs in `programs` need. `rt.device` is the device either way, so a host that writes its own
WebGPU next to the runtime uses the same device and the same resources. `runtime()` returns the
default runtime, the one the call layer uses, and `configure({ runtime })` makes the call layer use
a runtime the host made (section 3).

**Loading.** `rt.load(manifest, options)` checks the schema and the features against the device,
and returns a `Program`. It takes the plugin's default export, or a manifest the host fetched or
cached, as an engine caches compiled shaders.

**Pipelines.** `program.compute(entry)` and `program.render(state)` resolve to a `ComputePipeline`
and a `RenderPipeline`, created asynchronously and cached by entry and state. The runtime builds
each pipeline's layout from the manifest, never `layout: 'auto'`: the bindings the pipeline's
entries reach, each visible to the stages that reach it. Two pipelines that reach the same
bindings get equal layouts, so one bind group serves both. A group that every pipeline of an
engine shares, such as its camera and lights, needs the host to place bindings, which is #335
principle 2 and its own proposal. Fixed-function state is the host's and is written
explicitly in `RenderState`: the targets' formats and blending, depth and stencil, topology, culling
and multisampling. The compiler knows only part of it, and the runtime fills and checks that part.
The entries default to the program's only vertex and fragment entry. The vertex buffers' layout
comes from the manifest. A target's format must suit the output at its location: an integer output
needs an integer format, and a mismatch is refused with the entry, the location and the line
before WebGPU is called. Where the state lives in the source, if anywhere, stays #204's question.

**Binding by name.** A draw or a dispatch takes its bindings as an object keyed by the names the
source declares. A value is a `Resident`, a `Texture`, a `Sampler`, a plain host value (Rule 8.21),
or the host's own `GPUBuffer`, `GPUTextureView` or `GPUSampler`. A plain value is packed by the
binding's layout into memory the runtime reuses. Bind groups are cached by the identity of what
they hold. Once a frame's shapes repeat, the runtime creates no GPU object per frame, and the
engine journey counts that (step 5). A missing binding, an unknown name or a value of the wrong
shape is a `TypeError` naming the entry, the binding and the line that declares it, as the call
layer's refusals do.

**One resource model with the call layer** (#335 principle 1). A resource made on one layer is
used on the other:

- `Resident` is the buffer of both layers. `resident(value)` takes any host value, not only an
  array: a struct for a uniform the frame shares is packed by the layout of the binding it is first
  bound to. `write(value)` replaces what it holds, and `destroy()` releases its buffer.
  `read()` stays. A `Resident` bound to a binding of another layout is a `TypeError` naming both.
- `Texture` holds a texture: made by `rt.texture({ size, format })` in any format the device can
  render or sample, float formats included, or wrapping the host's `GPUTexture`. It has
  `resize()`, `destroy()` and `read()`. It is #204's image, and the call layer takes it wherever
  it takes an image today.
- `Sampler` holds a sampler, made from options or wrapping the host's.

**Frames and the host's encoder.** `rt.frame()` records into one encoder: `dispatch()`, and
`pass(targets, record)`, a render pass into textures or a canvas context the host configured.
`submit()` submits it. A host that owns its encoders records with the pipelines directly:
`dispatch(encoder, bindings, workgroups)` into a `GPUCommandEncoder` or a `GPUComputePassEncoder`,
and `draw(pass, bindings, geometry)` into a `GPURenderPassEncoder`. It then calls
`rt.submit(encoder)`, which adds the console copies before it finishes the encoder.

**What it does not do.** It has no scene, camera, light or material (#335 decision 3). It draws a
canvas only through a context the host configured. It does not reorder, merge or schedule work.
Version 1 runs on WebGPU only: how it offers the WebGL2 and CPU tiers to a host that owns its frame
is #335's last open question and its own proposal. The manifest carries the WebGL2 conventions from
schema 1 so that proposal changes no schema.

### 3. The call layer runs on the program runtime

This is #335 decision 2. The generated module's WebGPU tier calls the program runtime instead of its
own dispatch and draw, with the same entries and the same refusals, so a caller sees no
difference but these:

- A call runs on the default runtime, whose device the host can replace:
  `configure({ runtime: await createRuntime({ device }) })`. Today `gpuDevice()` requests its own
  device with no descriptor, and a texture the host made cannot reach a call
  (`src/core/host-entry.ts:580`).
- A `Resident` passed to a call is the program runtime's: it has `write()` and `destroy()`, and it
  can be bound by a frame of the host's.
- An image a call reads is uploaded once, not on every call, when it is passed as a `Texture`.

The op library a generated module imports, the CPU tier's runtime, moves from `typeshade/runtime`
to `typeshade/runtime/internal`, which stays not API. The generated modules name it, and the
same package version writes and reads it (Rule 11.7). The WebGL2 and CPU tiers of the call layer
stay where they are until the program runtime's WebGL2 proposal.

### 4. A console line says where it ran, and a production build records when asked

This section was proposed as #336, which it replaces.

**The printed line.** Today a decoded event is printed as `console[e.method](...e.args)`. A
dispatch of 64 invocations that calls `console.log("x", v)` prints 64 lines of `x 1.5`, `x 2.5`,
and nothing says which invocation printed which, or that they came from the GPU. The event carries
both. After this change every line the runtime prints starts with the tier, the line the call is
on and the invocation, when the event has one:

```
 GPU  particles.shade.ts:14  [3, 0, 0]  x 4.5
 CPU  particles.shade.ts:14  [3, 0, 0]  x 4.5
 CPU  terrain.shade.ts:6  height 0.25
```

- The tier is `GPU` for an event decoded from the console buffer and `CPU` for one the CPU tier's
  sink delivered. A browser draws it as a label with `%c`. Node ignores `%c`, so a test runner prints
  the same text unstyled.
- The invocation is the event's own: `global_invocation_id` for a compute entry, the pixel
  `[x, y, 0]` for a fragment entry. A helper the host calls (surface §64) has none.
- The method stays, so `console.warn` is still a warning and the browser's filters still work.
- The prefix goes in the format string and the event's arguments follow. A label holding `%d` is
  printed as written, where today it is read as a directive.
- A `console.table` prints the prefix on a `console.log` line, then the table.
- The warning for calls that did not fit the buffer carries the same prefix and names the entry.

The events do not change. `ConsoleEvent` keeps its shape and `decodeConsole` its result. A host
that shows the events itself passes a sink, `createRuntime({ console: sink })`, as the Playground
will.

**Recording in a production build.** Today `typeshade/vite` records in `vite dev` and never in
`vite build` (Rule 8.24), so a problem that shows only in a deployed build cannot be looked at
through the console. After this change the plugin takes options:

```ts
export default defineConfig({ plugins: [typeshade({ console: 'always' })] });
```

- `console: 'dev'` records in `vite dev` and not in `vite build`. It is the default, so
  `typeshade()` behaves as it does today.
- `console: 'always'` records in both. Each dispatch and draw of an entry that logs then binds one
  storage buffer, adds one atomic per call and reads the buffer back after the work. The plugin says
  so in one line when the build starts.
- `console: 'never'` records in neither, so `vite dev`'s WGSL is the production WGSL byte for byte.

The buffer's size is the runtime's, `createRuntime({ consoleBytes })`, 1 MiB by default as today.
A frame that logs every pixel fills any buffer; the dropped count says so, and this is how a
developer gives it more room.

A host with its own pipeline around `compile()` keeps `decodeConsole` and the `ConsoleLog` that
`compile(src, { console: 'gpu' })` returns. #336 proposed a helper for that host. The runtime now
records and prints the console as part of its own work, so the helper is not needed.

### 5. The load-time emitter: a program emitted again without the front end

Some choices can only be made where the program runs. A host turns the console on in a deployed
build for one session. An engine loads a material package compiled elsewhere and places its
bindings in its own layout. On WebGL2, a variant has to be emitted again with its overrides pinned,
since GLSL has none. Each needs the shader text emitted again at load time. The TypeScript front
end is not needed for that: the IR and the backends are enough.

`typeshade/emit` exports one function, `repack(manifest, options)`. It emits the manifest again
from the IR the manifest carries, and the runtime takes it as a plug-in so it never imports it
itself:

```ts
import { createRuntime } from 'typeshade/runtime';
import { repack } from 'typeshade/emit';

const rt = await createRuntime({ emit: repack });
const program = rt.load(brick, { console: true }); // recorded, although the build did not record
```

- **What it carries.** The IR and the WGSL and GLSL writers, the console lowering and the
  manifest builder. It carries no `typescript` and no file of the front end. Measured at
  `a88335b`, the backends alone bundle to 227,125 bytes (70,714 gzipped). The whole compiler is
  5,072,486 (1,425,482 gzipped) with TypeScript, and 916,936 (245,625) without it. The
  implementation trims what the backends pull in without using it: the IR builder through the
  `f64` library, the CPU runtime through constant folding, and the lint engine through
  `validate.ts`.
- **The portable IR.** The manifest carries it only when asked, `typeshade({ ir: true })` or
  `packModule(m, { ir: true })`, since it is three times the WGSL gzipped (the median of the 89
  examples). For each of the 89, the IR through `JSON.stringify` and back gives WGSL, GLSL,
  `reflect()`, the console variant and `Pack` byte for byte. Three things are fixed on the way:
  - `declRef` is written as a reference, not inlined: inlined, it makes the largest example's IR
    1,156,773 bytes against 185,171.
  - Spans are kept only where an event reports them.
  - `-0` is kept, where `JSON.stringify` writes `0`.
- **Only the same version reads it.** The IR is not a stable format (roadmap item 24), and this
  proposal does not make it one. `ir` records the package version that wrote it, and `repack`
  reads only its own version. A manifest from another version still loads from its emitted text.
  Only a load option that needs a new emit is refused, and the refusal names both versions.
- **In version 1** the one load option that needs it is `console: true`. Placement at load time,
  the pinned overrides of the WebGL2 tier, and a program composed at run time are the next
  proposals built on it.

### What stays

- `compile()`, `reflect()`, `packModule()` and the emitted text stay the way into an engine of the
  host's own (`docs/dx.md` principle 6). The static path needs no runtime.
- The call layer's calls, tiers and refusals (Rules 8.24, 11.7 and 11.8), apart from the device
  and the resources above.
- The console's events and the buffer's format (Rule 11.9). What is recorded, and `TS8071`.
- `typeshade/compute`'s runner, which predates this layer and takes the host's device and GL
  context. Whether the program runtime absorbs it is for the WebGL2 proposal.

## Why

**The layer ② would be has been written three times, and none of them is public** (#335 §4):

- the call layer's WebGPU tier in `src/core/host-entry.ts` and `host-draw.ts`;
- the site's runner: `src/lib/shader-runtime.ts`, `shader-bindings.ts` and `compute-runner.ts`,
  2,445 lines at `b3bfddf`, which import nothing from the compiler;
- the journeys' harness, `journeys/_harness.mjs`, 521 lines of WebGPU written by hand.

Each packs by its own reading of the layouts, and each learned the console on its own: the call
layer in change 0014, the harness in #328, the site's runner in typeshade.github.io#98. TypeGPU
prints the console of every draw and dispatch because its runtime owns the pipeline. With a public
runtime under every path, TypeShade does too.

**The call layer cannot be an engine's layer as it stands** (#335 §2 and §3). It requests its own
device with no descriptor. Every call records and submits its own encoder, creates its bind groups
and waits on an error scope. A draw is one full-screen triangle into a canvas. A `Resident` is
never written or released. An image is uploaded as `rgba8unorm` on every call.

**A runtime that reads `reflect()` output would re-derive the private data again.** Section 1
lists what neither output carries. The fourth copy of the layer would be the first public one.

**The whole compiler cannot be the runtime's price.** With TypeScript it is 5.07 MB and 1.43 MB
gzipped, of which TypeScript is 3.58 MB and Bun's polyfills for it 0.55 MB. Gzipped, the backends
are 5 % of that, and the op library the runtime grows from 1.5 %. The root barrel already reaches
the backends without TypeScript when a bundler tree-shakes it, but that rests on one `sideEffects`
line in `package.json`, and an unbundled load reaches `typescript` through `src/index.ts`. The two
subpaths make the boundary a checked property (Rule 11.11) instead of a bundler's inference.

Alternatives considered:

- **Run the compiler in the browser, as the Playground does.** That is right for an editor and
  wrong for an application, for the size above.
- **Make the IR a stable public format now.** It would freeze the layer roadmap item 24 marks
  unstable, before an engine has used it. The same-version rule gives the load-time emitter
  everything it needs, and a stable format can follow once one is asked for.
- **`layout: 'auto'`.** A bind group made for one pipeline's automatic layout cannot be bound to
  another, so an engine could not share one group of per-frame state between pipelines.
- **The manifest behind a `?program` query**, `import brick from './brick.shade.ts?program'`.
  TypeScript cannot resolve a query suffix to a file, so the bindings would be untyped. A named
  export would take a name an author may use. `import * as` would keep every export's CPU tier in
  the bundle. The default export is typed, is free today, and tree-shakes.
- **A typed wrapper over every WebGPU object**, as TypeGPU offers. #335 decision 1 rules it out:
  the runtime automates what the compiler knows, and the host's own WebGPU sits beside it on the
  same device.
- **WebGL2 in version 1.** It doubles the first implementation, and #335 left it to its own
  proposal. The manifest carries its conventions now, so nothing about it is lost by waiting.

## What it touches

**Rules.**

- **Rule 6.8**: the manifest's layouts are held to the emitted WGSL byte for byte, as `reflect()`'s
  are, and `reflect().vertex` reports the manifest's offsets.
- **Rule 8.24**: a call's WebGPU tier runs on the default runtime or the one `configure` names. In
  `vite dev`, or in any build with `console: 'always'`, an entry records its console calls, and each
  printed line carries its tier, its line and its invocation. `console: 'never'` records in
  neither.
- **Rule 11.7**: the op library the CPU tier closes over is `typeshade/runtime/internal`.
- **Rule 11.8**: `resident(value)` takes any host value. `Resident` gains `write()` and
  `destroy()` and is bound by the program runtime too. `configure` takes `runtime`.
- **Rule 11.10 (new)**: the manifest. What it carries (section 1), its schema and compiler
  version, the refusal of an unknown schema, and the default export of a host import.
- **Rule 11.11 (new)**: the program runtime. Binding by name, the refusals and their sentences,
  the one resource model, and the boundary: its module closure holds no file of `src/compiler` and
  no `typescript`, and the load-time emitter's holds the IR and the backends and no front end.

**Surface.**

- **§64** (the plugin): `typeshade({ console, ir })`, and the host view's default export.
- **§65**: `resident(value)`, `write()`, `destroy()` and `configure({ runtime })`.
- **§66**: the printed form.
- **§67**: the default runtime, the console options and the printed lines.
- **§69 (new)**, "Running a compiled program": the program runtime and the load-time emitter.

**Exports.**

- `typeshade`: `packModule` takes `PackOptions`, and `Pack`, `PackBinding` and `PackEntry` gain the
  fields of section 1. `resident`, `Resident` and `configure` are reshaped as above.
- `typeshade/vite`: `typeshade` takes `TypeshadeViteOptions`.
- `typeshade/runtime`, public now:
  - `createRuntime`, `runtime`, `Runtime` and `RuntimeOptions`;
  - `Program` and `LoadOptions`;
  - `ComputePipeline`, `RenderPipeline` and `RenderState`;
  - `Frame`, `RenderPass`, `PassTargets`, `Geometry` and `Bindings`;
  - `Texture`, `TextureOptions`, `Sampler` and `SamplerOptions`;
  - `resident`, `Resident` and `configure`, the same functions as the root's, so that a host of
    the runtime never imports the root barrel.
- `typeshade/emit`, new: `repack`.
- `src/api-surface.test.ts` and `api-doc-coverage.test.ts` add `./runtime` and `./emit` to
  their public subpaths, and the op library's subpath stays off the list.

**Code.**

- `src/core/manifest.ts` (new): the manifest builder, from the IR alone. `src/compiler/ts/pack.ts`
  calls it, and `host-face.ts` writes the default export from it instead of computing layouts
  itself.
- `src/runtime/` (new): the program runtime, and `src/runtime.ts` its barrel.
- `src/core/host-entry.ts`, `host-compute.ts`, `host-draw.ts` and `resident.ts`: the WebGPU tier on
  the runtime. `gpuDevice()` gives way to the default runtime.
- `src/core/console-print.ts` (new): the printed form, used by both tiers and both layers.
- `src/core/ir/portable.ts` (new): the portable IR, `declRef` by reference, `-0` kept.
- `src/emit.ts` (new): `repack`.
- `src/vite.ts`: the options, and the one line a recording production build prints.
- `package.json`: the `./runtime/internal` and `./emit` subpaths.

**Tests and gates.**

- `src/core/manifest.test.ts`: for every example, the manifest's layouts equal `reflect()`'s and
  the call layer's, byte for byte (Rule 6.8). An unknown schema is refused with both versions
  named, and the manifest survives JSON unchanged.
- `src/core/ir/portable.test.ts`: every example's portable IR, emitted again, gives the WGSL,
  GLSL, reflection, console variant and manifest byte for byte, with a fixture for `-0` and one
  for a declared function that shadows a builtin.
- `src/runtime/*.test.ts`, against a recording fake device: binding by name and each refusal's
  text; equal layouts for pipelines that reach the same bindings; the cache; a `Resident` shared
  by the call layer and a frame; a sink that receives the events.
- `src/core/console-print.test.ts`: the format string for each method, a label holding `%d`, a
  table, an event with no invocation, the dropped warning.
- `src/vite.test.ts`: `console: 'always'` records under `vite build`, `'never'` under `vite dev`, and
  the default as today; `ir: true` adds the IR; a bundle that imports only a module's default
  export carries none of its CPU tier.
- `scripts/bundle-boundary.ts` (new, in CI's `typecheck + unit` job): walks the module closure of
  `src/runtime.ts` and `src/emit.ts`, fails on a file of `src/compiler` in the first, on a file of
  the front end in the second, and on `typescript` in either, and prints both bundles' gzipped
  sizes. Each size has a budget, set at the size its step lands with, and a rise past it is a
  reviewed change. The emitter's step reports its size against today's 70,714 bytes.
- **The engine journey**, `journeys/engine/`, the gate #335 set before the reference engine:
  - two materials, a shared camera and lights, a shadow pass, a render to texture and a 60-frame
    loop, on public exports only;
  - a private import, or a call on a WebGPU object in its own code, fails it;
  - its last frame is held to a reference;
  - the harness counts the GPU objects the frames create after the first, which must be none.
- The import journey and the compile gate's entry-call leg pass unchanged once the call layer runs
  on the runtime. They are that step's regression test.

## Implementation, in steps

Each step is its own pull request, with a `Change: 0025` line.

1. **The manifest.** Schema 1, the builder in `src/core`, `packModule`'s options, the plugin's
   default export, and `reflect().vertex` agreeing with the manifest.
2. **The program runtime** on WebGPU, with the boundary check and its budget.
3. **The call layer on the runtime.** `configure({ runtime })`, the reshaped `Resident`, and
   the op library's move to `typeshade/runtime/internal`.
4. **The console lines** and the plugin's `console` option.
5. **The journeys' harness on the runtime, and the engine journey.**
6. **The load-time emitter**: the portable IR, `repack`, and `LoadOptions.console`.

The site's runner moves onto the runtime once step 3 is pinned there. That is the site's pin pull
request, and `compiler-changes.md` records `0025` when it lands.

## What it owes downstream

**typeshade.github.io**

- The API reference gains `typeshade/runtime` and `typeshade/emit`.
- The Playground's WebGPU runner moves onto the program runtime: `src/lib/shader-runtime.ts`, with
  `shader-bindings.ts` and `compute-runner.ts`, 2,445 lines at `b3bfddf`. Its WebGL2 path stays
  until the WebGL2 proposal. Its pixel and frame console capture keeps its scissor and passes the
  runtime a sink.
- `PRODUCT.md` names entry point ② (#335).
- The WebGPU concept page (`ConceptsWebgpuPage`, en and ko). Its ownership table's Device row
  says "No TypeShade code touches a WebGPU object", and its No runtime section says there is "no
  TypeShade object to create at startup". Both stay true of the static path and become false of
  the runtime, so the page presents both.
- The Console tab shows the tier and the source line as the printed line does.
- The Korean guide sections AUTHORING.md changes, which `bun run check:guide` lists.

**vscode-typeshade**

- The skill's `references/host.md` says "The runtime creates the device and the pipelines". That
  becomes false with `configure({ runtime })`. The file gains the program runtime beside the raw
  `compile()` path, and the plugin's `console` option.
- The MCP server's `run` tool prints its console lines in the same form, pinned by
  `tools.test.ts`.
- `docs/design.md` §4 declines a rendering preview because it "would still need its own device and
  its own copy of the bindings". It records that the program runtime provides both. Whether to
  build the preview stays that repository's own proposal.

## Decisions for the reviewer

Accepting this proposal accepts each of these. Each is the recommendation above:

1. `Pack` becomes the manifest, schema 1, with everything section 1 lists. A reader refuses a
   schema it does not know, and the builder lives in `src/core`, free of TypeScript.
2. A module's default export, which has no host face today, is its manifest, typed from the host
   view.
3. `typeshade/runtime` becomes the public program runtime, and the op library moves to
   `typeshade/runtime/internal`.
4. Version 1 runs on WebGPU only. WebGL2 and the CPU tier for a host that owns its frame are their
   own proposal, and the manifest carries the WebGL2 conventions from the start.
5. Pipeline layouts built from the manifest, never `layout: 'auto'`, and fixed-function state
   written by the host in `RenderState`, checked against what the manifest knows.
6. One resource model: `Resident` is the buffer of both layers and takes any host value, with
   `write()` and `destroy()`. `Texture` is #204's image, and `Sampler` completes the three.
7. `configure({ runtime })` lets the host give the call layer its device.
8. Every printed console line carries its tier, its line and its invocation. The plugin takes
   `console: 'dev' | 'always' | 'never'`, `'dev'` by default, and the runtime takes `consoleBytes`,
   1 MiB by default. #336 closes in favour of this proposal.
9. `typeshade/emit` exports `repack`, which emits a manifest again from its own portable IR. Only
   the same package version reads the IR, which is never a stable format under this proposal.
10. The boundary is a rule (11.11), checked in CI with a size budget for each subpath: no
    compiler in the runtime, and no front end in the emitter.
11. The engine journey on public exports only is the gate before the reference engine's
    repository, as #335 ordered.
