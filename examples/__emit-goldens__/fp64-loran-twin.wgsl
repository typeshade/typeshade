struct Uniforms {
  center: DF64Vec2,
  st_a: DF64Vec2,
  st_b: DF64Vec2,
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
fn fs_loran(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let span = pow(10.0, (-u.zoom_exp));
  let half = (vo.uv.x * 2.0);
  let _cse0 = (vo.uv.x < 0.5);
  let sx = (half - select(1.0, 0.0, _cse0));
  let dx = ((sx - 0.5) * span);
  let dy = (((vo.uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  let isF32 = (_cse0 || (u.fp64 < 0.5));
  let _cse1 = vec2<f32>(u.center.hi.x, u.center.lo.x);
  let _cse2 = vec2<f32>(u.center.hi.y, u.center.lo.y);
  let _lc0 = df64_add(_cse1, vec2<f32>(dx, 0.0), _fp64_g);
  let _lc1 = df64_add(_cse2, vec2<f32>(dy, 0.0), _fp64_g);
  let pos = DF64Vec2(vec2<f32>(_lc0.x, _lc1.x), vec2<f32>(_lc0.y, _lc1.y));
  let _cse8 = bitcast<f32>(bitcast<u32>(0.0));
  let _cse3 = vec2<f32>(_cse8, _cse8);
  let _cse4 = vec2<f32>(u.st_a.hi.x, u.st_a.lo.x);
  let _cse5 = vec2<f32>(u.st_a.hi.y, u.st_a.lo.y);
  let _gv0 = df64_add(vec2<f32>(pos.hi.x, pos.lo.x), _cse3, _fp64_g);
  let _gv1 = df64_add(vec2<f32>(pos.hi.y, pos.lo.y), _cse3, _fp64_g);
  let d1 = df64_sqrt(df64_add(df64_sqr(df64_sub(_gv0, df64_add(_cse4, _cse3, _fp64_g), _fp64_g), _fp64_g), df64_sqr(df64_sub(_gv1, df64_add(_cse5, _cse3, _fp64_g), _fp64_g), _fp64_g), _fp64_g), _fp64_g);
  let _cse6 = vec2<f32>(u.st_b.hi.x, u.st_b.lo.x);
  let _cse7 = vec2<f32>(u.st_b.hi.y, u.st_b.lo.y);
  let d2 = df64_sqrt(df64_add(df64_sqr(df64_sub(_gv0, df64_add(_cse6, _cse3, _fp64_g), _fp64_g), _fp64_g), df64_sqr(df64_sub(_gv1, df64_add(_cse7, _cse3, _fp64_g), _fp64_g), _fp64_g), _fp64_g), _fp64_g);
  let th64 = df64_narrow(df64_fract((df64_sub(df64_add(d1, _cse3, _fp64_g), df64_add(d2, _cse3, _fp64_g), _fp64_g) * 0.25), _fp64_g));
  let te64 = df64_narrow(df64_fract((df64_add(d1, d2, _fp64_g) * 0.0625), _fp64_g));
  let pos32 = vec2<f32>((df64_narrow(_cse1) + dx), (df64_narrow(_cse2) + dy));
  let d1f = length((pos32 - vec2<f32>(df64_narrow(_cse4), df64_narrow(_cse5))));
  let d2f = length((pos32 - vec2<f32>(df64_narrow(_cse6), df64_narrow(_cse7))));
  let th32 = fract(((d1f - d2f) * 0.25));
  let te32 = fract(((d1f + d2f) * 0.0625));
  let th = select(th64, th32, isF32);
  let te = select(te64, te32, isF32);
  let dh = min(th, (1.0 - th));
  let de = min(te, (1.0 - te));
  let aaH = ((fwidth(dh) * 1.2) + 0.0001);
  let aaE = ((fwidth(de) * 1.2) + 0.0001);
  let lineH = (1.0 - smoothstep(0.0, aaH, dh));
  let lineE = (1.0 - smoothstep(0.0, aaE, de));
  let sea = mix(vec3<f32>(0.02, 0.07, 0.13), vec3<f32>(0.04, 0.12, 0.2), vo.uv.y);
  let rgb = (((sea + (vec3<f32>(0.0, 0.06, 0.08) * th)) + (vec3<f32>(0.25, 0.95, 0.95) * (lineH * 0.9))) + (vec3<f32>(0.95, 0.7, 0.25) * (lineE * 0.35)));
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

fn df64_sqr(a: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  var _v0: vec2<f32> = df64_twoSqr(a.x, _fp64_g);
  _v0.y = (_v0.y + ((a.x * a.y) * 2.0));
  return df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
}

fn df64_sqrt(a: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  let _v0 = (_fp64_g / sqrt(a.x));
  let _v1 = (a.x * _v0);
  let _v2 = (df64_twoSqr(_v1, _fp64_g) * _fp64_g);
  let _v3 = df64_sub(a, _v2, _fp64_g).x;
  let _v4 = df64_twoProd((_v0 * 0.5), _v3, _fp64_g);
  let _v5 = df64_add(vec2<f32>(_v1, 0.0), _v4, _fp64_g);
  return select(_v5, vec2<f32>(0.0, 0.0), (a.x == 0.0));
}

fn df64_floor(a: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  let _v0 = floor(a.x);
  return select(vec2<f32>(_v0, 0.0), df64_quickTwoSum(_v0, floor(a.y), _fp64_g), (_v0 == a.x));
}

fn df64_fract(a: vec2<f32>, _fp64_g: f32) -> vec2<f32> {
  return df64_sub(a, df64_floor(a, _fp64_g), _fp64_g);
}

fn df64_narrow(a: vec2<f32>) -> f32 {
  return (a.x + a.y);
}
