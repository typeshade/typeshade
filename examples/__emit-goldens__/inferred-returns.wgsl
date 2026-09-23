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

fn Rng_new() -> Rng {
  var self_: Rng = Rng(0u);
  self_.seed = 7u;
  return self_;
}

fn Orbit_get_period(self_: Orbit) -> f32 {
  return (6.2831855 / self_.speed);
}

fn Orbit_get_span(self_: Orbit) -> f32 {
  return (self_.radius * 2.0);
}

fn Orbit_set_span(self_: ptr<function, Orbit>, d: f32) {
  (*self_).radius = (d * 0.5);
}

fn Orbit_at(self_: Orbit, t: f32) -> vec2<f32> {
  let a = (t * self_.speed);
  return vec2<f32>((cos(a) * self_.radius), (sin(a) * self_.radius));
}

fn Orbit_new() -> Orbit {
  var self_: Orbit = Orbit(0.0, 0.0);
  self_.radius = 0.45;
  self_.speed = 1.5;
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

fn fs_falloff(d: f32) -> f32 {
  return (0.004 / ((d * d) + 0.002));
}

fn pick_vec2(c: bool, a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  if (c) {
    return a;
  }
  return b;
}

fn tint(glow: f32, lit: f32) -> vec3<f32> {
  return vec3<f32>(((0.3 * glow) + lit), ((0.6 * glow) + (0.8 * lit)), (glow + (0.5 * lit)));
}

fn ring(p: vec2<f32>, r: f32) -> f32 {
  return (1.0 - smoothstep(0.0, 0.01, abs((length(p) - r))));
}

@fragment
fn fs(v: VsOut) -> FsOut {
  let p = v.uv;
  var orbit: Orbit = Orbit_new();
  Orbit_set_span(&orbit, 0.9);
  var rng: Rng = Rng_new();
  var glow: f32 = 0.0;
  for (var i: i32 = 0; (i < 5); i = (i + 1)) {
    let _seq0 = Rng_next(&rng);
    let t = (((Orbit_get_period(orbit) * f32(i)) / 5.0) + ((_seq0 - 0.5) * 0.3));
    let a = Orbit_at(orbit, t);
    let b = Orbit_at(orbit, (t + 0.05));
    glow += fs_falloff(distance(p, pick_vec2((distance(p, a) < distance(p, b)), a, b)));
  }
  let col = min(tint(glow, ring(p, (orbit.radius * 0.6))), vec3<f32>(1.0, 1.0, 1.0));
  return FsOut(vec4<f32>(col, 1.0));
}
