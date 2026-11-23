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
  _opt_f32_ _gv0 = root(x);
  float _i5ret = mix(_gv0.value, 0.0, (_gv0.present == false));
  float _i6a0 = uv.x;
  float _i6ret = mix((_i6a0 * 0.5), 0.0, (true == false));
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
    _i2ret = mix(1000.0, _i2_opt.value, _i2_opt.present);
  }
  float g = (_i2ret * mix(0.25, shade.value, shade.present));
  vec2 o = ((uv * 2.0) - vec2(1.0, 1.0));
  vec2 _i3a0 = (o - vec2(0.0, 2.0));
  vec2 _i3a1 = vec2(0.0, 1.0);
  _opt_Hit_ _i3ret = _opt_Hit_(Hit(0.0, vec2(0.0)), false);
  float _i3_b = dot(_i3a0, _i3a1);
  float _i3_c = (dot(_i3a0, _i3a0) - 0.25);
  float _i3_disc = ((_i3_b * _i3_b) - _i3_c);
  vec2 _cse2 = vec2(0.0, 0.0);
  _opt_Hit_ _cse1 = _opt_Hit_(Hit(0.0, _cse2), false);
  if ((_i3_disc < 0.0)) {
    _i3ret = _cse1;
  } else {
    float _i3_t = ((-_i3_b) - sqrt(_i3_disc));
    if ((_i3_t < 0.0)) {
      _i3ret = _cse1;
    } else {
      Hit _i3_h = Hit(_i3_t, normalize((_i3a0 + (_i3a1 * _i3_t))));
      _i3ret = _opt_Hit_(_i3_h, true);
    }
  }
  _opt_Hit_ hit = _i3ret;
  float _i4ret = mix(0.0, hit.value.t, hit.present);
  vec2 n = mix(_cse2, hit.value.normal, bvec2(hit.present));
  color = vec4(r, g, ((_i4ret * 0.5) + (n.x * 0.25)), 1.0);
}
