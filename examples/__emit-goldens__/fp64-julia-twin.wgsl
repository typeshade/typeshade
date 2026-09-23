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
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

@fragment
fn fs_julia(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _licm0 = vec2<f32>(16.0, 0.0);
  let _licm1 = vec2<f32>(-0.800000011920929, 1.1920929132713809e-8);
  let _licm2 = vec2<f32>(0.15600000321865082, -3.218650901359865e-9);
  let span = pow(10.0, (-u.zoom_exp));
  let half = (vo.uv.x * 2.0);
  let _cse0 = (vo.uv.x < 0.5);
  let sx = (half - select(1.0, 0.0, _cse0));
  let dx = ((sx - 0.5) * span);
  let dy = (((vo.uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  var it: f32 = 0.0;
  var m2: f32 = 0.0;
  let _cse1 = vec2<f32>(u.center.hi.x, u.center.lo.x);
  let _cse2 = vec2<f32>(u.center.hi.y, u.center.lo.y);
  if ((_cse0 || (u.fp64 < 0.5))) {
    var zx: f32 = (df64_narrow(_cse1) + dx);
    var zy: f32 = (df64_narrow(_cse2) + dy);
    for (var j: u32 = 0u; (j < 128u); j = (j + 1u)) {
      let _gv0 = (zx * zx);
      let _gv1 = (zy * zy);
      if (((_gv0 + _gv1) <= 16.0)) {
        let nzx = ((_gv0 - _gv1) + -0.8);
        zy = (((zx * zy) * 2.0) + 0.156);
        zx = nzx;
        it = (it + 1.0);
      }
    }
    m2 = ((zx * zx) + (zy * zy));
  } else {
    var zx_1: vec2<f32> = df64_add(_cse1, vec2<f32>(dx, 0.0), _fp64_g);
    var zy_1: vec2<f32> = df64_add(_cse2, vec2<f32>(dy, 0.0), _fp64_g);
    for (var j_1: u32 = 0u; (j_1 < 128u); j_1 = (j_1 + 1u)) {
      let _gv2 = df64_sqr(zx_1, _fp64_g);
      let _gv3 = df64_sqr(zy_1, _fp64_g);
      if (df64_le(df64_add(_gv2, _gv3, _fp64_g), _licm0)) {
        let nzx_1 = df64_add(df64_sub(_gv2, _gv3, _fp64_g), _licm1, _fp64_g);
        zy_1 = df64_add((df64_mul(zx_1, zy_1, _fp64_g) * 2.0), _licm2, _fp64_g);
        zx_1 = nzx_1;
        it = (it + 1.0);
      }
    }
    m2 = df64_narrow(df64_add(df64_sqr(zx_1, _fp64_g), df64_sqr(zy_1, _fp64_g), _fp64_g));
  }
  let sn = ((it - log2(max(log2(max(m2, 1.0001)), 0.0001))) + 1.0);
  let inside = step(127.5, it);
  let s = (sn * 0.0078125);
  let ph = vec3<f32>(0.0, 0.25, 0.6);
  let rgb = (((vec3<f32>(0.5, 0.5, 0.5) + (cos(((ph + (s * 5.5)) + 2.2)) * 0.5)) * mix(0.35, 1.0, s)) * (1.0 - inside));
  return vec4<f32>(rgb, 1.0);
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

fn df64_le(a: vec2<f32>, b: vec2<f32>) -> bool {
  return ((a.x < b.x) || ((a.x == b.x) && (a.y <= b.y)));
}

fn df64_narrow(a: vec2<f32>) -> f32 {
  return (a.x + a.y);
}
