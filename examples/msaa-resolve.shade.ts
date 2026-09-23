"use typeshade";

/* @example
{
  "title": "A multisampled texture, resolved by hand",
  "blurb": "An MSAA render target as a `texture_multisampled_2d<f32>` read one sample at a time with `textureLoad(t, coords, sampleIndex)` and averaged over `textureNumSamples`, and its depth attachment as a `texture_depth_multisampled_2d` (§37). A multisampled texture cannot be used with a sampler, so every sampling form is refused with the load named instead. WGSL-only: GLSL ES 3.00 has no `sampler2DMS`, so the binding derives `msaaTextureLoad` and the Tint half of the gate alone runs it.",
  "renderable": false,
  "reason": "missing capabilities: msaaTextureLoad"
}
*/

// A multisampled texture, read one sample at a time (§37). An MSAA render target stores several
// samples per texel; a shader that resolves it reads each with `textureLoad(t, coords,
// sampleIndex)` and averages them, and `textureNumSamples(t)` is how many there are. The type
// existed before this example (roadmap 0.4 item 13); this is the read it lacked.
//
// A multisampled texture cannot be used with a sampler (WGSL §6.6.3), so every sampling form is
// refused with this load named instead. WGSL-only: GLSL ES 3.00 has no `sampler2DMS` (that is
// ES 3.10), so the binding derives the `msaaTextureLoad` capability and this example runs on the
// Tint half of the gate alone.

declare const msaa: texture_multisampled_2d<f32>;
declare const depthMs: texture_depth_multisampled_2d;

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  // The integer texel this fragment covers: a multisampled load takes no normalised coordinate.
  const c: vec2i = vec2i(p.xy);
  // A 4× resolve, one load per sample. The count is a fact about the texture the host bound;
  // a target with fewer samples makes the later loads indeterminate, so the divisor is the
  // count the texture reports and not the number of loads written.
  const s0 = textureLoad(msaa, c, 0);
  const s1 = textureLoad(msaa, c, 1);
  const s2 = textureLoad(msaa, c, 2);
  const s3 = textureLoad(msaa, c, 3);
  const n = f32(textureNumSamples(msaa));
  const colour: vec4 = (s0 + s1 + s2 + s3) / max(n, 1.);
  // The nearest depth of the texel's first two samples, from the multisampled depth attachment.
  const depth = min(textureLoad(depthMs, c, 0), textureLoad(depthMs, c, 1));
  const size = textureDimensions(msaa);
  const vignette = 1. - 0.5 * length(p.xy / vec2(f32(size.x), f32(size.y)) - 0.5);
  return vec4(colour.rgb * vignette * (1. - depth * 0.25), 1.);
}
