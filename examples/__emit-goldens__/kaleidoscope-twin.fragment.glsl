#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float segments;
} U;
int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}
uint hash32(uint x) {
  uint a = ((x ^ (x >> 16u)) * 2246822519u);
  uint b = ((a ^ (a >> 13u)) * 3266489917u);
  return (b ^ (b >> 16u));
}

float hash(vec2 p) {
  uint h = hash32((uint(_f2i(p.x)) ^ hash32(uint(_f2i(p.y)))));
  return (float((h >> 8u)) * 5.960464477539063e-8);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = ((f * f) * (vec2(3.0) - (f * 2.0)));
  return mix(mix(hash(i), hash((i + vec2(1.0, 0.0))), u.x), mix(hash((i + vec2(0.0, 1.0))), hash((i + vec2(1.0, 1.0))), u.x), u.y);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float t = U.time;
  vec2 res = U.resolution;
  vec2 _i0a0 = uv;
  float _i0_asp = (res.x / res.y);
  float _gv0 = (((_i0a0.x * 2.0) - 1.0) * _i0_asp);
  float _gv1 = ((_i0a0.y * 2.0) - 1.0);
  vec2 _i0ret = vec2(_gv0, _gv1);
  float r = length(_i0ret);
  float a0 = atan(_gv1, _gv0);
  float sector = (6.2831853 / U.segments);
  float am = mod(a0, sector);
  float af = abs((am - (sector * 0.5)));
  vec2 q = (vec2(cos(af), sin(af)) * r);
  vec2 _i1a0 = ((q * 3.0) + vec2((t * 0.12), (-(t * 0.09))));
  float v = ((((noise(_i1a0) * 0.5) + (noise((_i1a0 * 2.02)) * 0.25)) + (noise((_i1a0 * 4.08)) * 0.125)) + (noise((_i1a0 * 8.2)) * 0.0625));
  float rings = ((sin(((r * 9.0) - (t * 0.8))) * 0.5) + 0.5);
  float _i2a0 = ((((v * 0.7) + (rings * 0.15)) + (r * 0.3)) - (t * 0.03));
  vec3 _i2_ph = vec3(0.0, 0.33, 0.67);
  vec3 _i2ret = (vec3(0.5) + (cos(((_i2a0 + _i2_ph) * 6.283)) * 0.5));
  float relief = ((v * 0.9) + 0.35);
  float vig = (1.0 - smoothstep(0.55, 1.25, r));
  _ret = vec4(((_i2ret * relief) * vig), 1.0);
}
