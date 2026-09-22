#version 300 es
precision highp float;
precision highp int;

struct DF64Vec2 {
  vec2 hi;
  vec2 lo;
};
layout(std140) uniform Uniforms {
  DF64Vec2 center;
  DF64Vec2 mark;
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
  vec2 _cse2 = vec2(u.mark.hi.x, u.mark.lo.x);
  float _cse6 = uintBitsToFloat(floatBitsToUint(0.0));
  vec2 _cse3 = vec2(_cse6, _cse6);
  float ex64 = df64_narrow(df64_sub(df64_add(_cse1, vec2(dx, 0.0)), df64_add(_cse2, _cse3)));
  vec2 _cse4 = vec2(u.center.hi.y, u.center.lo.y);
  vec2 _cse5 = vec2(u.mark.hi.y, u.mark.lo.y);
  float ey64 = df64_narrow(df64_sub(df64_add(_cse4, vec2(dy, 0.0)), df64_add(_cse5, _cse3)));
  float ex32 = ((df64_narrow(_cse1) + dx) - df64_narrow(_cse2));
  float ey32 = ((df64_narrow(_cse4) + dy) - df64_narrow(_cse5));
  float ex = (isF32 ? ex32 : ex64);
  float ey = (isF32 ? ey32 : ey64);
  float rw = (span * 0.125);
  float r = length(vec2(ex, ey));
  float pixw = (span / (u.resolution.x * 0.5));
  float tri = (((-abs((fract((r / rw)) - 0.5))) + 0.5) * rw);
  float ring = (1.0 - smoothstep(0.0, ((pixw * 1.6) + 1e-9), tri));
  float cross = (1.0 - smoothstep(0.0, ((pixw * 1.4) + 1e-9), min(abs(ex), abs(ey))));
  float dotGlow = exp((-(r / ((pixw * 6.0) + 1e-9))));
  float vignette = max(0.0, (1.0 - (r / (span * 0.75))));
  vec3 bg = mix(vec3(0.01, 0.04, 0.02), vec3(0.02, 0.09, 0.045), vignette);
  vec3 rgb = (((bg + (vec3(0.1, 0.75, 0.3) * (ring * 0.8))) + (vec3(0.12, 0.9, 0.4) * (cross * 0.55))) + (vec3(1.0, 0.45, 0.25) * dotGlow));
  _ret = vec4(rgb, 1.0);
}
