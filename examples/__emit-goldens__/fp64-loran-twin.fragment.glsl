#version 300 es
precision highp float;
precision highp int;

struct DF64Vec2 {
  vec2 hi;
  vec2 lo;
};
layout(std140) uniform Uniforms {
  DF64Vec2 center;
  DF64Vec2 st_a;
  DF64Vec2 st_b;
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

vec2 df64_sqr(vec2 a, float _fp64_g) {
  vec2 _v0 = df64_twoSqr(a.x, _fp64_g);
  _v0.y = (_v0.y + ((a.x * a.y) * 2.0));
  return df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
}

vec2 df64_sqrt(vec2 a, float _fp64_g) {
  float _v0 = (_fp64_g / sqrt(a.x));
  float _v1 = (a.x * _v0);
  vec2 _v2 = (df64_twoSqr(_v1, _fp64_g) * _fp64_g);
  float _v3 = df64_sub(a, _v2, _fp64_g).x;
  vec2 _v4 = df64_twoProd((_v0 * 0.5), _v3, _fp64_g);
  vec2 _v5 = df64_add(vec2(_v1, 0.0), _v4, _fp64_g);
  return ((a.x == 0.0) ? vec2(0.0, 0.0) : _v5);
}

vec2 df64_floor(vec2 a, float _fp64_g) {
  float _v0 = floor(a.x);
  return ((_v0 == a.x) ? df64_quickTwoSum(_v0, floor(a.y), _fp64_g) : vec2(_v0, 0.0));
}

vec2 df64_fract(vec2 a, float _fp64_g) {
  return df64_sub(a, df64_floor(a, _fp64_g), _fp64_g);
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
  bool isF32 = (_cse0 || (u.fp64 < 0.5));
  vec2 _cse1 = vec2(u.center.hi.x, u.center.lo.x);
  vec2 _cse2 = vec2(u.center.hi.y, u.center.lo.y);
  vec2 _lc0 = df64_add(_cse1, vec2(dx, 0.0), _fp64_g);
  vec2 _lc1 = df64_add(_cse2, vec2(dy, 0.0), _fp64_g);
  DF64Vec2 pos = DF64Vec2(vec2(_lc0.x, _lc1.x), vec2(_lc0.y, _lc1.y));
  float _cse8 = uintBitsToFloat(floatBitsToUint(0.0));
  vec2 _cse3 = vec2(_cse8, _cse8);
  vec2 _cse4 = vec2(u.st_a.hi.x, u.st_a.lo.x);
  vec2 _cse5 = vec2(u.st_a.hi.y, u.st_a.lo.y);
  vec2 _gv0 = df64_add(vec2(pos.hi.x, pos.lo.x), _cse3, _fp64_g);
  vec2 _gv1 = df64_add(vec2(pos.hi.y, pos.lo.y), _cse3, _fp64_g);
  vec2 d1 = df64_sqrt(df64_add(df64_sqr(df64_sub(_gv0, df64_add(_cse4, _cse3, _fp64_g), _fp64_g), _fp64_g), df64_sqr(df64_sub(_gv1, df64_add(_cse5, _cse3, _fp64_g), _fp64_g), _fp64_g), _fp64_g), _fp64_g);
  vec2 _cse6 = vec2(u.st_b.hi.x, u.st_b.lo.x);
  vec2 _cse7 = vec2(u.st_b.hi.y, u.st_b.lo.y);
  vec2 d2 = df64_sqrt(df64_add(df64_sqr(df64_sub(_gv0, df64_add(_cse6, _cse3, _fp64_g), _fp64_g), _fp64_g), df64_sqr(df64_sub(_gv1, df64_add(_cse7, _cse3, _fp64_g), _fp64_g), _fp64_g), _fp64_g), _fp64_g);
  float th64 = df64_narrow(df64_fract((df64_sub(df64_add(d1, _cse3, _fp64_g), df64_add(d2, _cse3, _fp64_g), _fp64_g) * 0.25), _fp64_g));
  float te64 = df64_narrow(df64_fract((df64_add(d1, d2, _fp64_g) * 0.0625), _fp64_g));
  vec2 pos32 = vec2((df64_narrow(_cse1) + dx), (df64_narrow(_cse2) + dy));
  float d1f = length((pos32 - vec2(df64_narrow(_cse4), df64_narrow(_cse5))));
  float d2f = length((pos32 - vec2(df64_narrow(_cse6), df64_narrow(_cse7))));
  float th32 = fract(((d1f - d2f) * 0.25));
  float te32 = fract(((d1f + d2f) * 0.0625));
  float th = (isF32 ? th32 : th64);
  float te = (isF32 ? te32 : te64);
  float dh = min(th, (1.0 - th));
  float de = min(te, (1.0 - te));
  float aaH = ((fwidth(dh) * 1.2) + 0.0001);
  float aaE = ((fwidth(de) * 1.2) + 0.0001);
  float lineH = (1.0 - smoothstep(0.0, aaH, dh));
  float lineE = (1.0 - smoothstep(0.0, aaE, de));
  vec3 sea = mix(vec3(0.02, 0.07, 0.13), vec3(0.04, 0.12, 0.2), uv.y);
  vec3 rgb = (((sea + (vec3(0.0, 0.06, 0.08) * th)) + (vec3(0.25, 0.95, 0.95) * (lineH * 0.9))) + (vec3(0.95, 0.7, 0.25) * (lineE * 0.35)));
  _ret = vec4(rgb, 1.0);
}
