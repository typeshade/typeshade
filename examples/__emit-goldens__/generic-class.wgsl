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

fn Slot_f32_either(self_: ptr<function, Slot_f32>, c: bool) -> f32 {
  return select((*self_).b, (*self_).a, c);
}

fn Slot_f32_first(self_: Slot_f32) -> f32 {
  return self_.a;
}

fn Slot_f32_new_into(_dst: ptr<function, Slot_f32>, a: f32, b: f32) {
  (*_dst) = Slot_f32(0.0, 0.0);
  (*_dst).a = a;
  (*_dst).b = b;
}

fn Slot_vec3_either(self_: ptr<function, Slot_vec3>, c: bool) -> vec3<f32> {
  return select((*self_).b, (*self_).a, c);
}

fn Slot_vec3_first(self_: Slot_vec3) -> vec3<f32> {
  return self_.a;
}

fn Slot_vec3_new_into(_dst: ptr<function, Slot_vec3>, a: vec3<f32>, b: vec3<f32>) {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  (*_dst) = Slot_vec3(_cse0, _cse0);
  (*_dst).a = a;
  (*_dst).b = b;
}

fn Bag_f32_nth(self_: ptr<function, Bag_f32>, i: i32) -> f32 {
  return (*self_).xs[i];
}

fn Bag_f32_new_into(_dst: ptr<function, Bag_f32>, xs: array<f32, 3>) {
  (*_dst) = Bag_f32(array<f32, 3>(0.0, 0.0, 0.0));
  (*_dst).xs = xs;
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
  var gain: Slot_f32;
  Slot_f32_new_into(&gain, 1.15, 0.55);
  var tint: Slot_vec3;
  Slot_vec3_new_into(&tint, vec3<f32>(0.95, 0.45, 0.28), vec3<f32>(0.18, 0.55, 0.92));
  var band: Bag_f32;
  Bag_f32_new_into(&band, array<f32, 3>(0.2, 0.55, 0.9));
  let step = Bag_f32_nth(&band, i32(floor((uv.y * 3.0))));
  var level: Level_f32;
  Level_f32_new_into(&level, 0.35);
  let edge = (smoothstep(0.0, level.edge, uv.y) * Level_unit());
  var marked: Marked;
  Marked_new_into(&marked, 0.4, 0.8, 0.5);
  let k = (((Slot_f32_either(&gain, (uv.x > 0.5)) * step) * Marked_first(&marked)) * marked.tag);
  return vec4<f32>(((Slot_vec3_either(&tint, (uv.y > 0.5)) * k) * edge), 1.0);
}
