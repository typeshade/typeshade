"use typeshade";

/* @example
{
  "title": "Converting constructors",
  "blurb": "A fullscreen triangle whose corner comes from `vec2(vec2u(...))` and whose colour comes from an `f32`→`u32`→`f32` round trip — the element-converting constructor in both directions and at both ends of the pipeline.",
  "renderable": true
}
*/

// The gated example for element-converting vector constructors (#8 A8). Before it, nothing
// the compile gate emits used the feature, so the gate's verdict said exactly as much about
// A8 as it did before A8 existed. Every constructor below is the CONVERTING form — one whole
// vector of the constructor's own size — and both stages go to a real compiler: WGSL to Tint,
// GLSL ES 3.00 to a WebGL2 context that also links the pair.
//
// It converts in both directions and at both sizes: u32→f32 in the vertex stage (the
// fullscreen triangle's corner, built out of the vertex index), f32→u32 and back again in the
// fragment stage (the grid cell). It takes no uniform, so nothing else has to be right for
// the gate to reach the constructors.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  // vec2<u32> → vec2<f32>: WGSL `vec2<f32>(v)`, GLSL `vec2(v)`.
  const bits = vec2u(vi & u32(1), vi >> u32(1));
  const corner = vec2(bits);
  // Annotated, not inferred: the editor's ambient lib gives vector arithmetic the type
  // `number`, and handing that straight to `vec4(...)` is a TS2345 it does not filter (#21).
  // A declared type is the shape its TS2322 arm already covers.
  const p: vec2 = corner * 4. - vec2(1., 1.);
  return { pos: vec4(p, 0., 1.), uv: corner };
}

@fragment
export function fs(v: VsOut): Color {
  // f32 → u32 (saturating, which is the rule this item documents) and straight back, so the
  // fragment reads the cell index of a 4×4 grid as a float again.
  const scaled = v.uv * 4.;
  const cell = vec2u(scaled);
  const back = vec2(cell);
  const shade = (back.x + back.y) / 6.;
  return { color: vec4(shade, 1. - shade, 0.35, 1.) };
}
