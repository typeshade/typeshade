struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var trail: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  let hdr = textureLoad(trail, vec2<i32>(v.pos.xy), 0u).rgb;
  let mapped = (hdr / (hdr + vec3<f32>(1.0, 1.0, 1.0)));
  let ground = vec3<f32>(0.03, 0.03, 0.06);
  return Color(vec4<f32>((ground + mapped), 1.0));
}
