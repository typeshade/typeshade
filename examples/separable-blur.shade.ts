"use typeshade";

/* @example
{
  "title": "Separable blur",
  "blurb": "A blur in two passes: the `blurX` pass draws a pattern blurred along x, and this file reads what it drew in the same frame through a `texture_2d<f32>` of the same name and blurs it along y.",
  "renderable": true,
  "passes": [{ "name": "blurX", "file": "passes/blur-x.shade.ts" }]
}
*/

// Change 0026: an example drawn in several passes. `passes/blur-x.shade.ts` is drawn first,
// into a texture the size of the canvas; this file is drawn last, into the canvas. A
// `texture_2d<f32>` named like a pass reads that pass's output, and a pass drawn earlier in the
// frame is read as this frame's output, so the two passes make one 9 by 9 Gaussian.

declare const blurX: texture_2d<f32>;
declare const smp: sampler;

class Uniforms {
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

@fragment
export function fs(v: VsOut): Color {
  const step = 1.5 / max(u.resolution.y, 1.);
  let sum = vec3(0., 0., 0.);
  let total = 0.;
  for (let i = -4; i <= 4; i++) {
    const w = exp(-f32(i * i) / 8.);
    sum = sum + textureSampleLevel(blurX, smp, v.uv + vec2(0., f32(i) * step), 0.).rgb * w;
    total = total + w;
  }
  return { color: vec4(sum / total, 1.) };
}
