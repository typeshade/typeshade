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
  float _i5ret = 0.0;
  _opt_f32_ _gv0 = root(x);
  if ((_gv0.present == false)) {
    _i5ret = 0.0;
  } else {
    _i5ret = _gv0.value;
  }
  float _i6a0 = uv.x;
  float _i6ret = 0.0;
  float _gv1 = (_i6a0 * 0.5);
  if ((true == false)) {
    _i6ret = 0.0;
  } else {
    _i6ret = _gv1;
  }
  float r = (_i5ret + _i6ret);
  float _i1a0 = uv.y;
  _opt_f32_ _i1ret;
  if ((_i1a0 <= 0.0)) {
    _i1ret = _cse0;
  } else {
    _i1ret = _opt_f32_((_i1a0 * 0.5), true);
  }
  float _i2ret;
  if ((_gv0.present && _i1ret.present)) {
    _i2ret = min(_gv0.value, _i1ret.value);
  } else {
    _opt_f32_ _sel0;
    if (_gv0.present) {
      _sel0 = _gv0;
    } else {
      _sel0 = _i1ret;
    }
    _opt_f32_ _i2_opt = _sel0;
    _i2ret = (_i2_opt.present ? _i2_opt.value : 1000.0);
  }
  float g = (_i2ret * (shade.present ? shade.value : 0.25));
  vec2 o = ((uv * 2.0) - vec2(1.0, 1.0));
  vec2 _i3a0 = (o - vec2(0.0, 2.0));
  vec2 _i3a1 = vec2(0.0, 1.0);
  _opt_Hit_ _i3ret = _opt_Hit_(Hit(0.0, vec2(0.0)), false);
  float _i3_b = dot(_i3a0, _i3a1);
  float _i3_c = (dot(_i3a0, _i3a0) - 0.25);
  float _i3_disc = ((_i3_b * _i3_b) - _i3_c);
  vec2 _cse3 = vec2(0.0, 0.0);
  Hit _cse2 = Hit(0.0, _cse3);
  _opt_Hit_ _cse1 = _opt_Hit_(_cse2, false);
  if ((_i3_disc < 0.0)) {
    _i3ret = _cse1;
  } else {
    float _i3_t = ((-_i3_b) - sqrt(_i3_disc));
    if ((_i3_t < 0.0)) {
      _i3ret = _cse1;
    } else {
      Hit _i3_h = _cse2;
      _i3_h.t = _i3_t;
      _i3_h.normal = normalize((_i3a0 + (_i3a1 * _i3_t)));
      _i3ret = _opt_Hit_(_i3_h, true);
    }
  }
  _opt_Hit_ hit = _i3ret;
  float _i4ret = (hit.present ? hit.value.t : 0.0);
  vec2 n = (hit.present ? hit.value.normal : _cse3);
  color = vec4(r, g, ((_i4ret * 0.5) + (n.x * 0.25)), 1.0);
}
