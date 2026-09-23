const Ring_MIN_WIDTH: f32 = 0.01;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

struct Ring {
  width: f32,
  center: vec2<f32>,
  radius: f32,
}

var<private> Ring_drawn: f32 = 0.0;

fn Ring_get_width(self_: Ring) -> f32 {
  return self_.width;
}

fn Ring_set_width(self_: ptr<function, Ring>, w: f32) {
  (*self_).width = max(w, Ring_MIN_WIDTH);
}

fn Ring_set_relativeWidth(self_: ptr<function, Ring>, f: f32) {
  Ring_set_width(self_, ((*self_).radius * f));
}

fn Ring_distance(self_: Ring, p: vec2<f32>) -> f32 {
  return (abs((length((p - self_.center)) - self_.radius)) - (self_.width * 0.5));
}

fn Ring_coverage(self_: Ring, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.012, Ring_distance(self_, p)));
}

fn Ring_get_unit() -> Ring {
  return Ring_new(vec2<f32>(0.0, 0.0), 0.5);
}

fn Ring_count() {
  Ring_drawn += 1.0;
}

fn Ring_new(center: vec2<f32>, radius: f32) -> Ring {
  var self_: Ring = Ring(0.0, vec2<f32>(0.0, 0.0), 0.0);
  self_.center = center;
  self_.radius = radius;
  self_.width = 0.05;
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
  var a: Ring = Ring_get_unit();
  Ring_set_relativeWidth(&a, 0.16);
  var b: Ring = Ring_new(vec2<f32>(0.35, 0.2), 0.3);
  Ring_set_width(&b, (Ring_get_width(b) - 0.1));
  Ring_count();
  Ring_count();
  let ink = max(Ring_coverage(a, v.uv), Ring_coverage(b, v.uv));
  let tint = mix(vec3<f32>(0.07, 0.08, 0.14), vec3<f32>(0.95, 0.74, 0.32), ink);
  return FsOut(vec4<f32>((tint * (Ring_drawn * 0.5)), 1.0));
}
