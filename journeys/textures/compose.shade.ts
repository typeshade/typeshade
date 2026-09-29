"use typeshade";

// The second pass reads three textures three ways. `level`, the r32float texture the first pass
// wrote, is only loaded: no sampler meets it, and a 32-bit float texture is no texture a sampler
// filters, so its layout must say unfilterable-float. `photo` is sampled through `smp`, and `glow`
// through a const of it and of the sampler: a sampler reads each, so their layouts say float, which
// a filtering sampler needs and an unfilterable-float layout makes WebGPU refuse.

declare const level: texture_2d<f32>;
declare const photo: texture_2d<f32>;
declare const glow: texture_2d<f32>;
declare const smp: sampler;

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv = p.xy / vec2(textureDimensions(photo));
  const near = textureLoad(level, vec2i(p.xy), 0).x / 1024.;
  const lamp = glow;
  const via = smp;
  return vec4(near, textureSample(photo, smp, uv).y, textureSample(lamp, via, uv).z, 1.);
}
