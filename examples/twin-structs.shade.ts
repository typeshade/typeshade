"use typeshade";

/* @example
{
  "title": "Twin IO structs",
  "blurb": "Two IO structs with identical fields, a vertex output and a fragment input, with object literals in all three positions that declare which one they build: a return type, an annotation and a parameter type. The case matching field names alone cannot decide.",
  "renderable": true
}
*/

// The gated example for object-literal contextual typing (#8 A11). The point it carries into
// the compile gate is the case name matching cannot decide: `VsOut` and `FsIn` have exactly
// the same fields, so `{ pos, uv }` is ambiguous by its names alone — and every literal below
// sits in a position that states which struct it is.
//
// Two identically shaped IO structs is not a contrivance. A vertex stage's output and the
// fragment stage's input describe the same interface from two sides, and a codebase that names
// them separately (for the attributes, or just for the reader) hits this on the first shader.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class FsIn {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

// The PARAMETER type says FsIn, so the literal built at the call site below is an FsIn.
export function shade(o: FsIn): vec4 {
  const d = o.uv - vec2(0.5, 0.5);
  const r = length(d);
  return vec4(o.uv.x, o.uv.y, 1. - r, 1.);
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  const uv = vec2(x, y) * 0.5 + vec2(0.5, 0.5);
  // The RETURN type says VsOut.
  return { pos: vec4(x, y, 0., 1.), uv: uv };
}

@fragment
export function fs(v: VsOut): Color {
  // The ANNOTATION says FsIn, from a literal with the same field names as the VsOut above.
  const asIn: FsIn = { pos: v.pos, uv: v.uv };
  const a = shade(asIn);
  // …and the parameter type says FsIn here, with no annotation to lean on.
  const b = shade({ pos: v.pos, uv: v.uv * 0.5 });
  return { color: (a + b) * 0.5 };
}
