struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5)));
}

fn pattern(uv: vec2<f32>) -> vec3<f32> {
  let d = length((uv - vec2<f32>(0.5, 0.5)));
  let rings = step(0.5, fract(((d * 10.0) - (u.time * 0.2))));
  let stripes = step(0.5, fract(((uv.x * 6.0) + (u.time * 0.1))));
  return (mix(vec3<f32>(0.1, 0.2, 0.5), vec3<f32>(1.0, 0.8, 0.3), vec3<f32>(rings, rings, rings)) * (0.6 + (0.4 * stripes)));
}

@fragment
fn fs(v: VsOut) -> Color {
  let _licm0 = v.uv;
  let step = (1.5 / max(u.resolution.x, 1.0));
  var sum: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var total: f32 = 0.0;
  for (var i: i32 = -4; (i <= 4); i = (i + 1)) {
    let w = exp(((-f32((i * i))) * 0.125));
    sum = (sum + (pattern((_licm0 + vec2<f32>((f32(i) * step), 0.0))) * w));
    total = (total + w);
  }
  return Color(vec4<f32>((sum / total), 1.0));
}
