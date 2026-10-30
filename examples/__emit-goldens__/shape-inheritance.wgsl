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

fn Circle_sdf(self_: ptr<function, Circle>, p: vec2<f32>) -> f32 {
  let d = (p - (*self_).center);
  return (length(d) - (*self_).radius);
}

fn Circle_coverage(self_: ptr<function, Circle>, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.02, Circle_sdf(self_, p)));
}

fn Circle_new_into(_dst: ptr<function, Circle>, center: vec2<f32>, radius: f32) {
  (*_dst) = Circle(vec2<f32>(0.0, 0.0), 0.0);
  var _sup: Shape;
  Shape_new_into(&_sup, center);
  (*_dst).center = _sup.center;
  (*_dst).radius = radius;
}

fn Square_sdf(self_: ptr<function, Square>, p: vec2<f32>) -> f32 {
  let d = (abs((p - (*self_).center)) - vec2<f32>((*self_).extent));
  return (length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0));
}

fn Square_coverage(self_: ptr<function, Square>, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.02, Square_sdf(self_, p)));
}

fn Square_new_into(_dst: ptr<function, Square>, center: vec2<f32>, extent: f32) {
  (*_dst) = Square(vec2<f32>(0.0, 0.0), 0.0);
  var _sup: Shape;
  Shape_new_into(&_sup, center);
  (*_dst).center = _sup.center;
  (*_dst).extent = extent;
}

fn Ring_sdf(self_: ptr<function, Ring>, p: vec2<f32>) -> f32 {
  return (abs(Ring_super_Circle_sdf(self_, p)) - (*self_).thickness);
}

fn Ring_coverage(self_: ptr<function, Ring>, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.02, Ring_sdf(self_, p)));
}

fn Ring_super_Circle_sdf(self_: ptr<function, Ring>, p: vec2<f32>) -> f32 {
  let d = (p - (*self_).center);
  return (length(d) - (*self_).radius);
}

fn Ring_new_into(_dst: ptr<function, Ring>, center: vec2<f32>, radius: f32, thickness: f32) {
  (*_dst) = Ring(vec2<f32>(0.0, 0.0), 0.0, 0.0);
  var _sup: Circle;
  Circle_new_into(&_sup, center, radius);
  (*_dst).center = _sup.center;
  (*_dst).radius = _sup.radius;
  (*_dst).thickness = thickness;
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
  var circle: Circle;
  Circle_new_into(&circle, vec2<f32>(-0.45, 0.0), 0.3);
  var square: Square;
  Square_new_into(&square, vec2<f32>(0.45, 0.0), 0.26);
  var ring: Ring;
  Ring_new_into(&ring, vec2<f32>(0.0, 0.55), 0.22, 0.05);
  let lit = (((vec3<f32>(0.95, 0.42, 0.3) * Circle_coverage(&circle, v.uv)) + (vec3<f32>(0.36, 0.7, 0.98) * Square_coverage(&square, v.uv))) + (vec3<f32>(0.98, 0.86, 0.4) * Ring_coverage(&ring, v.uv)));
  return vec4<f32>((lit + vec3<f32>(0.05, 0.05, 0.08)), 1.0);
}
