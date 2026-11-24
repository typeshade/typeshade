"use typeshade";

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
    textureStore(dst, vec2u(i % w, i / w), vec4(1 - c.rgb, c.a));
  }
}
