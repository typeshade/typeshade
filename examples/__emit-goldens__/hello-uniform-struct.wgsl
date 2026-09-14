struct Uniforms {
  tint: vec4<f32>,
  gain: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) idx: u32) -> VsOut {
  let x = ((f32((idx & 1u)) * 4.0) - 1.0);
  let y = ((f32((idx >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), (((y * 0.5) + 0.5) * u.gain)));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let rgb = (u.tint.rgb * vo.uv.y);
  return vec4<f32>(rgb, u.tint.a);
}
