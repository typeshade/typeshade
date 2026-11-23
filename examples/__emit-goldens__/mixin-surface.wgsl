struct Disc {
  center: vec2<f32>,
  radius: f32,
}

struct Bar {
  center: vec2<f32>,
  halfWidth: f32,
}

struct TintedDisc {
  center: vec2<f32>,
  radius: f32,
  tint: vec3<f32>,
  softness: f32,
}

struct TintedBar {
  center: vec2<f32>,
  halfWidth: f32,
  tint: vec3<f32>,
  softness: f32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(xs[i], ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let p = (frag.xy * 0.004);
  let _i0a0 = vec2<f32>(0.6, 0.6);
  let _i0a3 = vec3<f32>(0.95, 0.4, 0.25);
  let _i1a3 = vec3<f32>(0.2, 0.55, 0.9);
  let rgb = ((_i0a3 * smoothstep(0.0, 1.0, (1.0 - smoothstep(0.26999999999999996, 0.35, length((p - _i0a0)))))) + (_i1a3 * smoothstep(0.0, 1.0, (1.0 - smoothstep(0.2, 0.25, abs((p.x - 1.4)))))));
  return vec4<f32>(rgb, 1.0);
}
