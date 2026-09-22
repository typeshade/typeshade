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

vec2 df64_floor(vec2 a) {
  float _v0 = floor(a.x);
  return ((_v0 == a.x) ? df64_quickTwoSum(_v0, floor(a.y)) : vec2(_v0, 0.0));
}

vec2 df64_fract(vec2 a) {
  return df64_sub(a, df64_floor(a));
}

float df64_narrow(vec2 a) {
  return (a.x + a.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float span = pow(10.0, (-u.zoom_exp));
  float half_ = (uv.x * 2.0);
  bool _cse0 = (uv.x < 0.5);
  float sx = (half_ - (_cse0 ? 0.0 : 1.0));
  float dx = ((sx - 0.5) * span);
  float dy = (((uv.y - 0.5) * span) * ((u.resolution.y / u.resolution.x) * 2.0));
  bool isF32 = (_cse0 || (u.fp64 < 0.5));
  vec2 _cse1 = vec2(u.center.hi.x, u.center.lo.x);
  vec2 px = df64_add(_cse1, vec2(dx, 0.0));
  vec2 _cse2 = vec2(u.center.hi.y, u.center.lo.y);
  vec2 py = df64_add(_cse2, vec2(dy, 0.0));
  float par64 = df64_narrow(df64_fract(df64_mul(df64_add(df64_floor(px), df64_floor(py)), vec2(0.5, 0.0))));
  float _cse4 = uintBitsToFloat(floatBitsToUint(0.0));
  vec2 _cse3 = vec2(_cse4, _cse4);
  float fx64 = df64_narrow(df64_fract(df64_add(px, _cse3)));
  float fy64 = df64_narrow(df64_fract(df64_add(py, _cse3)));
  float px32 = (df64_narrow(_cse1) + dx);
  float py32 = (df64_narrow(_cse2) + dy);
  float par32 = fract(((floor(px32) + floor(py32)) * 0.5));
  float fx32 = fract(px32);
  float fy32 = fract(py32);
  float par = (isF32 ? par32 : par64);
  float fx = (isF32 ? fx32 : fx64);
  float fy = (isF32 ? fy32 : fy64);
  float chk = step(0.25, par);
  float edge = min(min(fx, (1.0 - fx)), min(fy, (1.0 - fy)));
  float pixw = (span / (u.resolution.x * 0.5));
  float line = smoothstep(0.0, ((pixw * 1.5) + 1e-9), edge);
  vec3 ivory = vec3(0.93, 0.9, 0.82);
  vec3 slate = vec3(0.23, 0.29, 0.36);
  vec3 rgb = (mix(ivory, slate, chk) * mix(0.35, 1.0, line));
  _ret = vec4(rgb, 1.0);
}
