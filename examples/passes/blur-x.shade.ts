"use typeshade";

// The first pass of `separable-blur.shade.ts` (change 0026): a pattern of rings and stripes,
// blurred along x with a 9-tap Gaussian. The example's own file reads what this pass drew in
// the same frame through its `blurX` texture and blurs it along y. The pattern is computed at
// each tap, since this pass reads no texture of its own.

class Uniforms {
  time: f32;
  resolution: vec2;
}

declare const u: uniform<Uniforms>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) * 0.5 + vec2(0.5, 0.5) };
}

// Rings around the centre over vertical stripes that drift with time: hard edges, so the blur
// has something to soften.
function pattern(uv: vec2): vec3 {
  const d = length(uv - vec2(0.5, 0.5));
  const rings = step(0.5, fract(d * 10. - u.time * 0.2));
  const stripes = step(0.5, fract(uv.x * 6. + u.time * 0.1));
  return mix(vec3(0.1, 0.2, 0.5), vec3(1., 0.8, 0.3), vec3(rings, rings, rings)) * (0.6 + 0.4 * stripes);
}

@fragment
export function fs(v: VsOut): Color {
  const step = 1.5 / max(u.resolution.x, 1.);
  let sum = vec3(0., 0., 0.);
  let total = 0.;
  for (let i = -4; i <= 4; i++) {
    const w = exp(-f32(i * i) / 8.);
    sum = sum + pattern(v.uv + vec2(f32(i) * step, 0.)) * w;
    total = total + w;
  }
  return { color: vec4(sum / total, 1.) };
}
