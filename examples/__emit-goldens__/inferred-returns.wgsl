struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

struct Rng {
  seed: u32,
}

struct Orbit {
  radius: f32,
  speed: f32,
}

fn Rng_next(self_: ptr<function, Rng>) -> f32 {
  (*self_).seed = (((*self_).seed * 1664525u) + 1013904223u);
  return (f32(((*self_).seed >> 8u)) * 5.960464477539063e-8);
}

fn Orbit_get_span(self_: Orbit) -> f32 {
  return (self_.radius * 2.0);
}

fn Orbit_set_span(self_: ptr<function, Orbit>, d: f32) {
  (*self_).radius = (d * 0.5);
}

fn Orbit_at(self_: ptr<function, Orbit>, t: f32) -> vec2<f32> {
  let a = (t * (*self_).speed);
  return (vec2<f32>(cos(a), sin(a)) * (*self_).radius);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

@fragment
fn fs(v: VsOut) -> FsOut {
  let p = v.uv;
  var orbit: Orbit = Orbit(0.0, 0.0);
  orbit.radius = 0.45;
  orbit.speed = 1.5;
  Orbit_set_span(&orbit, 0.9);
  var rng: Rng = Rng(0u);
  rng.seed = 7u;
  var glow: f32 = 0.0;
  for (var i: i32 = 0; (i < 5); i = (i + 1)) {
    let _seq0 = Rng_next(&rng);
    let t = ((((6.2831855 / orbit.speed) * f32(i)) / 5.0) + ((_seq0 - 0.5) * 0.3));
    let a = Orbit_at(&orbit, t);
    let b = Orbit_at(&orbit, (t + 0.05));
    let _i3a0 = (distance(p, a) < distance(p, b));
    var _i3ret: vec2<f32>;
    if (_i3a0) {
      _i3ret = a;
    } else {
      _i3ret = b;
    }
    let _i2a0 = distance(p, _i3ret);
    glow += (0.004 / ((_i2a0 * _i2a0) + 0.002));
  }
  let _i4a1 = (1.0 - smoothstep(0.0, 0.01, abs((length(p) - (orbit.radius * 0.6)))));
  let col = min(vec3<f32>(((0.3 * glow) + _i4a1), ((0.6 * glow) + (0.8 * _i4a1)), (glow + (0.5 * _i4a1))), vec3<f32>(1.0));
  return FsOut(vec4<f32>(col, 1.0));
}
