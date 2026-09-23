"use typeshade";

/* @example
{
  "title": "Default parameter values",
  "blurb": "Three helpers with default parameters, each called with a different argument omitted (§14). Neither target has default arguments, so the emitted function keeps every parameter and the call site carries the value: `vignette(v.uv)` emits `vignette(v.uv, 0.8, 1.35)`. A default may read a module const and call a helper, since it is lowered once in the module's scope.",
  "renderable": true
}
*/

// Default parameter values (roadmap 0.3 item T7, §14): `function vignette(uv: vec2, strength:
// f32 = 0.8)` is ordinary TypeScript, and `vignette(uv)` is how it is then called. Neither WGSL
// nor GLSL has default arguments, so the emitted function keeps every parameter and the missing
// ones are filled in where the call is written: the WGSL below reads `vignette(v.uv, 0.8)`. A
// default may read a module const (`WARM`) and call a helper (`grade`), because it is lowered
// once in the module's scope; it may not read another parameter, since at the call site that
// parameter is an expression and would run twice. One shader, both targets, three calls that
// each omit a different argument.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

const WARM: vec3 = vec3(1., 0.72, 0.42);

function grade(c: vec3, gamma: f32 = 2.2): vec3 {
  return pow(max(c, vec3(0.)), vec3(1. / gamma));
}

function vignette(uv: vec2, strength: f32 = 0.8, softness: f32 = 1.35): f32 {
  return 1. - strength * smoothstep(0., softness, dot(uv, uv));
}

function bands(uv: vec2, tint: vec3 = WARM, count: f32 = 6.): vec3 {
  const t = fract(uv.y * count) * 0.35 + 0.65;
  return tint * t;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  const p: vec2 = vec2(xs[i], ys[i]);
  return { pos: vec4(p, 0., 1.), uv: p };
}

@fragment
export function fs(v: VsOut): vec4 {
  // Every argument written, one omitted, all the optional ones omitted.
  const cool = bands(v.uv, vec3(0.38, 0.6, 1.), 10.);
  const warm = bands(v.uv);
  const mixed = mix(cool, warm, smoothstep(-1., 1., v.uv.x));
  // Annotated for the editor: the ambient lib types vector arithmetic loosely.
  const lit: vec3 = mixed * vignette(v.uv);
  return vec4(grade(lit), 1.);
}
