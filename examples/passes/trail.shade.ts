"use typeshade";

// The pass of `feedback-trail.shade.ts` (change 0026). It reads its own output through the
// `trail` texture, which a pass that reads itself receives as the frame before, fades it, and
// adds a dot where the orbit is now. On the first frame there is no frame before: the texture
// reads zeroes, and `frame` says so, so the fade starts from nothing on every backend.
//
// The frame before is read at the pixel's own position. A texture's rows run down from the top
// on WebGPU and up from the bottom on WebGL2, and a pass writes each pixel where its position
// says on both, so the position finds the pixel it drew. `uv` runs up the screen on both, and
// read through it the texture would come back upside down on WebGPU, every frame.

declare const trail: texture_2d<f32>;

class Uniforms {
  time: f32;
  resolution: vec2;
  frame: u32;
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
  const before = textureLoad(trail, vec2i(v.pos.xy), 0).rgb;
  const keep = u.frame === u32(0) ? 0. : 0.96;
  const aspect = u.resolution.x / max(u.resolution.y, 1.);
  const at = vec2(0.5, 0.5) + vec2(cos(u.time * 1.3), sin(u.time * 2.1)) * 0.3;
  const d = length((v.uv - at) * vec2(aspect, 1.));
  const spot = smoothstep(0.04, 0., d);
  const hue = vec3(0.5, 0.5, 0.5) + vec3(cos(u.time), cos(u.time + 2.1), cos(u.time + 4.2)) * 0.5;
  return { color: vec4(before * keep + hue * (spot * 1.5), 1.) };
}
