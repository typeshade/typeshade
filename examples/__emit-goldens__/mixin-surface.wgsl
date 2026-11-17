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

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  return vec4<f32>(xs[i], ys[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let p = (frag.xy * 0.004);
  let _sm0_a0 = vec2<f32>(0.6, 0.6);
  let _sm0_a3 = vec3<f32>(0.95, 0.4, 0.25);
  let _cse0 = vec2<f32>(0.0, 0.0);
  let _cse1 = vec3<f32>(0.0, 0.0, 0.0);
  var _sm0_l_self_: TintedDisc = TintedDisc(_cse0, 0.0, _cse1, 0.0);
  _sm0_l_self_.center = _sm0_a0;
  _sm0_l_self_.radius = 0.35;
  _sm0_l_self_.softness = 0.08;
  _sm0_l_self_.tint = _sm0_a3;
  var disc: TintedDisc = _sm0_l_self_;
  let _sm1_a0 = vec2<f32>(1.4, 0.0);
  let _sm1_a3 = vec3<f32>(0.2, 0.55, 0.9);
  var _sm1_l_self_: TintedBar = TintedBar(_cse0, 0.0, _cse1, 0.0);
  _sm1_l_self_.center = _sm1_a0;
  _sm1_l_self_.halfWidth = 0.25;
  _sm1_l_self_.softness = 0.05;
  _sm1_l_self_.tint = _sm1_a3;
  var bar: TintedBar = _sm1_l_self_;
  let rgb = ((disc.tint * smoothstep(0.0, 1.0, (1.0 - smoothstep((disc.radius - disc.softness), disc.radius, length((p - disc.center)))))) + (bar.tint * smoothstep(0.0, 1.0, (1.0 - smoothstep((bar.halfWidth - bar.softness), bar.halfWidth, abs((p.x - bar.center.x)))))));
  return vec4<f32>(rgb, 1.0);
}
