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

fn Shape_new(center: vec2<f32>) -> Shape {
  var self_: Shape = Shape(vec2<f32>(0.0, 0.0));
  self_.center = center;
  return self_;
}

fn Circle_sdf(self_: Circle, p: vec2<f32>) -> f32 {
  let d = (p - self_.center);
  return (length(d) - self_.radius);
}

fn Circle_coverage(self_: Circle, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.02, Circle_sdf(self_, p)));
}

fn Circle_new(center: vec2<f32>, radius: f32) -> Circle {
  var self_: Circle = Circle(vec2<f32>(0.0, 0.0), 0.0);
  let _sup = Shape_new(center);
  self_.center = _sup.center;
  self_.radius = radius;
  return self_;
}

fn Square_sdf(self_: Square, p: vec2<f32>) -> f32 {
  let d = (abs((p - self_.center)) - vec2<f32>(self_.extent, self_.extent));
  return (length(max(d, vec2<f32>(0.0, 0.0))) + min(max(d.x, d.y), 0.0));
}

fn Square_coverage(self_: Square, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.02, Square_sdf(self_, p)));
}

fn Square_new(center: vec2<f32>, extent: f32) -> Square {
  var self_: Square = Square(vec2<f32>(0.0, 0.0), 0.0);
  let _sup = Shape_new(center);
  self_.center = _sup.center;
  self_.extent = extent;
  return self_;
}

fn Ring_sdf(self_: Ring, p: vec2<f32>) -> f32 {
  return (abs(Ring_super_Circle_sdf(self_, p)) - self_.thickness);
}

fn Ring_coverage(self_: Ring, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.02, Ring_sdf(self_, p)));
}

fn Ring_super_Circle_sdf(self_: Ring, p: vec2<f32>) -> f32 {
  let d = (p - self_.center);
  return (length(d) - self_.radius);
}

fn Ring_new(center: vec2<f32>, radius: f32, thickness: f32) -> Ring {
  var self_: Ring = Ring(vec2<f32>(0.0, 0.0), 0.0, 0.0);
  let _sup = Circle_new(center, radius);
  self_.center = _sup.center;
  self_.radius = _sup.radius;
  self_.thickness = thickness;
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), p);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let circle = Circle_new(vec2<f32>(-0.45, 0.0), 0.3);
  let square = Square_new(vec2<f32>(0.45, 0.0), 0.26);
  let ring = Ring_new(vec2<f32>(0.0, 0.55), 0.22, 0.05);
  let lit = (((vec3<f32>(0.95, 0.42, 0.3) * Circle_coverage(circle, v.uv)) + (vec3<f32>(0.36, 0.7, 0.98) * Square_coverage(square, v.uv))) + (vec3<f32>(0.98, 0.86, 0.4) * Ring_coverage(ring, v.uv)));
  return vec4<f32>((lit + vec3<f32>(0.05, 0.05, 0.08)), 1.0);
}
