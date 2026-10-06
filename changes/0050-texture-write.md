---
id: '0050'
title: A host writes an image or bytes into one layer and one level of a program runtime's `Texture`, and `generateMipmaps()` fills its mip chain
status: draft
rules:
  - '11.11'
surface:
  - 69
exports:
  - Texture
  - TextureOptions
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The API reference's runtime-api page, read from the JSDoc of src/runtime/resources.ts at the pin, shows write(), generateMipmaps(), layers and mipLevelCount. The pin pull request checks that page. compiler-changes.md records 0050.
  - repo: vscode-typeshade
    what: The skill's host reference (references/host.md) gains a bullet on write() and generateMipmaps() beside its bullet on reading a texture back. compiler-changes.md records 0050 when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names files it will add and files in downstream repositories -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and status           | Change proposal `0050`, `status: draft`. The front matter is the lifecycle authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Date and attribution          | Written 2026-10-05 (UTC), which is 2026-10-06 in Asia/Seoul. Revised on the same date after a review of the draft. The dates are the authoring context, not an approval. A coding agent in a Claude Code session drafted it for the engine typeshade/radiance. The source is item 4 of the engine's [record 0006](https://github.com/typeshade/radiance/blob/0bd1be89d1d5fe1407c34c3ed56809ff0c2c512d/docs/design/0006-compiler-boundary.md), and the consumer is "The texture plan (M3)" in its [record 0004](https://github.com/typeshade/radiance/blob/0bd1be89d1d5fe1407c34c3ed56809ff0c2c512d/docs/design/0004-materials-and-shading.md). The owner accepted both records on 2026-10-05. Attribution is not approval. |
| Applicability / Effectivity   | The program runtime: `src/runtime/resources.ts` (`Texture`, `TextureOptions`, `TextureImpl`), `src/runtime/program.ts` (the view a binding takes), `src/runtime/runtime.ts` (the view a pass attaches), `src/runtime/gpu.ts`, and a new `src/runtime/mipmap.ts`. Rule 11.11, surface §69, the tests, a new journey and the documents named below, the site and the editor. The call layer, its WebGL2 tier, the CPU tier and the oracle do not change. Release version unassigned.                                                                                                                                                                                                                                         |
| Review baseline               | `origin/main` at `3f6f46b0c97b9761a4cb1d6975cf16685e7f355b`. The engine read its evidence at `e923a34`. `git diff e923a34 3f6f46b` shows no change under `src/runtime/`, in `src/core/host-entry.ts` or in `src/core/host-draw.ts`. Rules 8.21 to 8.24 and 11.1 to 11.12 and surface §69 have the same text at both commits. So every line the engine cited is where it was.                                                                                                                                                                                                                                                                                                                                               |
| Review and revision authority | No pull request is assigned yet. Git records the revisions. The pull request's review and merge will record the decision. This document does not name the hash of the commit that will contain it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## What changes

A host of the program runtime gains a way to put texels into a `Texture` with no WebGPU call of
its own. `texture.write(source, { layer, level })` writes bytes or an image into one level of one
layer. `TextureOptions` gains `mipLevelCount`, and `texture.generateMipmaps()` fills levels 1 and
up from level 0 by a filter this proposal states exactly. A host writes the layers of an array
texture one at a time.

The design extends change 0025's one resource model (section 2, "One resource model with the call
layer"). That section made `Texture` the runtime's texture, with `resize()`, `read()` and
`destroy()`. The design follows change 0028 (section 5), which gave `read()` its byte layout and
its place on the queue. `write()` takes the layout `read()` gives, and keeps the same queue order.
Nothing an author writes in a shader changes, and no host view changes.

The design also goes past two texts, and amends one of them (Why, "The scope of 0025 and Rule
11.11"). Change 0025 section 2 says the runtime "automates what the compiler knows and nothing
else". Rule 11.11 says the runtime "makes each shader module from the text the manifest holds".
The mip filter of `generateMipmaps()` is neither something the compiler knows nor text a manifest
holds.

### Before and after

| Today, at the baseline (fact)                                                                                                                                                              | After this proposal (proposed)                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rt.texture()` makes a texture of one mip level, since `TextureImpl` passes no `mipLevelCount` to `createTexture`. A texture that wraps the host's `GPUTexture` has the host's levels.     | `rt.texture({ mipLevelCount })` makes up to the full chain. One level stays the default.                                                                                         |
| `Texture` has `resize()`, `read()`, `readFloats()` and `destroy()`. Nothing in the runtime writes its texels but a pass that draws into it.                                                | `Texture` gains `write()` and `generateMipmaps()`, and the read-only `layers` and `mipLevelCount`.                                                                               |
| A host that calls no WebGPU itself cannot put an image or bytes into a texture. A host that calls WebGPU writes through `rt.device.queue` on `texture.texture`, which change 0025 permits. | `write(bytes)` puts bytes in `read()`'s layout into one level of one layer. `write(image)` copies an image of the level's size there. Neither needs a WebGPU call of the host's. |
| A binding takes the texture's default view: every level and layer, in WebGPU's default dimension.                                                                                          | A sampled binding takes every level, and the layers the binding's dimension takes. A storage binding takes level 0.                                                              |
| A pass attaches the default view. WebGPU refuses it for a wrapped texture of several levels (from the specification, not measured).                                                        | A pass attaches level 0. A texture of one level gets the same view as today.                                                                                                     |
| `read()` and `readFloats()` give the first layer or slice.                                                                                                                                 | Unchanged. They give level 0 of the first layer or slice, and their JSDoc says level 0.                                                                                          |
| A call uploads an image at the call (Rule 8.21), into a new `rgba8unorm` texture of one level (`gpuHandle` in `src/core/host-entry.ts`). A draw on WebGL2 refuses a `Texture`.             | Unchanged.                                                                                                                                                                       |

### The API (proposed)

`src/runtime/resources.ts` gains the members below. The JSDoc is the proposed text, which the
site's API reference shows. The declaration types an image source as `object`, as `rt.texture()`
and `rt.sampler()` take the host's own objects as `object` (`Runtime` in `src/runtime/runtime.ts`).

```ts
export interface TextureOptions {
  // size, format, dimension, sampleCount and storage stay as they are.
  /** The number of mip levels, 1 when omitted. Level `n` is `max(1, width >> n)` by
   *  `max(1, height >> n)`, and a 3d texture's depth halves the same way. The most a texture
   *  takes is its full chain, `floor(log2(max(width, height))) + 1`, with the depth in the
   *  maximum for a 3d texture. A multisampled texture has one level. */
  readonly mipLevelCount?: number;
}

export interface Texture {
  // texture, format, width, height, resize, read, readFloats and destroy stay as they are.
  /** The array layers of a 2d texture, or the depth of a 3d one: `size[2]`, 1 when omitted, or
   *  the host texture's own. */
  readonly layers: number;
  /** The mip levels: `mipLevelCount`, or the host texture's own. */
  readonly mipLevelCount: number;
  /**
   * Write one level of one layer: `level` 0 and `layer` 0 when omitted. `layer` is an array
   * layer of a 2d texture, or a depth slice of a 3d one at that level.
   *
   * Bytes are a typed array, a `DataView` or an `ArrayBuffer`, read from the bytes it views,
   * in the layout `read()` gives: rows tightly packed, the top row first, each texel the
   * format's bytes in the format's order. Their length is the level's width times its height
   * times the bytes of one texel, exactly. Every uncompressed colour format takes bytes. A
   * depth, stencil or compressed format takes neither bytes nor an image.
   *
   * An image is an `ImageBitmap`, `ImageData`, `HTMLImageElement`, `HTMLCanvasElement`,
   * `HTMLVideoElement` or `OffscreenCanvas` of the level's size, into a 2d texture. Its top row
   * is the level's top row, and its colours are written as sRGB and not premultiplied. An
   * `ImageData` written into `rgba8unorm` or `rgba8unorm-srgb` is its bytes, as they are.
   *
   * The write is on the queue when `write()` returns, and the source is copied at the call.
   * A frame submitted after the call draws what it wrote, and so does a read started after it.
   */
  write(
    source: ArrayBufferView | ArrayBuffer | object,
    options?: { readonly layer?: number; readonly level?: number },
  ): void;
  /**
   * Fill levels 1 to `mipLevelCount - 1` of every layer, or of `layer` alone, each from the
   * level above it. Texel (x, y) of a level comes from the four texels (2x, 2y), (2x + 1, 2y),
   * (2x, 2y + 1) and (2x + 1, 2y + 1) of the level above, each coordinate clamped to that
   * level's last column and row:
   *
   * - A unorm format that is not sRGB takes the mean of the stored integers,
   *   `(a + b + c + d + 2) >> 2`, the nearest with a tie up.
   * - A float format takes the f32 mean, `((a + b) + (c + d)) * 0.25`, stored as the format
   *   stores a value a pass writes.
   * - An sRGB format takes the same f32 mean of the linear values a load gives, encoded again as
   *   the format stores a value a pass writes.
   *
   * The passes are on the queue when `generateMipmaps()` returns, as a write is.
   */
  generateMipmaps(options?: { readonly layer?: number }): void;
}
```

### What `write()` does on WebGPU

- **Bytes** go to `queue.writeTexture` with `{ texture, mipLevel: level, origin: [0, 0, layer] }`,
  `{ bytesPerRow, rowsPerImage }` of the level and the size `[width, height, 1]` of the level. The
  bytes of a texel come from the table `read()` already uses (`layoutOf` in
  `src/runtime/resources.ts`). So `t.write(await t.read())` writes back what level 0 of layer 0
  held. The runtime reads a typed array from its `byteOffset` for its `byteLength`, and ignores
  its element type. So a `Float16Array` gives an `rgba16float` texture its halves, and a
  `Float32Array` gives an `rgba32float` texture its floats.
- **`depth32float` takes no bytes.** `layoutOf` has a layout for it, since `read()` copies it.
  WebGPU does not take it as the destination of a write from bytes (from the WebGPU
  specification, not measured here). So `write()` refuses it by name, before it reads `layoutOf`.
- **An image.** `imageOf` in `src/core/host-entry.ts`, the call layer's own reader, reads its kind
  and size. So both layers take the same six kinds of image, and both refuse an image of no pixels
  with the same reason. `imageOf` also takes a `Texture` as an image, and calls its
  `[DEVICE_VIEW]()`, which makes a view. So `write()` refuses a `Texture` as its source before it
  calls `imageOf`.
- **The image copy.** The image goes to `queue.copyExternalImageToTexture` with the source
  `{ source, flipY: false }`. The destination is
  `{ texture, mipLevel: level, origin: [0, 0, layer] }`, with `premultipliedAlpha: false` and
  `colorSpace: 'srgb'`. These are the conventions the call layer already uploads with.
  `gpuHandle` in `src/core/host-entry.ts` passes no flag, so WebGPU's defaults apply. The WebGL2
  draw in `src/core/host-draw.ts` sets `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL`
  to `false`.
- **A 2d destination only.** The draft expects WebGPU to refuse a 3d texture as the destination of
  an image copy. This is an inference from Dawn's checks of a copy for the browser, not verified
  here. The runtime refuses an image into a 3d texture in either case. A host writes a 3d
  texture's slices as bytes.
- **An `ImageData`** in `rgba8unorm` or `rgba8unorm-srgb` goes to `queue.writeTexture` as its
  `data`, as `gpuHandle` uploads it today. The runtime writes its bytes as they are, whatever its
  `colorSpace`. In another format it is an image like the other five.
- **No scaling.** The runtime refuses an image of another size than the level. A host makes the
  image the level's size first, with `createImageBitmap`'s `resizeWidth` and `resizeHeight`. The
  scale filter is then the host's choice and not the runtime's.
- **Usage.** `TextureImpl` gives every texture of one sample `COPY_DST` and `RENDER_ATTACHMENT`
  (`#make` in `src/runtime/resources.ts`). Both copies need `COPY_DST`, and the image copy needs
  `RENDER_ATTACHMENT` too (from the specification, not measured here). For a texture that wraps the
  host's `GPUTexture`, the runtime checks the usage each call needs and names a missing one.

### The mip chain: `generateMipmaps()`

**Proposal.** `generateMipmaps()` records one render pass for each level from 1 up, of each layer
it fills. It records them into an encoder of its own and submits it before it returns, as `read()`
submits its copy. Each pass attaches level `n` of layer `k` and binds level `n - 1` of the same
layer. Each view is a `'2d'` view of one level and one layer. A full-screen triangle draws it.
Its fragment shader loads the four texels with `textureLoad`, never through a sampler, and
computes the rule in the JSDoc above.

- **The shader** is WGSL text in `src/runtime/mipmap.ts`, about thirty lines. It is the one
  shader module of the program runtime that no manifest holds (Why, "The scope of 0025 and Rule
  11.11"). The texture binding is laid out `unfilterable-float`, which takes `r32float` and
  `rgba32float` too.
- **The pipeline.** The runtime makes one pipeline for each device and format, with the
  synchronous `createRenderPipeline`, so the passes are on the queue when the call returns. This
  is a deliberate exception to change 0025 section 2, where a pipeline is "created asynchronously
  and cached" (decision 9). The first call for each format compiles a shader on the main thread.
  That cost is not measured. The runtime makes the views and bind groups at each call:
  `generateMipmaps()` is a load-time operation, not a frame's.
- **The formats** are a fixed list of thirteen: `r8unorm`, `r16float`, `r32float`, `rg8unorm`,
  `rg16float`, `rg32float`, `rgba8unorm`, `rgba8unorm-srgb`, `bgra8unorm`, `bgra8unorm-srgb`,
  `rgb10a2unorm`, `rgba16float` and `rgba32float`. Each is a colour format a pass draws into in
  core WebGPU, with no feature (from the specification, not measured here). The runtime refuses
  every other format by name, `rg11b10ufloat` among them, which a pass draws into only with the
  `rg11b10ufloat-renderable` feature. It also refuses a 3d texture. The host writes each level of
  those with `write()`.
- **Why the integer rule for unorm.** The shader rounds each loaded value to the format's
  integer: `round(v * 255.0)` for an 8-bit channel, with 1023 and 3 for `rgb10a2unorm`. It sums
  the four integers, takes the rule's mean `m`, and writes `m / 255.0`. A pass stores that value
  back as `m` (inference: it is within a small fraction of a step of `m`). So the stored level is
  the integer rule exactly, and a CPU reference computes the same bytes.
- **sRGB.** A load from an `-srgb` texture gives linear values and a pass encodes what it writes,
  so an `-srgb` texture averages in linear light. An `rgba8unorm` texture that holds sRGB-encoded
  colour averages the encoded bytes. A host that wants linear-light levels makes the texture
  `-srgb`.
- **Odd sizes.** Level `n` is `floor` of half the level above. So the last column or row of an
  odd-sized level does not reach the next level. A dimension of 1 reads its one texel twice.
  The engine's size classes are powers of two, where neither case arises above 1 × 1.

**Inference, to be measured.** A pass stores the f32 mean of a 32-bit float format as it is. For a
16-bit float format the store converts once from f32, which WebGPU leaves to the hardware. For an
`-srgb` format the load and the store convert, and their precision is the hardware's. The draft
expects no difference from a CPU reference for unorm and 32-bit float formats. It expects none
for half floats where the store rounds to nearest even. It expects at most one step of the format
for sRGB. These are expectations, not results. Rule 11.2 governs a target divergence measured on
Tint and on a WebGL2 driver, and this comparison is neither. The draft follows the principle Rule
11.2 derives from, #162's "measure before you keep a design". So the implementation measures each
class on Dawn before a test holds a tolerance.

### The views a texture with levels needs

**Fact.** `TextureImpl.view()` is `createView()` with no descriptor (`src/runtime/resources.ts`).
A binding takes it (`#resource` in `src/runtime/program.ts`), a pass attaches it (`viewOf` in
`src/runtime/runtime.ts`), and the call layer binds it (`[DEVICE_VIEW]()`). A texture the runtime
makes has one level, since `#make` passes no `mipLevelCount`. It has the layers `size[2]` gives:
`rt.texture({ size: [w, h, n] })` makes `n` layers. A texture that wraps the host's `GPUTexture`
has the levels and layers the host gave it. The `TextureImpl` constructor wraps any object that
has `createView`.

**Fact, from the WebGPU specification, not measured here.** An attachment of a pass takes a view of
one mip level and one layer. A storage texture binding takes a view of one mip level. A `'2d'`
view has one layer. The default view of a `'2d'` texture of one layer is `'2d'`, and of more
layers `'2d-array'`.

**Proposal.** `TextureImpl` keeps one view for each use, made at first use and dropped by
`resize()`. A sampled binding takes every level, in the dimension the manifest gives the binding
(`textureDim`). It reads `'2d-ms'` as `'2d'`, as the layout already does in
`src/runtime/program.ts`. The layers it takes follow the dimension:

| The binding's dimension | The texture it takes                                   | The layers the view takes |
| ----------------------- | ------------------------------------------------------ | ------------------------- |
| `'2d'`                  | A 2d texture of one layer                              | Layer 0                   |
| `'2d-array'`            | A 2d texture of any number of layers                   | Every layer               |
| `'cube'`                | A square 2d texture of six layers                      | Layers 0 to 5             |
| `'cube-array'`          | A square 2d texture whose layers are a multiple of six | Every layer               |
| `'3d'`                  | A 3d texture                                           | Its whole depth           |
| `'1d'`                  | A 1d texture, which only a wrapped host texture is     | Layer 0                   |

- A texture that does not fit its binding's dimension is a `TypeError`, before any WebGPU call
  (The refusals). So a one-layer texture binds to a `texture_2d_array`, and a six-layer square
  texture binds to a `texture_cube`. Today WebGPU refuses both, since the default view has the
  other dimension (inference from the defaults above, not measured).
- A storage texture binding takes level 0, with the layers of the same table.
- A pass attaches level 0. Its layers stay WebGPU's default, so WebGPU refuses a texture of
  several layers as a pass target, as it does today.
- The call layer's `[DEVICE_VIEW]()` keeps the default view. A call binds only a
  `texture_2d<f32>` (Rule 8.21), and the default view of a 2d texture of one layer is `'2d'`, with
  every level.

A texture of one level and one layer gets the same views as today. A frame that repeats its
shapes still makes no GPU object (Rule 11.11), since the runtime makes each view once.

### The refusals

Each refusal is a `TypeError`. The runtime throws it before it calls WebGPU, so a refused call
leaves the texture and the queue as they were. Two orders make that hold for `write()`. It
refuses a `Texture` as the source before it calls `imageOf`. It refuses `depth32float` before it
reads `layoutOf`. A call that passes every refusal and that WebGPU still refuses reaches the
device's uncaptured error, as a call of the host's own WebGPU does.

Each text is a template literal whose `${…}` parts are the call's values. `${call}` is `write` or
`generateMipmaps`. `${size}` is `${w} x ${h}`, or `${w} x ${h} x ${d}` for a 3d texture.

| Call                           | When                                                                         | Text                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rt.texture()`                 | `mipLevelCount` is not a whole number from 1 to the maximum.                 | `rt.texture(): mipLevelCount ${n} is not a whole number from 1 to ${max}. A ${size} texture has ${max} mip levels at most.`                                                                                                                                        |
| `rt.texture()`                 | `sampleCount` and `mipLevelCount` are both above 1.                          | `rt.texture(): a texture of ${s} samples has one mip level. Leave mipLevelCount out, or make it 1.`                                                                                                                                                                |
| `resize()`                     | The new size holds fewer levels than the texture has.                        | `resize(${w}, ${h}): a ${size} texture has ${max} mip levels at most, and this one has ${n}. Make a new texture with rt.texture().`                                                                                                                                |
| `write()`                      | The source is a `Texture`.                                                   | `write() does not copy one Texture into another. Read it with read() and write its bytes, or draw it in a pass.`                                                                                                                                                   |
| `write()`                      | The source is neither an image nor bytes.                                    | `write() takes an ImageBitmap, ImageData, HTMLImageElement, HTMLCanvasElement, HTMLVideoElement, OffscreenCanvas or bytes (a typed array, a DataView or an ArrayBuffer). Got ${describe(source)}.`                                                                 |
| `write()`                      | The image has no pixels.                                                     | `write(): ${reason}.`, where `reason` is the text `imageOf` returns.                                                                                                                                                                                               |
| `write()`, `generateMipmaps()` | `layer` is out of range on a 2d texture.                                     | `${call}(): layer ${layer} is not a whole number from 0 to ${n - 1}. This texture has ${n} layers.`                                                                                                                                                                |
| `write()`                      | `layer` is out of range on a 3d texture.                                     | `write(): layer ${layer} is not a whole number from 0 to ${n - 1}. Level ${level} of this 3d texture has ${n} depth slices.`                                                                                                                                       |
| `write()`                      | `level` is out of range.                                                     | `write(): level ${level} is not a whole number from 0 to ${n - 1}. This texture has ${n} mip levels.`                                                                                                                                                              |
| `write()`                      | The bytes have another length than the level takes.                          | `write(): level ${level} of this ${format} texture is ${w} x ${h} and takes ${bytes} bytes, ${h} rows of ${row}. Got ${length}.`                                                                                                                                   |
| `write()`                      | Bytes into a compressed, depth or stencil format, `depth32float` among them. | `write() cannot write a ${format} texture. It writes the uncompressed colour formats, and a pass draws a depth or stencil texture.`                                                                                                                                |
| `write()`                      | An image into a 3d texture.                                                  | `write() copies an image into a 2d texture. Write a depth slice of a 3d texture as bytes.`                                                                                                                                                                         |
| `write()`                      | An image into a format the image copy does not take.                         | `write() copies an image into r8unorm, r16float, r32float, rg8unorm, rg16float, rg32float, rgba8unorm, rgba8unorm-srgb, bgra8unorm, bgra8unorm-srgb, rgb10a2unorm, rgba16float or rgba32float. Write bytes into a ${format} texture.`                              |
| `write()`                      | An image of another size than the level.                                     | `write(): the image is ${iw} x ${ih} and level ${level} is ${w} x ${h}. Make the image the level's size first, with createImageBitmap's resizeWidth and resizeHeight.`                                                                                             |
| `write()`                      | A multisampled texture.                                                      | `write(): a multisampled texture is drawn into, not written.`                                                                                                                                                                                                      |
| `write()`, `generateMipmaps()` | A host texture without the usage the call needs.                             | `${call}(): the host's texture has no ${usage} usage. Add GPUTextureUsage.${usage} where the host makes it.`                                                                                                                                                       |
| `write()`, `generateMipmaps()` | The runtime made the texture, and the call comes after `destroy()`.          | `${call}(): destroy() released this texture. Make a new one with rt.texture().`                                                                                                                                                                                    |
| `generateMipmaps()`            | The texture has one level.                                                   | `generateMipmaps(): this texture has one mip level. Make it with rt.texture({ mipLevelCount }).`                                                                                                                                                                   |
| `generateMipmaps()`            | A 3d texture.                                                                | `generateMipmaps() fills the levels of a 2d texture and of each layer of an array. Write each level of a 3d texture with write().`                                                                                                                                 |
| `generateMipmaps()`            | A format outside the thirteen above.                                         | `generateMipmaps() cannot filter a ${format} texture. It filters r8unorm, r16float, r32float, rg8unorm, rg16float, rg32float, rgba8unorm, rgba8unorm-srgb, bgra8unorm, bgra8unorm-srgb, rgb10a2unorm, rgba16float and rgba32float. Write each level with write().` |
| `draw()`, `dispatch()`         | A `Texture` that does not fit its binding's dimension (the table above).     | `${where} takes a ${dim} view, which a ${dimension} texture of ${layers} layers cannot give.`, where `where` is the start the binding refusals of `#resource` in `src/runtime/program.ts` already have.                                                            |

The list of image formats is the list the WebGPU specification gives for
`copyExternalImageToTexture` at the time of writing. The implementation pins it in its test
against the specification.

A texture that wraps the host's `GPUTexture` has no refusal after `destroy()`. Its `destroy()`
releases nothing (`destroy()` in `src/runtime/resources.ts`), and the host's texture stays the
host's.

### The order on the queue

`write()` and `generateMipmaps()` put their work on the device's queue before they return, as
`read()` puts its copy there (Rule 11.11). The queue runs work in the order it receives it:

- A frame submitted after a write draws what the write put there. This holds for a frame recorded
  before the write and submitted after it, since WebGPU's queue runs a frame at its submit. A
  frame counts from its submit in surface §69 too.
- A frame submitted before a write draws what was there before.
- A read started after a write reads what it wrote. A read started before it reads what was
  there before.
- `generateMipmaps()` filters what level 0 holds after every write and submit made before the
  call, including a pass that drew into level 0.

WebGPU copies the source at the call. A host may reuse its array or close its `ImageBitmap` once
`write()` returns.

### Each tier

The program runtime runs on WebGPU only: `createRuntime()` rejects where there is no WebGPU
(`src/runtime/runtime.ts`), and surface §69 ends "The runtime runs on WebGPU only". So a `Texture`
exists only on a WebGPU device, and `write()` and `generateMipmaps()` run only there.

| Tier                        | Today (fact)                                                                                                                                                                                                         | After this proposal                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| WebGPU, the program runtime | Only a pass that draws into a `Texture`, or the host's own WebGPU, fills it.                                                                                                                                         | `write()` and `generateMipmaps()` as above.                                                                                 |
| WebGPU, the call layer      | A call that takes an image binds a `Texture` as it is (Rule 11.8).                                                                                                                                                   | Unchanged. A written texture with levels binds with every level, so a fragment entry's implicit-level sample reads them.    |
| WebGL2, the call layer      | A draw uploads an image source at each call into level 0 (`texImage2D` in `src/core/host-draw.ts`). It refuses a `Texture`: the text says it "is a Texture on the WebGPU device, which the WebGL2 tier cannot read". | Unchanged. The program runtime has no WebGL2 tier, and this proposal adds none.                                             |
| The CPU tier                | An entry or a draw that reaches a texture has no CPU tier (Rule 8.24). `noCpuTier` in `src/compiler/ts/host-face.ts` says "which the CPU tier cannot read".                                                          | Unchanged.                                                                                                                  |
| The wasm tier of 0042       | 0042 is a draft. Its stage 1 inherits the CPU tier's refusals, so an entry that reaches a texture has no wasm tier.                                                                                                  | Unchanged. 0042's stage 2 names textures by a software sampler, which would read texels in the byte layout `write()` takes. |

`generateMipmaps()` therefore never runs where no GPU exists. Where a host needs the same levels
without a GPU (a test in Node, an engine's CPU reference), it computes the rule in the JSDoc.
This proposal states the rule in bytes and in f32 operations for that reason. The
implementation's test helper is the CPU reference the tests hold the GPU to.

### What the oracle sees

**Fact.** The oracle has no texture memory. A texture read, a texture's size and a storage
texture write are stubs (`GPU_STUBS` in `src/core/cpu-runtime.ts`). Each throws, or gives a
placeholder under the `gpuStubs` option (`src/core/oracle.ts`). This proposal does not give the
oracle texture memory, and the stubs do not change.

**Proposal.** This proposal defines a texture's contents after each operation, so that a CPU
reference outside the runtime can hold the same contents:

- After `write(bytes)`, the level of that layer holds those bytes exactly.
- After `write(imageData)` into `rgba8unorm` or `rgba8unorm-srgb`, it holds `imageData.data`
  exactly.
- After `write(image)` for any other image, it holds what the browser's copy gives. Only a read
  back tells a CPU reference what that is.
- After `generateMipmaps()`, each level from 1 up holds the rule's result from the level above,
  within the tolerance the measurement sets for its format class.

**What stays blocked.** This item unblocks the upload, and not a differential test over a sampled
texture. The `textures` differential scene of the engine's record 0004 (step 3) runs the kernel on
the oracle, whose texture reads stay stubs. So that scene has no oracle path after this proposal.
It waits on a software sampler (0042's stage 2, toward roadmap item X3), or on a reference the
engine computes itself. Neither is part of this proposal.

### The host signature (Rules 8.21 and 8.24)

The host view does not change. A `texture_2d<f32>` binding of a call already takes a `Texture`.
Its host type is `IMAGE_SOURCE` in `src/compiler/ts/host-face.ts`, which ends `| Texture`. The
view imports `Texture` as a type from `typeshade/runtime/internal`, the default of
`HostFaceOptions.runtime` in the same file. That subpath re-exports the type of
`src/runtime/resources.ts` (`src/core/host-runtime.ts`). So the type gains members, and the
view's text stays the same. `write()` is a method of the runtime's texture, not a value a call
passes.

Rule 8.21's row stays as it is: a `texture_2d<f32>` of a call takes an image source, "uploaded at
the call". `gpuHandle` in `src/core/host-entry.ts` uploads it into a new `rgba8unorm` texture of
one level, and this proposal does not change that. A call's `sampler`, `{ filter, address }`,
sets no `mipmapFilter` (`gpuHandle`), so WebGPU's default picks one level. A `texture_2d_array`
binding has no host value in a call and stays `never` in the host view (Rule 8.24). The engine
binds its arrays through the program runtime, by name.

### Exclusions

- No write of a part of a level (`origin` and `size`). A host that streams tiles asks for it in a
  later proposal.
- No `writeFloats()`. A `Float16Array` gives a half-float texture its bytes, and the runtime then
  owns no rounding rule for an encoder.
- No copy from one `Texture` to another, which `write()` refuses, and no write of compressed
  blocks.
- No `read({ layer, level })`. Item 8 of the engine's record 0006 asks for `read({ layer })` in a
  proposal of its own.
- No change to the call layer, its WebGL2 tier, the CPU tier, the oracle, the manifest, the IR or
  the emitted text. No new export, no diagnostic code, no example.

## Why

### The evidence

- **The runtime has no write.** `Texture` in `src/runtime/resources.ts` declares `texture`,
  `format`, `width`, `height`, `resize()`, `read()`, `readFloats()` and `destroy()`, and nothing
  that writes texels. `TextureOptions` declares `size`, `format`, `dimension`, `sampleCount` and
  `storage`, and no level count. `#make` passes no `mipLevelCount`, so WebGPU makes one level.
- **The call layer alone uploads an image in the compiler's code.** At each call, `gpuHandle` in
  `src/core/host-entry.ts` makes a new `rgba8unorm` texture of one level for each image. Rule 8.21
  says that a `texture_2d<f32>` takes an image source, "uploaded at the call".
- **A host's own WebGPU can write a texture today.** `Runtime` has `device`
  (`src/__api__/surface.md`). `Texture.texture` is the `GPUTexture`, "for the host's own WebGPU"
  (its JSDoc in `src/runtime/resources.ts`). Change 0025 section 2 says that a host "that writes
  its own WebGPU next to the runtime uses the same device and the same resources". The editor's
  webview fills an `rt.texture()` with `rt.device.queue.writeTexture`
  (`packages/vscode-typeshade/src/webview/canvas.ts` in vscode-typeshade, lines 150 to 156).
- **A host that calls no WebGPU itself cannot.** The engine journey's harness refuses an engine
  module that calls a `create…` function, a pass or the queue (`journeys/README.md`,
  `engineOffence` in `journeys/_harness.mjs`). Rule 11.11 calls that journey "a host engine on the
  runtime's public exports alone". The engine typeshade/radiance holds every package to the same
  pattern (its `scripts/boundary.mjs`). The textures journey fills its two sampled textures by
  clearing each to one colour in a pass (`journeys/textures/engine.mjs`).
- **The sampler is ready.** `SamplerImpl` sets `mipmapFilter` to its filter
  (`src/runtime/resources.ts`). So a linear sampler filters between levels once a texture has
  them.

### Why the runtime, beside the host's own WebGPU

Change 0025 keeps the host's own WebGPU beside the runtime, and this proposal keeps it too. Four
reasons put the operation in the runtime as well:

- **The compiler's own engine gate.** The engine journey defines an engine on the runtime alone,
  with no WebGPU call. Under that gate an engine cannot put an image or bytes into a texture. An
  engine that samples images from files is a common case (inference). So the gate cannot hold
  such an engine today.
- **The byte layout is the runtime's already.** `layoutOf` gives `read()` and `readFloats()` the
  bytes of each format's texel. A host's own `writeTexture` derives the texel size and
  `bytesPerRow` again, a second copy of that table. With `write()`, one table serves both
  directions.
- **The views are the runtime's.** `TextureImpl.view()` makes the view the runtime binds and
  attaches for a `Texture`. A host's own WebGPU can make a view of one level and pass it instead,
  since 0025 section 2 takes the host's `GPUTextureView`. A host that calls no WebGPU itself cannot.
  So a `Texture` with levels needs the runtime's views, whoever writes the texels.
- **One image, one meaning on both layers.** `write(image)` reads an image with the call layer's
  `imageOf`, and copies it with the call layer's flags. So an image gives the same texels to a
  call and to a `Texture` (#335 principle 1, which 0025 section 2 cites).

### The scope of 0025 and Rule 11.11

Two texts bound what the runtime does. `write()` stays inside the first. `generateMipmaps()` goes
past both.

- **Change 0025, section 2:** "It automates what the compiler knows and nothing else, so it is not a
  typed wrapper over every WebGPU object." `read()` (0025) and `readFloats()` (0028, section 5) move
  texels between the host and a resource the runtime makes. Neither reads a manifest: each takes the
  texel layout from `layoutOf`. `write()` is the same kind of operation. So the draft reads
  `write()` as inside that scope, by the same precedent. This is an inference, and the owner decides
  it.
- **Rule 11.11:** "it makes each shader module from the text the manifest holds and binds the
  bindings the manifest lists". The program runtime makes no other shader module today.
  `ProgramImpl` makes its module from the manifest's WGSL (`src/runtime/program.ts`).
  `FULLSCREEN_WGSL` belongs to the call layer (`src/core/host-draw.ts`), not to the program
  runtime.

The filter of `generateMipmaps()` is a rule this proposal sets, not something the compiler knows.
Its shader module comes from no manifest, and binds no binding a manifest lists. So, under
decision 1 as recommended, this proposal amends Rule 11.11 and widens the scope 0025 states:

- **Rule 11.11 gains an exception.** After "binds the bindings the manifest lists", its sentence
  adds "except the mip filter of `generateMipmaps()`, the one shader module the runtime writes
  itself". Its rationale gains the reason. A host on the runtime alone cannot draw into a level
  other than 0, so it cannot filter the levels on the GPU.
- **Change 0025 keeps its text.** Its status is `implemented`, and its text stays as the record of
  its decision. Rule 11.11 carries the runtime's scope from this proposal on, with the exception
  above.
- **Under decision 3's manifest option,** a manifest the runtime ships holds the filter's text.
  The shader-module sentence then needs a narrower exception: that manifest is the runtime's, and
  no host loads it. The scope still widens, since the filter is still the runtime's rule.
- **Decision 1's option (c)** amends neither text. It costs a public view of one level and one
  layer, and a filter in each engine (Alternatives considered).

### What the consumer needs

Record 0004's texture plan, for M3, keeps four `texture_2d_array<f32>` bindings, one for each
size class (256, 512, 1024 and 2048 pixels square). Each is `rgba8unorm` with a full mip chain,
read by one sampler with `textureSampleLevel` in a compute entry. An HDR environment map is its
own `texture_2d<f32>` in `rgba16float`. With this proposal the engine writes:

```ts
// One array for each size class, each with its full chain (record 0004).
const classes = [256, 512, 1024, 2048].map((side) =>
  rt.texture({
    size: [side, side, layers],
    format: 'rgba8unorm',
    mipLevelCount: Math.log2(side) + 1,
  }),
);

// A texture of the 1024 class goes to layer 3 of classes[2].
const bitmap = await createImageBitmap(blob, {
  resizeWidth: 1024,
  resizeHeight: 1024,
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
});
classes[2].write(bitmap, { layer: 3 }); // level 0 of layer 3
classes[2].generateMipmaps({ layer: 3 }); // levels 1 to 10 of layer 3

// The environment map: halves the host decoded, four to a texel.
const sky = rt.texture({ size: [width, height], format: 'rgba16float' });
sky.write(new Float16Array(rgba)); // width * height * 4 halves
```

A size class that holds one texture is an array of one layer. Its binding then needs the view
this proposal gives a `texture_2d_array` binding. Record 0006 puts this item on M3's critical
path: M3's textured materials and the environment map wait on it.

### Alternatives considered

- **The host's own `queue.writeTexture` on `rt.device`.** Change 0025 permits it, and the editor's
  webview does it for its checker texture (`packages/vscode-typeshade/src/webview/canvas.ts` in
  vscode-typeshade). It stays open to every host after this proposal. It does not serve a host
  that calls no WebGPU itself, which the engine journey's harness and the engine's boundary hold.
  It also leaves the runtime's views as they are. A pass then refuses a `Texture` with levels,
  unless the host makes its own view of one level.
- **Level views, and the filter in the host's own TypeShade.** `Texture` gives a view of one level
  and one layer, which a pass attaches and a binding takes. The host writes the filter as a
  `.shade.ts` program and runs it through the runtime. This keeps 0025's scope and Rule 11.11's
  sentence as they are, and keeps GPU code in the language. It costs a reshaped `PassTargets` and
  binding value, or a new view type, and a filter in each engine. It is decision 1's option (c).
- **A host copy of the texels in each `Texture`, as a `Resident` keeps one.** The WebGL2 and CPU
  tiers could then read it. Rejected for two reasons. The program runtime is WebGPU only. One
  2048 × 2048 `rgba8unorm` layer with its chain is about 21 MiB (2048 × 2048 × 4 × 4/3), and a
  copy doubles it.
- **Mip levels computed on the CPU in JavaScript.** They are exact by construction. But the
  runtime has no bytes for a level 0 that an image or a pass filled, without a read back. It also
  costs time on the main thread for each 2048 × 2048 layer (inference, not measured).
- **The common blit, a linear sampler at each texel's corner.** WebGPU does not fix the
  precision of a sampler's weights. The precision is the hardware's (not measured here). So no CPU
  reference can be exact. A filtering sampler also cannot read `r32float` without the
  `float32-filterable` feature. `textureLoad` has neither problem.
- **A compute pass with a storage texture.** `rgba8unorm-srgb` is no storage format, and every
  texture would need `STORAGE_BINDING`.
- **The filter written in TypeShade and shipped as a manifest.** It keeps GPU code in the
  language. But `package.json`'s `build` script has no step that compiles a shader into the
  runtime. The runtime's module closure also holds no file of the compiler (Rule 11.11). Thirty
  lines of WGSL is the smaller thing. The owner may prefer the manifest (decision 3).
- **Scaling inside `write()`.** The scale filter would be the browser's and differ by browser.
  `createImageBitmap`'s resize options give the host the same result with the choice visible.
- **A typed wrapper over `GPUTexture`.** Change 0025 rejects a typed wrapper over every WebGPU
  object in its "Alternatives considered", after issue #335's decision 1. This proposal adds the
  two operations a host cannot do without a WebGPU call of its own, and nothing more.

### Unresolved decisions

The owner decides these before acceptance. Each is the draft's recommendation, open to change:

1. **A filter in the runtime.** (a) `generateMipmaps()` with the rule above, which amends Rule
   11.11 (The scope of 0025 and Rule 11.11). (b) No filter: a host writes every level with
   `write()`. (c) Level views, with the filter in the host's own TypeShade. The draft recommends
   (a): one filter, held to one exact rule, with no new view in the public API. A pass attaches
   level 0 alone, so under (b) a host on the runtime alone cannot draw into another level.
2. **The rule.** The integer mean for unorm, the f32 mean for float and linear light for sRGB, or
   the common linear-sampler blit. The draft recommends the rule, for a CPU reference to match.
3. **Where the WGSL lives.** A string in `src/runtime/mipmap.ts`, or a TypeShade module compiled
   into a manifest the runtime ships. The second narrows the exception in Rule 11.11.
4. **One level.** `generateMipmaps()` on a texture of one level throws, or does nothing. The
   draft recommends the refusal: a missing `mipLevelCount` otherwise shows as aliasing far from
   its cause.
5. **The binding's dimension.** The view by the binding's dimension (a one-layer array, a cube)
   and its refusal stay in this proposal or move to their own. The level-0 views for a pass and a
   storage binding cannot move: a texture with levels breaks both without them.
6. **The CPU reference.** It stays a test helper, or becomes an export for a host's oracle in a
   later proposal. This draft declares no new export.
7. **The engine as a downstream repository.** `DOWNSTREAM_REPOS` in `scripts/changes.ts` names
   the site and the editor only. So the front matter cannot name typeshade/radiance, and
   `scripts/downstream-impact.ts` will not list this proposal for it. Adding the engine is a
   change of its own.
8. **Placement and the budget.** The roadmap row. The estimate below puts the runtime past its
   bundle budget, so the owner sets a new budget or asks for shorter refusal texts.
9. **The synchronous pipeline.** `generateMipmaps()` makes its pipeline with the synchronous
   `createRenderPipeline`, an exception to 0025 section 2. The other choice is an asynchronous
   `generateMipmaps()`, whose passes are on the queue when its promise resolves. The draft
   recommends the synchronous call, so that a write and its levels keep the order of the calls.

## What it touches

- **Rule 11.11.** Its sentence on textures gains the mip levels, up to the full chain. It gains
  `write()`: one level of one layer, from bytes in `read()`'s layout or from an image of the
  level's size. It gains `generateMipmaps()` and its rule, the views for a binding and a pass, the
  queue order and each refusal. Its shader-module sentence gains the exception for the mip filter,
  and its rationale the reason (The scope of 0025 and Rule 11.11). Its "Enforced by" gains the
  tests below.
- **Surface §69.** A bullet "Writing a texture, and its mip chain" beside the bullet on
  reading a texture back. "What a host writes" names `mipLevelCount`. The read bullet says level 0.
  The bullet "Bindings go by name" gives a texture's view by the binding's dimension, and its
  refusal.
- **`Texture`** (`typeshade/runtime`): gains `write()`, `generateMipmaps()`, `layers` and
  `mipLevelCount`.
- **`TextureOptions`** (`typeshade/runtime`): gains `mipLevelCount`.
- **Code.** `src/runtime/resources.ts` gains the members, the refusals and the views.
  `src/runtime/mipmap.ts` (new) holds the WGSL and the pipeline for each device and format.
  `#resource` in `src/runtime/program.ts` takes the view by the binding. `viewOf` in
  `src/runtime/runtime.ts` attaches level 0. `src/runtime/gpu.ts` gains the queue's two writes,
  the synchronous `createRenderPipeline`, and a texture's `usage`, `mipLevelCount`,
  `depthOrArrayLayers` and `dimension`. `imageOf` in `src/core/host-entry.ts` and
  `[DEVICE_VIEW]()` stay as they are.
- The proposal adds no rule number, no diagnostic code and no example.

**Tests the implementation owes.**

- `src/runtime/runtime.test.ts`, against its recording device:
  - `mipLevelCount` reaches `createTexture`, and the default stays 1.
  - `write(bytes, { layer, level })` makes one `writeTexture` call with the level, the origin, the
    row layout and the size. The call reads a typed array from its `byteOffset`.
  - `write(image)` makes one `copyExternalImageToTexture` call with the flags above. An
    `ImageData` in `rgba8unorm` goes to `writeTexture`.
  - Each refusal's text, with nothing recorded on the device. A `Texture` as the source makes no
    view, and `depth32float` makes no `writeTexture` call.
  - `generateMipmaps()` records one pass for each level and layer, with the two views. A second
    call makes no pipeline.
  - A one-layer texture binds to a `texture_2d_array` binding with a `'2d-array'` view. A storage
    binding and a pass take level 0. A wrapped host texture of three levels attaches level 0.
  - The runtime refuses a texture that does not fit its binding's dimension, and the device
    records nothing.
  - The queue receives a submit, a write and a submit in the order of the calls.
- A CPU reference of the rule, in a test helper outside the runtime's module closure. Its own
  test pins hand values: a tie, a clamped edge, a level one texel wide, each format class.
- A user journey on WebGPU from the packed tarball, `journeys/texture-write/`, of
  `kind: 'engine'`, on public exports alone. The harness holds the last frame's `read()` to
  `expected()`, and fails a run whose engine throws (`runEngine` in `journeys/_harness.mjs`). The
  journey uses both, and needs no change to the harness:
  - **The mip chain, held by the frame.** `setup()` makes an `rgba8unorm` array of three layers,
    64 × 64 with seven levels. It writes bytes into each layer's level 0, then calls
    `generateMipmaps()`. Each frame loads every level of every layer into the output with
    `textureLoad`. `expected()` computes the same texels from the CPU reference, with a tolerance
    of 0.
  - **The writes, held by a throw.** `setup()` writes an `rgba16float` texture from a
    `Float16Array` and reads it back with `readFloats()`. It writes an `ImageBitmap` made from an
    `ImageData` with no conversion, and reads it back with `read()`. It throws at the first texel
    that differs, with the texel and both values. The draft expects the `ImageData`'s bytes. If
    Chromium gives others, the run fails, and the validation record keeps what Chromium gave.
  - **The measurement, held by a throw.** `setup()` fills an `rgba8unorm-srgb` array and an
    `rgba16float` array with `generateMipmaps()`. A pass loads each level and draws it into a
    texture of the level's size and format. `read()` or `readFloats()` reads that texture back.
    `setup()` compares it with the CPU reference, and throws when a difference passes the class's
    tolerance. A first run with a tolerance of 0 gives the largest difference in its error text.
    The validation record keeps that number, and the tolerance then holds it. The number includes
    the draw's own store, if it converts.
- `bun run gate:boundary`: the runtime's gzipped size within its budget, or a moved budget.
- `bun run bake:api-surface` for the two shapes, and `src/api-doc-coverage.test.ts` for the new
  members' JSDoc.

### Draft impact estimate

| Area              | Expected work                                                                                                                                                                              | Basis and uncertainty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime           | `write()`, `generateMipmaps()`, `mipLevelCount`, `layers`, the views and the refusals.                                                                                                     | `src/runtime/resources.ts` is 354 lines at the baseline. Change 0028's section 5 (`readFloats()` and the read order) is the precedent in size.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Shader            | One WGSL module of about thirty lines and its pipeline cache.                                                                                                                              | No precedent in the program runtime. `FULLSCREEN_WGSL` in `src/core/host-draw.ts` is the call layer's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Bundle            | About 3,000 bytes gzipped more, which passes the budget by about 1,800.                                                                                                                    | Estimated on 2026-10-05 with Bun 1.3.14 at the baseline. A prototype of the members, the views, the refusal texts and the filter went into a scratch copy of `src/`. Measured as `scripts/bundle-boundary.ts` measures, the copy grew from 11,701 to 14,683 bytes gzipped. The filter is about 820 of the growth. The budget is 12,900. The prototype is not the implementation, so the real growth may differ.                                                                                                                                                                                                                |
| Tests and journey | The recording-device cases, the CPU reference, the journey and the measurement.                                                                                                            | `journeys/hdr-target/` and `journeys/textures/` are the precedent. The measurement's result is unknown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Documents         | Rule 11.11, surface §69, the JSDoc, a `CHANGELOG.md` entry.                                                                                                                                | `bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` hold the set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Compatibility     | Additive for a texture the runtime makes today, which has one level. A view that binds or attaches today takes an equivalent view after. Three outcomes change, listed in the next column. | Known from the code, with WebGPU's rules from the specification, not measured. (1) A wrapped host texture of several levels attaches level 0 as a pass target and a storage binding. WebGPU refuses its default view there today. (2) A one-layer texture binds to a `texture_2d_array`, and a six-layer square texture to a `texture_cube`. WebGPU refuses both today (inference from the defaults, not measured). (3) A texture that does not fit its binding's dimension is a `TypeError` at the draw or the dispatch. WebGPU refuses it today, and its error reaches a frame's `submit()` as `The frame did not validate`. |
| Dependencies      | None.                                                                                                                                                                                      | Known.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Duration and cost | Unknown. Not estimated.                                                                                                                                                                    | No basis established.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Approval and plan record

This record does not yet apply. Acceptance requires the owner's answers to the nine decisions
above, recorded in this file. It also requires the actual decision, its pull request reference
and the approved revision of this file. It requires the final declarations (Rule 11.11, §69,
`Texture`, `TextureOptions`), the roadmap placement and the bundle budget. This draft assigns no
responsibility, milestone, duration or cost.

### Configuration and validation record

This record does not yet apply. Delivery requires the evidence below, each item with its date,
configuration and result. None of it exists yet.

- The implementing commits, each with `Change: 0050`.
- `bun run test` green on the delivered revision, with the runtime, API-surface and JSDoc tests.
- `bun run gate:journeys` green in Chromium with the new journey.
- The measurement for each format class, with its browser, adapter and numbers, and what Chromium
  gave for the `ImageBitmap`.
- `bun run gate:boundary` within the budget, or the budget moved in the same pull request.
- `bun run docs:impact`, `docs:refs`, `reqs:sync` and `doorstop -C` clean after the Rule 11.11
  edit.
- Separately, the site's and the editor's pin pull requests, each with `0050` recorded in its
  `compiler-changes.md`.

## What it owes downstream

**typeshade.github.io.** The API reference's `runtime-api` page reads the JSDoc of
`src/runtime/resources.ts` (the page map in `src/lib/api.ts`). At the pin it shows `write()`,
`generateMipmaps()`, `layers` and `mipLevelCount`. The pin pull request checks that page. The
WebGPU concept page's runtime paragraph (`src/i18n/en.ts` and `ko.ts`) says the runtime "makes
the buffers, textures and samplers". That stays true, so the draft expects no edit there.
`compiler-changes.md` records `0050` when the pin moves.

**vscode-typeshade.** The skill's host reference
(`plugins/typeshade/skills/typeshade/references/host.md`) has a bullet "Reading a texture back".
It gains a bullet beside it on `write()` and `generateMipmaps()`, in one or two sentences. The
webview writes its checker texture through the device's queue
(`packages/vscode-typeshade/src/webview/canvas.ts`). It may use `checker.write()` instead, which
is the editor's choice. `compiler-changes.md` records `0050` when the pin moves.

**typeshade/radiance**, which is not a listed downstream repository (decision 7). Record 0004's
step 3 (textures) starts after the compiler implements this proposal and the engine pins it. Its
`textures` differential scene still waits on an oracle path (What the oracle sees). The engine
records `0050` in its own `compiler-changes.md` when its pin moves, by its `CLAUDE.md`.
