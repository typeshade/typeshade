#version 300 es
precision highp float;
precision highp int;

struct _opt_f32_ {
  float value;
  bool present;
};

struct Sample {
  _opt_f32_ value;
};

struct _opt3_f32_ {
  float value;
  bool present;
  bool isNull;
};

struct _opt_Sample_ {
  Sample value;
  bool present;
};
_opt3_f32_ _opt_widen_struct_opt_f32_2_f32_(_opt_f32_ v0) {
  return _opt3_f32_(v0.value, v0.present, true);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float _i1a0 = uv.x;
  _opt_Sample_ _i1ret = _opt_Sample_(Sample(_opt_f32_(0.0, false)), false);
  _opt_f32_ _cse1 = _opt_f32_(0.0, false);
  Sample _cse0 = Sample(_cse1);
  if ((_i1a0 < 0.333)) {
    _i1ret = _opt_Sample_(_cse0, false);
  } else {
    _opt_f32_ _sel0;
    if ((_i1a0 < 0.666)) {
      _sel0 = _cse1;
    } else {
      _sel0 = _opt_f32_(_i1a0, true);
    }
    _opt_f32_ _i1_a0 = _sel0;
    Sample _i1_self_ = _cse0;
    _i1_self_.value = _i1_a0;
    _i1ret = _opt_Sample_(_i1_self_, true);
  }
  _opt_Sample_ _opt = _i1ret;
  _opt3_f32_ _sel1;
  if (_opt.present) {
    _sel1 = _opt_widen_struct_opt_f32_2_f32_(_opt.value.value);
  } else {
    _sel1 = _opt3_f32_(0.0, false, false);
  }
  _opt3_f32_ value = _sel1;
  vec3 _i2ret = vec3(0.0);
  bool _gv0 = (value.present == false);
  if ((_gv0 && (value.isNull == false))) {
    _i2ret = vec3(0.8, 0.1, 0.1);
  } else {
    if ((_gv0 && value.isNull)) {
      _i2ret = vec3(0.1, 0.8, 0.1);
    } else {
      _i2ret = vec3(0.1, 0.1, value.value);
    }
  }
  color = vec4(_i2ret, 1.0);
}
