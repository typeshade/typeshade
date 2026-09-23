"use typeshade";

/* @example
{
  "title": "A conditional on a struct and on an array",
  "blurb": "Two arms that are structs, and two that are fixed-length arrays, chosen at run time (§31). Neither target has an operator for it: WGSL's `select` is declared for a scalar or a vector and WGSL has no ternary, and a WebGL2 driver refuses GLSL's ternary on a struct or an array. So the conditional is hoisted into a slot and an `if` on both targets, the way a multi-arm conditional expression already is; not a helper function, whose arguments would evaluate both arms. Issue #113: before that, this shape compiled with zero diagnostics and both backends rejected the result.",
  "renderable": true
}
*/

// A conditional whose two arms are STRUCTS, and one whose arms are fixed-length ARRAYS (§31).
//
// NEITHER target has an operator for it, which is what this example exists to pin. WGSL's
// `select` builtin is declared for a scalar or a vector, and WGSL has no ternary at all; GLSL
// ES 3.00 has the ternary, and a WebGL2 driver refuses it here — "'?:' : ternary operator is
// not allowed for structures in ESSL 1.0 and webgl", and the same for arrays. So the
// conditional is hoisted into a slot and an `if` on both targets, the way a multi-arm
// conditional expression already is. The source says the same thing either way.
//
// Not a helper function: its arguments would be evaluated before the call, so both arms would
// run, and an arm holding a call that discards would discard unconditionally.
//
// Issue #113: before that, this file compiled with zero diagnostics and emitted
// `select(Palette, Palette, bool)` on WGSL and `((c) ? warm : cool)` on GLSL, and both backends
// rejected it. No example carried the shape, so no gate had ever compiled one; the constant
// folder hides the easy case, since two identical arms fold to one binding. It takes a runtime
// condition AND two distinguishable arms to reach, which is what this example is for.
//
// The GLSL half of that is a guess this example corrected: the ES 3.00 spec's ternary takes any
// two operands of one type, so a reading of the spec says a struct is fine. The driver is what
// the emitted code has to satisfy, and it said no.

class Palette {
  lo: vec3;
  hi: vec3;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(@builtin("position") frag: vec4): vec4 {
  const uv: vec2 = fract(frag.xy * 0.008);

  const warm: Palette = { lo: vec3(0.35, 0.1, 0.05), hi: vec3(1., 0.75, 0.35) };
  const cool: Palette = { lo: vec3(0.04, 0.1, 0.3), hi: vec3(0.5, 0.85, 1.) };
  // Two structs, chosen at run time: the shape WGSL has no `select` for.
  const shade: Palette = uv.x > 0.5 ? warm : cool;

  const rising: array<f32, 3> = [0.15, 0.5, 0.9];
  const falling: array<f32, 3> = [0.9, 0.5, 0.15];
  // The same for two fixed-length arrays.
  const steps: array<f32, 3> = uv.y > 0.5 ? rising : falling;

  const band = i32(floor(uv.y * 3.));
  const t = smoothstep(0., 1., steps[band]);
  return vec4(mix(shade.lo, shade.hi, t), 1.);
}
