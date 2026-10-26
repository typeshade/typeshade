struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

struct _opt_vec2_f32_ {
  value: vec2<f32>,
  present: bool,
}

struct _opt_f32_ {
  value: f32,
  present: bool,
}

struct Hit {
  t: f32,
  normal: _opt_vec2_f32_,
  radius: _opt_f32_,
}

fn Hit_new() -> Hit {
  var self_: Hit = Hit(0.0, _opt_vec2_f32_(vec2<f32>(0.0, 0.0), false), _opt_f32_(0.0, false));
  return self_;
}

fn intersect(o: vec2<f32>, d: vec2<f32>, r: f32) -> Hit {
  var h: Hit = Hit_new();
  let b = dot(o, d);
  let c = (dot(o, o) - (r * r));
  let disc = ((b * b) - c);
  h.t = 1000.0;
  h.radius = _opt_f32_(r, true);
  if ((disc < 0.0)) {
    return h;
  }
  let t = ((-b) - sqrt(disc));
  if ((t < 0.0)) {
    h.t = 0.0;
    return h;
  }
  h.t = t;
  h.normal = _opt_vec2_f32_(normalize((o + (d * t))), true);
  return h;
}

fn circle(t: f32) -> Hit {
  return Hit(t, _opt_vec2_f32_(vec2<f32>(0.0, 0.0), false), _opt_f32_(0.0, false));
}

fn shadeOf(h: Hit, light: vec2<f32>) -> f32 {
  let _cse0 = select(0.0, h.radius.value, h.radius.present);
  if (h.normal.present) {
    return (max(dot(h.normal.value, light), 0.0) + (_cse0 * 0.1));
  }
  return ((h.t * 0.5) + _cse0);
}

fn clampTo(x: f32, limit: _opt_f32_) -> f32 {
  if ((limit.present == false)) {
    return x;
  }
  return min(x, limit.value);
}

fn sampleAll(samples: array<_opt_f32_, 4>) -> f32 {
  var s: f32 = 0.0;
  for (var i: i32 = 0; (i < 4); i = (i + 1)) {
    s += select(0.0, samples[i].value, samples[i].present);
  }
  return s;
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
  let o = ((v.uv * 2.0) - vec2<f32>(1.0, 1.0));
  let _cse0 = vec2<f32>(0.0, 1.0);
  let hit = intersect((o - vec2<f32>(0.0, 2.0)), _cse0, 0.5);
  let flat = circle(v.uv.x);
  let r = shadeOf(hit, normalize(vec2<f32>(0.3, 1.0)));
  let g = shadeOf(flat, _cse0);
  let _cse1 = _opt_f32_(0.0, false);
  let samples = array<_opt_f32_, 4>(_opt_f32_(v.uv.x, true), _cse1, _opt_f32_(v.uv.y, true), _cse1);
  let b = (clampTo(sampleAll(samples), _opt_f32_(0.75, true)) + clampTo((v.uv.x * 0.1), _cse1));
  return Color(vec4<f32>(r, g, b, 1.0));
}
