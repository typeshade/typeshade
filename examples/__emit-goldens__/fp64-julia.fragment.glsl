#version 300 es
precision highp float;
precision highp int;

struct DF64Vec2 {
  vec2 hi;
  vec2 lo;
};
layout(std140) uniform Uniforms {
  DF64Vec2 center;
  vec2 resolution;
  float zoom_exp;
  float fp64;
} u;

uniform highp sampler2D _fp64;
vec2 df64_twoSum(float a, float b, float _fp64_g) {
  float _v0 = (a + b);
  float _v1 = (((_v0 * _fp64_g) - a) * _fp64_g);
  float _v2 = (((a - ((_v0 - _v1) * _fp64_g)) * _fp64_g) + (b - _v1));
  return vec2(_v0, _v2);
}

vec2 df64_quickTwoSum(float a, float b, float _fp64_g) {
  float _v0 = ((a + b) * _fp64_g);
  float _v1 = (b - ((_v0 - a) * _fp64_g));
  return vec2(_v0, _v1);
}

vec2 df64_split(float a, float _fp64_g) {
  float _v0 = (a * (_fp64_g * 4097.0));
  float _v1 = ((_v0 * _fp64_g) - (_v0 - a));
  float _v2 = ((a * _fp64_g) - _v1);
  return vec2(_v1, _v2);
}

vec2 df64_twoProd(float a, float b, float _fp64_g) {
  float _v0 = (a * b);
  vec2 _v1 = df64_split(a, _fp64_g);
  vec2 _v2 = df64_split(b, _fp64_g);
  float _v3 = (((((_v1.x * _v2.x) - _v0) + (_v1.x * _v2.y)) + (_v1.y * _v2.x)) + (_v1.y * _v2.y));
  return vec2(_v0, _v3);
}

vec2 df64_twoSqr(float a, float _fp64_g) {
  float _v0 = (a * a);
  vec2 _v1 = df64_split(a, _fp64_g);
  float _v2 = (((((_v1.x * _v1.x) - _v0) * _fp64_g) + (((_v1.x * _v1.y) * 2.0) * _fp64_g)) + ((_v1.y * _v1.y) * _fp64_g));
  return vec2(_v0, _v2);
}

vec2 df64_add(vec2 a, vec2 b, float _fp64_g) {
  vec2 _v0 = df64_twoSum(a.x, b.x, _fp64_g);
  vec2 _v1 = df64_twoSum(a.y, b.y, _fp64_g);
  _v0.y = (_v0.y + _v1.x);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  _v0.y = (_v0.y + _v1.y);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  return _v0;
}

vec2 df64_sub(vec2 a, vec2 b, float _fp64_g) {
  return df64_add(a, (-b), _fp64_g);
}

vec2 df64_mul(vec2 a, vec2 b, float _fp64_g) {
  vec2 _v0 = df64_twoProd(a.x, b.x, _fp64_g);
  _v0.y = (_v0.y + (a.x * b.y));
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  _v0.y = (_v0.y + (a.y * b.x));
  return df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
}

vec2 df64_sqr(vec2 a, float _fp64_g) {
  vec2 _v0 = df64_twoSqr(a.x, _fp64_g);
  _v0.y = (_v0.y + ((a.x * a.y) * 2.0));
  return df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
}

float df64_narrow(vec2 a) {
  return (a.x + a.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float _fp64_g = texelFetch(_fp64, ivec2(0, 0), 0).x;
  vec2 _licm0 = vec2(-0.800000011920929, 1.1920929132713809e-8);
  vec2 _licm1 = vec2(0.15600000321865082, -3.218650901359865e-9);
  float _v0 = pow(10.0, (-u.zoom_exp));
  float _v1 = (uv.x * 2.0);
  bool _cse0 = (uv.x < 0.5);
  float _v2 = (_v1 - (_cse0 ? 0.0 : 1.0));
  float _v3 = ((_v2 - 0.5) * _v0);
  float _v4 = (((uv.y - 0.5) * _v0) * ((u.resolution.y / u.resolution.x) * 2.0));
  float _v5 = 0.0;
  float _v6 = 0.0;
  vec2 _cse1 = vec2(u.center.hi.x, u.center.lo.x);
  vec2 _cse2 = vec2(u.center.hi.y, u.center.lo.y);
  if ((_cse0 || (u.fp64 < 0.5))) {
    float _v7 = (df64_narrow(_cse1) + _v3);
    float _v8 = (df64_narrow(_cse2) + _v4);
    float _v9 = (_v7 * _v7);
    float _v10 = (_v8 * _v8);
    _v6 = (_v9 + _v10);
    for (uint _v11 = 0u; (_v11 < 128u); _v11 = (_v11 + 1u)) {
      if ((_v6 > 16.0)) {
        break;
      }
      float _v12 = ((_v9 - _v10) + -0.8);
      _v8 = (((_v7 * _v8) * 2.0) + 0.156);
      _v7 = _v12;
      _v5 = (_v5 + 1.0);
      _v9 = (_v7 * _v7);
      _v10 = (_v8 * _v8);
      _v6 = (_v9 + _v10);
    }
  } else {
    vec2 _v13 = df64_add(_cse1, vec2(_v3, 0.0), _fp64_g);
    vec2 _v14 = df64_add(_cse2, vec2(_v4, 0.0), _fp64_g);
    float _v15 = df64_narrow(_v13);
    float _v16 = df64_narrow(_v14);
    _v6 = ((_v15 * _v15) + (_v16 * _v16));
    for (uint _v17 = 0u; (_v17 < 128u); _v17 = (_v17 + 1u)) {
      if ((_v6 > 16.0)) {
        break;
      }
      vec2 _v18 = df64_add(df64_sub(df64_sqr(_v13, _fp64_g), df64_sqr(_v14, _fp64_g), _fp64_g), _licm0, _fp64_g);
      _v14 = df64_add((df64_mul(_v13, _v14, _fp64_g) * 2.0), _licm1, _fp64_g);
      _v13 = _v18;
      _v5 = (_v5 + 1.0);
      float _v19 = df64_narrow(_v13);
      float _v20 = df64_narrow(_v14);
      _v6 = ((_v19 * _v19) + (_v20 * _v20));
    }
  }
  float _v21 = ((_v5 - log2(max(log2(max(_v6, 1.0001)), 0.0001))) + 1.0);
  float _v22 = step(127.5, _v5);
  float _v23 = (_v21 * 0.0078125);
  _ret = vec4((((vec3(0.5) + (cos(((vec3(0.0, 0.25, 0.6) + (_v23 * 5.5)) + 2.2)) * 0.5)) * mix(0.35, 1.0, _v23)) * (1.0 - _v22)), 1.0);
}
