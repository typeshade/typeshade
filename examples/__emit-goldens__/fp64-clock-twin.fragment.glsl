#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  vec2 epoch;
  float speed;
  float fp64;
} U;

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
  float phase64 = df64_narrow(df64_fract(df64_mul(df64_add(U.epoch, vec2(U.time, 0.0)), vec2(U.speed, 0.0))));
  float phase32 = fract(((df64_narrow(U.epoch) + U.time) * U.speed));
  bool _cse0 = (uv.x < 0.5);
  bool isF32 = (_cse0 || (U.fp64 < 0.5));
  float phase = (isF32 ? phase32 : phase64);
  float halfUv = (uv.x * 2.0);
  float sx = (halfUv - (_cse0 ? 0.0 : 1.0));
  vec2 c = vec2((((sx * 2.0) - 1.0) * ((U.resolution.x * 0.5) / U.resolution.y)), ((uv.y * 2.0) - 1.0));
  float r = length(c);
  float a01 = fract((0.25 - (atan(c.y, c.x) / 6.283185307179586)));
  float px = (2.0 / U.resolution.y);
  float bezel = (1.0 - smoothstep((px * 1.5), (px * 3.0), (abs((r - 0.82)) - 0.012)));
  float tickA = ((-abs((fract((a01 * 12.0)) - 0.5))) + 0.5);
  float tick = (((1.0 - smoothstep(0.0, 0.035, tickA)) * smoothstep(0.62, 0.66, r)) * (1.0 - smoothstep(0.78, 0.8, r)));
  float behind = fract(((phase - a01) + 1.0));
  float hand = (((1.0 - smoothstep(0.0, 0.006, min(behind, (1.0 - behind)))) * step(r, 0.6)) * smoothstep(0.05, 0.1, r));
  float trail = ((exp((behind * -5.0)) * 0.35) * step(r, 0.58));
  float hub = (1.0 - smoothstep((px * 2.0), (px * 5.0), r));
  vec3 face = mix(vec3(0.03, 0.045, 0.08), vec3(0.05, 0.075, 0.12), r);
  vec3 rgb = (((((face + (vec3(0.85, 0.9, 1.0) * (bezel * 0.35))) + (vec3(0.8, 0.85, 0.95) * (tick * 0.5))) + (vec3(1.0, 0.72, 0.2) * hand)) + (vec3(1.0, 0.6, 0.15) * trail)) + (vec3(1.0, 0.85, 0.5) * hub));
  _ret = vec4(rgb, 1.0);
}
