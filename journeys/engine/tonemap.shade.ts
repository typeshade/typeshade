"use typeshade";

// The last pass: the scene was drawn into a half-float texture, whose colours pass 1; this pass
// samples it and maps each colour into [0, 1) for the display, c / (1 + c).

declare const hdr: texture_2d<f32>;
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
  const size = vec2(textureDimensions(hdr));
  // The coordinate is a local, not the argument itself: the editor refuses a vector operator
  // written as textureSample's argument, which the compiler accepts (#387).
  const uv = p.xy / size;
  const c = textureSample(hdr, smp, uv).xyz;
  return vec4(c / (vec3(1., 1., 1.) + c), 1.);
}
