---
id: '0016'
title: A host file calls a module's `@compute` entry, which runs on the GPU, and draws its full-screen `@fragment` entry into a canvas, through the same import
status: accepted
rules:
- '8.20'
- '8.21'
- '8.24'
- '11.7'
- '11.8'
surface:
- 64
- 67
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The import itself, which the owner held back from the site until this proposal (0009's owed copy: the "No runtime" lines, the quick start's plugin, tsconfig and sync lines), now presented with its GPU call; the WebGPU and WebGL2 concept page (runtimeH, runtimeP, en and ko), whose GPU ownership table ("No TypeShade code touches a WebGPU object") and "the host owns runtime objects" copy this makes false; the quick start and the front page, which gain the entry call and the draw
- repo: vscode-typeshade
  what: The skill's host section (SKILL.md) and references/host.md, which gain the entry call and the draw beside 0009's helper call and 0013's kernel function; a tsserver fixture for a host file that calls a compute entry and draws a fragment entry through the host view
---

<!-- doc-refs: skip-file — a proposal names the files it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

This is the second half of roadmap item 16 (row 16b). It is the part the owner found missing when
reviewing the first half (#257, #261). A developer who writes a shader, imports it and calls it
expects it to run on the GPU. The first half runs a helper on the CPU. The owner kept that half as
the plumbing, and held the import back from the site and the release until this proposal lands.

After this proposal and 0013, where each call runs:

| What the host calls                                    | Where it runs                                                                     | The call                     | Proposal |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------- | -------- |
| a helper, `height(p, k)`                               | the CPU tier, at `f32`                                                            | synchronous                  | 0009     |
| a kernel function, a loop over an `array<T>` parameter | the GPU when its loop is proven independent, the CPU with `TS8070` when it is not | asynchronous                 | 0013     |
| a `@compute` entry                                     | the GPU (WebGPU); the CPU tier when there is none and the entry has no barrier    | asynchronous                 | this     |
| a full-screen `@fragment` entry                        | the GPU (WebGPU, then WebGL2); the CPU tier as the last fallback                  | a draw into a canvas, queued | this     |

The table is the answer to the owner's question. Work that is parallel reaches the GPU. That is
0013's loop, or an entry an author wrote. A single call of a scalar helper stays on the CPU, as a
scalar function does in PyTorch. TypeGPU is the same: a `'use gpu'` function called from
JavaScript runs as JavaScript, and it reaches the GPU through a pipeline and a dispatch.

Today the journeys' host halves do by hand what the runtime will do.
`journeys/particles/journey.mjs` packs "the particles the way WGSL lays them out (two vec4 per
particle, 32 bytes)" and the uniform, and `runOnGpu` in `journeys/_harness.mjs` is 115 lines of
WebGPU:

- the adapter and the device;
- the module and the bind group layout;
- the buffers;
- the pipeline, the pass and the dispatch;
- the readback.

After this change the same entry is one call:

```ts
// particles.shade.ts, as it is in journeys/particles
'use typeshade';

class Particle {
  pos: vec4;
  vel: vec4;
}
class Sim {
  dt: f32;
  gravity: f32;
  floor: f32;
  bounce: f32;
}

declare const sim: uniform<Sim>;
declare const particles: storage<array<Particle>, "read_write">;

@compute([64])
export function step(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= particles.length) {
    return;
  }
  // … integrate one particle, as the journey does
}
```

```ts
// app.ts
import { resident } from 'typeshade';
import { step } from './particles.shade.ts';

const sim = { dt: 1 / 30, gravity: 9.8, floor: 0, bounce: 0.6 };
const particles = Array.from({ length: 200 }, () => ({ pos: [0, 3, 0, 1], vel: [1, 2, 0, 0] }));

await step({ sim, particles }, Math.ceil(particles.length / 64)); // particles updated in place

const onGpu = resident(particles); // 0013's handle: stays on the device
for (let frame = 0; frame < 20; frame++) step({ sim, particles: onGpu }, 4); // queued
const after = await onGpu.read(); // the one wait
```

A fragment entry that reads only its pixel position draws a frame:

```ts
// plasma.shade.ts's fragment entry, as it is in journeys/plasma
@fragment
export function fs(@builtin("position") p: vec4): Color { … }
```

```ts
import { fs } from './plasma.shade.ts';

const canvas = document.querySelector('canvas')!;
const frame = (t: number) => {
  fs(canvas, { frame: { time: t / 1000, scale: 0.02 } }); // queued; nothing is read back
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
```

### The compute entry call (Rule 8.24)

`entry(bindings, workgroups)`:

- **`bindings`** is one object. It has a property for each binding the entry reaches through its
  calls, read or written: the effects analysis (`fnReads`, `fnWrites`) already knows the set.
  Each property takes the binding's host value (below). A binding the entry does not reach is not
  a property, and the view types the object exactly, so a missing or misspelled binding is a type
  error at the host's line.
- **`workgroups`** is the workgroup count, `number | readonly [x, y?, z?]`. It is passed to
  `dispatchWorkgroups` as written. The entry is the escape hatch, and it runs as its author wrote
  it: WGSL's unit and the author's own bound check, with no guard added. The view's comment on the
  entry gives its `@compute` shape. A host that wants an invocation count and no guard writes
  0013's loop instead.
- **The result.** The call returns `Promise<void>`. Each storage binding the entry writes is read
  back into the caller's value in place, as 0013's kernel call reads back: a typed array element
  by element, a struct array object by object. A binding passed as a `Resident` stays on the
  device. When every binding the entry writes is a `Resident`, the call returns `void` and only
  queues (0013's second signature). A uniform is an input and is never read back.
- **Tiers** (Rule 11.8):
  1. WebGPU.
  2. The CPU tier (Rule 11.7). It runs the generated code of each invocation of each workgroup, in
     order (z, then y, then x), with the builtins filled in. An out-of-range write does nothing,
     as a typed array ignores one, so a missing bound check cannot grow the caller's array.
  3. For an entry that reaches a barrier, nothing. Lockstep needs the interpreter's generators,
     which the runtime does not ship. That entry needs WebGPU, and without it the call throws a
     `TypeError` naming the barrier's line.

  WebGL2 has no compute stage. 0013's fragment lowering serves its loops, not an entry an author
  wrote. `configure({ prefer })` (0013) orders and restricts the tiers.

### The fragment draw (Rule 8.24)

`entry(target, bindings)` draws one frame of the fragment entry into `target` with a full-screen
triangle:

- **Which fragment entries.** It must read no builtin but `position` and `front_facing`, and no
  `@location` input, since no vertex stage feeds one. It must write one `@location(0)` colour.
  A fragment entry that reads what its own `@vertex` writes needs a mesh, a vertex count and a
  topology. That is #204's rendering design, and until then the entry is `never` with that
  reason.
- **`target`** is an `HTMLCanvasElement` or an `OffscreenCanvas`, and the frame fills its `width`
  by `height`. A canvas keeps the first kind of context it hands out: `getContext` returns `null`
  for another kind. So the first draw into a canvas decides its tier, and every later draw into
  it uses that tier.
- **The result** is a `Promise<void>` that resolves when the frame is submitted, not when the GPU
  has drawn it. A draw reads nothing back (`docs/dx.md` principle 4), so a frame loop can drop
  the promise. The first draw on a page waits for the device, and draws made before then are
  queued in order.
- **Tiers:**
  1. WebGPU, with the canvas's `webgpu` context.
  2. WebGL2: the emitted GLSL ES 3.00 fragment program with the runtime's full-screen vertex
     program.
  3. The CPU tier: the generated code, pixel by pixel, into an `ImageData` put on a `2d` context.

### Host values of a binding (Rule 8.21)

| Binding                                                 | Host value                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uniform<T>`                                            | `T`'s host value (0009's table), packed in the uniform layout `reflect()` computes                                                                  |
| `storage<T>`, sized                                     | `T`'s host value                                                                                                                                    |
| `storage<array<T>>`, runtime-sized                      | 0013's table: the scalar's typed array for scalars and vectors, `S[]` of objects for a struct, or a `Resident` of either                            |
| `storage<array<atomic<u32>>>`, `atomic<i32>`            | `Uint32Array`, `Int32Array`                                                                                                                         |
| `texture_2d<f32>`                                       | an image source: `ImageBitmap`, `ImageData`, `HTMLImageElement`, `HTMLCanvasElement`, `HTMLVideoElement` or `OffscreenCanvas`, uploaded at the call |
| `sampler`                                               | `{ filter?: 'nearest' \| 'linear', address?: 'clamp' \| 'repeat' \| 'mirror' }`, or nothing for linear and clamp                                    |
| a storage texture, a depth texture, any other dimension | none yet: the entry is `never`, naming #204                                                                                                         |

Each value is checked at the call as 0009's are, and a value that does not fit is a `TypeError`
naming the entry, the binding and its type. An `override` takes its default. Setting one from the
call is later work.

### What the generated module carries

The plugin compiles each module at build time, as it already does. For each callable entry, the
generated module gains:

- the WGSL;
- the GLSL ES 3.00 fragment program, where the WebGL2 tier can draw it;
- the reflection the runtime binds by: the group, binding, kind, layout and workgroup shape;
- the bindings the entry reads and writes.

`typeshade/runtime` builds each pipeline on the first call and keeps it per device, shared with
0013's kernel calls. The application ships no compiler, as Rule 11.7 already promises.

In `vite dev` the plugin compiles with 0014's `console: 'gpu'`. The runtime creates, binds,
resets and decodes `_console` for a host-called entry, and hands the events to the host's
console, in the order the CPU tier would print them. A production build records nothing, as
0014's does not.

### Every failure names a line (`docs/dx.md` principle 3)

- A WGSL creation error, from `getCompilationInfo`, is mapped to the `.shade.ts` line through the
  span table the plugin writes in `vite dev`. A production build names the entry and the WGSL
  line.
- A validation error from the call's error scope rejects the call's promise, naming the entry.
- A lost device rejects the call in flight, and the next call requests the device again.

## Why

- **The owner's review of the first half.** The import is announced with this proposal, so the
  first import a user meets runs their entry on the GPU. 0009's own "What comes next" named this
  half.
- **`docs/dx.md` principle 6: lower layers are escape hatches, never requirements.** A
  hand-written `@compute` entry is the escape hatch below 0013's loop. Today reaching it means
  leaving the import and writing the harness's WebGPU by hand: the device, the module, the
  layouts, the packing, the dispatch and the readback. After this change the entry is one call
  on the same import.
- **Measured starting points.**
  - `runOnGpu` in `journeys/_harness.mjs` drives all eight journey runs on WebGPU (SwiftShader in
    headless Chromium) from `compile().wgsl` and `reflect()`. Their results are held against the
    CPU oracle: the worst relative error is `2.14e-3`, on plasma, measured in
    `bun run gate:journeys` on the 0009 branch.
  - `reflect()` already carries what binding and packing need: the bind groups, each entry's
    resource kind, texture dimension and std140/std430 layout, and each entry's workgroup shape
    and location/builtin interface.
  - `src/core/compute/runner.ts` already decides a tier and reports why each earlier tier was
    rejected.
  - The generated CPU code already sends a barrier to `$.barrier`, which throws and names
    `dispatch`. So the CPU tier's limit above is the code's limit today, not a new one.
  - The site's `shader-runtime.ts` and `compute-runner.ts`, which 0009 named and 0014 extends
    with the `_console` buffer, run the Playground's entries. The runtime is measured against
    them before it replaces anything there.
- **Alternatives considered:**
  - **An invocation count with a generated guard**, as TypeGPU's
    `createGuardedComputePipeline(main).dispatchThreads(n)` does. It changes the WGSL of an entry
    the author wrote, with a hidden bound and a hidden uniform. 0013's loop already gives the
    invocation-count form with no guard to write, so the escape hatch keeps WGSL's unit.
  - **Returning the written bindings as new values**, which 0009's "What comes next" sketched.
    In place matches 0013, so there is one convention for every GPU call, and a large array is
    not copied twice.
  - **A module object**, `device.create(Module)` (`docs/runtime-architecture.md` §5). It adds an
    object to create and hold before the first call. "The call is the whole API" (0009) keeps one
    import and one call, and a module object can follow with #97.
  - **Shipping the interpreter**, so that the CPU tier runs barriers in lockstep. That puts the IR
    and the interpreter into every application's bundle (0009 measured the generator alone at
    92 KiB minified), for the fallback of a fallback.
  - **Drawing with the module's own `@vertex`.** Without a vertex count, a topology and vertex
    buffers, only a full-screen pass is well defined, and those three are #204's design.

## What it touches

- **Rule 8.20 (0009).** An entry point becomes callable when Rule 8.24 admits it. Every other
  entry's `never` names the reason and the work that adds it (#204 for a vertex entry, a
  fragment entry that reads interstage values, and the resource kinds above).
- **Rule 8.21 (0009).** It gains the host values of a binding (the table above), the in-place
  readback, and the entry calls' shapes, which are asynchronous, as 0009 promised a later tier
  would be.
- **Rule 8.24 (new).** An entry point called from host code:
  - the compute call: the bindings object, the workgroup count, and what is read back;
  - the fragment draw: the target, the full-screen triangle, and one frame;
  - what makes an entry callable.
- **Rule 11.7 (0009).** The CPU tier also runs an entry's invocations and a fragment's pixels. It
  still does so through the generated code, with no `new Function`.
- **Rule 11.8 (0013).** The tiers gain the entry calls: WebGPU then the CPU for a compute entry
  with no barrier, and WebGPU, then WebGL2, then the CPU for a draw. A canvas keeps its tier.
- **Surface §64 (0009).** Its table of what a host can call: the entry row points to §67 in place
  of `never`.
- **Surface §67 (new): "Calling an entry point from host code".** It is the next free number
  (Rule 3.7): 0013 takes §65 and 0014 takes §66. It holds the two calls, the host values of a
  binding, the tiers, the `_console` handling in `vite dev`, and what an entry needs to be
  callable.
- **No export, no code, no example.**
  - The call shapes are the host view's. `configure` and `resident` are 0013's.
    `typeshade/runtime` stays outside the API (0009).
  - A refusal is a `TypeError` at the call, or `never` in the view with its reason.
  - The journeys carry the programs.
- **Code.**
  - `src/compiler/ts/host-face.ts`: an entry's host face; the generated module gains the WGSL,
    the GLSL fragment program, the reflection and the written set.
  - `typeshade/runtime` (`src/core/host-runtime.ts`): the device, pipelines, packing from
    `reflect()`'s layouts, dispatch, readback and draw. The CPU-tier dispatch and pixel loop.
    `_console` in `vite dev`.
  - `src/core/compute/runner.ts`: the tier decision and its report, shared with 0013.
- **Tests.**
  - `src/compiler/ts/host-face.test.ts`:
    - which entries are callable, one case per refusal;
    - the view's types for each binding kind;
    - both signatures of a compute entry.
  - A GPU test in the compile gate's Chromium:
    - each callable compute entry of `examples/` dispatched on WebGPU and on the CPU tier, and
      compared;
    - each callable fragment entry drawn on WebGPU, on WebGL2 and on the CPU tier, and
      compared pixel by pixel within the determinism report's bounds.
  - Both halves (CLAUDE.md): each call typed through the host view in `tsc`, and each refusal
    held against the same source in `compile()` and in the language service.
  - The journeys:
    - the particles journey calls `step` through the import, with no packing and no WebGPU in
      its host half;
    - the plasma journey draws `fs` through the import;
    - both are held against the plain-JavaScript reference, as now.

## What it owes downstream

**typeshade.github.io**

- **The import.** The owner held the import back from the site until this proposal. 0009's owed
  copy lands with it, and now presents the GPU call:
  - the "No runtime" lines;
  - the quick start's plugin, `tsconfig` and `typeshade sync` lines.
- **The concept page** (`runtimeH`, `runtimeP`, en and ko). The GPU ownership table ("No
  TypeShade code touches a WebGPU object") and the "host owns runtime objects" copy were true
  until this proposal, as 0009 recorded. The page now says that the runtime owns the device,
  pipelines and buffers of a host call, and that `compile()` and `reflect()` stay the escape
  hatch.
- **The quick start and the front page** gain the entry call and the draw.

**vscode-typeshade**

- **The skill.** `SKILL.md`'s host section and `references/host.md` gain the entry call and the
  draw, beside 0009's helper call and 0013's kernel function.
- **A tsserver fixture:** a host file that calls a compute entry with a struct array and with a
  `Resident`, and draws a fragment entry, through the host view.

## What comes next

- **#204, the rendering design:**
  - a vertex entry with vertex buffers, a count and a topology;
  - depth and several render targets;
  - instancing;
  - a `Resident` texture, the image 0013 names.
- **Setting an `override`** from the call.
- **#97:** a module object, and residency inferred across calls.

## Decisions for the reviewer

Accepting this proposal accepts each of these. Each is the recommendation above, and each can be
changed before acceptance without touching the rest:

1. A compute entry takes a workgroup count, not an invocation count: the entry runs as written,
   with no guard added.
2. What an entry writes is read back into the caller's values in place, as 0013 does, and not
   returned as new values.
3. The CPU tier runs a compute entry that reaches no barrier. One that reaches a barrier needs
   WebGPU.
4. The draw is full-screen only, for a fragment entry that reads its position. A fragment that
   reads its vertex's outputs waits for #204.
5. The draw returns a `Promise<void>` that resolves at submission, which a frame loop may drop,
   rather than `void`.
6. An image source is a `texture_2d<f32>`'s host value, uploaded at each call. A `Resident`
   texture waits for #204.
7. `vite dev` records `console.*` from WebGPU through 0014's buffer, and a production build does
   not.
8. No new export: the calls are the host view's, and `configure` and `resident` stay 0013's.
