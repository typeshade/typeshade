struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  octaves: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> U: Uniforms;

fn hash(p: vec2<f32>) -> f32 {
  return fract((sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let _cse0 = ((f32((vi & 1u)) * 4.0) - 1.0);
  let _cse1 = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(_cse0, _cse1, 0.0, 1.0), vec2<f32>(((_cse0 * 0.5) + 0.5), ((_cse1 * 0.5) + 0.5)));
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let _licm0 = U.octaves;
  let _licm1 = vec2<f32>((U.time * 0.08), 0.0);
  let _licm2 = vec2<f32>(1.0, 0.0);
  let _licm3 = vec2<f32>(0.0, 1.0);
  let _licm4 = vec2<f32>(1.0, 1.0);
  var _av0: f32 = 0.0;
  var _av1: vec2<f32> = vec2<f32>((vo.uv.x * 3.0), (vo.uv.y * 3.0));
  var _av2: f32 = 0.55;
  let _cse0 = vec2<f32>(3.0);
  for (var _v0: u32 = 0u; (f32(_v0) < _licm0); _v0 = (_v0 + 1u)) {
    let _i0a0 = (_av1 + _licm1);
    let _i0_v0 = floor(_i0a0);
    let _i0_v1 = fract(_i0a0);
    let _gv0 = ((_i0_v1 * _i0_v1) * (_cse0 - (_i0_v1 * 2.0)));
    let _lc0 = _gv0.x;
    let _i0ret = mix(mix(hash(_i0_v0), hash((_i0_v0 + _licm2)), _lc0), mix(hash((_i0_v0 + _licm3)), hash((_i0_v0 + _licm4)), _lc0), _gv0.y);
    _av0 = (_av0 + (_av2 * _i0ret));
    _av1 = (_av1 * 2.02);
    _av2 = (_av2 * 0.5);
  }
  return vec4<f32>(mix(vec3<f32>(0.2, 0.42, 0.72), vec3<f32>(0.97, 0.97, 1.0), clamp(_av0, 0.0, 1.0)), 1.0);
}
