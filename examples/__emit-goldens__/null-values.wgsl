struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Color {
  @location(0) color: vec4<f32>,
}

struct _opt_f32_ {
  value: f32,
  present: bool,
}

struct Sample {
  value: _opt_f32_,
}

struct _opt3_f32_ {
  value: f32,
  present: bool,
  isNull: bool,
}

struct _opt_Sample_ {
  value: Sample,
  present: bool,
}

fn _opt_widen_struct_opt_f32_2_f32__into(_dst: ptr<function, _opt3_f32_>, v0: _opt_f32_) {
  (*_dst) = _opt3_f32_(v0.value, v0.present, true);
}

fn Sample_get_amount(self_: Sample) -> _opt_f32_ {
  return self_.value;
}

fn Sample_new(value: ptr<function, _opt_f32_>) -> Sample {
  var self_: Sample = Sample(_opt_f32_(0.0, false));
  self_.value = (*value);
  return self_;
}

fn sample(x: f32) -> _opt_Sample_ {
  let _cse0 = _opt_f32_(0.0, false);
  if ((x < 0.333)) {
    return _opt_Sample_(Sample(_cse0), false);
  }
  var _sel0: _opt_f32_;
  if ((x < 0.666)) {
    _sel0 = _cse0;
  } else {
    _sel0 = _opt_f32_(x, true);
  }
  return _opt_Sample_(Sample_new(&_sel0), true);
}

fn tint(value: _opt3_f32_) -> vec3<f32> {
  let _cse0 = (value.present == false);
  if ((_cse0 && (value.isNull == false))) {
    return vec3<f32>(0.8, 0.1, 0.1);
  }
  if ((_cse0 && value.isNull)) {
    return vec3<f32>(0.1, 0.8, 0.1);
  }
  return vec3<f32>(0.1, 0.1, value.value);
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
  let _opt = sample(v.uv.x);
  var _sel1: _opt3_f32_;
  if (_opt.present) {
    _opt_widen_struct_opt_f32_2_f32__into(&_sel1, Sample_get_amount(_opt.value));
  } else {
    _sel1 = _opt3_f32_(0.0, false, false);
  }
  let value = _sel1;
  return Color(vec4<f32>(tint(value), 1.0));
}
