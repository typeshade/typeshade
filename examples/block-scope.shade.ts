"use typeshade";

/* @example
{
  "title": "Block scope",
  "blurb": "Two sequential loops over `i`, a `p` in a loop body beside a `p` in an `if` arm, and an inner `p` that shadows the outer one: the block scoping TypeScript has and the IR now follows, with the second declaration of each name emitted as `i_1`, `p_1` (#38). Also a float `%=` for GLSL ES 3.00 (#20) and a shift inside 0 to 31 (#71). Renders concentric rings.",
  "renderable": true
}
*/

// Block scope, the way TypeScript has it and the IR did not (#38): two sequential loops over
// `i`, a `p` in a loop body beside a `p` in an `if` arm, and an inner `p` that shadows the
// outer one. Before the fix the lowerer handed both bindings one name and the emit refused the
// module with SD0112 at line 1 of the file, which is what stopped the two raymarch twins. The
// second declaration of each name takes the IR name `i_1`, `p_1` in the emitted WGSL and GLSL
// (the golden shows them), and the compile gate runs both on Tint and ANGLE.
//
// It also carries §22's spellings to the gate: a shift inside 0 to 31, a division by a module
// const that is not zero, and a float `%=`, which GLSL ES 3.00 receives as `floatMod` (#20),
// on a scalar and on a vector — GLSL ES 3.00 has no float `%` at any width, so both are the
// componentwise `(a - b * trunc(a / b))` a real WebGL2 driver accepts.
//
// Renders concentric rings, brighter towards the centre, with a stepped band inside each ring
// and a faint square lattice from the vector `%=`.

const RINGS: f32 = 6.;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class FsOut {
  @location(0) color: vec4;
}

// Fullscreen triangle, as `cutout.shade.ts` draws it: no vertex buffer, a centred [-1, 1] uv.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
}

@fragment
export function fs(v: VsOut): FsOut {
  const r = length(v.uv);
  // Where in its ring this pixel is, 0 at the inner edge and 1 at the outer: a float `%=`.
  let band: f32 = r * RINGS;
  band %= 1.;
  // The same operator on a vector: where in its cell this pixel is, both components at once.
  // WGSL keeps `cell %= 1.`; GLSL ES 3.00 takes `floatMod` on the whole `vec2`.
  let cell: vec2 = v.uv * RINGS;
  cell %= 1.;
  // Four steps up across the band, then three dips: the same counter name in two loops, and
  // the same `p` in two bodies.
  let acc = 0.;
  for (let i: u32 = 0; i < 4; i++) {
    const p = f32(i) * 0.25;
    acc = acc + step(p, band) * 0.25;
  }
  for (let i: u32 = 0; i < 3; i++) {
    const p = f32(i + 1) / 3.;
    acc = acc * (1. - abs(band - p) * 0.5);
  }
  // Warm the centre: an inner `p` that shadows nothing outside its block, then reads as the
  // mix weight. The outer `p`s above are gone by here; this one is its own binding.
  let tint: vec3 = vec3(0.1, 0.2, 0.5);
  if (r < 0.5) {
    const p = 1. - r * 2.;
    tint = mix(tint, vec3(1., 0.9, 0.6), vec3(p, p, p));
  }
  // Sixteen levels of the band, a shift down and back up inside the range a 32-bit integer has.
  const levels: u32 = u32(band * 255.) >> 4;
  const stepped = f32(levels << 4) / 255.;
  // A grid over the same rings: a component of the remainder is 0 on every line where that
  // component of `uv * RINGS` is whole, so the smaller of the two is 0 along each line of the
  // lattice and rises towards 1 inside a cell. Added, so the lines stay dark and the cell
  // interiors lift.
  const grid = min(abs(cell.x), abs(cell.y));
  const shaded: vec3 = tint * acc + stepped * 0.1 + grid * 0.05;
  return { color: vec4(shaded / RINGS * 4., 1.) };
}
