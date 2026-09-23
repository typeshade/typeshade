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
fn fs_julia(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _licm0 = vec2<f32>(-0.800000011920929, 1.1920929132713809e-8);
  let _licm1 = vec2<f32>(0.15600000321865082, -3.218650901359865e-9);
  let _v0 = pow(10.0, (-u.zoom_exp));
  let _v1 = (vo.uv.x * 2.0);
  let _cse0 = (vo.uv.x < 0.5);
  let _v2 = (_v1 - select(1.0, 0.0, _cse0));
  let _v3 = ((_v2 - 0.5) * _v0);
  let _v4 = (((vo.uv.y - 0.5) * _v0) * ((u.resolution.y / u.resolution.x) * 2.0));
  var _v5: f32 = 0.0;
  var _v6: f32 = 0.0;
  let _cse1 = vec2<f32>(u.center.hi.x, u.center.lo.x);
  let _cse2 = vec2<f32>(u.center.hi.y, u.center.lo.y);
  if ((_cse0 || (u.fp64 < 0.5))) {
    var _v7: f32 = (df64_narrow(_cse1) + _v3);
    var _v8: f32 = (df64_narrow(_cse2) + _v4);
    var _v9: f32 = (_v7 * _v7);
    var _v10: f32 = (_v8 * _v8);
    _v6 = (_v9 + _v10);
    for (var _v11: u32 = 0u; (_v11 < 128u); _v11 = (_v11 + 1u)) {
      if ((_v6 <= 16.0)) {
        let _v12 = ((_v9 - _v10) + -0.8);
        _v8 = (((_v7 * _v8) * 2.0) + 0.156);
        _v7 = _v12;
        _v5 = (_v5 + 1.0);
        _v9 = (_v7 * _v7);
        _v10 = (_v8 * _v8);
        _v6 = (_v9 + _v10);
      }
    }
  } else {
    var _v13: vec2<f32> = df64_add(_cse1, vec2<f32>(_v3, 0.0), _fp64_g);
    var _v14: vec2<f32> = df64_add(_cse2, vec2<f32>(_v4, 0.0), _fp64_g);
    let _v15 = df64_narrow(_v13);
    let _v16 = df64_narrow(_v14);
    _v6 = ((_v15 * _v15) + (_v16 * _v16));
    for (var _v17: u32 = 0u; (_v17 < 128u); _v17 = (_v17 + 1u)) {
      if ((_v6 <= 16.0)) {
        let _v18 = df64_add(df64_sub(df64_sqr(_v13, _fp64_g), df64_sqr(_v14, _fp64_g), _fp64_g), _licm0, _fp64_g);
        _v14 = df64_add((df64_mul(_v13, _v14, _fp64_g) * 2.0), _licm1, _fp64_g);
        _v13 = _v18;
        _v5 = (_v5 + 1.0);
        let _v19 = df64_narrow(_v13);
        let _v20 = df64_narrow(_v14);
        _v6 = ((_v19 * _v19) + (_v20 * _v20));
      }
    }
  }
  let _v21 = ((_v5 - log2(max(log2(max(_v6, 1.0001)), 0.0001))) + 1.0);
  let _v22 = step(127.5, _v5);
  let _v23 = (_v21 * 0.0078125);
  return vec4<f32>((((vec3<f32>(0.5) + (cos(((vec3<f32>(0.0, 0.25, 0.6) + (_v23 * 5.5)) + 2.2)) * 0.5)) * mix(0.35, 1.0, _v23)) * (1.0 - _v22)), 1.0);
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
