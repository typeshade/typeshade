struct Uniforms {
  origin: vec2<f32>,
  span: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) originParts: vec2<f32>,
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
  let shifted = df64_mul(u.origin, vec2<f32>(2.5, 0.0));
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)), shifted);
}

@fragment
fn fs(vo: VsOut) -> @location(0) vec4<f32> {
  let origin = vec2<f32>(vo.originParts.x, vo.originParts.y);
  let world = df64_add(origin, vec2<f32>((u.span * (vo.uv.x - 0.5)), 0.0));
  let stripe = vec2<f32>(0.125, 0.0);
  let _cse1 = bitcast<f32>(bitcast<u32>(0.0));
  let _cse0 = vec2<f32>(_cse1, _cse1);
  let bands = df64_fract(df64_div(df64_add(world, _cse0), df64_add(stripe, _cse0)));
  let p = DF64Vec3(vec3<f32>(world.x, origin.x, bands.x), vec3<f32>(world.y, origin.y, bands.y));
  let _gv0 = vec2<f32>(p.hi.x, p.lo.x);
  let _gv1 = vec2<f32>(p.hi.y, p.lo.y);
  let _gv2 = vec2<f32>(p.hi.z, p.lo.z);
  let narrowed = vec3<f32>(df64_narrow(_gv0), df64_narrow(_gv1), df64_narrow(_gv2));
  let _lc0 = df64_add(df64_add(df64_mul(_gv0, _gv0), df64_mul(_gv1, _gv1)), df64_mul(_gv2, _gv2));
  let reach = df64_narrow(df64_div(df64_sqrt(_lc0), df64_add(vec2<f32>((1.0 + df64_narrow(_lc0)), 0.0), _cse0)));
  let _gv3 = df64_add(_gv0, _cse0);
  let turns = (df64_narrow(df64_sub(df64_round(df64_add(origin, _cse0)), df64_round(_gv3))) * 0.5);
  let flat = fract((df64_narrow(world) * 8.0));
  let shade = select(df64_narrow(bands), flat, (vo.uv.x < 0.5));
  return vec4<f32>(shade, ((df64_narrow(df64_sub(df64_add(_gv1, _cse0), _gv3)) * 0.0) + reach), abs(turns), ((narrowed.z * 0.0) + 1.0));
}

fn df64_twoSum(a: f32, b: f32) -> vec2<f32> {
  let _v0 = (a + b);
  let _cse0 = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _v1 = (((_v0 * _cse0) - a) * _cse0);
  let _v2 = (((((a - ((_v0 - _v1) * _cse0)) * _cse0) * _cse0) * _cse0) + (b - _v1));
  return vec2<f32>(_v0, _v2);
}

fn df64_quickTwoSum(a: f32, b: f32) -> vec2<f32> {
  let _cse0 = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _v0 = ((a + b) * _cse0);
  let _v1 = (b - ((_v0 - a) * _cse0));
  return vec2<f32>(_v0, _v1);
}

fn df64_split(a: f32) -> vec2<f32> {
  let _cse0 = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _v0 = (a * (_cse0 * 4097.0));
  let _v1 = ((_v0 * _cse0) - (_v0 - a));
  let _v2 = ((a * _cse0) - _v1);
  return vec2<f32>(_v1, _v2);
}

fn df64_twoProd(a: f32, b: f32) -> vec2<f32> {
  let _v0 = (a * b);
  let _v1 = df64_split(a);
  let _v2 = df64_split(b);
  let _v3 = (((((_v1.x * _v2.x) - _v0) + (_v1.x * _v2.y)) + (_v1.y * _v2.x)) + (_v1.y * _v2.y));
  return vec2<f32>(_v0, _v3);
}

fn df64_twoSqr(a: f32) -> vec2<f32> {
  let _v0 = (a * a);
  let _v1 = df64_split(a);
  let _cse0 = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _v2 = (((((_v1.x * _v1.x) - _v0) * _cse0) + ((((_v1.x * _v1.y) * 2.0) * _cse0) * _cse0)) + ((((_v1.y * _v1.y) * _cse0) * _cse0) * _cse0));
  return vec2<f32>(_v0, _v2);
}

fn df64_add(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  var _v0: vec2<f32> = df64_twoSum(a.x, b.x);
  let _v1 = df64_twoSum(a.y, b.y);
  _v0.y = (_v0.y + _v1.x);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  _v0.y = (_v0.y + _v1.y);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  return _v0;
}

fn df64_sub(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return df64_add(a, (-b));
}

fn df64_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  var _v0: vec2<f32> = df64_twoProd(a.x, b.x);
  _v0.y = (_v0.y + (a.x * b.y));
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  _v0.y = (_v0.y + (a.y * b.x));
  return df64_quickTwoSum(_v0.x, _v0.y);
}

fn df64_div(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let _v0 = (textureLoad(_fp64, vec2<i32>(0, 0), 0).x / b.x);
  let _v1 = (a * _v0);
  let _v2 = df64_sub(a, df64_mul(b, _v1)).x;
  let _v3 = df64_twoProd(_v0, _v2);
  return df64_add(_v1, _v3);
}

fn df64_sqrt(a: vec2<f32>) -> vec2<f32> {
  let _cse0 = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let _v0 = (_cse0 / sqrt(a.x));
  let _v1 = (a.x * _v0);
  let _v2 = (df64_twoSqr(_v1) * _cse0);
  let _v3 = df64_sub(a, _v2).x;
  let _v4 = df64_twoProd((_v0 * 0.5), _v3);
  let _v5 = df64_add(vec2<f32>(_v1, 0.0), _v4);
  return select(_v5, vec2<f32>(0.0, 0.0), (a.x == 0.0));
}

fn df64_gt(a: vec2<f32>, b: vec2<f32>) -> bool {
  return ((a.x > b.x) || ((a.x == b.x) && (a.y > b.y)));
}

fn df64_eq(a: vec2<f32>, b: vec2<f32>) -> bool {
  return ((a.x == b.x) && (a.y == b.y));
}

fn df64_floor(a: vec2<f32>) -> vec2<f32> {
  let _v0 = floor(a.x);
  return select(vec2<f32>(_v0, 0.0), df64_quickTwoSum(_v0, floor(a.y)), (_v0 == a.x));
}

fn df64_fract(a: vec2<f32>) -> vec2<f32> {
  return df64_sub(a, df64_floor(a));
}

fn df64_round(a: vec2<f32>) -> vec2<f32> {
  let _v0 = df64_floor(a);
  let _v1 = df64_sub(a, _v0);
  let _v2 = (((_v0.x - (floor((_v0.x * 0.5)) * 2.0)) + (_v0.y - (floor((_v0.y * 0.5)) * 2.0))) == 1.0);
  let _cse0 = vec2<f32>(0.5, 0.0);
  return select(_v0, df64_add(_v0, vec2<f32>(1.0, 0.0)), (df64_gt(_v1, _cse0) || (df64_eq(_v1, _cse0) && _v2)));
}

fn df64_narrow(a: vec2<f32>) -> f32 {
  return (a.x + a.y);
}
