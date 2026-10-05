struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

struct Ray {
  origin: vec2<f32>,
  dir: vec2<f32>,
}

fn Ray_new() -> Ray {
  let _cse0 = vec2<f32>(0.0, 0.0);
  var self_: Ray = Ray(_cse0, _cse0);
  return self_;
}

fn swap(a: ptr<function, f32>, b: ptr<function, f32>) {
  let t = (*a);
  (*a) = (*b);
  (*b) = t;
}

fn order(lo: ptr<function, f32>, hi: ptr<function, f32>) {
  if (((*lo) > (*hi))) {
    swap(lo, hi);
  }
}

fn advance(r: ptr<function, Ray>, t: f32) {
  (*r).origin = ((*r).origin + ((*r).dir * t));
}

fn lift(w: ptr<function, f32>, k: f32) {
  (*w) = mix((*w), 1.0, k);
}

fn liftAll(ws: ptr<function, array<f32, 3>>, k: f32) {
  for (var i: i32 = 0; (i < 3); i = (i + 1)) {
    liftAll_liftAt(ws, k, i);
  }
}

fn project(m: mat2x2<f32>, p: vec2<f32>, q: ptr<function, vec2<f32>>) {
  (*q) = (m * p);
}

fn shrink(column: ptr<function, vec2<f32>>, k: f32) {
  (*column) = ((*column) * k);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  var a: f32 = v.uv.x;
  var b: f32 = v.uv.y;
  order(&a, &b);
  var r: Ray = Ray_new();
  r.origin = v.uv;
  r.dir = vec2<f32>(0.5, -0.25);
  advance(&r, (b - a));
  var w: array<f32, 3> = array<f32, 3>(a, b, 0.5);
  liftAll(&w, 0.25);
  var basis: mat2x2<f32> = mat2x2<f32>(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0));
  shrink(&basis[1], 0.5);
  var q: vec2<f32>;
  project(basis, (v.uv - vec2<f32>(0.5, 0.5)), &q);
  return Color(vec4<f32>(fract((r.origin.x * 3.0)), (w[0] * w[1]), (w[2] * (1.0 - length(q))), 1.0));
}

fn liftAll_liftAt(ws: ptr<function, array<f32, 3>>, k: f32, i: i32) {
  lift(&(*ws)[i], k);
}
