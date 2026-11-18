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

fn Circle_new_into(_dst: ptr<function, Circle>, center: vec2<f32>, radius: f32) {
  (*_dst) = Circle(vec2<f32>(0.0, 0.0), 0.0);
  var _sup: Shape;
  Shape_new_into(&_sup, center);
  (*_dst).center = _sup.center;
  (*_dst).radius = radius;
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
  let _i4a0 = vec2<f32>(0.45, 0.0);
  let _cse0 = vec2<f32>(0.0, 0.0);
  var _i4_self_: Square = Square(_cse0, 0.0);
  var _i4_sup: Shape;
  Shape_new_into(&_i4_sup, _i4a0);
  _i4_self_.center = _i4_sup.center;
  _i4_self_.extent = 0.26;
  var square: Square = _i4_self_;
  let _i6a0 = vec2<f32>(0.0, 0.55);
  var _i6_self_: Ring = Ring(_cse0, 0.0, 0.0);
  var _i6_sup: Circle;
  Circle_new_into(&_i6_sup, _i6a0, 0.22);
  _i6_self_.center = _i6_sup.center;
  _i6_self_.radius = _i6_sup.radius;
  _i6_self_.thickness = 0.05;
  var ring: Ring = _i6_self_;
  let _i1a1 = v.uv;
  let _i1_d = (_i1a1 - circle.center);
  let _i1_ret = (length(_i1_d) - circle.radius);
  let _i1ret = (1.0 - smoothstep(0.0, 0.02, _i1_ret));
  let _i3a1 = v.uv;
  let _i3_d = (abs((_i3a1 - square.center)) - vec2<f32>(square.extent));
  let _i3_ret = (length(max(_i3_d, vec2<f32>(0.0))) + min(max(_i3_d.x, _i3_d.y), 0.0));
  let _i3ret = (1.0 - smoothstep(0.0, 0.02, _i3_ret));
  let _i5a1 = v.uv;
  let _i5_d = (_i5a1 - ring.center);
  let _i5ret = (length(_i5_d) - ring.radius);
  let lit = (((vec3<f32>(0.95, 0.42, 0.3) * _i1ret) + (vec3<f32>(0.36, 0.7, 0.98) * _i3ret)) + (vec3<f32>(0.98, 0.86, 0.4) * (1.0 - smoothstep(0.0, 0.02, (abs(_i5ret) - ring.thickness)))));
  return vec4<f32>((lit + vec3<f32>(0.05, 0.05, 0.08)), 1.0);
}
