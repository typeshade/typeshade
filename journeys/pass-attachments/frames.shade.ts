"use typeshade";

// The pass-attachments journey's shader (proposal 0064, PR-3): one full-screen triangle, and one
// fragment entry with three colours. The depth of the triangle and its colour are overrides, which
// each draw sets. One vertex entry and one fragment entry: the GLSL writer takes one of each per
// module.

class VsOut {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

/** The depth of the triangle in clip space, which is its window depth. 0.5 when a draw gives none. */
const depth: override<f32> = 0.5;

/** 1 red, 2 green, 3 white. 0 is unused. */
const pick: override<i32> = 0;

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, depth, 1) };
}

@fragment
export function fs(v: VsOut): Color {
  if (pick == 1) {
    return { color: vec4(1, 0, 0, 1) };
  }
  if (pick == 2) {
    return { color: vec4(0, 1, 0, 1) };
  }
  return { color: vec4(1, 1, 1, 1) };
}
