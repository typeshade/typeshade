"use typeshade";

// The pipeline-state journey's shaders (proposal 0064, PR-2): one full-screen triangle, a line and a
// point, and one fragment entry with three colours. The pipeline's depth, its primitive and its
// colour are overrides, which each draw sets. One vertex entry and one fragment entry: the GLSL
// writer takes one of each per module.

class VsOut {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

/** The depth of the primitive in clip space, which is its window depth. 0.5 when a draw gives none. */
const depth: override<f32> = 0.5;

/** The depth gained for each unit of clip x: a sloped plane, for a bias that depends on the slope. */
const slope: override<f32> = 0;

/** 0: the triangle (-1,-1), (-1,3), (3,-1), clockwise in clip space. 1: its mirror, counter-clockwise.
 *  2: the line from (-3, 0) to (3, 0). 3: the point (px, 0). */
const prim: override<i32> = 0;

/** The x of the point, in clip space. */
const px: override<f32> = 0;

/** 0: unused. 1 red, 2 green, 3 white. */
const pick: override<i32> = 0;

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  if (prim == 2) {
    return { pos: vec4(f32(i32(vi)) * 6 - 3, 0, depth, 1) };
  }
  if (prim == 3) {
    return { pos: vec4(px, 0, depth, 1) };
  }
  if (prim == 1) {
    const x1 = f32(i32(vi) % 2) * 4 - 1;
    const y1 = f32(i32(vi) / 2) * 4 - 1;
    return { pos: vec4(x1, y1, depth + slope * x1, 1) };
  }
  const x = f32(i32(vi) / 2) * 4 - 1;
  const y = f32(i32(vi) % 2) * 4 - 1;
  return { pos: vec4(x, y, depth + slope * x, 1) };
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
