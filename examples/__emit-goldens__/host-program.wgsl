struct Sky {
  size: vec2<f32>,
  time: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> sky: Sky;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let _cse0 = i32(vi);
  let x = ((f32((_cse0 / 2)) * 4.0) - 1.0);
  let y = ((f32((_cse0 % 2)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0));
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> Color {
  let uv = (p.xy / sky.size);
  return Color(vec4<f32>(uv.x, (1.0 - uv.y), (0.5 + (0.5 * cos(sky.time))), 1.0));
}
