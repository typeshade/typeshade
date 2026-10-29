struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

struct Mover {
  pos: vec2<f32>,
  vel: vec2<f32>,
}

struct Ring {
  center: Mover,
  radius: f32,
  width: f32,
}

struct Dot {
  center: Mover,
  size: f32,
}

fn Mover_step(self_: ptr<function, Mover>, dt: f32) {
  (*self_).pos += ((*self_).vel * dt);
}

fn Mover_new_into(_dst: ptr<function, Mover>) {
  let _cse0 = vec2<f32>(0.0, 0.0);
  (*_dst) = Mover(_cse0, _cse0);
  (*_dst).pos = _cse0;
  (*_dst).vel = _cse0;
}

fn Ring_cover(self_: ptr<function, Ring>, p: vec2<f32>) -> f32 {
  let d = abs((length((p - (*self_).center.pos)) - (*self_).radius));
  return (1.0 - smoothstep(((*self_).width * 0.5), (*self_).width, d));
}

fn Ring_advance(self_: ptr<function, Ring>, dt: f32) {
  Mover_step(&(*self_).center, dt);
}

fn Ring_new_into(_dst: ptr<function, Ring>) {
  let _cse0 = vec2<f32>(0.0, 0.0);
  (*_dst) = Ring(Mover(_cse0, _cse0), 0.0, 0.0);
  Mover_new_into(&(*_dst).center);
  (*_dst).radius = 0.3;
  (*_dst).width = 0.04;
}

fn Dot_cover(self_: ptr<function, Dot>, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(((*self_).size * 0.8), (*self_).size, length((p - (*self_).center.pos))));
}

fn Dot_new_into(_dst: ptr<function, Dot>) {
  let _cse0 = vec2<f32>(0.0, 0.0);
  (*_dst) = Dot(Mover(_cse0, _cse0), 0.0);
  Mover_new_into(&(*_dst).center);
  (*_dst).size = 0.1;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

fn coverOf_Ring(m: ptr<function, Ring>, p: vec2<f32>) -> f32 {
  return Ring_cover(m, p);
}

fn coverOf_Dot(m: ptr<function, Dot>, p: vec2<f32>) -> f32 {
  return Dot_cover(m, p);
}

@fragment
fn fs(v: VsOut) -> FsOut {
  var ring: Ring;
  Ring_new_into(&ring);
  ring.center.vel = vec2<f32>(0.5, 0.2);
  Ring_advance(&ring, 0.5);
  var spot: Dot;
  Dot_new_into(&spot);
  spot.center.pos = vec2<f32>(-0.45, -0.3);
  var col: vec3<f32> = vec3<f32>(0.06, 0.07, 0.12);
  col = mix(col, vec3<f32>(0.95, 0.7, 0.3), coverOf_Ring(&ring, v.uv));
  col = mix(col, vec3<f32>(0.3, 0.7, 0.95), coverOf_Dot(&spot, v.uv));
  return FsOut(vec4<f32>(col, 1.0));
}
