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

vec2 df64_abs(vec2 a) {
  return ((a.x < 0.0) ? (-a) : a);
}

float df64_narrow(vec2 a) {
  return (a.x + a.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float _fp64_g = texelFetch(_fp64, ivec2(0, 0), 0).x;
  float span = pow(10.0, (-u.zoom_exp));
  float half_ = (uv.x * 2.0);
  bool _cse0 = (uv.x < 0.5);
  float sx = (half_ - (_cse0 ? 0.0 : 1.0));
  float dx = ((sx - 0.5) * span);
  float dy = (((uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  float it = 0.0;
  float m2 = 0.0;
  vec2 _cse1 = vec2(u.center.hi.x, u.center.lo.x);
  vec2 _cse2 = vec2(u.center.hi.y, u.center.lo.y);
  if ((_cse0 || (u.fp64 < 0.5))) {
    float cx = (df64_narrow(_cse1) + dx);
    float cy = (df64_narrow(_cse2) + dy);
    float zx = 0.0;
    float zy = 0.0;
    float x2 = 0.0;
    float y2 = 0.0;
    for (uint j = 0u; (j < 128u); j = (j + 1u)) {
      if ((m2 > 16.0)) {
        break;
      }
      float nzx = ((x2 - y2) + cx);
      zy = ((abs((zx * zy)) * 2.0) + cy);
      zx = nzx;
      it = (it + 1.0);
      x2 = (zx * zx);
      y2 = (zy * zy);
      m2 = (x2 + y2);
    }
  } else {
    vec2 cx_1 = df64_add(_cse1, vec2(dx, 0.0), _fp64_g);
    vec2 cy_1 = df64_add(_cse2, vec2(dy, 0.0), _fp64_g);
    vec2 _cse3 = vec2(0.0, 0.0);
    vec2 zx_1 = _cse3;
    vec2 zy_1 = _cse3;
    for (uint j_1 = 0u; (j_1 < 128u); j_1 = (j_1 + 1u)) {
      if ((m2 > 16.0)) {
        break;
      }
      vec2 nzx_1 = df64_add(df64_sub(df64_sqr(zx_1, _fp64_g), df64_sqr(zy_1, _fp64_g), _fp64_g), cx_1, _fp64_g);
      zy_1 = df64_add((df64_abs(df64_mul(zx_1, zy_1, _fp64_g)) * 2.0), cy_1, _fp64_g);
      zx_1 = nzx_1;
      it = (it + 1.0);
      float hx = df64_narrow(zx_1);
      float hy = df64_narrow(zy_1);
      m2 = ((hx * hx) + (hy * hy));
    }
  }
  float sn = ((it - log2(max(log2(max(m2, 1.0001)), 0.0001))) + 1.0);
  float inside = step(127.5, it);
  float s = (sn * 0.0078125);
  float _gv0 = (s * s);
  float ease = (_gv0 * (3.0 - (s * 2.0)));
  vec3 rgb = (mix(mix(vec3(0.06, 0.02, 0.05), vec3(0.95, 0.45, 0.08), ease), vec3(1.0, 0.93, 0.75), _gv0) * (1.0 - inside));
  _ret = vec4(rgb, 1.0);
}
