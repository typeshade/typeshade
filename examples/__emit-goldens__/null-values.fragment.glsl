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
Sample Sample_new(_opt_f32_ value) {
  Sample self_ = Sample(_opt_f32_(0.0, false));
  self_.value = value;
  return self_;
}

_opt_Sample_ sample_(float x) {
  _opt_f32_ _cse0 = _opt_f32_(0.0, false);
  if ((x < 0.333)) {
    return _opt_Sample_(Sample(_cse0), false);
  }
  _opt_f32_ _sel0;
  if ((x < 0.666)) {
    _sel0 = _cse0;
  } else {
    _sel0 = _opt_f32_(x, true);
  }
  return _opt_Sample_(Sample_new(_sel0), true);
}

vec3 tint(_opt3_f32_ value) {
  bool _cse0 = (value.present == false);
  if ((_cse0 && (value.isNull == false))) {
    return vec3(0.8, 0.1, 0.1);
  }
  if ((_cse0 && value.isNull)) {
    return vec3(0.1, 0.8, 0.1);
  }
  return vec3(0.1, 0.1, value.value);
}

_opt3_f32_ _flow3_fused(Sample _flow0_input) {
  _opt_f32_ _flow6_whole = _flow0_input.value;
  float _flow4_part = _flow6_whole.value;
  bool _flow5_part = _flow6_whole.present;
  return _opt3_f32_(_flow4_part, _flow5_part, true);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  _opt_Sample_ _opt = sample_(uv.x);
  _opt3_f32_ _sel1;
  if (_opt.present) {
    _sel1 = _flow3_fused(_opt.value);
  } else {
    _sel1 = _opt3_f32_(0.0, false, false);
  }
  _opt3_f32_ value = _sel1;
  color = vec4(tint(value), 1.0);
}
