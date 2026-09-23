struct Uniforms {
  center: DF64Vec2,
  resolution: vec2<f32>,
  zoom_exp: f32,
  fp64: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct DF64Vec2 {
  hi: vec2<f32>,
  lo: vec2<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var _fp64: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let _cse0 = ((f32((vi & 1u)) * 4.0) - 1.0);
  let _cse1 = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(_cse0, _cse1, 0.0, 1.0), vec2<f32>(((_cse0 * 0.5) + 0.5), ((_cse1 * 0.5) + 0.5)));
}

@fragment
fn fs_de(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _v0 = pow(10.0, (-u.zoom_exp));
  let _v1 = (vo.uv.x * 2.0);
  let _cse0 = (vo.uv.x < 0.5);
  let _v2 = (_v1 - select(1.0, 0.0, _cse0));
  let _v3 = ((_v2 - 0.5) * _v0);
  let _v4 = (((vo.uv.y - 0.5) * _v0) * ((u.resolution.y / u.resolution.x) * 2.0));
  var _v5: f32 = 0.0;
  var _v6: f32 = 1.0;
  let _cse1 = vec2<f32>(u.center.hi.x, u.center.lo.x);
  let _cse2 = vec2<f32>(u.center.hi.y, u.center.lo.y);
  if ((_cse0 || (u.fp64 < 0.5))) {
    let _v7 = (df64_narrow(_cse1) + _v3);
    let _v8 = (df64_narrow(_cse2) + _v4);
    var _v9: f32 = 0.0;
    var _v10: f32 = 0.0;
    var _v11: f32 = 0.0;
    var _v12: f32 = 0.0;
    for (var _v13: u32 = 0u; (_v13 < 160u); _v13 = (_v13 + 1u)) {
      let _gv1 = (_v9 * _v9);
      let _gv2 = (_v10 * _v10);
      if (((_gv1 + _gv2) <= 1000000.0)) {
        let _v14 = ((((_v9 * _v11) - (_v10 * _v12)) * 2.0) + 1.0);
        _v12 = (((_v9 * _v12) + (_v10 * _v11)) * 2.0);
        _v11 = _v14;
        let _v15 = ((_gv1 - _gv2) + _v7);
        _v10 = (((_v9 * _v10) * 2.0) + _v8);
        _v9 = _v15;
      }
    }
    _v5 = ((_v9 * _v9) + (_v10 * _v10));
    _v6 = ((_v11 * _v11) + (_v12 * _v12));
  } else {
    let _v16 = df64_add(_cse1, vec2<f32>(_v3, 0.0), _fp64_g);
    let _v17 = df64_add(_cse2, vec2<f32>(_v4, 0.0), _fp64_g);
    let _cse3 = vec2<f32>(0.0, 0.0);
    var _v18: vec2<f32> = _cse3;
    var _v19: vec2<f32> = _cse3;
    var _v20: f32 = 0.0;
    var _v21: f32 = 0.0;
    for (var _v22: u32 = 0u; (_v22 < 160u); _v22 = (_v22 + 1u)) {
      let _gv3 = df64_sqr(_v18, _fp64_g);
      let _gv4 = df64_sqr(_v19, _fp64_g);
      if ((df64_narrow(df64_add(_gv3, _gv4, _fp64_g)) <= 1000000.0)) {
        let _v23 = df64_narrow(_v18);
        let _v24 = df64_narrow(_v19);
        let _v25 = ((((_v23 * _v20) - (_v24 * _v21)) * 2.0) + 1.0);
        _v21 = (((_v23 * _v21) + (_v24 * _v20)) * 2.0);
        _v20 = _v25;
        let _v26 = df64_add(df64_sub(_gv3, _gv4, _fp64_g), _v16, _fp64_g);
        _v19 = df64_add((df64_mul(_v18, _v19, _fp64_g) * 2.0), _v17, _fp64_g);
        _v18 = _v26;
      }
    }
    _v5 = df64_narrow(df64_add(df64_sqr(_v18, _fp64_g), df64_sqr(_v19, _fp64_g), _fp64_g));
    _v6 = ((_v20 * _v20) + (_v21 * _v21));
  }
  let _v27 = sqrt(max(_v5, 1.0));
  let _v28 = (((_v27 * log(_v27)) * 0.5) / sqrt(max(_v6, 1e-30)));
  let _v29 = min((_v28 / (_v0 * 0.012)), 40.0);
  let _v30 = select(0.0, 1.0, (_v5 > 1000000.0));
  let _gv0 = (-_v29);
  let _v31 = (exp((_gv0 * 1.2)) * _v30);
  let _v32 = (exp((_gv0 * 0.25)) * _v30);
  return vec4<f32>(((vec3<f32>(0.02, 0.03, 0.08) + (vec3<f32>(0.12, 0.2, 0.42) * _v32)) + (vec3<f32>(1.0, 0.85, 0.45) * _v31)), 1.0);
}

fn df64_twoSum(a: f32, b: f32, _fp64_g: f32) -> vec2<f32> {
  let _v0 = (a + b);
  let _v1 = (((_v0 * _fp64_g) - a) * _fp64_g);
  let _v2 = (((a - ((_v0 - _v1) * _fp64_g)) * _fp64_g) + (b - _v1));
  return vec2<f32>(_v0, _v2);
}

fn df64_quickTwoSum(a: f32, b: f32, _fp64_g: f32) -> vec2<f32> {
  let _v0 = ((a + b) * _fp64_g);
  let _v1 = (b - ((_v0 - a) * _fp64_g));
  return vec2<f32>(_v0, _v1);
}

fn df64_split(a: f32, _fp64_g: f32) -> vec2<f32> {
  let _v0 = (a * (_fp64_g * 4097.0));
  let _v1 = ((_v0 * _fp64_g) - (_v0 - a));
  let _v2 = ((a * _fp64_g) - _v1);
  return vec2<f32>(_v1, _v2);
}

fn df64_twoProd(a: f32, b: f32, _fp64_g: f32) -> vec2<f32> {
  let _v0 = (a * b);
  let _v1 = df64_split(a, _fp64_g);
  let _v2 = df64_split(b, _fp64_g);
  let _v3 = (((((_v1.x * _v2.x) - _v0) + (_v1.x * _v2.y)) + (_v1.y * _v2.x)) + (_v1.y * _v2.y));
  return vec2<f32>(_v0, _v3);
}

fn df64_twoSqr(a: f32, _fp64_g: f32) -> vec2<f32> {
  let _v0 = (a * a);
  let _v1 = df64_split(a, _fp64_g);
  let _v2 = (((((_v1.x * _v1.x) - _v0) * _fp64_g) + (((_v1.x * _v1.y) * 2.0) * _fp64_g)) + ((_v1.y * _v1.y) * _fp64_g));
  return vec2<f32>(_v0, _v2);
}

fn df64_add(a: vec2<f32>, b: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  var _v0: vec2<f32> = df64_twoSum(a.x, b.x, _fp64_g);
  let _v1 = df64_twoSum(a.y, b.y, _fp64_g);
  _v0.y = (_v0.y + _v1.x);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  _v0.y = (_v0.y + _v1.y);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  return _v0;
}

fn df64_sub(a: vec2<f32>, b: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  return df64_add(a, (-b), _fp64_g);
}

fn df64_mul(a: vec2<f32>, b: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  var _v0: vec2<f32> = df64_twoProd(a.x, b.x, _fp64_g);
  _v0.y = (_v0.y + (a.x * b.y));
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  _v0.y = (_v0.y + (a.y * b.x));
  return df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
}

fn df64_sqr(a: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  var _v0: vec2<f32> = df64_twoSqr(a.x, _fp64_g);
  _v0.y = (_v0.y + ((a.x * a.y) * 2.0));
  return df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
}

fn df64_narrow(a: vec2<f32>) -> f32 {
  return (a.x + a.y);
}
