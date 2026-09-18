struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  let stops = array<vec3<f32>, 3>(vec3<f32>(0.1, 0.1, 0.35), vec3<f32>(0.9, 0.4, 0.2), vec3<f32>(1.0, 0.95, 0.7));
  let weights = array<i32, 3>(1, 2, 1);
  var band: i32 = i32((v.uv.x * 3.0));
  if ((band > 2)) {
    band = 2;
  }
  let w = (f32(weights[band]) * 0.25);
  let c = (stops[band] * (0.75 + w));
  return Color(vec4<f32>(c, 1.0));
}
