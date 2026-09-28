"use typeshade";

// console.log from a fragment shader: one line per pixel the draw covers, the pixel's position
// and a varying the rasteriser interpolates. The host draws this into a small texture with the
// console recorded (surface §66) and reads the lines back from WebGPU.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

/** A fullscreen triangle, with `uv` running from 0 at the top left to 1 at the bottom right. */
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, 0, 1), uv: vec2(x * 0.5 + 0.5, 0.5 - y * 0.5) };
}

@fragment
export function fs(v: VsOut): Color {
  console.log("pixel", v.pos.x, v.pos.y, v.uv);
  return { color: vec4(v.uv, 0, 1) };
}
