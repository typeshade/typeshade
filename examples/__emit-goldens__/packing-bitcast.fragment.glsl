#version 300 es
precision highp float;
precision highp int;

uint _xbits(uint e, uint o, uint c) {
  o = min(o, 32u);
  c = min(c, 32u - o);
  if (c == 0u) return uint(0);
  return (e << (32u - o - c)) >> (32u - c);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec2 origin = vec2(0.0, 0.0);
  uvec3 steps = uvec3(1u, 2u, 3u);
  uint rgba8Bits = (uint(floor(0.5 + clamp(vec4(uv, 0.25, 1.0).x, 0.0, 1.0) * 255.0)) | (uint(floor(0.5 + clamp(vec4(uv, 0.25, 1.0).y, 0.0, 1.0) * 255.0)) << 8) | (uint(floor(0.5 + clamp(vec4(uv, 0.25, 1.0).z, 0.0, 1.0) * 255.0)) << 16) | (uint(floor(0.5 + clamp(vec4(uv, 0.25, 1.0).w, 0.0, 1.0) * 255.0)) << 24));
  vec4 rgba8 = (vec4(uvec4(rgba8Bits, rgba8Bits >> 8, rgba8Bits >> 16, rgba8Bits >> 24) & 0xFFu) / 255.0);
  uint signed8Bits = (uint(int(floor(0.5 + clamp(vec4(((uv * 2.0) - vec2(1.0, 1.0)), -0.5, 1.0).x, -1.0, 1.0) * 127.0)) & 0xFF) | (uint(int(floor(0.5 + clamp(vec4(((uv * 2.0) - vec2(1.0, 1.0)), -0.5, 1.0).y, -1.0, 1.0) * 127.0)) & 0xFF) << 8) | (uint(int(floor(0.5 + clamp(vec4(((uv * 2.0) - vec2(1.0, 1.0)), -0.5, 1.0).z, -1.0, 1.0) * 127.0)) & 0xFF) << 16) | (uint(int(floor(0.5 + clamp(vec4(((uv * 2.0) - vec2(1.0, 1.0)), -0.5, 1.0).w, -1.0, 1.0) * 127.0)) & 0xFF) << 24));
  vec4 signed8 = max(vec4(ivec4(uvec4(signed8Bits, signed8Bits >> 8, signed8Bits >> 16, signed8Bits >> 24) << 24) >> 24) / 127.0, vec4(-1.0));
  vec2 half_ = unpackHalf2x16(packHalf2x16(uv));
  vec2 u16 = unpackUnorm2x16(packUnorm2x16(uv));
  vec2 s16 = unpackSnorm2x16(packSnorm2x16((uv - origin)));
  uint bits = floatBitsToUint((uv.x + 1.0));
  float exponent = (float(_xbits(bits, 23u, 8u)) / 255.0);
  float back = uintBitsToFloat(bits);
  vec3 grade = vec3(half_.x, u16.y, exponent);
  vec3 coarse = vec3(unpackHalf2x16(packHalf2x16(vec2(grade.x, 0.0))).x, unpackHalf2x16(packHalf2x16(vec2(grade.y, 0.0))).x, unpackHalf2x16(packHalf2x16(vec2(grade.z, 0.0))).x);
  bool lit = (back > 1.5);
  float edge = ((lit ? 0.15 : 0.0) + ((uv.x > 0.98) ? 0.1 : 0.0));
  float banded = (float(steps.y) * 0.125);
  float _lc0 = (banded * 0.1);
  vec3 rgb = (((coarse * 0.5) + (vec3(rgba8.x, ((signed8.y * 0.5) + 0.5), ((s16.x * 0.5) + 0.5)) * 0.4)) + vec3(_lc0, _lc0, _lc0));
  _ret = vec4(clamp((rgb + vec3(edge, edge, edge)), vec3(0.0, 0.0, 0.0), vec3(1.0, 1.0, 1.0)), rgba8.w);
}
