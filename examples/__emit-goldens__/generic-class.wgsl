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

fn Marked_either(self_: Marked, c: bool) -> f32 {
  return select(self_.b, self_.a, c);
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
  var gain: Slot_f32;
  Slot_f32_new_into(&gain, 1.15, 0.55);
  let _sm0_a0 = vec3<f32>(0.95, 0.45, 0.28);
  let _sm0_a1 = vec3<f32>(0.18, 0.55, 0.92);
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _sm0_l_self_: Slot_vec3 = Slot_vec3(_cse0, _cse0);
  _sm0_l_self_.a = _sm0_a0;
  _sm0_l_self_.b = _sm0_a1;
  var tint: Slot_vec3 = _sm0_l_self_;
  var _sm1_a0: array<f32, 3> = array<f32, 3>(0.2, 0.55, 0.9);
  var _sm1_l_self_: Bag_f32 = Bag_f32(array<f32, 3>(0.0, 0.0, 0.0));
  _sm1_l_self_.xs = _sm1_a0;
  var band: Bag_f32 = _sm1_l_self_;
  let step = band.xs[i32(floor((uv.y * 3.0)))];
  var _sm2_l_self_: Level_f32 = Level_f32(0.0);
  _sm2_l_self_.edge = 0.35;
  var level: Level_f32 = _sm2_l_self_;
  let edge = (smoothstep(0.0, level.edge, uv.y) * 0.75);
  var _sm3_l_self_: Marked = Marked(0.0, 0.0, 0.0);
  var _sm3_l_sup: Slot_f32;
  Slot_f32_new_into(&_sm3_l_sup, 0.4, 0.8);
  _sm3_l_self_.a = _sm3_l_sup.a;
  _sm3_l_self_.b = _sm3_l_sup.b;
  _sm3_l_self_.tag = 0.5;
  var marked: Marked = _sm3_l_self_;
  let k = (((select(gain.b, gain.a, (uv.x > 0.5)) * step) * marked.a) * marked.tag);
  return vec4<f32>(((select(tint.b, tint.a, (uv.y > 0.5)) * k) * edge), 1.0);
}
