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
  let _i1a0 = v.uv.x;
  var _i1ret: _opt_Sample_;
  var _cse1: _opt_f32_ = _opt_f32_(0.0, false);
  var _cse0: Sample = Sample(_cse1);
  if ((_i1a0 < 0.333)) {
    _i1ret = _opt_Sample_(_cse0, false);
  } else {
    var _sel0: _opt_f32_;
    if ((_i1a0 < 0.666)) {
      _sel0 = _cse1;
    } else {
      _sel0 = _opt_f32_(_i1a0, true);
    }
    var _i1_a0: _opt_f32_ = _sel0;
    var _i1_self_: Sample = _cse0;
    _i1_self_.value = _i1_a0;
    _i1ret = _opt_Sample_(_i1_self_, true);
  }
  var _opt: _opt_Sample_ = _i1ret;
  var _sel1: _opt3_f32_;
  if (_opt.present) {
    _opt_widen_struct_opt_f32_2_f32__into(&_sel1, &_opt.value.value);
  } else {
    _sel1 = _opt3_f32_(0.0, false, false);
  }
  var value: _opt3_f32_ = _sel1;
  let _gv0 = (value.present == false);
  let _i2ret = select(select(vec3<f32>(0.1, 0.1, value.value), vec3<f32>(0.1, 0.8, 0.1), (_gv0 && value.isNull)), vec3<f32>(0.8, 0.1, 0.1), (_gv0 && (value.isNull == false)));
  return Color(vec4<f32>(_i2ret, 1.0));
}
