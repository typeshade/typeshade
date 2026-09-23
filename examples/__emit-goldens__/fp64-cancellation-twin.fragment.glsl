#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  vec2 resolution;
  float half_width;
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
  float w = u.half_width;
  float halfUv = (uv.x * 2.0);
  bool _cse0 = (uv.x < 0.5);
  float sx = (halfUv - (_cse0 ? 0.0 : 1.0));
  float _gv0 = (sx - 0.5);
  float d = (_gv0 * (w * 2.0));
  bool isF32 = (_cse0 || (u.fp64 < 0.5));
  vec2 _cse1 = vec2(1.0, 0.0);
  vec2 xd = df64_add(_cse1, vec2(d, 0.0), _fp64_g);
  vec2 x2 = df64_sqr(xd, _fp64_g);
  vec2 x3 = df64_mul(x2, xd, _fp64_g);
  vec2 x4 = df64_sqr(x2, _fp64_g);
  vec2 x5 = df64_mul(x4, xd, _fp64_g);
  vec2 x6 = df64_sqr(x3, _fp64_g);
  vec2 x7 = df64_mul(x6, xd, _fp64_g);
  float _cse6 = uintBitsToFloat(floatBitsToUint(0.0));
  vec2 _cse2 = vec2(_cse6, _cse6);
  vec2 _cse3 = vec2(7.0, 0.0);
  vec2 _cse4 = vec2(21.0, 0.0);
  vec2 _cse5 = vec2(35.0, 0.0);
  float p64 = df64_narrow(df64_sub(df64_add(df64_sub(df64_add(df64_sub(df64_add(df64_sub(df64_add(x7, _cse2, _fp64_g), df64_mul(x6, _cse3, _fp64_g), _fp64_g), df64_mul(x5, _cse4, _fp64_g), _fp64_g), df64_mul(x4, _cse5, _fp64_g), _fp64_g), df64_mul(x3, _cse5, _fp64_g), _fp64_g), df64_mul(x2, _cse4, _fp64_g), _fp64_g), df64_mul(xd, _cse3, _fp64_g), _fp64_g), df64_add(_cse1, _cse2, _fp64_g), _fp64_g));
  float xf = (1.0 + d);
  float f2 = (xf * xf);
  float f3 = (f2 * xf);
  float f4 = (f2 * f2);
  float f5 = (f4 * xf);
  float f6 = (f3 * f3);
  float f7 = (f6 * xf);
  float p32 = (((((((f7 - (f6 * 7.0)) + (f5 * 21.0)) - (f4 * 35.0)) + (f3 * 35.0)) - (f2 * 21.0)) + (xf * 7.0)) - 1.0);
  float pv = (isF32 ? p32 : p64);
  float yscale = (pow(w, 7.0) * 1.3);
  float v = (pv / yscale);
  float d2 = (d * d);
  float truth = ((((d2 * d2) * d2) * d) / yscale);
  float py = ((uv.y - 0.5) * 2.0);
  float px = (2.0 / u.resolution.y);
  float gxf = fract((sx * 10.0));
  float gyf = fract(((py + 1.0) * 5.0));
  float dgx = min(gxf, (1.0 - gxf));
  float dgy = min(gyf, (1.0 - gyf));
  float aaCx = (30.0 / u.resolution.x);
  float aaCy = (15.0 / u.resolution.y);
  float grid = ((1.0 - smoothstep(0.0, aaCx, dgx)) + (1.0 - smoothstep(0.0, aaCy, dgy)));
  vec3 paper = vec3(0.96, 0.94, 0.88);
  vec3 rgb0 = mix(paper, vec3(0.72, 0.78, 0.86), (min(grid, 1.0) * 0.45));
  float fill = step(py, v);
  vec3 rgb1 = mix(rgb0, vec3(0.62, 0.74, 0.9), (fill * 0.5));
  float ink = (1.0 - smoothstep((px * 1.2), (px * 3.0), abs((v - py))));
  vec3 rgb2 = mix(rgb1, vec3(0.13, 0.16, 0.3), (ink * 0.85));
  float refLine = (1.0 - smoothstep((px * 0.8), (px * 2.2), abs((truth - py))));
  vec3 rgb3 = mix(rgb2, vec3(0.8, 0.25, 0.2), (refLine * 0.65));
  float _lc0 = (px * 1.5);
  float axis = min(smoothstep(0.0, _lc0, abs(py)), smoothstep(0.0, _lc0, (abs(_gv0) * 2.0)));
  vec3 rgb = mix(vec3(0.35, 0.33, 0.3), rgb3, axis);
  _ret = vec4(rgb, 1.0);
}
