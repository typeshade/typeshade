struct Uniforms {
  center: DF64Vec2,
  mark: DF64Vec2,
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
fn fs_rtc(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let span = pow(10.0, (-u.zoom_exp));
  let half = (vo.uv.x * 2.0);
  let _cse0 = (vo.uv.x < 0.5);
  let sx = (half - select(1.0, 0.0, _cse0));
  let dx = ((sx - 0.5) * span);
  let dy = (((vo.uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  let isF32 = (_cse0 || (u.fp64 < 0.5));
  let _cse1 = vec2<f32>(u.center.hi.x, u.center.lo.x);
  let _cse2 = vec2<f32>(u.mark.hi.x, u.mark.lo.x);
  let _cse6 = bitcast<f32>(bitcast<u32>(0.0));
  let _cse3 = vec2<f32>(_cse6, _cse6);
  let ex64 = df64_narrow(df64_sub(df64_add(_cse1, vec2<f32>(dx, 0.0), _fp64_g), df64_add(_cse2, _cse3, _fp64_g), _fp64_g));
  let _cse4 = vec2<f32>(u.center.hi.y, u.center.lo.y);
  let _cse5 = vec2<f32>(u.mark.hi.y, u.mark.lo.y);
  let ey64 = df64_narrow(df64_sub(df64_add(_cse4, vec2<f32>(dy, 0.0), _fp64_g), df64_add(_cse5, _cse3, _fp64_g), _fp64_g));
  let ex32 = ((df64_narrow(_cse1) + dx) - df64_narrow(_cse2));
  let ey32 = ((df64_narrow(_cse4) + dy) - df64_narrow(_cse5));
  let ex = select(ex64, ex32, isF32);
  let ey = select(ey64, ey32, isF32);
  let rw = (span * 0.125);
  let r = length(vec2<f32>(ex, ey));
  let pixw = (span / (u.resolution.x * 0.5));
  let tri = (((-abs((fract((r / rw)) - 0.5))) + 0.5) * rw);
  let ring = (1.0 - smoothstep(0.0, ((pixw * 1.6) + 1e-9), tri));
  let cross = (1.0 - smoothstep(0.0, ((pixw * 1.4) + 1e-9), min(abs(ex), abs(ey))));
  let dotGlow = exp((-(r / ((pixw * 6.0) + 1e-9))));
  let vignette = max(0.0, (1.0 - (r / (span * 0.75))));
  let bg = mix(vec3<f32>(0.01, 0.04, 0.02), vec3<f32>(0.02, 0.09, 0.045), vignette);
  let rgb = (((bg + (vec3<f32>(0.1, 0.75, 0.3) * (ring * 0.8))) + (vec3<f32>(0.12, 0.9, 0.4) * (cross * 0.55))) + (vec3<f32>(1.0, 0.45, 0.25) * dotGlow));
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

fn df64_narrow(a: vec2<f32>) -> f32 {
  return (a.x + a.y);
}
