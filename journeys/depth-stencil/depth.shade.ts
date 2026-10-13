"use typeshade";

// A full-screen triangle at depth 0.5. The host draws it into an rgba8unorm colour target and a
// depth target that its run names: one format with no stencil aspect, and depth24plus-stencil8.
// Each colour is a multiple of 1/16, so the harness holds the readback to a rounding step.

class VsOut {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

/** A fullscreen triangle, in front of a depth target cleared to its default, 1. */
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, 0.5, 1) };
}

/** Red climbs with the column and green with the row, over a 16 by 16 target. */
@fragment
export function fs(v: VsOut): Color {
  const px = floor(v.pos.x);
  const py = floor(v.pos.y);
  return { color: vec4(px / 16, py / 16, 0.5, 1) };
}
