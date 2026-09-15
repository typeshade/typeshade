struct Uniforms {
  top: vec4<f32>,
  bottom: vec4<f32>,
  mix_bias: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_full(@builtin(vertex_index) idx: u32) -> VsOut {
  var pos: vec2<f32> = vec2<f32>(-1.0, -1.0);
  if ((idx == 1u)) {
    pos = vec2<f32>(3.0, -1.0);
  } else if ((idx == 2u)) {
    pos = vec2<f32>(-1.0, 3.0);
  }
  return VsOut(vec4<f32>(pos, 0.0, 1.0), vec2<f32>(((pos.x + 1.0) * 0.5), ((pos.y + 1.0) * 0.5)));
}

@fragment
fn fs_gradient(vo: VsOut) -> @location(0) vec4<f32> {
  let t = (vo.uv.y + u.mix_bias);
  let rgb = mix(u.bottom.rgb, u.top.rgb, t);
  return vec4<f32>(rgb, 1.0);
}
