#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  vec2 origin;
  float span;
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
  float _cse1 = (uv.x * u.span);
  float _cse0 = (((uv.x < 0.5) || (u.fp64 < 0.5)) ? fract((df64_narrow(u.origin) + _cse1)) : df64_narrow(df64_fract(df64_add(u.origin, vec2(_cse1, 0.0), _fp64_g), _fp64_g)));
  _ret = vec4(_cse0, _cse0, _cse0, 1.0);
}
