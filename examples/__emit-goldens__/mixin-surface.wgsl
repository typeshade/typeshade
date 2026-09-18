struct Disc {
  center: vec2<f32>,
  radius: f32,
}

struct Bar {
  center: vec2<f32>,
  halfWidth: f32,
}

struct TintedDisc {
  center: vec2<f32>,
  radius: f32,
  tint: vec3<f32>,
  softness: f32,
}

struct TintedBar {
  center: vec2<f32>,
  halfWidth: f32,
  tint: vec3<f32>,
  softness: f32,
}

fn TintedDisc_lit(self_: TintedDisc, cover: f32) -> vec3<f32> {
  return (self_.tint * smoothstep(0.0, 1.0, cover));
}

fn TintedDisc_cover(self_: TintedDisc, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep((self_.radius - self_.softness), self_.radius, length((p - self_.center))));
}

fn TintedDisc_new(center: vec2<f32>, radius: f32, softness: f32, tint: vec3<f32>) -> TintedDisc {
  var self_: TintedDisc = TintedDisc(vec2<f32>(0.0, 0.0), 0.0, vec3<f32>(0.0, 0.0, 0.0), 0.0);
  self_.center = center;
  self_.radius = radius;
  self_.softness = softness;
  self_.tint = tint;
  return self_;
}

fn TintedBar_lit(self_: TintedBar, cover: f32) -> vec3<f32> {
  return (self_.tint * smoothstep(0.0, 1.0, cover));
}

fn TintedBar_cover(self_: TintedBar, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep((self_.halfWidth - self_.softness), self_.halfWidth, abs((p.x - self_.center.x))));
}

fn TintedBar_new(center: vec2<f32>, halfWidth: f32, softness: f32, tint: vec3<f32>) -> TintedBar {
  var self_: TintedBar = TintedBar(vec2<f32>(0.0, 0.0), 0.0, vec3<f32>(0.0, 0.0, 0.0), 0.0);
  self_.center = center;
  self_.halfWidth = halfWidth;
  self_.softness = softness;
  self_.tint = tint;
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
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let p = (frag.xy * 0.004);
  let disc = TintedDisc_new(vec2<f32>(0.6, 0.6), 0.35, 0.08, vec3<f32>(0.95, 0.4, 0.25));
  let bar = TintedBar_new(vec2<f32>(1.4, 0.0), 0.25, 0.05, vec3<f32>(0.2, 0.55, 0.9));
  let rgb = (TintedDisc_lit(disc, TintedDisc_cover(disc, p)) + TintedBar_lit(bar, TintedBar_cover(bar, p)));
  return vec4<f32>(rgb, 1.0);
}
