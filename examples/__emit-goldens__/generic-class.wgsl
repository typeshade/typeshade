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
  (*_dst) = Slot_f32(a, b);
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
  let _i0a0 = vec3<f32>(0.95, 0.45, 0.28);
  let _i0a1 = vec3<f32>(0.18, 0.55, 0.92);
  var _i1a0: array<f32, 3> = array<f32, 3>(0.2, 0.55, 0.9);
  let step = _i1a0[i32(floor((uv.y * 3.0)))];
  var _i2_self_: Level_f32 = Level_f32(0.35);
  let edge = (smoothstep(0.0, _i2_self_.edge, uv.y) * 0.75);
  var _i3_sup: Slot_f32;
  Slot_f32_new_into(&_i3_sup, 0.4, 0.8);
  let k = (((select(gain.b, gain.a, (uv.x > 0.5)) * step) * _i3_sup.a) * 0.5);
  return vec4<f32>(((select(_i0a1, _i0a0, (uv.y > 0.5)) * k) * edge), 1.0);
}
