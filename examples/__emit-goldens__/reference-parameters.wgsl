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

fn advance(r: ptr<function, Ray>, t: f32) {
  (*r).origin = ((*r).origin + ((*r).dir * t));
}

fn liftAll(ws: ptr<function, array<f32, 3>>, k: f32) {
  liftAll_liftAt(ws, k, 0);
  liftAll_liftAt(ws, k, 1);
  liftAll_liftAt(ws, k, 2);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

@fragment
fn fs(v: VsOut) -> Color {
  var a: f32 = v.uv.x;
  var b: f32 = v.uv.y;
  var _list_0: f32;
  var _list_1: f32;
  if ((a > b)) {
    _list_0 = b;
    _list_1 = a;
  } else {
    _list_0 = a;
    _list_1 = b;
  }
  a = _list_0;
  b = _list_1;
  var r: Ray = Ray(vec2<f32>(0.0, 0.0), vec2<f32>(0.0, 0.0));
  r.origin = v.uv;
  r.dir = vec2<f32>(0.5, -0.25);
  advance(&r, (b - a));
  var w: array<f32, 3> = array<f32, 3>(a, b, 0.5);
  liftAll(&w, 0.25);
  var basis: mat2x2<f32> = mat2x2<f32>(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0));
  basis[1] = (basis[1] * 0.5);
  let q = (basis * (v.uv - vec2<f32>(0.5, 0.5)));
  return Color(vec4<f32>(fract((r.origin.x * 3.0)), (w[0] * w[1]), (w[2] * (1.0 - length(q))), 1.0));
}

fn liftAll_liftAt(ws: ptr<function, array<f32, 3>>, k: f32, i: i32) {
  (*ws)[i] = mix((*ws)[i], 1.0, k);
}
