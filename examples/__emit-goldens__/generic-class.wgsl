struct Slot_f32 {
  a: f32,
  b: f32,
}

struct Slot_vec3 {
  a: vec3<f32>,
  b: vec3<f32>,
}

struct Bag_f32 {
  xs: array<f32, 3>,
}

struct Level_f32 {
  edge: f32,
}

struct Marked {
  a: f32,
  b: f32,
  tag: f32,
}

fn Slot_f32_first(self_: Slot_f32) -> f32 {
  return self_.a;
}

fn Slot_f32_new_into(_dst: ptr<function, Slot_f32>, a: f32, b: f32) {
  (*_dst) = Slot_f32(0.0, 0.0);
  (*_dst).a = a;
  (*_dst).b = b;
}

fn Slot_vec3_first(self_: Slot_vec3) -> vec3<f32> {
  return self_.a;
}

fn Slot_vec3_new(a: vec3<f32>, b: vec3<f32>) -> Slot_vec3 {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: Slot_vec3 = Slot_vec3(_cse0, _cse0);
  self_.a = a;
  self_.b = b;
  return self_;
}

fn Bag_f32_new(xs: array<f32, 3>) -> Bag_f32 {
  var self_: Bag_f32 = Bag_f32(array<f32, 3>(0.0, 0.0, 0.0));
  self_.xs = xs;
  return self_;
}

fn Level_f32_new_into(_dst: ptr<function, Level_f32>, edge: f32) {
  (*_dst) = Level_f32(0.0);
  (*_dst).edge = edge;
}

fn Level_unit() -> f32 {
  return 0.75;
}

fn Marked_either(self_: Marked, c: bool) -> f32 {
  return select(self_.b, self_.a, c);
}

fn Marked_first(self_: ptr<function, Marked>) -> f32 {
  return (*self_).a;
}

fn Marked_new_into(_dst: ptr<function, Marked>, a: f32, b: f32, tag: f32) {
  (*_dst) = Marked(0.0, 0.0, 0.0);
  var _sup: Slot_f32;
  Slot_f32_new_into(&_sup, a, b);
  (*_dst).a = _sup.a;
  (*_dst).b = _sup.b;
  (*_dst).tag = tag;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(xs[i], ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fract((p.xy * 0.006));
  var level: Level_f32;
  Level_f32_new_into(&level, 0.35);
  let edge = (smoothstep(0.0, level.edge, uv.y) * Level_unit());
  var marked: Marked;
  Marked_new_into(&marked, 0.4, 0.8, 0.5);
  let k = (((_flow8_fused(1.15, 0.55, (uv.x > 0.5)) * _flow19_fused(array<f32, 3>(0.2, 0.55, 0.9), i32(floor((uv.y * 3.0))))) * Marked_first(&marked)) * marked.tag);
  return vec4<f32>(((_flow32_fused(vec3<f32>(0.95, 0.45, 0.28), vec3<f32>(0.18, 0.55, 0.92), (uv.y > 0.5)) * k) * edge), 1.0);
}

fn _flow8_fused(_flow0_input: f32, _flow1_input: f32, _flow5_input: bool) -> f32 {
  var _flow9_part: f32 = 0.0;
  var _flow10_part: f32 = 0.0;
  _flow9_part = _flow0_input;
  _flow10_part = _flow1_input;
  let _flow11_part = _flow9_part;
  let _flow12_part = _flow10_part;
  return select(_flow12_part, _flow11_part, _flow5_input);
}

fn _flow19_fused(_flow13_input: array<f32, 3>, _flow16_input: i32) -> f32 {
  let _flow20_part = _flow13_input[0u];
  let _flow21_part = _flow13_input[1u];
  let _flow22_part = _flow13_input[2u];
  var _flow14_local: Bag_f32 = Bag_f32(array<f32, 3>(0.0, 0.0, 0.0));
  _flow14_local.xs = array<f32, 3>(_flow20_part, _flow21_part, _flow22_part);
  var _flow17_arg: Bag_f32 = _flow14_local;
  return _flow17_arg.xs[_flow16_input];
}

fn _flow32_fused(_flow24_input: vec3<f32>, _flow25_input: vec3<f32>, _flow29_input: bool) -> vec3<f32> {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _flow33_part: vec3<f32> = _cse0;
  var _flow34_part: vec3<f32> = _cse0;
  _flow33_part = _flow24_input;
  _flow34_part = _flow25_input;
  let _flow35_part = _flow33_part;
  let _flow36_part = _flow34_part;
  return select(_flow36_part, _flow35_part, _flow29_input);
}
