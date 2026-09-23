"use typeshade";

/* @example
{
  "title": "A shadow map, read by comparison",
  "blurb": "A depth texture read through a `sampler_comparison` with `textureSampleCompare` and `textureSampleCompareLevel`, on a plain 2D shadow map and on a cascade array (§34). Both targets have a spelling: WGSL keeps two bindings and puts the comparison on the sampler, GLSL ES 3.00 fuses them into one `sampler2DShadow` and folds the reference into the coordinate. Measured on Tint and on a WebGL2 driver; the two sampler kinds are not interchangeable, and the compiler says so before either backend does.",
  "renderable": true
}
*/

// A shadow map, read by comparison (§34). The texture a shadow pass wrote is a DEPTH texture:
// single-channel float with no element type of its own, and the read that applies to it is
// not a sample but a COMPARISON — a reference depth against the texel, through a comparison
// sampler, yielding how much of the filter footprint passed. That number is the light factor.
//
// Both targets have a spelling, so this example runs on both halves of the gate. WGSL keeps
// the texture and the sampler as two bindings and puts the comparison on the SAMPLER
// (`sampler_comparison`); GLSL ES 3.00 fuses them into one `sampler2DShadow` and folds the
// reference INTO the coordinate, `texture(shadowMap, vec3(uv, ref))` — the same fold the array
// layer already takes. Measured on Tint and on a WebGL2 driver, both of which take every shape
// below. A shadow sampler has no default precision in GLSL, so the header declares one.
//
// The two sampler kinds are not interchangeable in either direction: Tint refuses both
// pairings as "no matching call", and this compiler says so first, in this file's own words.
// `textureSampleCompare` uses the implicit level of detail and is fragment-only, as Tint
// says; `textureSampleCompareLevel` samples level 0 and is legal in any stage.
//
// A PLAIN read of a depth texture (`textureSample` with an ordinary sampler, `textureLoad`) is
// refused for now, with the reason: on GLSL the combined sampler's type is decided by the read,
// so a texture read both ways needs WebGPU's separate samplers, which a later item adds.

declare const shadowMap: texture_depth_2d;
declare const shadowSmp: sampler_comparison;

// A cascade: one depth texture per distance band, the layer picked per fragment.
declare const cascades: texture_depth_2d_array;

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv: vec2 = fract(p.xy * 0.004);
  // A stand-in for the light-space depth of this fragment.
  const depthHere = 0.5 + 0.25 * sin(uv.x * 6.2831);

  // How lit this fragment is: the fraction of the footprint whose stored depth is not nearer
  // than ours. The implicit LOD form, which is what a fragment stage is for.
  const lit = textureSampleCompare(shadowMap, shadowSmp, uv, depthHere);

  // The explicit-level form on the cascade array, layer first, then the reference.
  const band = i32(floor(uv.y * f32(textureNumLayers(cascades))));
  const litFar = textureSampleCompareLevel(cascades, shadowSmp, uv, band, depthHere);

  const size = textureDimensions(shadowMap);
  const texel = 1. / f32(size.x);
  const shade = mix(0.15, 1., lit * 0.6 + litFar * 0.4);
  return vec4(shade * (0.9 - texel), shade * 0.8, shade * 0.6, 1.);
}
