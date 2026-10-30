struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Shape {
  center: vec2<f32>,
}

struct Circle {
  center: vec2<f32>,
  radius: f32,
}

struct Square {
  center: vec2<f32>,
  extent: f32,
}

struct Ring {
  center: vec2<f32>,
  radius: f32,
  thickness: f32,
}

fn Shape_new_into(_dst: ptr<function, Shape>, center: vec2<f32>) {
  (*_dst) = Shape(vec2<f32>(0.0, 0.0));
  (*_dst).center = center;
}

fn Circle_sdf(self_: Circle, p: vec2<f32>) -> f32 {
  let d = (p - self_.center);
  return (length(d) - self_.radius);
}

fn Circle_new_into(_dst: ptr<function, Circle>, center: vec2<f32>, radius: f32) {
  (*_dst) = Circle(vec2<f32>(0.0, 0.0), 0.0);
  var _sup: Shape;
  Shape_new_into(&_sup, center);
  (*_dst).center = _sup.center;
  (*_dst).radius = radius;
}

fn Square_sdf(self_: Square, p: vec2<f32>) -> f32 {
  let d = (abs((p - self_.center)) - vec2<f32>(self_.extent));
  return (length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0));
}

fn Square_new(center: vec2<f32>, extent: f32) -> Square {
  var self_: Square = Square(vec2<f32>(0.0, 0.0), 0.0);
  var _sup: Shape;
  Shape_new_into(&_sup, center);
  self_.center = _sup.center;
  self_.extent = extent;
  return self_;
}

fn Ring_sdf(self_: Ring, p: vec2<f32>) -> f32 {
  return (abs(Ring_super_Circle_sdf(self_, p)) - self_.thickness);
}

fn Ring_super_Circle_sdf(self_: Ring, p: vec2<f32>) -> f32 {
  let d = (p - self_.center);
  return (length(d) - self_.radius);
}

fn Ring_new(center: vec2<f32>, radius: f32, thickness: f32) -> Ring {
  var self_: Ring = Ring(vec2<f32>(0.0, 0.0), 0.0, 0.0);
  var _sup: Circle;
  Circle_new_into(&_sup, center, radius);
  self_.center = _sup.center;
  self_.radius = _sup.radius;
  self_.thickness = thickness;
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), p);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let lit = (((vec3<f32>(0.95, 0.42, 0.3) * _flow9_fused(vec2<f32>(-0.45, 0.0), 0.3, v.uv)) + (vec3<f32>(0.36, 0.7, 0.98) * _flow25_fused(vec2<f32>(0.45, 0.0), 0.26, v.uv))) + (vec3<f32>(0.98, 0.86, 0.4) * _flow43_fused(vec2<f32>(0.0, 0.55), 0.22, 0.05, v.uv)));
  return vec4<f32>((lit + vec3<f32>(0.05, 0.05, 0.08)), 1.0);
}

fn _flow9_fused(_flow0_input: vec2<f32>, _flow1_input: f32, _flow6_input: vec2<f32>) -> f32 {
  var _flow10_part: vec2<f32> = vec2<f32>(0.0, 0.0);
  var _flow11_part: f32 = 0.0;
  var _flow15_whole: Shape;
  Shape_new_into(&_flow15_whole, _flow0_input);
  let _flow12_part = _flow15_whole.center;
  _flow10_part = _flow12_part;
  _flow11_part = _flow1_input;
  let _flow13_part = _flow10_part;
  let _flow14_part = _flow11_part;
  return (1.0 - smoothstep(0.0, 0.02, Circle_sdf(Circle(_flow13_part, _flow14_part), _flow6_input)));
}

fn _flow25_fused(_flow16_input: vec2<f32>, _flow17_input: f32, _flow22_input: vec2<f32>) -> f32 {
  var _flow26_part: vec2<f32> = vec2<f32>(0.0, 0.0);
  var _flow27_part: f32 = 0.0;
  var _flow31_whole: Shape;
  Shape_new_into(&_flow31_whole, _flow16_input);
  let _flow28_part = _flow31_whole.center;
  _flow26_part = _flow28_part;
  _flow27_part = _flow17_input;
  let _flow29_part = _flow26_part;
  let _flow30_part = _flow27_part;
  return (1.0 - smoothstep(0.0, 0.02, Square_sdf(Square(_flow29_part, _flow30_part), _flow22_input)));
}

fn _flow43_fused(_flow32_input: vec2<f32>, _flow33_input: f32, _flow34_input: f32, _flow40_input: vec2<f32>) -> f32 {
  var _flow44_part: vec2<f32> = vec2<f32>(0.0, 0.0);
  var _flow45_part: f32 = 0.0;
  var _flow46_part: f32 = 0.0;
  var _flow52_whole: Circle;
  Circle_new_into(&_flow52_whole, _flow32_input, _flow33_input);
  let _flow47_part = _flow52_whole.center;
  let _flow48_part = _flow52_whole.radius;
  _flow44_part = _flow47_part;
  _flow45_part = _flow48_part;
  _flow46_part = _flow34_input;
  let _flow49_part = _flow44_part;
  let _flow50_part = _flow45_part;
  let _flow51_part = _flow46_part;
  return (1.0 - smoothstep(0.0, 0.02, Ring_sdf(Ring(_flow49_part, _flow50_part, _flow51_part), _flow40_input)));
}
