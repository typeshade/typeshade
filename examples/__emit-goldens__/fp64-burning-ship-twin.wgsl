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
fn fs_ship(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _licm0 = vec2<f32>(16.0, 0.0);
  let _licm1 = vec2<f32>(2.0, 0.0);
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
    let cx = (df64_narrow(_cse1) + dx);
    let cy = (df64_narrow(_cse2) + dy);
    var zx: f32 = 0.0;
    var zy: f32 = 0.0;
    for (var j: u32 = 0u; (j < 128u); j = (j + 1u)) {
      if ((((zx * zx) + (zy * zy)) <= 16.0)) {
        let nzx = (((zx * zx) - (zy * zy)) + cx);
        zy = ((abs((zx * zy)) * 2.0) + cy);
        zx = nzx;
        it = (it + 1.0);
      }
    }
    m2 = ((zx * zx) + (zy * zy));
  } else {
    let cx_1 = df64_add(_cse1, vec2<f32>(dx, 0.0), _fp64_g);
    let cy_1 = df64_add(_cse2, vec2<f32>(dy, 0.0), _fp64_g);
    let _cse3 = vec2<f32>(0.0, 0.0);
    var zx_1: vec2<f32> = _cse3;
    var zy_1: vec2<f32> = _cse3;
    for (var j_1: u32 = 0u; (j_1 < 128u); j_1 = (j_1 + 1u)) {
      if (df64_le(df64_add(df64_mul(zx_1, zx_1, _fp64_g), df64_mul(zy_1, zy_1, _fp64_g), _fp64_g), _licm0)) {
        let nzx_1 = df64_add(df64_sub(df64_mul(zx_1, zx_1, _fp64_g), df64_mul(zy_1, zy_1, _fp64_g), _fp64_g), cx_1, _fp64_g);
        zy_1 = df64_add(df64_mul(df64_abs(df64_mul(zx_1, zy_1, _fp64_g)), _licm1, _fp64_g), cy_1, _fp64_g);
        zx_1 = nzx_1;
        it = (it + 1.0);
      }
    }
    m2 = df64_narrow(df64_add(df64_mul(zx_1, zx_1, _fp64_g), df64_mul(zy_1, zy_1, _fp64_g), _fp64_g));
  }
  let sn = ((it - log2(max(log2(max(m2, 1.0001)), 0.0001))) + 1.0);
  let inside = step(127.5, it);
  let s = (sn * 0.0078125);
  let _gv0 = (s * s);
  let ease = (_gv0 * (3.0 - (s * 2.0)));
  let rgb = (mix(mix(vec3<f32>(0.06, 0.02, 0.05), vec3<f32>(0.95, 0.45, 0.08), ease), vec3<f32>(1.0, 0.93, 0.75), _gv0) * (1.0 - inside));
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

fn df64_le(a: vec2<f32>, b: vec2<f32>) -> bool {
  return ((a.x < b.x) || ((a.x == b.x) && (a.y <= b.y)));
}

fn df64_abs(a: vec2<f32>) -> vec2<f32> {
  return select(a, (-a), (a.x < 0.0));
}

fn df64_narrow(a: vec2<f32>) -> f32 {
  return (a.x + a.y);
}
