struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(vin: VsIn) -> VsOut {
  return VsOut(vec4<f32>(vin.position, 1.0), vin.uv);
}

@fragment
fn fs(v: VsOut) -> Color {
  return Color(vec4<f32>(v.uv, 0.2, 1.0));
}
