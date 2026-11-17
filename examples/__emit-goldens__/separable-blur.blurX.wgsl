struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), ((vec2<f32>(x, y) * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  let _licm0 = v.uv;
  let _licm1 = vec2<f32>(0.5, 0.5);
  let _licm2 = (u.time * 0.2);
  let _licm3 = (u.time * 0.1);
  let _licm4 = vec3<f32>(0.1, 0.2, 0.5);
  let _licm5 = vec3<f32>(1.0, 0.8, 0.3);
  let step_ = (1.5 / max(u.resolution.x, 1.0));
  var sum: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var total: f32 = 0.0;
  for (var i: i32 = -4; (i <= 4); i = (i + 1)) {
    let w = exp(((-f32((i * i))) * 0.125));
    let _sm0_a0 = (_licm0 + vec2<f32>((f32(i) * step_), 0.0));
    let _sm0_l_d = length((_sm0_a0 - _licm1));
    let _sm0_l_rings = step(0.5, fract(((_sm0_l_d * 10.0) - _licm2)));
    let _sm0_l_stripes = step(0.5, fract(((_sm0_a0.x * 6.0) + _licm3)));
    let _sm0_ret = (mix(_licm4, _licm5, vec3<f32>(_sm0_l_rings, _sm0_l_rings, _sm0_l_rings)) * (0.6 + (0.4 * _sm0_l_stripes)));
    sum = (sum + (_sm0_ret * w));
    total = (total + w);
  }
  return Color(vec4<f32>((sum / total), 1.0));
}
