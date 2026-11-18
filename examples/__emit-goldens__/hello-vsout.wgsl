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
  let _ifc0 = (i == 1u);
  x = select(x, 0.8, _ifc0);
  u = select(u, 1.0, _ifc0);
  let _ifc1 = (i == 2u);
  x = select(x, 0.0, _ifc1);
  y = select(y, 0.8, _ifc1);
  u = select(u, 0.5, _ifc1);
  v = select(v, 1.0, _ifc1);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(u, v));
}

@fragment
fn fs(v: VsOut) -> Color {
  return Color(vec4<f32>(v.uv.x, v.uv.y, 0.2, 1.0));
}
