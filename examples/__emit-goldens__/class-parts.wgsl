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
  let _cse1 = vec2<f32>(0.0);
  (*_dst).pos = _cse1;
  (*_dst).vel = _cse1;
}

fn Ring_advance(self_: ptr<function, Ring>, dt: f32) {
  Mover_step(&(*self_).center, dt);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

@fragment
fn fs(v: VsOut) -> FsOut {
  var ring: Ring = Ring(Mover(vec2<f32>(0.0, 0.0), vec2<f32>(0.0, 0.0)), 0.0, 0.0);
  Mover_new_into(&ring.center);
  ring.radius = 0.3;
  ring.width = 0.04;
  ring.center.vel = vec2<f32>(0.5, 0.2);
  Ring_advance(&ring, 0.5);
  var spot: Dot = Dot(Mover(vec2<f32>(0.0, 0.0), vec2<f32>(0.0, 0.0)), 0.0);
  Mover_new_into(&spot.center);
  spot.size = 0.1;
  spot.center.pos = vec2<f32>(-0.45, -0.3);
  var col: vec3<f32> = vec3<f32>(0.06, 0.07, 0.12);
  let _i3a1 = v.uv;
  let _i3_d = abs((length((_i3a1 - ring.center.pos)) - ring.radius));
  let _i3_ret = (1.0 - smoothstep((ring.width * 0.5), ring.width, _i3_d));
  col = mix(col, vec3<f32>(0.95, 0.7, 0.3), _i3_ret);
  col = mix(col, vec3<f32>(0.3, 0.7, 0.95), (1.0 - smoothstep((spot.size * 0.8), spot.size, length((v.uv - spot.center.pos)))));
  return FsOut(vec4<f32>(col, 1.0));
}
