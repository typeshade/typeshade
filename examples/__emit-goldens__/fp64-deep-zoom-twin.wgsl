struct Uniforms {
  origin: vec2<f32>,
  span: f32,
  fp64: f32,
}

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var _fp64: texture_2d<f32>;

@vertex
fn vs_full(@builtin(vertex_index) idx: u32) -> VsOut {
  var pos: vec2<f32> = vec2<f32>(-1.0, -1.0);
  if ((idx == 1u)) {
    pos = vec2<f32>(3.0, -1.0);
  } else if ((idx == 2u)) {
    pos = vec2<f32>(-1.0, 3.0);
  }
  return VsOut(vec4<f32>(pos, 0.0, 1.0), vec2<f32>(((pos.x + 1.0) * 0.5), ((pos.y + 1.0) * 0.5)));
}

@fragment
fn fs_stripes(vo: VsOut) -> @location(0) vec4<f32> {
  let _fp64_g = textureLoad(_fp64, vec2<i32>(0, 0), 0).x;
  let sweep = (vo.uv.x * u.span);
  let stripes64 = df64_narrow(df64_fract(df64_add(u.origin, vec2<f32>(sweep, 0.0), _fp64_g), _fp64_g));
  let stripes32 = fract((df64_narrow(u.origin) + sweep));
  let v = select(stripes64, stripes32, ((vo.uv.x < 0.5) || (u.fp64 < 0.5)));
  return vec4<f32>(v, v, v, 1.0);
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
