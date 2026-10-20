---
id: '0077'
title: A kernel function takes a texture as a parameter, reads it and writes it at `vec2(i % W, i / W)` on every tier, and a device owner makes the texture it writes
status: draft
rules:
  - '8.22'
  - '8.23'
  - '11.7'
  - '11.8'
  - '11.13'
surface:
  - 33
  - 65
  - 71
exports:
  - Device
examples:
  - kernel-image-invert
exports-removed: []
codes: []
downstream:
  - repo: typeshade.github.io
    what: The kernel-function page and the storage-texture page, en and ko, gain a texture parameter, its host values, the write form `vec2(i % W, i / W)` and the tiers that run it. The `fuse` page says that a loop that touches a texture is a group of its own. The device-owner page gains `device.texture()`. The API reference is generated from the pinned compiler's source. compiler-changes.md records 0077 when the pin moves.
  - repo: vscode-typeshade
    what: The skill's references/host.md gains a kernel function's texture parameter, its host values and `device.texture()`. compiler-changes.md records 0077 when the pin moves.
  - repo: typecv
    what: Nothing is owed at the pin. The image operators of the planned `Mat` front end can take and return a texture through this change; the design record that adopts it names 0077. compiler-changes.md records 0077 when the pin moves.
  - repo: radiance
    what: Nothing is owed at the pin. Frame accumulation (docs/plan.md section 9, #204) can move from the host to a kernel function that writes the accumulation texture. compiler-changes.md records 0077 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in other repositories -->

**Document control**

| Field                       | Record                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                    | Proposal 0077. This file is the proposal source. It has status `draft`.                                                                                                                                                                                                                                                                                                         |
| Revision context            | Drafted 2026-10-20, UTC. The date is the authoring context. It is not an approval date.                                                                                                                                                                                                                                                                                         |
| Request source              | The repository owner, Seungup, asked in a Claude Code session of 2026-10-20 which front-end concepts TypeShade still lacks. The session listed a texture that a kernel function writes as the first one, and the owner approved the drafting of a proposal for it in the same session. No GitHub issue is recorded for this draft.                                              |
| Attribution                 | Drafted by a Claude Code agent at the owner's request. Git authorship is not an approval signature.                                                                                                                                                                                                                                                                             |
| Current lifecycle state     | `draft`. No decision is recorded.                                                                                                                                                                                                                                                                                                                                               |
| Applicability / effectivity | The kernel-loop proof (`src/core/passes/parallel-loop.ts`), the kernel lowering (`src/core/passes/kernel-lower.ts`), the call (`src/core/host-kernel.ts`), the host face (`src/compiler/ts/host-face.ts`), the CPU oracle's texture builtins, the device owner (`src/runtime/device.ts`), the `fuse` planner, the WebGPU, WebGL2 and CPU tiers. No release version is assigned. |
| Review baseline             | `origin/main` at `86ddc08` (commit "Mark proposals 0074 and 0075 implemented (#707)"), read on 2026-10-20. The consumers were read at typecv `fc070a8`, radiance `3e4efb3` and typenn `eea7f19`, the checkouts of this session.                                                                                                                                                 |
| Proposal review             | No pull request is assigned at the time of writing.                                                                                                                                                                                                                                                                                                                             |
| Revision authority          | Git records the revisions of this file. The review and merge of the proposal-only pull request record the decision.                                                                                                                                                                                                                                                             |

## What changes

A kernel function (Rule 8.22) works on arrays today. It cannot work on an image. This proposal
lets a kernel function take a texture as a parameter, read it, and write it, on each tier that
can run the call. The author writes no binding, no entry and no pass. The proposal has six parts.

### 1. The parameter

A kernel function may take a parameter of two texture types. WGSL already allows a texture as a
function parameter ([Function Declaration](https://gpuweb.github.io/gpuweb/wgsl/#function-declaration-sec)),
so no new name comes in (Rule 2.1):

- `texture_2d<f32>`, a sampled texture that the body reads;
- `texture_storage_2d<F, A>`, a storage texture of format `F` and access `A`, that the body
  writes, or reads and writes.

Rule 8.23 gains the texture: the parameter is the caller's texture, passed by reference. The body
reads it with `textureLoad` and `textureDimensions`, and writes it with `textureStore`. It cannot
assign the parameter whole. The format and the access decide the texel and the calls, as surface
§33 says for a module binding.

```ts
"use typeshade";

export function invert(
  src: texture_2d<f32>,
  dst: texture_storage_2d<"rgba8unorm", "write">,
  w: u32,
  h: u32,
) {
  for (let i: u32 = 0; i < w * h; i++) {
    const c = textureLoad(src, vec2u(i % w, i / w), 0);
    textureStore(dst, vec2u(i % w, i / w), vec4(1.0 - c.rgb, c.a));
  }
}
```

A kernel function needs one array with no size today (Rule 8.22). After this change, one array
with no size or one texture parameter makes a function a kernel function.

### 2. The write form

Rule 8.22, R3, already names the form: a write "on a texture at `vec2(i % W, i / W)`". The form
stays the only texture write a loop may make. `W` is loop-invariant and is the same at every
write to that texture. Any other coordinate is refused with `TS8070`, as an array's shared write
is refused today. A grid of two loops (#350) is outside this change.

### 3. The host values

The call takes these host values for a texture parameter:

| Parameter                  | Host value                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `texture_2d<f32>`          | the image sources a `texture_2d<f32>` binding takes today: `ImageBitmap`, `ImageData`, `HTMLImageElement`, `HTMLCanvasElement`, `HTMLVideoElement`, `OffscreenCanvas`, or a `Texture` |
| `texture_storage_2d<F, A>` | a `Texture` of format `F`, made with `storage: true`                                                                                                                                  |

A device owner (change 0071) gains `device.texture({ size, format, storage })`. It makes a
`Texture` that the owner holds, with the shape of the program runtime's `Texture` (change 0025):
`width`, `height`, `format`, `read()`, `readFloats()`, `destroy()`. One `Texture` belongs to one
owner, as one `Resident` does. A call inside `device.fuse()` that takes a texture of another
owner is refused with a `TypeError` that names both owners. A `Texture` of the program runtime
that an owner was opened over (`createDevice({ runtime })`) belongs to that owner.

Before anything runs, the call checks each written texture against the loop: the loop writes
texels `0` to `n - 1` in row order, and the texture must hold them. It refuses a texture that is
too small with an `Error` that names the parameter, its size and the texels the loop writes, as
it refuses a short array today (surface §65).

### 4. The tiers

The call runs on the first tier of the owner, or of `configure({ prefer })`, that can run it
(Rule 11.8):

- **WebGPU.** Each loop is one `@compute` entry. Each texture parameter is a binding of it.
  The proof's write form gives one invocation per texel.
- **WebGL2.** A loop that writes one texture at `vec2(i % W, i / W)` and no array runs as one
  fragment program drawn into that texture, one fragment per texel, as a loop that writes one
  array at `i` runs into an `R32UI` target today. A read texture is a sampled texture of the
  program. A format that WebGL2 cannot render into falls to the next tier, with the reason. A
  float format needs `EXT_color_buffer_float` (capability `floatRenderTarget`).
- **The CPU tier.** The oracle gains texture memory (part 5). A loop that reads only with
  `textureLoad` and `textureDimensions`, and writes only with `textureStore`, runs on the CPU
  tier. A loop that samples (`textureSample` and its forms) keeps no CPU tier, with the reason
  `host-face.ts` gives today.

### 5. The oracle's texture memory

The CPU oracle has no texture memory today: a texture read returns opaque black
(`src/core/oracle-backend-parity.test.ts`, "O3b/O5b"). This change gives the CPU tier a texture
as a typed array of its texels, in row order, with the channels and the element of its format:

- `textureLoad` reads the texel. A coordinate outside the texture reads the nearest texel inside,
  one of the results WGSL allows, the one WebGL2's memory root gives (surface §33).
- `textureStore` writes the texel after the conversion its format names. A store outside the
  texture is dropped.
- `textureDimensions` gives the size.

The conversion of a stored value is the conversion of the WebGPU specification for the format.
A float to `unorm` or `snorm` conversion that the specification leaves within a tolerance is a
row of the determinism report (surface §38), with the formats it reaches.

The stub contract of the other texture builtins stays. A call that reaches only the stubs still
has no CPU tier.

### 6. Fusion

A `fuse` scope (Rule 11.13) puts each loop that reads or writes a texture into a group of its
own. The planner records no texel fact in this change. A later change can fuse a chain whose
texels are all at the loop's counter.

### Not in this change

- A grid of two nested loops dispatched as a 2D grid (#350).
- `texture_external` and a `VideoFrame` as a host value (#162).
- A texture parameter of a dimension other than `2d`, an array texture, a depth texture and a
  multisampled texture.
- A host write into a texture (change 0050, `draft`).
- The rendering design of #204: a pass, a mesh, a render target and the fixed-function state.

## Why

**An image is the most common data that a TypeScript program hands a GPU.** A kernel function
is the front end that asks no GPU vocabulary of the author (Rule 8.22, `docs/dx.md`). It covers
arrays and stops at images. Three consumers meet the gap:

- TypeCV takes every image as packed RGBA bytes in a storage buffer
  (`extractSiftGpuResident(device, rgba, width, height)`, typecv `src/gpu/sift.ts`). It cannot
  return an image as a texture, and it cannot use the texture hardware for a read.
- Radiance solves frame accumulation on the host (radiance `docs/plan.md`, section 9).
- TypeNN has no image input path.

**The proof names a form that no loop reaches.** Rule 8.22, R3, accepts a write "on a texture at
`vec2(i % W, i / W)`". Two facts stop it:

1. `lowerKernel` refuses the loop: "a loop of it writes a texture, whose host value is #204's
   image" (`src/core/passes/kernel-lower.ts`).
2. The proof refuses the form before it reaches clause (d). A texture is a whole name whose type
   is not an array, so `proveLoop` reads every write to it as a reduction and refuses it as
   carried. Measured on `86ddc08` with `compile()` under Bun: the `invert` function of part 1,
   and the same loop over a module binding `declare const dst: texture_storage_2d<"rgba8unorm", "write">`,
   each give `TS8070` "line N writes "dst", which the next iteration reads". This is a
   difference between Rule 8.22 and its enforcement. The implementation fixes it under this
   change.

**#204 is a larger question.** #204 asks what a pass that returns an image is. That design has
open decisions on format, size, geometry and fixed-function state. A kernel function that
writes a texture needs none of them: it is a compute loop, and its texture is a parameter. This
proposal takes the compute half and leaves #204 the rendering half.

### Alternatives

- **A texture as a module binding only.** Surface §33 already declares a storage texture as a
  module binding. A kernel function that reaches a module binding runs on the CPU tier today
  (`kernel-lower.ts`), and a binding is a global that every call shares. A parameter matches an
  array parameter: each call names its own texture. The proposal takes the parameter.
- **An image as an array.** A host can pack an image into an `array<u32>`, as TypeCV does. It
  loses the texture hardware (filtering, format conversion, cache layout) and a render target. It
  is what consumers do today because no other form exists.
- **Wait for #204.** #204 has no accepted design and no date. The compute half does not depend
  on it.

### Assumptions

- Change 0071 is implemented on `main` at the baseline. The owner has no texture today, so
  `device.texture()` is new.
- The program runtime's `Texture` (change 0025) is the shape the owner's texture takes. A
  consumer that holds a `Texture` of a runtime keeps one type.
- A WGSL function may take a texture parameter, and Tint accepts it. The compile gate measures
  this in the implementation (Rule 13.3).

### Open decisions

1. **The read form on the CPU tier.** This draft gives the CPU tier `textureLoad` only. A loop
   that samples keeps no CPU tier. The alternative is a CPU `textureSampleLevel` with linear
   filtering. WebGPU does not fix the precision of filtering, so the oracle cannot claim the
   bits of a GPU. The draft keeps it out.
2. **The unorm conversion.** The draft follows the WebGPU specification and records its
   tolerance in the determinism report. The alternative refuses `unorm` and `snorm` formats on
   the CPU tier.
3. **The owner's texture usages.** The draft makes a texture of `device.texture()` a sampled
   texture, a copy source and destination, a render target, and a storage texture when
   `storage` is true, as the program runtime does. A format that cannot be a render target
   leaves out that usage.
4. **Pool.** The draft does not pool textures. `destroy()` frees one. The owner's statistics
   count textures and their bytes beside the arrays.

## What it touches

- **Rule 8.22.** A texture parameter makes a function a kernel function. R3 keeps its texture
  clause, and its enforcement starts to reach it. "Enforced by" loses the text "a function that
  writes a texture is not callable until #204 gives a storage texture its host value".
- **Rule 8.23.** The parameter passed by reference gains the texture.
- **Rule 11.7.** The CPU tier gains texture memory for `textureLoad`, `textureStore` and
  `textureDimensions`.
- **Rule 11.8.** The tiers gain a texture parameter: WebGPU binds it, WebGL2 draws into it, and
  the CPU tier reads its memory. The one-owner rule extends to a `Texture`.
- **Rule 11.13.** A loop that touches a texture is a group of its own.
- **Surface §33.** The sentence "A storage texture has no host value in the call layer yet
  (#204)" changes to the host value of part 3.
- **Surface §65.** The parameter table gains the two texture rows. The "Not yet" paragraph is
  removed.
- **Surface §71.** The groups gain the texture rule.
- **Export `Device`.** It gains `texture()`, and `DeviceStatistics` gains the texture counts
  through it.
- **Example `kernel-image-invert`.** The `invert` function of part 1, registered with its
  golden, run on WebGPU, WebGL2 and the CPU tier.

### Draft impact estimate

Known work, by area:

- **Proof.** `proveLoop` in `src/core/passes/parallel-loop.ts`: test clause (d) before the
  reduction clause. Pin the accepted form and each refusal in `parallel-loop.test.ts`.
- **Front end.** `parseParams` in `src/compiler/ts/lower/function.ts` and the kernel test in
  `src/core/ir/kernels.ts`: a texture parameter makes a kernel function. The language service
  agrees (Rule 12.7). A test reads both halves on the same source.
- **Lowering.** `lowerKernel`: a texture parameter becomes a binding of each entry that reaches
  it. The WebGL2 path in the same file gains a texture target.
- **Host face.** `host-face.ts`: the host view types each texture parameter with the values of
  part 3.
- **Call.** `callKernel` in `src/core/host-kernel.ts`: binds the texture, checks its size, and
  refuses one of another owner.
- **Owner.** `src/runtime/device.ts`: `device.texture()`, its statistics and its disposal.
- **Oracle.** The CPU texture memory and the three builtins. The stub table of
  `oracle-backend-parity.test.ts` loses `textureLoad` as a stub.
- **Planner.** `src/fuse.ts`: a texture loop is a group of its own.

Compatibility: no program that compiles today changes its meaning. A texture write in a kernel
function never ran on any tier before, so no caller depends on it.

Dependencies: change 0071 (implemented). Change 0054 for the WebGL2 path (accepted). No other
proposal blocks this one.

Duration and cost: unknown. No estimate is established.

### Approval and plan record

This record does not yet apply. Acceptance will require the owner's decision on the proposal-only
pull request, recorded by its merge with `status: accepted`, and a decision on each open
decision above.

### Configuration and validation record

This record does not yet apply. Delivery will require this evidence, none of which exists yet:

- the proof's accepted form and refusals, in `parallel-loop.test.ts`;
- the compiler's and the language service's diagnostics on one source (Rule 12.7);
- `kernel-image-invert` through the compile gate (Tint and WebGL2), bit for bit on the CPU tier
  against the oracle, and on WebGPU in Chromium for `rgba8unorm`, `r32float` and `rgba32float`;
- a texture of another owner refused inside `device.fuse()`;
- a short texture refused before the call runs;
- a `fuse` scope with a texture loop between two array loops, giving the bits of the calls run
  apart.

## What it owes downstream

- **typeshade.github.io.** The kernel-function page and the storage-texture page, in English and
  Korean, gain the texture parameter, its host values, the write form and the tiers. The `fuse`
  page gains the group rule. The device-owner page gains `device.texture()`. `compiler-changes.md`
  records 0077 when the pin moves.
- **vscode-typeshade.** `references/host.md` gains the texture parameter and `device.texture()`.
  `compiler-changes.md` records 0077 when the pin moves.
- **typecv.** No page describes the old behavior. The planned image front end can adopt the
  change in its own design record. `compiler-changes.md` records 0077 when the pin moves.
- **radiance.** No page describes the old behavior as a requirement. Design record 0006 lists
  frame accumulation as solved on the host, and it can name this change as the way back.
  `compiler-changes.md` records 0077 when the pin moves.
