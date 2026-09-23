struct Uniforms {
  resolution: vec2<f32>,
  half_width: f32,
  fp64: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
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
fn fs_cancel(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let w = u.half_width;
  let halfUv = (vo.uv.x * 2.0);
  let _cse0 = (vo.uv.x < 0.5);
  let sx = (halfUv - select(1.0, 0.0, _cse0));
  let _gv0 = (sx - 0.5);
  let d = (_gv0 * (w * 2.0));
  let isF32 = (_cse0 || (u.fp64 < 0.5));
  let _cse1 = vec2<f32>(1.0, 0.0);
  let xd = df64_add(_cse1, vec2<f32>(d, 0.0), _fp64_g);
  let x2 = df64_sqr(xd, _fp64_g);
  let x3 = df64_mul(x2, xd, _fp64_g);
  let x4 = df64_sqr(x2, _fp64_g);
  let x5 = df64_mul(x4, xd, _fp64_g);
  let x6 = df64_sqr(x3, _fp64_g);
  let x7 = df64_mul(x6, xd, _fp64_g);
  let _cse6 = bitcast<f32>(bitcast<u32>(0.0));
  let _cse2 = vec2<f32>(_cse6, _cse6);
  let _cse3 = vec2<f32>(7.0, 0.0);
  let _cse4 = vec2<f32>(21.0, 0.0);
  let _cse5 = vec2<f32>(35.0, 0.0);
  let p64 = df64_narrow(df64_sub(df64_add(df64_sub(df64_add(df64_sub(df64_add(df64_sub(df64_add(x7, _cse2, _fp64_g), df64_mul(x6, _cse3, _fp64_g), _fp64_g), df64_mul(x5, _cse4, _fp64_g), _fp64_g), df64_mul(x4, _cse5, _fp64_g), _fp64_g), df64_mul(x3, _cse5, _fp64_g), _fp64_g), df64_mul(x2, _cse4, _fp64_g), _fp64_g), df64_mul(xd, _cse3, _fp64_g), _fp64_g), df64_add(_cse1, _cse2, _fp64_g), _fp64_g));
  let xf = (1.0 + d);
  let f2 = (xf * xf);
  let f3 = (f2 * xf);
  let f4 = (f2 * f2);
  let f5 = (f4 * xf);
  let f6 = (f3 * f3);
  let f7 = (f6 * xf);
  let p32 = (((((((f7 - (f6 * 7.0)) + (f5 * 21.0)) - (f4 * 35.0)) + (f3 * 35.0)) - (f2 * 21.0)) + (xf * 7.0)) - 1.0);
  let pv = select(p64, p32, isF32);
  let yscale = (pow(w, 7.0) * 1.3);
  let v = (pv / yscale);
  let d2 = (d * d);
  let truth = ((((d2 * d2) * d2) * d) / yscale);
  let py = ((vo.uv.y - 0.5) * 2.0);
  let px = (2.0 / u.resolution.y);
  let gxf = fract((sx * 10.0));
  let gyf = fract(((py + 1.0) * 5.0));
  let dgx = min(gxf, (1.0 - gxf));
  let dgy = min(gyf, (1.0 - gyf));
  let aaCx = (30.0 / u.resolution.x);
  let aaCy = (15.0 / u.resolution.y);
  let grid = ((1.0 - smoothstep(0.0, aaCx, dgx)) + (1.0 - smoothstep(0.0, aaCy, dgy)));
  let paper = vec3<f32>(0.96, 0.94, 0.88);
  let rgb0 = mix(paper, vec3<f32>(0.72, 0.78, 0.86), (min(grid, 1.0) * 0.45));
  let fill = step(py, v);
  let rgb1 = mix(rgb0, vec3<f32>(0.62, 0.74, 0.9), (fill * 0.5));
  let ink = (1.0 - smoothstep((px * 1.2), (px * 3.0), abs((v - py))));
  let rgb2 = mix(rgb1, vec3<f32>(0.13, 0.16, 0.3), (ink * 0.85));
  let refLine = (1.0 - smoothstep((px * 0.8), (px * 2.2), abs((truth - py))));
  let rgb3 = mix(rgb2, vec3<f32>(0.8, 0.25, 0.2), (refLine * 0.65));
  let _lc0 = (px * 1.5);
  let axis = min(smoothstep(0.0, _lc0, abs(py)), smoothstep(0.0, _lc0, (abs(_gv0) * 2.0)));
  let rgb = mix(vec3<f32>(0.35, 0.33, 0.3), rgb3, axis);
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

fn df64_narrow(a: vec2<f32>) -> f32 {
  return (a.x + a.y);
}
