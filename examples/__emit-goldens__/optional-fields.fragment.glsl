#version 300 es
precision highp float;
precision highp int;

struct _opt_vec2_f32_ {
  vec2 value;
  bool present;
};

struct _opt_f32_ {
  float value;
  bool present;
};

struct Hit {
  float t;
  _opt_vec2_f32_ normal;
  _opt_f32_ radius;
};
float shadeOf(Hit h, vec2 light) {
  float _cse0 = (h.radius.present ? h.radius.value : 0.0);
  if (h.normal.present) {
    return (max(dot(h.normal.value, light), 0.0) + (_cse0 * 0.1));
  }
  return ((h.t * 0.5) + _cse0);
}

float clampTo(float x, _opt_f32_ limit) {
  if ((limit.present == false)) {
    return x;
  }
  return min(x, limit.value);
}

float sampleAll(_opt_f32_[4] samples) {
  float s_1 = (samples[0].present ? samples[0].value : 0.0);
  float s_2 = (s_1 + (samples[1].present ? samples[1].value : 0.0));
  float s_3 = (s_2 + (samples[2].present ? samples[2].value : 0.0));
  float s_4 = (s_3 + (samples[3].present ? samples[3].value : 0.0));
  return s_4;
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 o = ((uv * 2.0) - vec2(1.0, 1.0));
  vec2 _sm1_a0 = (o - vec2(0.0, 2.0));
  vec2 _cse0 = vec2(0.0, 1.0);
  Hit _sm1_ret = Hit(0.0, _opt_vec2_f32_(vec2(0.0), false), _opt_f32_(0.0, false));
  _opt_vec2_f32_ _cse1 = _opt_vec2_f32_(vec2(0.0, 0.0), false);
  _opt_f32_ _cse2 = _opt_f32_(0.0, false);
  Hit _sm1_l_h = Hit(0.0, _cse1, _cse2);
  float _sm1_l_b = dot(_sm1_a0, _cse0);
  float _sm1_l_c = (dot(_sm1_a0, _sm1_a0) - 0.25);
  float _sm1_l_disc = ((_sm1_l_b * _sm1_l_b) - _sm1_l_c);
  _sm1_l_h.t = 1000.0;
  _sm1_l_h.radius = _opt_f32_(0.5, true);
  if ((_sm1_l_disc < 0.0)) {
    _sm1_ret = _sm1_l_h;
  } else {
    float _sm1_l_t = ((-_sm1_l_b) - sqrt(_sm1_l_disc));
    if ((_sm1_l_t < 0.0)) {
      _sm1_l_h.t = 0.0;
      _sm1_ret = _sm1_l_h;
    } else {
      _sm1_l_h.t = _sm1_l_t;
      _sm1_l_h.normal = _opt_vec2_f32_(normalize((_sm1_a0 + (_cse0 * _sm1_l_t))), true);
      _sm1_ret = _sm1_l_h;
    }
  }
  Hit hit = _sm1_ret;
  Hit flat_ = Hit(uv.x, _cse1, _cse2);
  float r = shadeOf(hit, normalize(vec2(0.3, 1.0)));
  float g = shadeOf(flat_, _cse0);
  _opt_f32_[4] samples = _opt_f32_[4](_opt_f32_(uv.x, true), _cse2, _opt_f32_(uv.y, true), _cse2);
  float b = (clampTo(sampleAll(samples), _opt_f32_(0.75, true)) + clampTo((uv.x * 0.1), _cse2));
  color = vec4(r, g, b, 1.0);
}
