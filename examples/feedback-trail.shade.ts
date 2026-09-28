"use typeshade";

/* @example
{
  "title": "Feedback trail",
  "blurb": "A dot that leaves a trail: the `trail` pass reads what it drew the frame before through a texture of its own name, fades it and adds the dot again, and this file tone-maps the result into the canvas.",
  "renderable": true,
  "passes": [{ "name": "trail", "file": "passes/trail.shade.ts" }]
}
*/

// Change 0026: a pass that reads its own output. `passes/trail.shade.ts` reads `trail`, and a
// pass read by itself, or by a pass drawn before it, receives its output from the frame
// before, so the trail builds up over frames. This file is drawn after it and reads this
// frame's `trail`. The pass keeps values above 1 where the dot passes often, which is why the
// outputs are `rgba16float`, and this file maps them back into the canvas's range.

declare const trail: texture_2d<f32>;
declare const smp: sampler;

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
  const hdr = textureSampleLevel(trail, smp, v.uv, 0.).rgb;
  const mapped = hdr / (hdr + vec3(1., 1., 1.));
  const ground = vec3(0.03, 0.03, 0.06);
  return { color: vec4(ground + mapped, 1.) };
}
