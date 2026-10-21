"use typeshade";

/* @example
{
  "title": "A kernel that writes an image",
  "blurb": "`invert` reads a `texture_2d<f32>` and stores into a `texture_storage_2d`, which makes it a kernel function (Rule 8.22, change 0077). Its loop stores each texel once, at `vec2u(i % w, i / w)`, the one coordinate the proof accepts. A host makes the storage texture with `device.texture({ size, format, storage: true })` and calls `invert(image, dst, w, h)` inside that device's `fuse()`: on WebGPU each texel is one invocation, and on the CPU tier the texture is held in memory.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// The storage texture is the caller's, passed by reference as an array is (Rule 8.23). The loop
// loads the image at the texel it stores, and keeps the alpha.

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
