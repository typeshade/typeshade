struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  frame: u32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var trail: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  let before = textureSampleLevel(trail, smp, v.uv, 0.0).rgb;
  let keep = select(0.96, 0.0, (u.frame == 0u));
  let aspect = (u.resolution.x / max(u.resolution.y, 1.0));
  let at = (vec2<f32>(0.5, 0.5) + (vec2<f32>(cos((u.time * 1.3)), sin((u.time * 2.1))) * 0.3));
  let d = length(((v.uv - at) * vec2<f32>(aspect, 1.0)));
  let spot = smoothstep(0.04, 0.0, d);
  let hue = (vec3<f32>(0.5, 0.5, 0.5) + (vec3<f32>(cos(u.time), cos((u.time + 2.1)), cos((u.time + 4.2))) * 0.5));
  return Color(vec4<f32>(((before * keep) + (hue * (spot * 1.5))), 1.0));
}
