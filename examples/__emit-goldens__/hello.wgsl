struct Clip {
  @builtin(position) pos: vec4<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Clip {
  var x: f32 = -0.8;
  var y: f32 = -0.8;
  if ((i == 1u)) {
    x = 0.8;
  }
  if ((i == 2u)) {
    x = 0.0;
    y = 0.8;
  }
  return Clip(vec4<f32>(x, y, 0.0, 1.0));
}

@fragment
fn fs() -> Color {
  return Color(vec4<f32>(1.0, 0.0, 0.0, 1.0));
}
