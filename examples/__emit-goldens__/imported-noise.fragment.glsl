#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
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
  vec2 u = ((f * f) * (vec2(3.0, 3.0) - (f * 2.0)));
  return mix(mix(hash(i), hash((i + vec2(1.0, 0.0))), u.x), mix(hash((i + vec2(0.0, 1.0))), hash((i + vec2(1.0, 1.0))), u.x), u.y);
}

float fbm(vec2 p) {
  return ((((noise(p) * 0.5) + (noise((p * 2.02)) * 0.25)) + (noise((p * 4.08)) * 0.125)) + (noise((p * 8.2)) * 0.0625));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float aspect = (U.resolution.x / U.resolution.y);
  vec2 p = ((vec2((uv.x * aspect), uv.y) * 4.0) + vec2((U.time * 0.05), 0.0));
  float cover = smoothstep(0.35, 0.75, fbm(p));
  vec3 sky = mix(vec3(0.18, 0.36, 0.7), vec3(0.55, 0.72, 0.92), uv.y);
  _ret = vec4(mix(sky, vec3(1.0, 1.0, 1.0), cover), 1.0);
}
