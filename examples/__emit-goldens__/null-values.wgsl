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

fn _opt_widen_struct_opt_f32_2_f32__into(_dst: ptr<function, _opt3_f32_>, v0: ptr<function, _opt_f32_>) {
  (*_dst) = _opt3_f32_((*v0).value, (*v0).present, true);
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
  let _sm1_a0 = v.uv.x;
  var _sm1_ret: _opt_Sample_;
  var _cse1: _opt_f32_ = _opt_f32_(0.0, false);
  var _cse0: Sample = Sample(_cse1);
  if ((_sm1_a0 < 0.333)) {
    _sm1_ret = _opt_Sample_(_cse0, false);
  } else {
    var _sm1_l_sm0_a0: _opt_f32_;
    if ((_sm1_a0 < 0.666)) {
      _sm1_l_sm0_a0 = _cse1;
    } else {
      _sm1_l_sm0_a0 = _opt_f32_(_sm1_a0, true);
    }
    var _sm1_l_sm0_l_self_: Sample = _cse0;
    _sm1_l_sm0_l_self_.value = _sm1_l_sm0_a0;
    _sm1_ret = _opt_Sample_(_sm1_l_sm0_l_self_, true);
  }
  var _opt: _opt_Sample_ = _sm1_ret;
  var value: _opt3_f32_;
  if (_opt.present) {
    _opt_widen_struct_opt_f32_2_f32__into(&value, &_opt.value.value);
  } else {
    value = _opt3_f32_(0.0, false, false);
  }
  var _sm2_ret: vec3<f32>;
  let _gv0 = (value.present == false);
  if ((_gv0 && (value.isNull == false))) {
    _sm2_ret = vec3<f32>(0.8, 0.1, 0.1);
  } else {
    if ((_gv0 && value.isNull)) {
      _sm2_ret = vec3<f32>(0.1, 0.8, 0.1);
    } else {
      _sm2_ret = vec3<f32>(0.1, 0.1, value.value);
    }
  }
  return Color(vec4<f32>(_sm2_ret, 1.0));
}
