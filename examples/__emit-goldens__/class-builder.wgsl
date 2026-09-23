const Disc_SIZE: f32 = 0.2;
const Capped_SIZE: f32 = 0.35;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

struct Disc {
  radius: f32,
  center: vec2<f32>,
  tint: vec3<f32>,
}

struct Capped {
  radius: f32,
  center: vec2<f32>,
  tint: vec3<f32>,
}

fn Disc_at(self_: ptr<function, Disc>, c: vec2<f32>) -> Disc {
  (*self_).center = c;
  return (*self_);
}

fn Disc_sized(self_: ptr<function, Disc>, r: f32) -> Disc {
  Disc_set_size(self_, r);
  return (*self_);
}

fn Disc_tinted(self_: ptr<function, Disc>, c: vec3<f32>) -> Disc {
  (*self_).tint = c;
  return (*self_);
}

fn Disc_get_size(self_: Disc) -> f32 {
  return self_.radius;
}

fn Disc_set_size(self_: ptr<function, Disc>, r: f32) {
  (*self_).radius = max(r, 0.01);
}

fn Disc_coverage(self_: Disc, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep((self_.radius - 0.01), self_.radius, length((p - self_.center))));
}

fn Disc_unit() -> Disc {
  var d: Disc = Disc_new();
  Disc_set_size(&d, Disc_SIZE);
  return d;
}

fn Disc_new() -> Disc {
  let _cse0 = vec2<f32>(0.0, 0.0);
  var self_: Disc = Disc(0.0, _cse0, vec3<f32>(0.0, 0.0, 0.0));
  self_.radius = 0.2;
  self_.center = _cse0;
  self_.tint = vec3<f32>(1.0, 1.0, 1.0);
  return self_;
}

fn Capped_set_size(self_: ptr<function, Capped>, r: f32) {
  Capped_super_Disc_set_size(self_, min(r, 0.3));
}

fn Capped_get_size(self_: Capped) -> f32 {
  return Capped_super_Disc_get_size(self_);
}

fn Capped_at(self_: ptr<function, Capped>, c: vec2<f32>) -> Capped {
  (*self_).center = c;
  return (*self_);
}

fn Capped_sized(self_: ptr<function, Capped>, r: f32) -> Capped {
  Capped_set_size(self_, r);
  return (*self_);
}

fn Capped_tinted(self_: ptr<function, Capped>, c: vec3<f32>) -> Capped {
  (*self_).tint = c;
  return (*self_);
}

fn Capped_coverage(self_: Capped, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep((self_.radius - 0.01), self_.radius, length((p - self_.center))));
}

fn Capped_unit() -> Capped {
  var d: Capped = Capped_new();
  Capped_set_size(&d, Capped_SIZE);
  return d;
}

fn Capped_super_Disc_set_size(self_: ptr<function, Capped>, r: f32) {
  (*self_).radius = max(r, 0.01);
}

fn Capped_super_Disc_get_size(self_: Capped) -> f32 {
  return self_.radius;
}

fn Capped_new() -> Capped {
  let _cse0 = vec2<f32>(0.0, 0.0);
  var self_: Capped = Capped(0.0, _cse0, vec3<f32>(0.0, 0.0, 0.0));
  self_.radius = 0.2;
  self_.center = _cse0;
  self_.tint = vec3<f32>(1.0, 1.0, 1.0);
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

@fragment
fn fs(v: VsOut) -> FsOut {
  var a: Disc = Disc_unit();
  Disc_at(&a, vec2<f32>(-0.45, 0.0));
  Disc_tinted(&a, vec3<f32>(0.95, 0.74, 0.32));
  var b: Capped = Capped_unit();
  Capped_at(&b, vec2<f32>(0.4, 0.0));
  Capped_tinted(&b, vec3<f32>(0.3, 0.6, 0.95));
  Capped_set_size(&b, (Capped_get_size(b) * 2.0));
  var _chain: Disc = Disc_new();
  Disc_at(&_chain, vec2<f32>(0.0, 0.55));
  Disc_sized(&_chain, 0.1);
  let c = Disc_tinted(&_chain, vec3<f32>(0.9, 0.3, 0.4));
  var col: vec3<f32> = mix(vec3<f32>(0.07, 0.08, 0.14), a.tint, Disc_coverage(a, v.uv));
  col = mix(col, b.tint, Capped_coverage(b, v.uv));
  col = mix(col, c.tint, Disc_coverage(c, v.uv));
  return FsOut(vec4<f32>(col, 1.0));
}
