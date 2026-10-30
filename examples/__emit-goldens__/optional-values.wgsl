struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

struct Hit {
  t: f32,
  normal: vec2<f32>,
}

struct _opt_f32_ {
  value: f32,
  present: bool,
}

struct _opt_Hit_ {
  value: Hit,
  present: bool,
}

struct _opt_vec2_f32_ {
  value: vec2<f32>,
  present: bool,
}

fn Hit_new_into(_dst: ptr<function, Hit>) {
  (*_dst) = Hit(0.0, vec2<f32>(0.0, 0.0));
}

fn root(x: f32) -> _opt_f32_ {
  if ((x < 0.0)) {
    return _opt_f32_(0.0, false);
  }
  return _opt_f32_(sqrt(x), true);
}

fn root_into(_dst: ptr<function, _opt_f32_>, x: f32) {
  if ((x < 0.0)) {
    (*_dst) = _opt_f32_(0.0, false);
    return;
  }
  (*_dst) = _opt_f32_(sqrt(x), true);
}

fn ramp(x: f32) -> f32 {
  return (x * 0.5);
}

fn halfOf(x: f32) -> _opt_f32_ {
  if ((x <= 0.0)) {
    return _opt_f32_(0.0, false);
  }
  return _opt_f32_((x * 0.5), true);
}

fn nearest(a: _opt_f32_, b: _opt_f32_) -> f32 {
  if ((a.present && b.present)) {
    return min(a.value, b.value);
  }
  var _sel0: _opt_f32_;
  if (a.present) {
    _sel0 = a;
  } else {
    _sel0 = b;
  }
  var _opt: _opt_f32_ = _sel0;
  return select(1000.0, _opt.value, _opt.present);
}

fn intersect(o: vec2<f32>, d: vec2<f32>, r: f32) -> _opt_Hit_ {
  let b = dot(o, d);
  let c = (dot(o, o) - (r * r));
  let disc = ((b * b) - c);
  var _cse0: _opt_Hit_ = _opt_Hit_(Hit(0.0, vec2<f32>(0.0, 0.0)), false);
  if ((disc < 0.0)) {
    return _cse0;
  }
  let t = ((-b) - sqrt(disc));
  if ((t < 0.0)) {
    return _cse0;
  }
  var h: Hit;
  Hit_new_into(&h);
  h.t = t;
  h.normal = normalize((o + (d * t)));
  return _opt_Hit_(h, true);
}

fn offsetOf(h: ptr<function, _opt_Hit_>, far: f32) -> f32 {
  var _opt: _opt_f32_ = _opt_f32_((*h).value.t, (*h).present);
  return select(far, _opt.value, _opt.present);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), ((p * 0.5) + vec2<f32>(0.5, 0.5)));
}

fn sampleOr_root(x: f32, fallback: f32) -> f32 {
  var v: _opt_f32_;
  root_into(&v, x);
  if ((v.present == false)) {
    return fallback;
  }
  return v.value;
}

fn sampleOr_ramp(x: f32, fallback: f32) -> f32 {
  var v: _opt_f32_ = _opt_f32_(ramp(x), true);
  if ((v.present == false)) {
    return fallback;
  }
  return v.value;
}

@fragment
fn fs(v: VsOut) -> Color {
  let x = ((v.uv.x * 2.0) - 1.0);
  var shade: _opt_f32_ = _opt_f32_(0.0, false);
  if ((v.uv.y > 0.5)) {
    shade = _opt_f32_(v.uv.y, true);
  }
  let r = (sampleOr_root(x, 0.0) + sampleOr_ramp(v.uv.x, 0.0));
  let g = (nearest(root(x), halfOf(v.uv.y)) * select(0.25, shade.value, shade.present));
  let o = ((v.uv * 2.0) - vec2<f32>(1.0, 1.0));
  var hit: _opt_Hit_ = intersect((o - vec2<f32>(0.0, 2.0)), vec2<f32>(0.0, 1.0), 0.5);
  let b = offsetOf(&hit, 0.0);
  var _opt: _opt_vec2_f32_ = _opt_vec2_f32_(hit.value.normal, hit.present);
  let n = select(vec2<f32>(0.0, 0.0), _opt.value, _opt.present);
  return Color(vec4<f32>(r, g, ((b * 0.5) + (n.x * 0.25)), 1.0));
}
