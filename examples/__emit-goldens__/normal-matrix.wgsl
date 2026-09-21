struct Uniforms {
  model: mat4x4<f32>,
  tint: mat3x3<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

fn normalMatrix(model: mat4x4<f32>) -> mat3x3<f32> {
  return mat3x3<f32>(model[0].xyz, model[1].xyz, model[2].xyz);
}

@vertex
fn vs(@builtin(vertex_index) idx: u32) -> VsOut {
  let x = ((f32((idx & 1u)) * 4.0) - 1.0);
  let y = ((f32((idx >> 1u)) * 4.0) - 1.0);
  let n = normalMatrix(u.model);
  let handed = select(1.0, -1.0, (determinant(n) < 0.0));
  let normal = (n * vec3<f32>(0.0, 0.0, handed));
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)), normal);
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let basis = mat3x3<f32>(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0));
  let scaled = ((0.5 * basis) * 2.0);
  let wide = mat2x3<f32>(vec3<f32>(vo.uv.x, vo.uv.y, 1.0), vec3<f32>(vo.uv.y, vo.uv.x, 1.0));
  let tall = transpose(wide);
  let row = (vo.normal * wide);
  let col = (tall * vo.normal);
  let rgb = ((scaled * u.tint) * vec3<f32>(row.x, col.y, abs((row.y - col.x))));
  return vec4<f32>(rgb, 1.0);
}
