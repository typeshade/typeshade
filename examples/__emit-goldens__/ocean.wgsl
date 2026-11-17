struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  swell: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> U: Uniforms;

fn hash32(x: u32) -> u32 {
  let _v0 = ((x ^ (x >> 16u)) * 2246822519u);
  let _v1 = ((_v0 ^ (_v0 >> 13u)) * 3266489917u);
  return (_v1 ^ (_v1 >> 16u));
}

fn hash(p: vec2<f32>) -> f32 {
  let _v0 = hash32((u32(i32(p.x)) ^ hash32(u32(i32(p.y)))));
  return (f32((_v0 >> 8u)) * 5.960464477539063e-8);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let _cse0 = ((f32((vi & 1u)) * 4.0) - 1.0);
  let _cse1 = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(_cse0, _cse1, 0.0, 1.0), vec2<f32>(((_cse0 * 0.5) + 0.5), ((_cse1 * 0.5) + 0.5)));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let _licm0 = (U.time * 0.6);
  let _licm1 = vec2<f32>((U.time * 0.12), 0.0);
  let _licm2 = vec2<f32>(1.0, 0.0);
  let _licm3 = vec2<f32>(0.0, 1.0);
  let _licm4 = vec2<f32>(1.0, 1.0);
  let _cse0 = (((vo.uv.x * 2.0) - 1.0) * (U.resolution.x / U.resolution.y));
  let _v0 = distance(vec2<f32>(_cse0, ((vo.uv.y * 2.0) - 1.0)), vec2<f32>(0.42, 0.56));
  let _v1 = max((0.58 - vo.uv.y), 0.0008);
  let _v2 = (0.06 / _v1);
  var _av0: f32 = 0.0;
  var _av1: f32 = 1.0;
  var _av2: f32 = 0.5;
  let _cse1 = vec2<f32>(3.0);
  let _licm5 = (vec2<f32>(((_cse0 * _v2) * 0.6), (_v2 + _licm0)) * 3.0);
  for (var _v3: u32 = 0u; (_v3 < 4u); _v3 = (_v3 + 1u)) {
    let _sm0_a0 = ((_licm5 * _av1) + _licm1);
    let _sm0_l_v0 = floor(_sm0_a0);
    let _sm0_l_v1 = fract(_sm0_a0);
    let _gv0 = ((_sm0_l_v1 * _sm0_l_v1) * (_cse1 - (_sm0_l_v1 * 2.0)));
    let _lc0 = _gv0.x;
    let _sm0_ret = mix(mix(hash(_sm0_l_v0), hash((_sm0_l_v0 + _licm2)), _lc0), mix(hash((_sm0_l_v0 + _licm3)), hash((_sm0_l_v0 + _licm4)), _lc0), _gv0.y);
    _av0 = (_av0 + (_av2 * _sm0_ret));
    _av1 = (_av1 * 2.03);
    _av2 = (_av2 * 0.5);
  }
  let _cse2 = vec3<f32>(1.0, 0.85, 0.6);
  let _lc1 = ((_av0 * U.swell) * smoothstep(0.0, 0.05, _v1));
  return vec4<f32>(mix(((mix(vec3<f32>(0.05, 0.18, 0.28), vec3<f32>(0.55, 0.5, 0.45), exp((-(_v1 * 7.0)))) + (vec3<f32>(0.3, 0.38, 0.36) * _lc1)) + (_cse2 * clamp(((pow((max((_lc1 - 0.32), 0.0) * 2.6), 3.0) * exp((-(abs((_cse0 - 0.42)) * 2.2)))) * exp((-(_v1 * 2.5)))), 0.0, 1.2))), (mix(vec3<f32>(0.83, 0.58, 0.38), vec3<f32>(0.12, 0.28, 0.48), smoothstep(0.58, 1.0, vo.uv.y)) + (_cse2 * ((1.0 - smoothstep(0.035, 0.06, _v0)) + (exp((-(_v0 * 4.0))) * 0.35)))), step(0.58, vo.uv.y)), 1.0);
}
