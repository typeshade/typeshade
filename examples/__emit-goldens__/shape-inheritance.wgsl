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
  let _sm4_a0 = vec2<f32>(0.45, 0.0);
  let _cse0 = vec2<f32>(0.0, 0.0);
  var _sm4_l_self_: Square = Square(_cse0, 0.0);
  var _sm4_l_sup: Shape;
  Shape_new_into(&_sm4_l_sup, _sm4_a0);
  _sm4_l_self_.center = _sm4_l_sup.center;
  _sm4_l_self_.extent = 0.26;
  var square: Square = _sm4_l_self_;
  let _sm6_a0 = vec2<f32>(0.0, 0.55);
  var _sm6_l_self_: Ring = Ring(_cse0, 0.0, 0.0);
  var _sm6_l_sup: Circle;
  Circle_new_into(&_sm6_l_sup, _sm6_a0, 0.22);
  _sm6_l_self_.center = _sm6_l_sup.center;
  _sm6_l_self_.radius = _sm6_l_sup.radius;
  _sm6_l_self_.thickness = 0.05;
  var ring: Ring = _sm6_l_self_;
  let _sm1_a1 = v.uv;
  let _sm1_l_sm0_l_d = (_sm1_a1 - circle.center);
  let _sm1_l_sm0_ret = (length(_sm1_l_sm0_l_d) - circle.radius);
  let _sm1_ret = (1.0 - smoothstep(0.0, 0.02, _sm1_l_sm0_ret));
  let _sm3_a1 = v.uv;
  let _sm3_l_sm2_l_d = (abs((_sm3_a1 - square.center)) - vec2<f32>(square.extent));
  let _sm3_l_sm2_ret = (length(max(_sm3_l_sm2_l_d, vec2<f32>(0.0))) + min(max(_sm3_l_sm2_l_d.x, _sm3_l_sm2_l_d.y), 0.0));
  let _sm3_ret = (1.0 - smoothstep(0.0, 0.02, _sm3_l_sm2_ret));
  let _sm5_a1 = v.uv;
  let _sm5_l_d = (_sm5_a1 - ring.center);
  let _sm5_ret = (length(_sm5_l_d) - ring.radius);
  let lit = (((vec3<f32>(0.95, 0.42, 0.3) * _sm1_ret) + (vec3<f32>(0.36, 0.7, 0.98) * _sm3_ret)) + (vec3<f32>(0.98, 0.86, 0.4) * (1.0 - smoothstep(0.0, 0.02, (abs(_sm5_ret) - ring.thickness)))));
  return vec4<f32>((lit + vec3<f32>(0.05, 0.05, 0.08)), 1.0);
}
