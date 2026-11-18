#version 300 es
precision highp float;
precision highp int;

struct Hit {
  float t;
  vec2 normal;
};

struct _opt_f32_ {
  float value;
  bool present;
};

struct _opt_Hit_ {
  Hit value;
  bool present;
};
_opt_f32_ root(float x) {
  if ((x < 0.0)) {
    return _opt_f32_(0.0, false);
  }
  return _opt_f32_(sqrt(x), true);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float x = ((uv.x * 2.0) - 1.0);
  _opt_f32_ _cse0 = _opt_f32_(0.0, false);
  _opt_f32_ shade;
  if ((uv.y > 0.5)) {
    shade = _opt_f32_(uv.y, true);
  } else {
    shade = _cse0;
  }
  float _sm5_ret = 0.0;
  _opt_f32_ _gv0 = root(x);
  if ((_gv0.present == false)) {
    _sm5_ret = 0.0;
  } else {
    _sm5_ret = _gv0.value;
  }
  float _sm6_a0 = uv.x;
  float _sm6_ret = 0.0;
  float _gv1 = (_sm6_a0 * 0.5);
  if ((true == false)) {
    _sm6_ret = 0.0;
  } else {
    _sm6_ret = _gv1;
  }
  float r = (_sm5_ret + _sm6_ret);
  float _sm1_a0 = uv.y;
  _opt_f32_ _sm1_ret;
  if ((_sm1_a0 <= 0.0)) {
    _sm1_ret = _cse0;
  } else {
    _sm1_ret = _opt_f32_((_sm1_a0 * 0.5), true);
  }
  float _sm2_ret;
  if ((_gv0.present && _sm1_ret.present)) {
    _sm2_ret = min(_gv0.value, _sm1_ret.value);
  } else {
    _opt_f32_ _sel0;
    if (_gv0.present) {
      _sel0 = _gv0;
    } else {
      _sel0 = _sm1_ret;
    }
    _opt_f32_ _sm2_l_opt = _sel0;
    _sm2_ret = (_sm2_l_opt.present ? _sm2_l_opt.value : 1000.0);
  }
  float g = (_sm2_ret * (shade.present ? shade.value : 0.25));
  vec2 o = ((uv * 2.0) - vec2(1.0, 1.0));
  vec2 _sm3_a0 = (o - vec2(0.0, 2.0));
  vec2 _sm3_a1 = vec2(0.0, 1.0);
  _opt_Hit_ _sm3_ret = _opt_Hit_(Hit(0.0, vec2(0.0)), false);
  float _sm3_l_b = dot(_sm3_a0, _sm3_a1);
  float _sm3_l_c = (dot(_sm3_a0, _sm3_a0) - 0.25);
  float _sm3_l_disc = ((_sm3_l_b * _sm3_l_b) - _sm3_l_c);
  vec2 _cse3 = vec2(0.0, 0.0);
  Hit _cse2 = Hit(0.0, _cse3);
  _opt_Hit_ _cse1 = _opt_Hit_(_cse2, false);
  if ((_sm3_l_disc < 0.0)) {
    _sm3_ret = _cse1;
  } else {
    float _sm3_l_t = ((-_sm3_l_b) - sqrt(_sm3_l_disc));
    if ((_sm3_l_t < 0.0)) {
      _sm3_ret = _cse1;
    } else {
      Hit _sm3_l_h = _cse2;
      _sm3_l_h.t = _sm3_l_t;
      _sm3_l_h.normal = normalize((_sm3_a0 + (_sm3_a1 * _sm3_l_t)));
      _sm3_ret = _opt_Hit_(_sm3_l_h, true);
    }
  }
  _opt_Hit_ hit = _sm3_ret;
  float _sm4_ret = (hit.present ? hit.value.t : 0.0);
  vec2 n = (hit.present ? hit.value.normal : _cse3);
  color = vec4(r, g, ((_sm4_ret * 0.5) + (n.x * 0.25)), 1.0);
}
