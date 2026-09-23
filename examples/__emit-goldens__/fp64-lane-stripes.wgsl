struct Uniforms {
  origin: vec2<f32>,
  span: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct DF64Vec3 {
  hi: vec3<f32>,
  lo: vec3<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var _fp64: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) idx: u32) -> VsOut {
  let x = ((f32((idx & 1u)) * 4.0) - 1.0);
  let y = ((f32((idx >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

fn stripeAt(origin: vec2<f32>, offset: f32) -> vec2<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let world = df64_add(origin, vec2<f32>(offset, 0.0), _fp64_g);
  let stripe = vec2<f32>(0.125, 0.0);
  let _cse1 = bitcast<f32>(bitcast<u32>(0.0));
  let _cse0 = vec2<f32>(_cse1, _cse1);
  return df64_fract(df64_div(df64_add(world, _cse0, _fp64_g), df64_add(stripe, _cse0, _fp64_g), _fp64_g), _fp64_g);
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let origin = df64_mul(u.origin, vec2<f32>(2.5, 0.0), _fp64_g);
  let offset = (u.span * (vo.uv.x - 0.5));
  let bands = stripeAt(origin, offset);
  let _cse1 = bitcast<f32>(bitcast<u32>(0.0));
  let _cse0 = vec2<f32>(_cse1, _cse1);
  let _gv0 = df64_add(origin, vec2<f32>(offset, 0.0), _fp64_g);
  let _lc1 = df64_round(df64_add(origin, _cse0, _fp64_g), _fp64_g);
  let p = DF64Vec3(vec3<f32>(_gv0.x, _lc1.x, bands.x), vec3<f32>(_gv0.y, _lc1.y, bands.y));
  let narrowed = vec3<f32>(df64_narrow(vec2<f32>(p.hi.x, p.lo.x)), df64_narrow(vec2<f32>(p.hi.y, p.lo.y)), df64_narrow(vec2<f32>(p.hi.z, p.lo.z)));
  let flat = fract((df64_narrow(_gv0) * 8.0));
  let shade = select(df64_narrow(vec2<f32>(p.hi.z, p.lo.z)), flat, (vo.uv.x < 0.5));
  let drift = abs((narrowed.z - flat));
  return vec4<f32>(shade, drift, fract((narrowed.y * 0.5)), 1.0);
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

fn df64_div(a: vec2<f32>, b: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  let _v0 = (_fp64_g / b.x);
  let _v1 = (a * _v0);
  let _v2 = df64_sub(a, df64_mul(b, _v1, _fp64_g), _fp64_g).x;
  let _v3 = df64_twoProd(_v0, _v2, _fp64_g);
  return df64_add(_v1, _v3, _fp64_g);
}

fn df64_gt(a: vec2<f32>, b: vec2<f32>) -> bool {
  return ((a.x > b.x) || ((a.x == b.x) && (a.y > b.y)));
}

fn df64_eq(a: vec2<f32>, b: vec2<f32>) -> bool {
  return ((a.x == b.x) && (a.y == b.y));
}

fn df64_floor(a: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  let _v0 = floor(a.x);
  return select(vec2<f32>(_v0, 0.0), df64_quickTwoSum(_v0, floor(a.y), _fp64_g), (_v0 == a.x));
}

fn df64_fract(a: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  return df64_sub(a, df64_floor(a, _fp64_g), _fp64_g);
}

fn df64_round(a: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  let _v0 = df64_floor(a, _fp64_g);
  let _v1 = df64_sub(a, _v0, _fp64_g);
  let _v2 = (((_v0.x - (floor((_v0.x * 0.5)) * 2.0)) + (_v0.y - (floor((_v0.y * 0.5)) * 2.0))) == 1.0);
  let _cse0 = vec2<f32>(0.5, 0.0);
  return select(_v0, df64_add(_v0, vec2<f32>(1.0, 0.0), _fp64_g), (df64_gt(_v1, _cse0) || (df64_eq(_v1, _cse0) && _v2)));
}

fn df64_narrow(a: vec2<f32>) -> f32 {
  return (a.x + a.y);
}
