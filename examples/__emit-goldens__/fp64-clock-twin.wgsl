struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  epoch: vec2<f32>,
  speed: f32,
  fp64: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var _fp64: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(((x * 0.5) + 0.5), ((y * 0.5) + 0.5)));
}

@fragment
fn fs_clock(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let phase64 = df64_narrow(df64_fract(df64_mul(df64_add(U.epoch, vec2<f32>(U.time, 0.0), _fp64_g), vec2<f32>(U.speed, 0.0), _fp64_g), _fp64_g));
  let phase32 = fract(((df64_narrow(U.epoch) + U.time) * U.speed));
  let _cse0 = (vo.uv.x < 0.5);
  let isF32 = (_cse0 || (U.fp64 < 0.5));
  let phase = select(phase64, phase32, isF32);
  let halfUv = (vo.uv.x * 2.0);
  let sx = (halfUv - select(1.0, 0.0, _cse0));
  let c = vec2<f32>((((sx * 2.0) - 1.0) * ((U.resolution.x * 0.5) / U.resolution.y)), ((vo.uv.y * 2.0) - 1.0));
  let r = length(c);
  let a01 = fract((0.25 - (atan2(c.y, c.x) / 6.283185307179586)));
  let px = (2.0 / U.resolution.y);
  let bezel = (1.0 - smoothstep((px * 1.5), (px * 3.0), (abs((r - 0.82)) - 0.012)));
  let tickA = ((-abs((fract((a01 * 12.0)) - 0.5))) + 0.5);
  let tick = (((1.0 - smoothstep(0.0, 0.035, tickA)) * smoothstep(0.62, 0.66, r)) * (1.0 - smoothstep(0.78, 0.8, r)));
  let behind = fract(((phase - a01) + 1.0));
  let hand = (((1.0 - smoothstep(0.0, 0.006, min(behind, (1.0 - behind)))) * step(r, 0.6)) * smoothstep(0.05, 0.1, r));
  let trail = ((exp((behind * -5.0)) * 0.35) * step(r, 0.58));
  let hub = (1.0 - smoothstep((px * 2.0), (px * 5.0), r));
  let face = mix(vec3<f32>(0.03, 0.045, 0.08), vec3<f32>(0.05, 0.075, 0.12), r);
  let rgb = (((((face + (vec3<f32>(0.85, 0.9, 1.0) * (bezel * 0.35))) + (vec3<f32>(0.8, 0.85, 0.95) * (tick * 0.5))) + (vec3<f32>(1.0, 0.72, 0.2) * hand)) + (vec3<f32>(1.0, 0.6, 0.15) * trail)) + (vec3<f32>(1.0, 0.85, 0.5) * hub));
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
