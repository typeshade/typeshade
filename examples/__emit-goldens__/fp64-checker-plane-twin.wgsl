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
fn fs_checker(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let span = pow(10.0, (-u.zoom_exp));
  let half = (vo.uv.x * 2.0);
  let _cse0 = (vo.uv.x < 0.5);
  let sx = (half - select(1.0, 0.0, _cse0));
  let dx = ((sx - 0.5) * span);
  let dy = (((vo.uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  let isF32 = (_cse0 || (u.fp64 < 0.5));
  let _cse1 = vec2<f32>(u.center.hi.x, u.center.lo.x);
  let px = df64_add(_cse1, vec2<f32>(dx, 0.0), _fp64_g);
  let _cse2 = vec2<f32>(u.center.hi.y, u.center.lo.y);
  let py = df64_add(_cse2, vec2<f32>(dy, 0.0), _fp64_g);
  let par64 = df64_narrow(df64_fract(df64_mul(df64_add(df64_floor(px, _fp64_g), df64_floor(py, _fp64_g), _fp64_g), vec2<f32>(0.5, 0.0), _fp64_g), _fp64_g));
  let _cse4 = bitcast<f32>(bitcast<u32>(0.0));
  let _cse3 = vec2<f32>(_cse4, _cse4);
  let fx64 = df64_narrow(df64_fract(df64_add(px, _cse3, _fp64_g), _fp64_g));
  let fy64 = df64_narrow(df64_fract(df64_add(py, _cse3, _fp64_g), _fp64_g));
  let px32 = (df64_narrow(_cse1) + dx);
  let py32 = (df64_narrow(_cse2) + dy);
  let par32 = fract(((floor(px32) + floor(py32)) * 0.5));
  let fx32 = fract(px32);
  let fy32 = fract(py32);
  let par = select(par64, par32, isF32);
  let fx = select(fx64, fx32, isF32);
  let fy = select(fy64, fy32, isF32);
  let chk = step(0.25, par);
  let edge = min(min(fx, (1.0 - fx)), min(fy, (1.0 - fy)));
  let pixw = (span / (u.resolution.x * 0.5));
  let line = smoothstep(0.0, ((pixw * 1.5) + 1e-9), edge);
  let ivory = vec3<f32>(0.93, 0.9, 0.82);
  let slate = vec3<f32>(0.23, 0.29, 0.36);
  let rgb = (mix(ivory, slate, chk) * mix(0.35, 1.0, line));
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
