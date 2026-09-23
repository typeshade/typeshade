struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct FsOut {
  @location(0) color: vec4<f32>,
}

struct Ring {
  n: i32,
  radius: f32,
}

fn Ring_new(n: i32, radius: f32) -> Ring {
  var self_: Ring = Ring(0, 0.0);
  self_.n = n;
  self_.radius = radius;
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = ((f32((vi & 1u)) * 4.0) - 1.0);
  let y = ((f32((vi >> 1u)) * 4.0) - 1.0);
  return VsOut(vec4<f32>(x, y, 0.0, 1.0), vec2<f32>(x, y));
}

fn circle(p: vec2<f32>) -> f32 {
  return (length(p) - 0.2);
}

fn cover_circle(p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.01, circle(p)));
}

fn around4_fs_petal(r: f32, p: vec2<f32>) -> f32 {
  let _licm0 = p.x;
  let _licm1 = p.y;
  var best: f32 = 1000.0;
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    let a = (f32(i) * 1.5707964);
    let _lc0 = cos(a);
    let _lc1 = sin(a);
    let q = vec2<f32>(((_licm0 * _lc0) + (_licm1 * _lc1)), ((_licm1 * _lc0) - (_licm0 * _lc1)));
    best = min(best, fs_petal(r, q));
  }
  return best;
}

fn fs_f(r: f32, q: vec2<f32>) -> f32 {
  return around4_fs_petal(r, q);
}

fn cover_fs_f(r: f32, p: vec2<f32>) -> f32 {
  return (1.0 - smoothstep(0.0, 0.01, fs_f(r, p)));
}

fn fs_body(glow: ptr<function, f32>, p: vec2<f32>, i: i32) {
  (*glow) += (0.15 / (1.0 + (40.0 * abs(((length(p) - 0.3) - (0.05 * f32(i)))))));
}

fn times3_fs_body(glow: ptr<function, f32>, p: vec2<f32>) {
  for (var i: i32 = 0; (i < 3); i = (i + 1)) {
    fs_body(glow, p, i);
  }
}

fn fs_dot(dots: ptr<function, f32>, p: vec2<f32>, c: vec2<f32>) {
  (*dots) = max((*dots), (1.0 - smoothstep(0.03, 0.04, length((p - c)))));
}

fn Ring_each_fs_dot(dots: ptr<function, f32>, p: vec2<f32>, self_: Ring) {
  for (var i: i32 = 0; (i < self_.n); i = (i + 1)) {
    let a = ((f32(i) * 6.2831855) / f32(self_.n));
    fs_dot(dots, p, (vec2<f32>(cos(a), sin(a)) * self_.radius));
  }
}

fn fs_any(p: vec2<f32>, b: f32) -> bool {
  return (abs((length(p) - b)) < 0.012);
}

@fragment
fn fs(v: VsOut) -> FsOut {
  let p = v.uv;
  var col: vec3<f32> = vec3<f32>(0.05, 0.06, 0.1);
  col = mix(col, vec3<f32>(0.95, 0.7, 0.3), cover_circle(p));
  col = mix(col, vec3<f32>(0.3, 0.7, 0.95), cover_fs_f(0.1, p));
  var glow: f32 = 0.0;
  times3_fs_body(&glow, p);
  col += vec3<f32>((glow * 0.3), (glow * 0.2), (glow * 0.6));
  let ring = Ring_new(6, 0.7);
  var dots: f32 = 0.0;
  Ring_each_fs_dot(&dots, p, ring);
  col = mix(col, vec3<f32>(0.9, 0.3, 0.5), dots);
  let bands = array<f32, 3>(0.8, 0.88, 0.96);
  if (((fs_any(p, bands[0]) || fs_any(p, bands[1])) || fs_any(p, bands[2]))) {
    col = vec3<f32>(1.0, 1.0, 1.0);
  }
  return FsOut(vec4<f32>(col, 1.0));
}

fn fs_petal(r: f32, q: vec2<f32>) -> f32 {
  return (length((q - vec2<f32>(0.5, 0.0))) - r);
}
