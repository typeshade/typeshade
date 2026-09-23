#version 300 es
precision highp float;
precision highp int;

struct DF64Vec3 {
  vec3 hi;
  vec3 lo;
};
layout(std140) uniform Uniforms {
  vec2 origin;
  float span;
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

vec2 df64_mul(vec2 a, vec2 b, float _fp64_g) {
  vec2 _v0 = df64_twoProd(a.x, b.x, _fp64_g);
  _v0.y = (_v0.y + (a.x * b.y));
  _v0 = df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
  _v0.y = (_v0.y + (a.y * b.x));
  return df64_quickTwoSum(_v0.x, _v0.y, _fp64_g);
}

vec2 df64_div(vec2 a, vec2 b, float _fp64_g) {
  float _v0 = (_fp64_g / b.x);
  vec2 _v1 = (a * _v0);
  float _v2 = df64_sub(a, df64_mul(b, _v1, _fp64_g), _fp64_g).x;
  vec2 _v3 = df64_twoProd(_v0, _v2, _fp64_g);
  return df64_add(_v1, _v3, _fp64_g);
}

vec2 stripeAt(vec2 origin, float offset) {
  float _fp64_g = texelFetch(_fp64, ivec2(0, 0), 0).x;
  vec2 world = df64_add(origin, vec2(offset, 0.0), _fp64_g);
  vec2 stripe = vec2(0.125, 0.0);
  float _cse1 = uintBitsToFloat(floatBitsToUint(0.0));
  vec2 _cse0 = vec2(_cse1, _cse1);
  return df64_fract(df64_div(df64_add(world, _cse0, _fp64_g), df64_add(stripe, _cse0, _fp64_g), _fp64_g), _fp64_g);
}

bool df64_gt(vec2 a, vec2 b) {
  return ((a.x > b.x) || ((a.x == b.x) && (a.y > b.y)));
}

bool df64_eq(vec2 a, vec2 b) {
  return ((a.x == b.x) && (a.y == b.y));
}

vec2 df64_round(vec2 a, float _fp64_g) {
  vec2 _v0 = df64_floor(a, _fp64_g);
  vec2 _v1 = df64_sub(a, _v0, _fp64_g);
  bool _v2 = (((_v0.x - (floor((_v0.x * 0.5)) * 2.0)) + (_v0.y - (floor((_v0.y * 0.5)) * 2.0))) == 1.0);
  vec2 _cse0 = vec2(0.5, 0.0);
  return ((df64_gt(_v1, _cse0) || (df64_eq(_v1, _cse0) && _v2)) ? df64_add(_v0, vec2(1.0, 0.0), _fp64_g) : _v0);
}

float df64_narrow(vec2 a) {
  return (a.x + a.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float _fp64_g = texelFetch(_fp64, ivec2(0, 0), 0).x;
  vec2 origin = df64_mul(u.origin, vec2(2.5, 0.0), _fp64_g);
  float offset = (u.span * (uv.x - 0.5));
  vec2 bands = stripeAt(origin, offset);
  float _cse1 = uintBitsToFloat(floatBitsToUint(0.0));
  vec2 _cse0 = vec2(_cse1, _cse1);
  vec2 _gv0 = df64_add(origin, vec2(offset, 0.0), _fp64_g);
  vec2 _lc1 = df64_round(df64_add(origin, _cse0, _fp64_g), _fp64_g);
  DF64Vec3 p = DF64Vec3(vec3(_gv0.x, _lc1.x, bands.x), vec3(_gv0.y, _lc1.y, bands.y));
  vec3 narrowed = vec3(df64_narrow(vec2(p.hi.x, p.lo.x)), df64_narrow(vec2(p.hi.y, p.lo.y)), df64_narrow(vec2(p.hi.z, p.lo.z)));
  float flat_ = fract((df64_narrow(_gv0) * 8.0));
  float shade = ((uv.x < 0.5) ? flat_ : df64_narrow(vec2(p.hi.z, p.lo.z)));
  float drift = abs((narrowed.z - flat_));
  _ret = vec4(shade, drift, fract((narrowed.y * 0.5)), 1.0);
}
