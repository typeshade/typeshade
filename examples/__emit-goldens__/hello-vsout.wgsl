struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var x: f32 = -0.8;
  var y: f32 = -0.8;
  var u: f32 = 0.0;
  var v: f32 = 0.0;
  if ((i == 1u)) {
    x = 0.8;
    u = 1.0;
  }
  if ((i == 2u)) {
    x = 0.0;
    y = 0.8;
    u = 0.5;
    v = 1.0;
  }
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(u, v));
}

@fragment
fn fs(v: VsOut) -> Color {
  return Color(vec4<f32>(v.uv.x, v.uv.y, 0.2, 1.0));
}
