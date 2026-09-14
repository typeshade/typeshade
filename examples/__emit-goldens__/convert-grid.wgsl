struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let bits = vec2<u32>((vi & 1u), (vi >> 1u));
  let corner = vec2<f32>(bits);
  let p = ((corner * 4.0) - vec2<f32>(1.0, 1.0));
  return VsOut(vec4<f32>(p, 0.0, 1.0), corner);
}

@fragment
fn fs(v: VsOut) -> Color {
  let scaled = (v.uv * 4.0);
  let cell = vec2<u32>(scaled);
  let back = vec2<f32>(cell);
  let shade = ((back.x + back.y) / 6.0);
  return Color(vec4<f32>(shade, (1.0 - shade), 0.35, 1.0));
}
