---
id: '0120'
title: A host opens one `Device` and draws a vertex and fragment entry pair with it on WebGPU, WebGL2 and the CPU tier, over a render hardware interface that TypeShade owns
status: accepted
rules:
  - '8.21'
  - '8.24'
  - '11.7'
  - '11.8'
  - '11.10'
  - '11.11'
  - '11.17'
  - '11.20'
surface:
  - 3
  - 65
  - 66
  - 67
  - 69
exports:
  - createDevice
  - configure
  - Device
  - DeviceOptions
  - DrawOptions
  - VertexEntry
  - FragmentEntry
exports-removed:
  - createRuntime
  - runtime
  - Runtime
  - RuntimeOptions
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The Playground's `host.ts` tab shows each example's real host file from `typeshade/examples`, the Result shows only what that file draws through `createDevice()`, and the site's own renderer (`lib/shader-runtime.ts`, `lib/render-runtime.ts`, `scripts/playground-bindings.ts`, `scripts/playground/cpu-program.ts`, `scripts/playground-raster.ts`) is removed; every page and API entry that copies surface §67 or §69 or names `createRuntime`, `runtime()`, `Runtime`, `RuntimeOptions` or `configure({ runtime })` moves to `Device`, in English and in Korean; `compiler-changes.md` records 0120 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references for the program runtime and for host calls name `createDevice()`, `device.load()`, `device.frame()` and `device.draw()` in place of `createRuntime()`; a fixture or snippet that names `createRuntime` changes; `compiler-changes.md` records 0120 when the pin moves.
  - repo: radiance
    what: '`packages/radiance/src/renderers/PathTracer.ts` and the design records that name `createRuntime` move to `createDevice()` and `device.native` before the release that removes `createRuntime`; `compiler-changes.md` records 0120 when the pin moves.'
  - repo: typenn
    what: A host or test that calls `createRuntime`, `runtime()` or `configure({ runtime })` moves to `createDevice()` before the release that removes them; `compiler-changes.md` records 0120 when the pin moves.
  - repo: typecv
    what: The same search and migration as typenn; `compiler-changes.md` records 0120 when the pin moves.
  - repo: typeaudio
    what: The same search and migration as typenn; `compiler-changes.md` records 0120 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files, tests and options that its implementation adds -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Proposal 0120, `status: accepted`. The front matter is the identity and lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Date and attribution          | Authored 2026-11-03 (UTC) by a Claude Code agent at the owner's direction. The date is the authorship date. It is not an approval date. Git authorship of the containing commit is not an approval signature.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Request source                | The owner (Seungup), in a Claude Code session on 2026-11-03, asked that every example on typeshade.dev come with real host code that runs it through the TypeShade runtime and device, and that the Playground's Result show what that code draws. The owner named X-GIS's render hardware interface (`rhi/src/rhi.ts` in `X-GIS/X-GIS`) as the model and decided D1 to D6 in the same session (Decisions). No GitHub issue is recorded.                                                                                                                                                                         |
| Applicability / effectivity   | `docs/language-design.md` Rules 8.21, 8.24, 11.7, 11.8, 11.10, 11.11 and 11.17 and their items in `reqs/`; `docs/use-typeshade-surface.md` §3, §65, §66, §67 and §69; `typeshade/runtime` (`src/runtime.ts`, `src/runtime/`), the call layer (`src/core/host-*.ts`, `gl-compute.ts`, `gl-context.ts`, `resident.ts`, `owner.ts`), `typeshade/compute` (`src/core/compute/runner.ts`), the host face (`src/compiler/ts/host-face.ts`), a new `src/rhi/`, `examples/`, `src/__api__/surface.md`, and the downstream repositories. The emitted WGSL and GLSL ES 3.00 do not change. No release version is assigned. |
| Review baseline               | `main` at `b76407d54afb17852eb3fb9c3af71ca539967335` (the merge of pull request #1022), read on 2026-11-03. X-GIS read-only at the clone the owner provided, `rhi/` package `@xgis/rhi` 0.0.1.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Review and revision authority | Pull request [#1030](https://github.com/typeshade/typeshade/pull/1030) (branch `claude/proposal-0120-device-rhi`). Git records the revisions of this file. The review and merge of its pull request with `status: accepted` record the decision. This file does not name the hash of the commit that contains it.                                                                                                                                                                                                                                                                                                |
| Amendment                     | A1, 2026-11-09 (UTC): the owner decided in the conversation that the CPU tier loads a module's CPU program lazily, from a chunk of its own, and that the record takes in Rule 11.20 and the validation of M2 and M3 as delivered (see Amendments). A coding agent (Claude Code session, 2026-11-09) drafted the text. The merge of the pull request that carries it is the acceptance. Git holds the earlier text.                                                                                                                                                                                               |

## What changes

**Before.** A host runs a module through one of two layers, and each layer drives WebGPU and
WebGL2 by itself.

- **The call layer** (change 0016, Rules 8.20 to 8.24 and 11.8): an entry or a kernel function
  is called as a function, on WebGPU, WebGL2 or the CPU tier. `createDevice()`
  (`src/runtime/device.ts`, changes 0071 and 0085) owns the calls and the resident arrays. A
  draw is only `fs(canvas, bindings)` for a full-screen fragment entry. A vertex entry, and a
  fragment entry that reads what a vertex entry writes, are `never` in the host view (Rule 8.24,
  issue #204).
- **The program runtime** (changes 0025 and 0054, Rules 11.10 and 11.11, surface §69):
  `createRuntime()` loads a manifest, makes pipelines and records frames and passes,
  `frame.pass(…, (p) => p.draw(pipe, bindings, { count }))`, with vertices and indices from
  typed arrays. It runs on WebGPU and WebGL2 only. Its `rt.device` is the native `GPUDevice` or
  `WebGL2RenderingContext`, which is a different thing from `createDevice()`'s `Device`.

**After.**

1. **A render hardware interface (RHI) that TypeShade owns** (D1). `src/rhi/rhi.ts` declares a
   backend-agnostic GPU interface modeled on X-GIS's `RhiDevice`: opaque handles for a buffer, a
   texture, a texture view, a sampler, a bind group, a bind group layout, a render pipeline and a
   compute pipeline; a device with create, write, read and destroy operations; a command encoder;
   a render pass (`setPipeline`, `setBindGroup`, `setVertexBuffer`, `setIndexBuffer`, `draw`,
   `drawIndexed`); a compute pass (`setPipeline`, `setBindGroup`, `dispatchWorkgroups`,
   `dispatchWorkgroupsIndirect`); and the device's capabilities (`caps`). Three backends
   implement it:
   - **WebGPU**, over a `GPUDevice`.
   - **WebGL2**, over a `WebGL2RenderingContext`. A storage buffer is a data texture whose
     element type the buffer carries (`elem`: `f32`, `i32` or `u32`), as X-GIS's
     `storage-data-texture.ts` and this repository's `core/glsl-data-texture.ts` do. Its programs
     are the GLSL ES 3.00 programs the manifest already carries (`gl.vertices`, `gl.draws`,
     `gl.computes`); the backend builds none.
   - **CPU**, a software device. A compute dispatch runs the entry's CPU code (Rule 11.7) for
     each invocation, `z`, then `y`, then `x`, with the workgroup memory zeroed for each
     workgroup, as the call layer's CPU tier does today. A render pass rasterizes triangles and
     runs the vertex and fragment entries' CPU code (item 5).

   The RHI's names follow X-GIS's where the meaning is the same, so that X-GIS can later replace
   its own `@xgis/rhi` with TypeShade's (What it owes downstream). Whether the RHI is a public
   export is open decision O1.

2. **Both layers on the RHI** (D2). The program runtime (`src/runtime/program.ts`,
   `resources.ts`, `gpu.ts`, `gl.ts`, `gl-draw.ts`) records its pipelines, frames and passes
   through the RHI and calls no WebGPU or WebGL2 function directly. The call layer
   (`src/core/host-draw.ts`, `host-compute.ts`, `host-entry.ts`, `host-kernel.ts`,
   `host-kernel-gl.ts`, `gl-compute.ts`) runs each entry call, kernel call, draw and `fuse` plan
   as program-runtime pipelines and passes. `typeshade/compute` (`createComputeRunner`) runs on the
   RHI as well; its export does not change. Each tier then has one backend implementation in
   place of two or three (Why, measurements). The program runtime gains the CPU tier through the
   CPU backend. The emitted WGSL and GLSL ES 3.00 do not change, and every behavior Rules 8.24,
   11.8, 11.11 and 11.13 state today holds, except the changes items 3 to 6 name.

3. **One public entry point, `Device`** (D3). `createDevice()` is the one way in. A `Device`
   keeps every member it has today (`array`, `texture`, `release`, `fuse`, `wait`, `dispose`,
   `info`, `tier`, `skipped`, `limits`, `lost`, `statistics`, `chunkSize`, `chunkRates`,
   `timeBudgetMs`, `fp64Flavor`) and gains the program runtime's operations and a draw:

   ```ts
   interface Device {
     // … every member of today …
     /** The native object of the tier: a `GPUDevice` on WebGPU, a `WebGL2RenderingContext` on
      *  WebGL2, `null` on the CPU tier. Escape hatch (Rule 11.17). */
     readonly native: object | null;
     /** The canvas `createDevice({ canvas })` named, or `null`. */
     readonly canvas: HTMLCanvasElement | OffscreenCanvas | null;
     load<E extends PackBindings>(program: Pack<E>, options?: LoadOptions): Program<E>;
     sampler(options?: SamplerOptions | object): Sampler;
     frame(): Frame;
     submit(...encoders: readonly object[]): ReturnType<Frame['submit']>;
     draw<A, O extends I, I, VB, FB>(
       stages: { readonly vertex: VertexEntry<A, O, VB>; readonly fragment: FragmentEntry<I, FB> },
       options: DrawOptions<A, VB & FB>,
     ): Promise<void>;
   }
   ```

   `device.texture()` takes the program runtime's `TextureOptions` as well as today's
   `{ size, format, storage }`, so one texture type serves calls and passes. `DeviceOptions`
   gains `canvas`, and the program runtime's `programs`, `console`, `consoleBytes` and `emit`;
   `DeviceOptions.device` takes a `WebGL2RenderingContext` as well as a `GPUDevice`, as
   `createRuntime({ device })` does today.

   **The host's code, with the owner's example:**

   ```ts
   import { createDevice } from 'typeshade/runtime';
   import { vs, fs } from './plasma.shade.ts';

   const device = await createDevice({ canvas });
   await device.draw(
     { vertex: vs, fragment: fs },
     { count: 3, bindings: { U: { time, resolution: [w, h] } } },
   );
   ```

   - **The target.** The canvas is given once, as `createDevice({ canvas })`. A canvas keeps the
     first kind of context it hands out, so the device takes the canvas's context only after its
     tier has opened: on WebGPU after the `GPUDevice` exists, on WebGL2 as the context the device
     runs on, and on the CPU tier as a `2d` context. Every draw of the device goes into that
     canvas, at its width and height. `device.draw()` on a device with no canvas is a `TypeError`
     that names `createDevice({ canvas })`.
   - **The return value.** A `Promise<void>` that resolves when the frame is submitted, as
     `fs(canvas, bindings)` does today. The draw reads nothing back.
   - **The host view.** The host view types a vertex entry as `VertexEntry<A, O, B>` and a
     fragment entry as `FragmentEntry<I, B>`, in place of `never`. `A` is the record of the
     vertex entry's `location` inputs by field or parameter name, each the typed array that holds
     it (`Float32Array` for an `f32` scalar or vector, `Int32Array` for `i32`, `Uint32Array` for
     `u32`). `O` and `I` are the interstage records keyed by location, each value the WGSL type
     and interpolation as a string literal type, for example `{ readonly 0: 'vec2f perspective' }`.
     `B` is the entry's bindings object, as Rule 8.24 types a compute entry's. A full-screen
     fragment entry stays callable as `fs(canvas, bindings)` and is also a `FragmentEntry<{}, B>`.
     A `VertexEntry` and a `FragmentEntry` are handles: they carry the entry's name, layouts and
     programs, and calling one is a `TypeError`, except the full-screen call above.
   - **The pair check.** `O extends I` makes `tsc` refuse a pair whose fragment reads a location
     the vertex does not write, or reads it with another type or interpolation. A vertex may
     write a location the fragment does not read, as WGSL allows. The draw makes the same check
     before anything runs, for a host that is not type-checked, and a mismatch is a `TypeError`
     that names the location and both types. The two entries must be of one module (open
     decision O4).

   `createRuntime()` and `runtime()` stay for one release. Each warns once per page with
   `console.warn`, with the text
   `createRuntime() is deprecated; use createDevice() (change 0120)` (or `runtime()`), and runs as
   today on the RHI. The release after that removes `createRuntime`, `runtime`, `Runtime` and
   `RuntimeOptions` (milestone M7). The migration table:

   | Today                                      | After                                                                        |
   | ------------------------------------------ | ---------------------------------------------------------------------------- |
   | `const rt = await createRuntime(options)`  | `const device = await createDevice(options)`                                 |
   | `await runtime()` (the default runtime)    | `const device = await createDevice(); configure({ device });` (O3)           |
   | `rt.load(m)`, `rt.frame()`, `rt.submit(…)` | `device.load(m)`, `device.frame()`, `device.submit(…)`                       |
   | `rt.texture(o)`, `rt.sampler(o)`           | `device.texture(o)`, `device.sampler(o)`                                     |
   | `rt.device` (the native object)            | `device.native`                                                              |
   | `rt.tier` (`'webgpu'` or `'webgl2'`)       | `device.tier` (`'webgpu'`, `'webgl2'` or `'cpu'`)                            |
   | `rt.limits`, `rt.info`                     | `device.limits`, `device.info`                                               |
   | `rt.destroy()`                             | `await device.dispose()`                                                     |
   | `createRuntime({ device })`                | `createDevice({ device })`                                                   |
   | `createDevice({ runtime: rt })`            | `createDevice({ device: rt.device })` now; the `runtime` option goes with M7 |
   | `configure({ runtime: rt })`               | `configure({ device })` with a `Device` (O3)                                 |
   | `p.draw(pipe, b, { count })` in a pass     | unchanged, inside `device.frame().pass(…)`                                   |

   In this repository at the baseline, `createRuntime(` occurs 323 times in 47 files and
   `createDevice(` 209 times in 33 files (`git grep`, `changes/` excluded): the runtime and its
   tests, the journeys, the scripts, the host examples, the rules, the surface document and the
   coverage model. M4 moves each use of `createRuntime`, `runtime()` and `configure({ runtime })`
   except the tests that pin the deprecated path, and M7 removes those.

4. **The first draw's scope** (D4). `DrawOptions<A, B>` is:

   ```ts
   interface DrawOptions<A, B> {
     /** Vertices to draw, or indices when `indices` is given; `indices.length` when omitted
      *  with `indices`. */
     readonly count?: number;
     /** One typed array for each `location` input of the vertex entry, by its name. */
     readonly attributes?: A;
     readonly indices?: Uint16Array | Uint32Array;
     /** Instances to draw: 1 when omitted. The vertex entry reads `instance_index`. */
     readonly instances?: number;
     /** The bindings both entries reach, each the binding's host value (Rule 8.21). */
     readonly bindings: B;
     /** The colour the frame starts from: `[0, 0, 0, 1]` when omitted. */
     readonly clear?: readonly [number, number, number, number];
   }
   ```

   Each `device.draw()` is one frame with one pass into the device's canvas, with the topology
   `triangle-list`. The device interleaves the attribute arrays into the one tightly packed vertex
   buffer that `reflect().vertex` and the manifest's `entries[].vertex` describe, so the pipeline
   and the WebGL2 program are the ones the program runtime builds today. Every attribute is per
   vertex. Before anything runs, the draw refuses with a `TypeError` that names the option: a
   `count` that is not a whole number from 0, or that is missing with no `indices`; an attribute
   key the vertex entry does not have, or a missing one; an attribute of another typed-array type,
   or one shorter than its component count times the vertices the draw reads; an index past the
   vertices the attributes hold; an `instances` that is not a whole number from 1.

   What the first draw does for each item that #204 keeps for later work at the `Device` level
   (the program runtime layer has each already, through `device.frame()`):

   | Item                       | The first `device.draw()`                                                                                                                        |
   | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
   | Blending                   | None. The fragment's colour replaces the pixel, and the frame is opaque, as Rule 8.24's draw is today.                                           |
   | Depth test                 | None. Triangles draw in order, and a later triangle covers an earlier one. `frag_depth` is refused.                                              |
   | Culling                    | None. Both faces draw. `front_facing` is true for a counter-clockwise triangle, WebGPU's default.                                                |
   | A target other than canvas | Refused: the target is the canvas of `createDevice({ canvas })`. A fragment output at a location other than 0, or an integer output, is refused. |
   | Several passes             | One pass a draw. Several meshes in one frame use `device.frame()`.                                                                               |
   | Other topologies, MSAA     | Refused by omission: no option names them.                                                                                                       |
   | Per-instance attributes    | None. An instance reads its data from a storage binding through `instance_index`.                                                                |

   The draw runs on the device's tier only. A canvas keeps its first context, so a draw does not
   fall back to a later tier as a kernel call does (Rule 11.8). A draw the tier cannot run (on
   WebGL2 an entry with no GLSL program, on the CPU tier an entry that reaches a texture or a call
   only a GPU computes) is a `TypeError` that names why, as Rule 8.24 says today for a full-screen
   draw.

5. **The CPU tier draws triangles.** The CPU backend runs the vertex entry's CPU code for each
   vertex at `f32` precision (Rule 11.7). It clips each triangle against WebGPU's clip volume
   (`0 <= z <= w`, `w > 0`; `x` and `y` are scissored to the canvas), maps it to the framebuffer
   as WebGPU's viewport does (row 0 at the top), and covers the pixel centres inside it, a centre
   on an edge by the top-left rule. It interpolates each interstage value as its WGSL
   interpolation says: `perspective` (the default) perspective-correct, `linear` in screen space,
   and `flat` from the first vertex. With no multisampling, `center`, `centroid` and `sample`
   sample at the pixel centre. The fragment's `position` is the framebuffer position WGSL defines
   for a fragment. It runs the fragment entry's CPU code for each covered pixel, a `discard`
   writing nothing, and converts the colour as WebGPU converts it to an 8-bit unorm canvas. The
   frame goes to the canvas's `2d` context with `putImageData`.

6. **Every example has a real host file** (D5). Each `examples/**/*.shade.ts` that exports an
   entry or a kernel function gets a host file that runs it through `createDevice()`: a draw, a
   dispatch or a kernel call. A generator writes a starter from the module's host face: a uniform
   whose fields are named `time`, `resolution` or `mouse` gets the frame's values, other scalars
   and vectors their zero or one, a storage array a typed array of the data its element type
   takes, and a sampled texture a generated checkerboard from `device.texture()`. A person reviews
   each starter, and the reviewed file is checked in. A test keeps each host file type-checking
   against its module's host view under `tsc --strict`, and runs it on the CPU tier. Where the
   files live, their contract and the examples that cannot have one yet are open decision O7.
   `typeshade/examples` carries each host file's text beside its module's, as `hostExamples`
   does today, so the site reads no file.

7. **The Playground** (D6, downstream). typeshade.github.io shows each example's real host file
   in its `host.ts` tab, the Result shows only what that file draws, and the site's own renderer
   is removed (What it owes downstream).

**Not changed.** The emitted WGSL and GLSL ES 3.00, byte for byte; the manifest's JSON fields
(schema 2); the call shapes of Rules 8.21 to 8.24 for compute entries, kernel functions and the
full-screen fragment draw; the tiers and their order under `configure({ prefer })` and
`createDevice({ prefer })` for a call; `fuse` and its report (Rule 11.13); the frame, pass and
pipeline API of surface §69, which moves from `Runtime` to `Device` with its signatures.

### Decisions

Decided by the owner on 2026-11-03 in the Claude Code session. These are decisions on the draft's
direction. They are not the acceptance of the proposal, which is the merge of its pull request
with `status: accepted`.

- **D1, decided.** TypeShade owns a render hardware interface modeled on X-GIS's `RhiDevice`,
  with three backends: WebGPU, WebGL2 (storage as data textures; the existing GLSL ES 3.00
  programs) and CPU (compute through the CPU code of Rule 11.7; triangles rasterized with WGSL's
  interpolation). It is designed so that X-GIS can later replace `@xgis/rhi` with it.
- **D2, decided.** The program runtime runs on the RHI, and the call layer runs on the program
  runtime. One backend implementation for each tier. Behavior and the emitted WGSL and GLSL do
  not change; the existing tests and gates hold them.
- **D3, decided.** `createDevice()` is the one public entry point. A `Device` has the call-layer
  operations, the program-runtime operations and a vertex and fragment draw. `createRuntime()`
  stays one release with a deprecation warning and is then removed. The native object is
  `device.native`.
- **D4, decided.** The first draw takes a vertex count, vertex attributes from typed arrays keyed
  by the vertex input's field names (layout from `reflect().vertex`), an index array
  (`Uint16Array | Uint32Array`) and an instance count, with `triangle-list`. Blending, depth test,
  culling, other targets and several passes stay #204's later work at the `Device` level. It runs
  on all three tiers.
- **D5, decided.** Every example with an entry or a kernel function has a host file that runs it
  through `createDevice()`, generated as a starter from the host face and reviewed per example,
  with a test that type-checks each one and runs it on the CPU tier.
- **D6, decided.** The Playground shows the real host file and draws only what it draws; the
  site's own renderer is removed. This is downstream work, and X-GIS is a downstream that may move
  to the RHI.

### Decisions O1 to O8

The draft left these open. The owner decided each as the draft recommended, on 2026-11-03 in the
Claude Code session ("승인"): O1 (a), O2 (a), O3 (a), O4 (a), O5 (a), O6 (a), O7 (a), O8 (a). The
text of each option stays as the draft gave it, so the record shows what was weighed.

- **O1. The RHI public or internal.** (a) Internal at first: `src/rhi/`, in no `package.json`
  subpath, imported by `typeshade/runtime` and `typeshade/compute`. (b) Public now as
  `typeshade/rhi`, listed in `src/__api__/surface.md`. **Recommendation: (a).** The interface is
  shaped by its first consumers, the program runtime and the call layer, and an export removed
  later costs every downstream a migration, while an export added later costs none. A later
  proposal makes it `typeshade/rhi` when X-GIS moves to it, with X-GIS's needs (render bundles, a
  screen-pass lifecycle, validation scopes) measured against it.
- **O2. Where the CPU tier gets the program of `device.load(manifest)`.** The call layer's CPU
  tier runs the generated code the Vite plugin writes into the module (Rule 11.7); a manifest is
  JSON and carries no code. (a) The default export of a module's host import carries the CPU code
  of its entries under a `Symbol` key, which `JSON.stringify` drops, so the manifest's JSON does
  not change; a manifest from `packModule()` or from JSON has none, and `device.load()` on the CPU
  tier refuses it with a `TypeError` that says so. (b) The CPU backend interprets the manifest's
  portable `ir` with the oracle's tree walk (`core/oracle.ts`): no `new Function`, but the oracle
  enters the runtime's closure, and `ir` is opt-in. (c) The manifest carries the generated code as
  text: that needs `new Function`, which Rule 11.7 forbids. **Recommendation: (a).** Rule 11.10
  gains one sentence (the default export's `Symbol`-keyed CPU program, outside the JSON) and Rule
  11.7 names the vertices and pixels of a draw and the program runtime's passes. Amendment A1
  (2026-11-09) replaces (a) with a lazy form of it: the `Symbol` key holds a loader of the CPU
  program, not the program.
- **O3. The default device.** `configure({ runtime })` names the program runtime whose device the
  default owner's calls use, and `runtime()` returns the default runtime. (a) `configure({ device })`
  takes a `Device`, whose backend the default owner's calls then use; `configure({ runtime })` and
  `runtime()` are deprecated with `createRuntime()`; no new accessor is added. (b) A new
  `defaultDevice()` export that returns the default owner's `Device`. **Recommendation: (a).** It
  adds no export, and a host that wants one device for everything writes the two lines of the
  migration table.
- **O4. A vertex and a fragment entry of two modules.** GLSL ES 3.00 matches interstage values by
  name, and two modules name them apart; WGSL matches them by location. (a) The first draw takes
  two entries of one module: the host view brands each handle with its module, so `tsc` refuses a
  pair of two modules, and the draw refuses it with a `TypeError`. (b) Two modules, with the
  WebGL2 backend renaming the varyings by location at link time. **Recommendation: (a)** now, and
  (b) as later work if a host asks for it.
- **O5. A WebGL2 device's kernel calls.** Today a kernel call on WebGL2 uses a context of its own,
  and `createDevice({ runtime })` refuses a WebGL2 runtime (Rule 11.11). (a) On the RHI, a `Device`
  on WebGL2 has one context, the canvas's when it has a canvas, and its calls, passes and draws use
  it. (b) Calls keep a context of their own beside the canvas's. **Recommendation: (a).** It is
  D2's one implementation for each tier, and a `Resident` then lives in the context that draws it.
- **O6. Textures and derivatives in a CPU-tier draw.** (a) The CPU tier refuses a draw whose
  entries reach a texture or a derivative, as Rule 8.24 says for a full-screen draw today.
  (b) M3 adds `textureLoad` and `textureSampleLevel` on a texture of the CPU tier's memory
  (`core/cpu-texture.ts`), and runs fragments in 2×2 quads for derivatives and implicit-LOD
  sampling. **Recommendation: (a)** in this proposal, with (b) as a proposal of its own. A grep
  of the examples finds up to 22 files that reach a texture, a derivative, a barrier or a subgroup
  function; the host-file test records the refusal of each that the CPU tier cannot run.
- **O7. The host files: where, what shape, and the exceptions.** (a) `examples/<id>.host.ts`
  beside each `examples/<id>.shade.ts`, and `examples/hosts/<id>/host.ts` as today for the host
  examples. Each exports `run(canvas?: HTMLCanvasElement | OffscreenCanvas): Promise<unknown>`:
  an example that draws draws into `canvas` and returns nothing; an example that computes returns
  what it computed, which the Playground prints. An example that animates also exports
  `animate(canvas, signal: AbortSignal): void`. `ShaderExample` in `typeshade/examples` gains
  `hostFile` and `hostSource`. Six modules have no entry a host can call until other work lands,
  and get no host file in this proposal: `storage-texture` and `subgroup-reduce` (a storage
  texture binding and a `subgroup` builtin), and `cube-array-gather`, `cube-env`, `msaa-resolve`
  and `shadow-compare` (a `texture_1d`, a cube, a multisampled and a depth texture binding, which
  have no host value, #204). The test lists them with that reason. (b) A folder for each example,
  `examples/<id>/`: it moves 102 module files, which `scripts/changes.ts` counts as removing and
  adding every example. **Recommendation: (a).**
- **O8. X-GIS as a tracked downstream.** `scripts/changes.ts` lists the downstream repositories
  (`DOWNSTREAM_REPOS`), and X-GIS is not one, so the front matter cannot name it. (a) A separate
  tooling pull request adds X-GIS when it depends on a published TypeShade; today it carries its
  own copy, `@xgis/shader-dsl`. (b) Add it in this proposal's first implementing pull request.
  **Recommendation: (a).** This proposal records X-GIS in What it owes downstream as expected,
  untracked work.

## Why

**The problem.** The owner wants each example to come with host code that runs it, and the
Playground to show what that code draws. At the baseline no call-layer host code can draw most
examples, and the program runtime that can draw them has no CPU tier and speaks GPU vocabulary.
The two layers also implement the same backends twice.

**Measured: the examples by kind.** On 2026-11-03, at the baseline, `hostFace()` from
`src/compiler/ts/host-face.ts` over every `examples/**/*.shade.ts` (114 files: 102 at the top
level and 12 in `hosts/`, `lib/` and `passes/`), with each export's kind and, for a `never`, its
reason:

| Kind of module                                                                    | Files |
| --------------------------------------------------------------------------------- | ----: |
| A vertex entry, with a fragment entry that reads interstage values (both `never`) |    69 |
| A vertex entry (`never`), with a full-screen fragment entry (callable)            |    11 |
| A vertex entry (`never`), with a fragment entry `never` for a texture binding     |     4 |
| A full-screen fragment entry, no vertex entry                                     |     3 |
| A compute entry (callable)                                                        |    11 |
| A kernel function, no entry                                                       |    12 |
| An entry `never` for another reason (a storage texture, a `subgroup` builtin)     |     2 |
| Helper functions only, no entry (`lib/noise`, `hello-camera`)                     |     2 |
| **Total**                                                                         |   114 |

One file with a full-screen fragment (`hosts/string-keys-record`) also has a kernel function; it
is counted once, with the vertex entries. So 84 of 114 modules have a vertex entry, and the host
view types it `never` (84 `it is a vertex entry …` reasons); 69 fragment entries are `never` as
`… is what a vertex entry writes` (Rule 8.24). The owner's count, 74 of 111, was taken on another
set; this proposal uses the measured one. Of the 84 vertex entries, `compile()` and
`vertexLayoutOfEntry` find one that reads vertex attributes (`hello-vsin`); 83 draw from
`vertex_index` alone, most as a full-screen triangle. So `count: 3` and bindings run most
examples, and D4's attributes are for the meshes an author writes.

**Measured: the two layers.** Line counts at the baseline (`wc -l`, tests excluded):

| Layer                                | Files                                                                                                                                                                                                                                        | Lines |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: |
| Program runtime                      | `runtime/runtime.ts` 794, `program.ts` 2,114, `resources.ts` 349, `gpu.ts` 152, `gl.ts` 457, `gl-draw.ts` 1,810                                                                                                                              | 5,676 |
| Call layer and its device owner      | `core/host-entry.ts` 2,016, `host-kernel.ts` 1,939, `gl-compute.ts` 1,105, `host-draw.ts` 740, `resident.ts` 737, `host-compute.ts` 517, `host-kernel-gl.ts` 204, `owner.ts` 123, `gl-context.ts` 30, `tiers.ts` 20, `runtime/device.ts` 858 | 8,289 |
| `typeshade/compute`                  | `core/compute/runner.ts`                                                                                                                                                                                                                     |   698 |
| The CPU tier both layers would share | `core/cpu-runtime.ts` 1,290, `cpu-codegen-runtime.ts` 210, `cpu-texture.ts` 199 (and the generator `cpu-codegen.ts` 2,097, the oracle `oracle.ts` 915)                                                                                       | 1,699 |

**Measured: the duplicated backend code.** The files that call the same native operation, by
`grep -c` over `src/runtime/` and `src/core/` (tests excluded):

| Native operation                              | Program runtime                                      | Call layer and `typeshade/compute`                                                           |
| --------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `requestAdapter`                              | `gpu.ts`, `runtime.ts`                               | `host-entry.ts`, `variant-link.ts`                                                           |
| `createRenderPipeline`, `beginRenderPass`     | `gpu.ts`, `program.ts`, `runtime.ts`                 | `host-draw.ts`                                                                               |
| `getCurrentTexture` (the canvas)              | `runtime.ts`                                         | `host-draw.ts`                                                                               |
| `createComputePipeline`, `beginComputePass`   | `gpu.ts`, `program.ts`                               | `host-entry.ts`, `compute/runner.ts`                                                         |
| `createBindGroup`                             | `gpu.ts`, `runtime.ts`                               | `host-draw.ts`, `host-entry.ts`, `compute/runner.ts`                                         |
| `mapAsync` (a readback)                       | `gpu.ts`, `program.ts`, `resources.ts`, `runtime.ts` | `host-entry.ts`, `compute/runner.ts`                                                         |
| `getContext('webgl2')`                        | through `gl-context.ts`                              | `gl-context.ts`, `host-draw.ts`, `variant-link.ts`                                           |
| `compileShader`, `linkProgram`                | through `gl-compute.ts`                              | `gl-compute.ts`, `host-draw.ts`, `host-kernel-gl.ts`, `variant-link.ts`, `compute/runner.ts` |
| `createFramebuffer`                           | `gl-draw.ts`                                         | `gl-compute.ts`, `host-draw.ts`, `host-kernel-gl.ts`, `compute/runner.ts`                    |
| `readPixels`                                  | `gl-draw.ts`                                         | `gl-compute.ts`, `host-kernel-gl.ts`, `compute/runner.ts`                                    |
| `texImage2D`, `texSubImage2D` (data textures) | `gl-draw.ts`                                         | `gl-compute.ts`, `host-draw.ts`, `host-kernel-gl.ts`, `compute/runner.ts`                    |

Some sharing exists already: the program runtime's WebGL2 tier compiles through `gl-compute.ts`
and packs through `host-entry.ts`. But a full-screen draw has its own WebGPU pipeline, render
pass and canvas presentation in `host-draw.ts` beside the program runtime's, and a WebGL2 pass
program is driven from three places. A fix to one (a canvas's sticky context, a row flip, a
data texture's format) reaches the others only by hand. The count of duplicated lines is not
measured; the table counts files.

**Measured: X-GIS's RHI.** `rhi/src/rhi.ts` (761 lines) declares `RhiDevice` with opaque handles,
`createBuffer`/`writeBuffer`/`destroyBuffer`, textures, samplers, bind groups and layouts,
`createPipeline`, a render pass with `setVertexBuffer`/`setIndexBuffer`/`draw`/`drawIndexed`, a
compute pass with `dispatchWorkgroups`, a command encoder and `RhiCaps` (`compute: 'native' |
'fragment-emulated'`, `shaderLanguage: 'wgsl' | 'glsl-es300'`, `executionModel`). Its backends
are `rhi-webgpu` and `rhi-webgl2` (`rhi-webgl2.ts` 1,565 lines, `storage-data-texture.ts`, the
storage element `elem`). `rhi-provider.ts` orders the backends as data and records which backend
claimed a canvas, for the same sticky-context reason as Rule 8.24. It has no CPU backend.
X-GIS carries its own copy of this compiler's predecessor as `@xgis/shader-dsl`
(`shader-dsl/package.json`), and `typeshade/compute` was written for it (X-GIS #1903).

**Alternatives.**

- **Adopt `@xgis/rhi` as a shared package.** Rejected by the owner (D1). The CPU backend runs on
  TypeShade's oracle and generated CPU code, which `@xgis/rhi` cannot depend on without inverting
  the dependency, and the owner chose that TypeShade owns the interface. X-GIS can move to
  TypeShade's RHI later.
- **Draw on the program runtime only.** Give the program runtime a CPU tier and leave the call
  layer as it is. Rejected: the duplicated backends stay, a host still holds two objects for one
  device, and the `never` entries stay `never` in the host view, so D5's host files would use
  manifests and GPU vocabulary.
- **Keep two entry points.** Keep `createRuntime()` beside `createDevice()`. Rejected (D3): two
  objects named "device" (`rt.device` and `Device`) for one GPU, two option sets and two lists of
  tiers, and a `Resident` shared between them through `configure({ runtime })`.
- **A draw method on the entry, `vs.draw(fs, options)`.** Rejected: it hides the device that owns
  the canvas and the resources, which D3 makes explicit.

**Assumptions.** The program runtime's WebGL2 programs (`gl.vertices`, `gl.draws`) are the
programs a vertex and fragment pair needs, so the WebGL2 backend builds none. The interleaving of
D4's attributes into the manifest's vertex layout gives the bytes the program runtime's
`vertices` takes today. The CPU rasterizer's edge pixels may differ from a GPU's, which WebGPU
does not specify to the pixel; the tests compare tiers with a measured tolerance at edges and
exact interiors. Each is checked at implementation, and a wrong one is a recorded deviation.

## What it touches

- **Rule 8.21.** A draw's attributes are typed arrays keyed by field name, a host value of a new
  kind beside the bindings.
- **Rule 8.24.** A vertex entry and a fragment entry that reads interstage values become
  `VertexEntry` and `FragmentEntry` handles in the host view; the paragraph that keeps them `never`
  names only what stays `never` (a binding with no host value); `device.draw()`, its pair check,
  its options, its refusals and its tiers (items 3 and 4).
- **Rule 11.7.** The CPU tier also runs the vertices and pixels of a `device.draw()` and the
  program runtime's passes, with the rasterizer of item 5, and its code reaches `device.load()` as
  O2 decides.
- **Rule 11.8.** `createDevice({ canvas })`; `DeviceOptions.device` takes a WebGL2 context;
  `configure({ device })` and the deprecation of `configure({ runtime })` (O3); one WebGL2 context
  for a device (O5); `device.native`.
- **Rule 11.10.** The default export of a host import carries the CPU program outside its JSON
  (O2 (a)). If O2 is decided otherwise, an amendment withdraws this entry. Amendment A1: the
  default export carries a loader of the CPU program, in a chunk of its own, and the Enforced-by
  sentence on `src/vite.test.ts` says that the default export's chunk carries no CPU tier.
- **Rule 11.20** (Amendment A1). Its Enforced-by names `src/rhi/` beside `src/runtime/` and
  `src/core/` as what `scripts/bundle-boundary.ts` holds each host face to. No requirement of the
  rule changes.
- **Rule 11.11.** The program runtime is reached through `Device`, runs on the RHI, has the CPU
  tier, and `createRuntime()` is deprecated and then removed.
- **Rule 11.17.** The escape hatches `Runtime.device` and `createRuntime({ device })` become
  `Device.native` and `createDevice({ device })`; the coverage model (`src/core/coverage/`) names
  them, and the table of Appendix C is baked again.
- **Surface §3.** It names `createRuntime({ programs })`, which becomes
  `createDevice({ programs })`.
- **Surface §65.** It names `configure({ runtime })` for a kernel call's device (O3).
- **Surface §66.** It names `createRuntime({ console: sink })`, which becomes
  `createDevice({ console: sink })`.
- **Surface §67.** It names `configure({ runtime })`, and gains "Drawing a vertex and fragment
  entry" with `device.draw()`, D4's scope and the CPU tier's rasterizer.
- **Surface §69.** "Running a compiled program" is written again around `Device`: the migration
  table, `device.load()`, `device.frame()`, `device.native`, the CPU tier.
- **exports.** `createDevice` and `DeviceOptions` reshaped (`canvas`, `programs`, `console`,
  `consoleBytes`, `emit`; `device` takes a WebGL2 context; `runtime` removed at M7); `Device`
  reshaped (item 3); `configure` reshaped (`device`); `DrawOptions`, `VertexEntry` and
  `FragmentEntry` added. With O1 (b), the `typeshade/rhi` exports are added by amendment.
- **exports-removed.** `createRuntime`, `runtime`, `Runtime` and `RuntimeOptions`, at M7, one
  release after the deprecation release.
- **codes: none.** The refusals are runtime `TypeError`s, as Rule 8.24's are; no diagnostic code
  is added.
- **examples: none.** The set of `examples/*.shade.ts` does not change. The host files of D5 are
  new files beside them (O7).

**Implementation.** `src/rhi/rhi.ts` (the interface), `src/rhi/webgpu.ts`, `src/rhi/webgl2.ts`
(with the data textures of `core/glsl-data-texture.ts`), `src/rhi/cpu.ts` and
`src/rhi/cpu-raster.ts`; `src/runtime/program.ts`, `resources.ts`, `runtime.ts`, `gl.ts` and
`gl-draw.ts` on the RHI, `gpu.ts` folded into `src/rhi/webgpu.ts`; `src/runtime/device.ts` with
the members of item 3; `src/core/host-draw.ts`, `host-compute.ts`, `host-entry.ts`,
`host-kernel.ts`, `host-kernel-gl.ts`, `gl-compute.ts` and `core/compute/runner.ts` on the program
runtime; `src/compiler/ts/host-face.ts` (the vertex and fragment faces, their view types and the
CPU code of each entry); `src/runtime.ts`; `src/core/resident.ts` (`configure`);
`src/__api__/surface.md` baked again; the host-file generator and the host files (O7);
`src/AGENTS.md`, `AGENTS.md` and `CHANGELOG.md`.

**Validation required.**

- Functional, each milestone: `bun run test`; `bun run gate:journeys` on WebGPU, WebGL2 and the
  CPU tier; the compile gate (Tint and WebGL2); the render and perf gates; `bun run gate:boundary`
  with the bundle budgets of `scripts/bundle-budget.json`; the emit goldens unchanged.
- The RHI: one conformance suite that runs the same buffers, textures, passes and dispatches on
  each backend and compares the results (`src/rhi/rhi-conformance.test.ts`, with the WebGPU and
  WebGL2 legs in the journeys).
- The draw: a test for each refusal of item 4 with its text; a pair check under `tsc` and at run
  time; `device.draw()` of `hello-vsin` (attributes), a full-screen triangle and an indexed,
  instanced mesh on each tier, the CPU frame compared to the WebGPU and WebGL2 frames of the
  journeys with a measured edge tolerance.
- Both halves (`CLAUDE.md`, A test reads both halves): the host view of a module with a vertex
  and fragment pair read by `tsc` (the `VertexEntry` and `FragmentEntry` types and the pair check)
  and the module read by the language service (`getDiagnostics`, `getHover` on the entries), in
  the shape of `src/language-service/ambient-parity.test.ts`.
- The host files: `examples/host-files.test.ts` type-checks each against its module's host view
  under `tsc --strict` and runs its `run()` on the CPU tier into a 64 by 64 stand-in canvas,
  pinning a hash of the frame or the returned value, or the refusal text for an example O6 or O7
  excludes.
- Document: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
  `python scripts/doorstop-check.py -C` for the seven rules and five sections;
  `bun scripts/changes.ts --base origin/main` inside this declaration.

### Draft impact estimate

**Known.** The front matter's seven rules, five sections and nine exports; 47 files that call
`createRuntime(` and 33 that call `createDevice(` in this repository; 103 new host files (112
modules with an entry or a kernel function, less the 9 host examples that have one) less the 6
exceptions of O7, so 97; the 9 host examples' files moved to `createDevice()`; the files of the
layers in Why. Compatibility: a host that uses `createRuntime()`, `runtime()` or
`configure({ runtime })` sees a warning for one release and must migrate before M7; a host of
`createDevice()` and of entry and kernel calls sees no change, except O5's one WebGL2 context. The
emit does not change, so no shader file downstream changes.

**Estimated, not measured.** The size of the runtime's bundle: the duplicated backends leave and
the rasterizer arrives, so the net change is unknown until `bun run gate:boundary` measures it at
each milestone. The size of the RHI interface: X-GIS's is 761 lines; TypeShade's adds the CPU
backend's needs (a readback, a canvas presentation) and leaves out X-GIS's optional screen-pass
and validation-scope members. Duration and cost: unknown, no basis for an estimate.

**Dependencies.** None added: the WebGPU types stay structural, as `typeshade/compute` keeps them,
and the CPU backend uses the CPU tier's op library that `typeshade/runtime/internal` ships.

**Risks.** The canvas's sticky context with a tier fallback; a WebGL2 context shared by calls and
draws (O5) that changes the state a pass sets and restores; the CPU rasterizer's cost on large
canvases, which the Playground's Result meets first.

**Decisions to resolve before acceptance:** O1 to O8.

**Milestones, in order** (each one pull request or more, each commit `Change: 0120`):

1. **M1. The RHI interface and the WebGPU backend; the program runtime on it.** `src/rhi/rhi.ts`,
   `src/rhi/webgpu.ts`; `createRuntime()` unchanged in its API, running on the RHI. Verifies:
   `src/runtime/*.test.ts`, `render-state-parity.test.ts`, the WebGPU journeys and the render gate
   with no changed frame; the boundary gate.
2. **M2. The WebGL2 backend.** `src/rhi/webgl2.ts` with the data textures and the manifest's
   programs; the program runtime's WebGL2 tier on it. Verifies: `gl-draw.test.ts`, the WebGL2
   journeys, the compile gate, and the RHI conformance suite on both GPU backends.
3. **M3. The CPU backend.** `src/rhi/cpu.ts` (buffers, textures of the CPU tier's memory, compute
   dispatch through the CPU code of Rule 11.7) and `src/rhi/cpu-raster.ts` (item 5); the program
   runtime's CPU tier, with O2's program source. Verifies: the conformance suite on the CPU backend
   against the oracle's dispatch; the rasterizer's interpolation, clipping, fill rule and
   `front_facing` against the WebGPU and WebGL2 frames of new journeys.
4. **M4. The call layer on the program runtime; one `Device`.** The call layer's draws, entry
   calls, kernel calls and `fuse` plans as program-runtime passes; `Device`'s new members and
   options; `device.draw()`; `VertexEntry`, `FragmentEntry` and the pair check in the host view;
   `createRuntime()` and `runtime()` deprecated with their warning; every use in this repository
   migrated; Rules 8.21, 8.24, 11.7, 11.8, 11.10, 11.11 and 11.17, §3, §65, §66, §67, §69; the
   API surface. Verifies: every existing call-layer test and journey unchanged; the draw tests and
   the both-halves test of Validation; `fuse` reports unchanged.
5. **M5. A host file for every example, and its test.** The generator, the reviewed host files,
   `typeshade/examples` with each host file's text, and `examples/host-files.test.ts`. Verifies:
   the test on the CPU tier, and the user journeys that run the host examples on WebGPU.
6. **M6. The site (downstream).** typeshade.github.io pins a compiler with M5 and does D6's work.
   Verified there, with its own checks.
7. **M7. The removal.** In the release after the one that publishes M4's deprecation:
   `createRuntime`, `runtime`, `Runtime`, `RuntimeOptions`, `DeviceOptions.runtime` and
   `configure({ runtime })` are removed, and Rule 11.11 and §69 say so. Verifies: the API surface
   bake shows the four removed exports and nothing else; the downstream pins of What it owes
   downstream carry the migration.

### Approval and plan record

- **Decision.** The owner accepted this proposal on 2026-11-03 in the Claude Code session: D1 to
  D6 as decided, and O1 to O8 each as the draft recommended (option (a)). The merge of pull
  request [#1030](https://github.com/typeshade/typeshade/pull/1030) with `status: accepted` records
  the acceptance.
- **Approved scope.** The front matter as it stands, which already matches the decided options:
  the RHI is internal (O1 (a)), so no `typeshade/rhi` export is listed, and Rule 11.10 gains the
  sentence of O2 (a).
- **Responsibilities.** Implementation is not yet assigned. Each implementing pull request carries
  `Change: 0120`.
- **Milestones.** M1 to M7 in the order of the plan above. Duration and cost are not estimated.

### Configuration and validation record

This record does not yet apply. Delivery will require, for each milestone: the implementing pull
requests and their commits that say `Change: 0120`; the delivered configuration; the functional
results of Validation required, with the date, the commit and the tool versions; the document
validation; each deviation with its disposition; and the pending work. Compiler status
`implemented` will not establish the downstream completion of M6.

## Amendments

An amendment changes the accepted text. Its pull request is proposal-only, and its merge is its
acceptance. Git holds the earlier text. The decided text stays in place, and an amendment record
sits under it.

### A1. The CPU program loads lazily; Rule 11.20 and the validation of M2 and M3 (2026-11-09)

- [fact] Why. M3 (pull request #1102, merged at `f2f05cb`) found that O2 (a) conflicts with Rule
  11.10's Enforced-by. That sentence says that `src/vite.test.ts` bundles a module's default export
  alone with no CPU tier. Under O2 (a) the default export holds the CPU program, so every bundle
  that imports it carries the CPU tier. #1102 therefore does not attach the program in
  `src/compiler/ts/host-face.ts`; `load()` reads the key, and the tests attach the program.
- [decision, owner, 2026-11-09] O2 becomes (a′), a lazy form of (a). The owner chose "CPU 코드를
  지연 로드" (load the CPU code lazily) over (a) as accepted and over an explicit import by the host.
  - The default export of a module's host import carries, under the `Symbol` key `CPU_PROGRAM`,
    a function that returns a promise of the module's CPU program. The function calls `import()`
    on a module the Vite plugin and `tshc` write for the CPU code alone.
  - A bundler puts that module in a chunk of its own. A bundle that imports only the default
    export carries no CPU code in the default export's chunk. It fetches the CPU chunk only when
    a CPU device runs one of the module's entries.
  - `load()` stays synchronous. On the CPU tier it records the loader. The first submit that runs
    one of the module's entries awaits it; the CPU backend's `submit()` already returns a promise.
  - A manifest from `packModule()` or from JSON has no loader, and `load()` on the CPU tier still
    refuses it with the `TypeError` of O2 (a).
  - The `Symbol` key stays outside the JSON, so the manifest's JSON does not change.
  - [fact] Why not (a). Every bundle would carry the CPU code of every entry, and Rule 11.10's
    guarantee would go. Why not an explicit import. Each host file would name a second import for
    the CPU tier, and the host files of M5 would be longer.
- [proposal, agent; the owner chose to carry it in this amendment, 2026-11-09] Rule 11.10's text takes the sentence of (a′) in M4. Its
  Enforced-by keeps `src/vite.test.ts` and says that the default export's chunk carries no CPU
  tier and that the CPU code is in a chunk the loader imports.
- [proposal, agent; the owner chose to carry it in this amendment, 2026-11-09] Rule 11.20 joins the rules of this proposal. Its Enforced-by names
  `src/rhi/` as a directory `scripts/bundle-boundary.ts` holds each host face to. Since M1 the
  program runtime imports `src/rhi/`, so the sentence that names only `src/runtime/` and
  `src/core/` is no longer true. M4 writes the text. This closes M2's open deviation on Rule 11.20.
- [proposal, agent; the owner chose to carry it in this amendment, 2026-11-09] The validation of M2 and M3 is as delivered.
  - The RHI conformance suite runs its WebGPU and WebGL2 legs in the compile gate
    (`scripts/rhi-conformance-arm.ts`), not in the user journeys. This closes D-M2-1.
  - The rasterizer's interpolation, clipping, fill rule and `front_facing` are held to the
    conformance suite's exact answers on all three backends, not to the frames of new journeys.
    [fact] The journeys install the packed tarball, and no public path reaches the CPU tier before
    M4. This closes D-M3-1.
  - M5's journeys, which run the host examples, compare the CPU tier's frames with the GPU tiers'
    once `createDevice()` reaches it.
- Open, not decided here: the WebGL2 backend takes a `flat` value from the last vertex (GL's
  provoking vertex), and WebGPU and the CPU backend take it from the first. The conformance
  suite's flat case records this. Next action: a bug fix or a decision in M4.
- Affects: the front matter `rules` (adds 11.20), the Document control table, O2, What it touches
  (Rules 11.10 and 11.20), and the milestones M2 and M3 of the plan as delivered.
- Not affected: the title, `surface`, `exports`, `exports-removed`, `codes`, `examples` and
  `downstream`; D1 to D6; O1 and O3 to O8.
- Status: `status: accepted` does not change.

## What it owes downstream

- **typeshade.github.io** (`typeshade/web`, `apps/typeshade`). The Playground's `host.ts` tab shows
  each example's host file from `typeshade/examples` (O7) in place of the generic starter of
  `src/scripts/playground-host-default.ts` (221 lines). The Result runs that file through
  `createDevice()` and shows only what it draws, or for a computing example what `run()` returns.
  The site's own renderer is removed: `lib/shader-runtime.ts` (1,955 lines),
  `lib/render-runtime.ts` (166, which calls `createRuntime`), `scripts/playground-bindings.ts`
  (1,869), `scripts/playground/cpu-program.ts` (268) and `scripts/playground-raster.ts` (296), and
  `lib/compute-runner.ts` (155) moves to `createDevice()`. The site's
  `docs/playground-one-runtime.md` (accepted there, #18) is the site's plan for the same goal and
  is revised against this proposal. Every page and API entry that copies §67 or §69, or names
  `createRuntime`, `runtime()`, `Runtime`, `RuntimeOptions` or `configure({ runtime })`
  (`content/api/*/createruntime.json`, `runtimeoptions.json`, `configure.json`, `device.json`,
  `deviceoptions.json`, `renderpass.json`, `src/i18n/en.ts` and `ko.ts`, the concept pages), is
  written again, in English and in Korean. `compiler-changes.md` records 0120 when the pin moves.
- **vscode-typeshade.** The skill's references for the program runtime and for host calls name
  `createDevice()`, `device.load()`, `device.frame()` and `device.draw()`; a fixture or snippet
  that names `createRuntime` changes. `compiler-changes.md` records 0120 when the pin moves.
- **radiance.** A GitHub code search on 2026-11-03 found `createRuntime` in
  `packages/radiance/src/renderers/PathTracer.ts` and in `docs/plan.md`, `docs/design/0006-*.md`,
  `docs/design/0007-*.md` and `reqs/records/REC-0006.md` and `REC-0007.md`. Each moves to
  `createDevice()` and `device.native` before its pin reaches M7. `compiler-changes.md` records
  0120 when the pin moves.
- **typenn, typecv, typeaudio.** The same code search found no `createRuntime` and no
  `typeshade/runtime` in these repositories; the search index may not cover them. Each searches
  its tree for `createRuntime`, `runtime()` and `configure({ runtime })` and migrates by the table
  of item 3. `compiler-changes.md` records 0120 in each when its pin moves.
- **X-GIS** (`X-GIS/X-GIS`), not tracked by `scripts/changes.ts` (O8). Expected work, not an
  obligation of this proposal: when the RHI is public (O1), X-GIS may replace `@xgis/rhi`,
  `@xgis/rhi-webgpu` and `@xgis/rhi-webgl2` with it, in a proposal of its own that measures
  X-GIS's optional members (screen passes, render bundles, validation scopes, the backend
  providers) against TypeShade's interface.

Expected work is described; responsibilities are recorded at acceptance; actual downstream
changes, pins and records are tracked apart after compiler implementation.
