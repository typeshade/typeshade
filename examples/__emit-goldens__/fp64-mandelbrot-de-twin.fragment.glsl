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

uniform sampler2D _fp64;
vec2 df64_twoSum(float a, float b) {
  float _v0 = (a + b);
  float _cse0 = texelFetch(_fp64, ivec2(0, 0), 0).x;
  float _v1 = (((_v0 * _cse0) - a) * _cse0);
  float _v2 = (((((a - ((_v0 - _v1) * _cse0)) * _cse0) * _cse0) * _cse0) + (b - _v1));
  return vec2(_v0, _v2);
}

vec2 df64_quickTwoSum(float a, float b) {
  float _cse0 = texelFetch(_fp64, ivec2(0, 0), 0).x;
  float _v0 = ((a + b) * _cse0);
  float _v1 = (b - ((_v0 - a) * _cse0));
  return vec2(_v0, _v1);
}

vec2 df64_split(float a) {
  float _cse0 = texelFetch(_fp64, ivec2(0, 0), 0).x;
  float _v0 = (a * (_cse0 * 4097.0));
  float _v1 = ((_v0 * _cse0) - (_v0 - a));
  float _v2 = ((a * _cse0) - _v1);
  return vec2(_v1, _v2);
}

vec2 df64_twoProd(float a, float b) {
  float _v0 = (a * b);
  vec2 _v1 = df64_split(a);
  vec2 _v2 = df64_split(b);
  float _v3 = (((((_v1.x * _v2.x) - _v0) + (_v1.x * _v2.y)) + (_v1.y * _v2.x)) + (_v1.y * _v2.y));
  return vec2(_v0, _v3);
}

vec2 df64_add(vec2 a, vec2 b) {
  vec2 _v0 = df64_twoSum(a.x, b.x);
  vec2 _v1 = df64_twoSum(a.y, b.y);
  _v0.y = (_v0.y + _v1.x);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  _v0.y = (_v0.y + _v1.y);
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  return _v0;
}

vec2 df64_sub(vec2 a, vec2 b) {
  return df64_add(a, (-b));
}

vec2 df64_mul(vec2 a, vec2 b) {
  vec2 _v0 = df64_twoProd(a.x, b.x);
  _v0.y = (_v0.y + (a.x * b.y));
  _v0 = df64_quickTwoSum(_v0.x, _v0.y);
  _v0.y = (_v0.y + (a.y * b.x));
  return df64_quickTwoSum(_v0.x, _v0.y);
}

float df64_narrow(vec2 a) {
  return (a.x + a.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec2 _licm0 = vec2(2.0, 0.0);
  float span = pow(10.0, (-u.zoom_exp));
  float half_ = (uv.x * 2.0);
  bool _cse0 = (uv.x < 0.5);
  float sx = (half_ - (_cse0 ? 0.0 : 1.0));
  float dx = ((sx - 0.5) * span);
  float dy = (((uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  float m2f = 0.0;
  float dm2 = 1.0;
  vec2 _cse1 = vec2(u.center.hi.x, u.center.lo.x);
  vec2 _cse2 = vec2(u.center.hi.y, u.center.lo.y);
  if ((_cse0 || (u.fp64 < 0.5))) {
    float cx = (df64_narrow(_cse1) + dx);
    float cy = (df64_narrow(_cse2) + dy);
    float zx = 0.0;
    float zy = 0.0;
    float ux = 0.0;
    float uy = 0.0;
    for (uint j = 0u; (j < 160u); j = (j + 1u)) {
      if ((((zx * zx) + (zy * zy)) <= 1000000.0)) {
        float nux = ((((zx * ux) - (zy * uy)) * 2.0) + 1.0);
        uy = (((zx * uy) + (zy * ux)) * 2.0);
        ux = nux;
        float nzx = (((zx * zx) - (zy * zy)) + cx);
        zy = (((zx * zy) * 2.0) + cy);
        zx = nzx;
      }
    }
    m2f = ((zx * zx) + (zy * zy));
    dm2 = ((ux * ux) + (uy * uy));
  } else {
    vec2 cx_1 = df64_add(_cse1, vec2(dx, 0.0));
    vec2 cy_1 = df64_add(_cse2, vec2(dy, 0.0));
    vec2 _cse3 = vec2(0.0, 0.0);
    vec2 zx_1 = _cse3;
    vec2 zy_1 = _cse3;
    float ux_1 = 0.0;
    float uy_1 = 0.0;
    for (uint j_1 = 0u; (j_1 < 160u); j_1 = (j_1 + 1u)) {
      if ((df64_narrow(df64_add(df64_mul(zx_1, zx_1), df64_mul(zy_1, zy_1))) <= 1000000.0)) {
        float zx32 = df64_narrow(zx_1);
        float zy32 = df64_narrow(zy_1);
        float nux_1 = ((((zx32 * ux_1) - (zy32 * uy_1)) * 2.0) + 1.0);
        uy_1 = (((zx32 * uy_1) + (zy32 * ux_1)) * 2.0);
        ux_1 = nux_1;
        vec2 nzx_1 = df64_add(df64_sub(df64_mul(zx_1, zx_1), df64_mul(zy_1, zy_1)), cx_1);
        zy_1 = df64_add(df64_mul(df64_mul(zx_1, zy_1), _licm0), cy_1);
        zx_1 = nzx_1;
      }
    }
    m2f = df64_narrow(df64_add(df64_mul(zx_1, zx_1), df64_mul(zy_1, zy_1)));
    dm2 = ((ux_1 * ux_1) + (uy_1 * uy_1));
  }
  float mz = sqrt(max(m2f, 1.0));
  float de = (((mz * log(mz)) * 0.5) / sqrt(max(dm2, 1e-30)));
  float t = min((de / (span * 0.012)), 40.0);
  float escaped = ((m2f > 1000000.0) ? 1.0 : 0.0);
  float _gv0 = (-t);
  float glow = (exp((_gv0 * 1.2)) * escaped);
  float body = (exp((_gv0 * 0.25)) * escaped);
  vec3 rgb = ((vec3(0.02, 0.03, 0.08) + (vec3(0.12, 0.2, 0.42) * body)) + (vec3(1.0, 0.85, 0.45) * glow));
  _ret = vec4(rgb, 1.0);
}
