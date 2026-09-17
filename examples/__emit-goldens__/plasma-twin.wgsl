struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> U: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let t = U.time;
  let uv = vo.uv;
  let v = ((sin(((uv.x * 10.0) + t)) + sin(((uv.y * 10.0) + t))) + sin((((uv.x + uv.y) * 10.0) + (t * 0.7))));
  let col = ((vec3<f32>(sin(v), sin((v + 2.094)), sin((v + 4.188))) * 0.5) + 0.5);
  return vec4<f32>(col, 1.0);
}
