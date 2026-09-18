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

fn Slot_f32_either(self_: Slot_f32, c: bool) -> f32 {
  return select(self_.b, self_.a, c);
}

fn Slot_f32_first(self_: Slot_f32) -> f32 {
  return self_.a;
}

fn Slot_f32_new(a: f32, b: f32) -> Slot_f32 {
  var self_: Slot_f32 = Slot_f32(0.0, 0.0);
  self_.a = a;
  self_.b = b;
  return self_;
}

fn Slot_vec3_either(self_: Slot_vec3, c: bool) -> vec3<f32> {
  return select(self_.b, self_.a, c);
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

fn Bag_f32_nth(self_: Bag_f32, i: i32) -> f32 {
  return self_.xs[i];
}

fn Bag_f32_new(xs: array<f32, 3>) -> Bag_f32 {
  var self_: Bag_f32 = Bag_f32(array<f32, 3>(0.0, 0.0, 0.0));
  self_.xs = xs;
  return self_;
}

fn Level_f32_new(edge: f32) -> Level_f32 {
  var self_: Level_f32 = Level_f32(0.0);
  self_.edge = edge;
  return self_;
}

fn Level_unit() -> f32 {
  return 0.75;
}

fn Marked_either(self_: Marked, c: bool) -> f32 {
  return select(self_.b, self_.a, c);
}

fn Marked_first(self_: Marked) -> f32 {
  return self_.a;
}

fn Marked_new(a: f32, b: f32, tag: f32) -> Marked {
  var self_: Marked = Marked(0.0, 0.0, 0.0);
  let _sup = Slot_f32_new(a, b);
  self_.a = _sup.a;
  self_.b = _sup.b;
  self_.tag = tag;
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(xs[i], ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fract((p.xy * 0.006));
  let gain = Slot_f32_new(1.15, 0.55);
  let tint = Slot_vec3_new(vec3<f32>(0.95, 0.45, 0.28), vec3<f32>(0.18, 0.55, 0.92));
  let band = Bag_f32_new(array<f32, 3>(0.2, 0.55, 0.9));
  let step = Bag_f32_nth(band, i32(floor((uv.y * 3.0))));
  let level = Level_f32_new(0.35);
  let edge = (smoothstep(0.0, level.edge, uv.y) * Level_unit());
  let marked = Marked_new(0.4, 0.8, 0.5);
  let k = (((Slot_f32_either(gain, (uv.x > 0.5)) * step) * Marked_first(marked)) * marked.tag);
  return vec4<f32>(((Slot_vec3_either(tint, (uv.y > 0.5)) * k) * edge), 1.0);
}
