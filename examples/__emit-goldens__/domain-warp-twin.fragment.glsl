#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float warp;
} U;
vec2 screenCoords(vec2 uv, vec2 resolution) {
  float asp = (resolution.x / resolution.y);
  return vec2((((uv.x * 2.0) - 1.0) * asp), ((uv.y * 2.0) - 1.0));
}

uint hash32(uint x) {
  uint a = ((x ^ (x >> 16u)) * 2246822519u);
  uint b = ((a ^ (a >> 13u)) * 3266489917u);
  return (b ^ (b >> 16u));
}

float hash(vec2 p) {
  uint h = hash32((uint(int(p.x)) ^ hash32(uint(int(p.y)))));
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
  float t = U.time;
  vec2 res = U.resolution;
  vec2 p = (screenCoords(uv, res) * 1.8);
  float w = U.warp;
  vec2 q = vec2(fbm(p), fbm((p + vec2(5.2, 1.3))));
  vec2 pq = (p + (q * w));
  vec2 r = vec2(fbm(((pq + vec2(1.7, 9.2)) + vec2((t * 0.15), (t * 0.12)))), fbm((pq + vec2(8.3, 2.8))));
  float f = fbm((p + (r * w)));
  vec3 a = mix(vec3(0.09, 0.12, 0.2), vec3(0.85, 0.83, 0.72), clamp(((f * f) * 2.8), 0.0, 1.0));
  vec3 b = mix(a, vec3(0.2, 0.5, 0.55), clamp((length(q) * 0.9), 0.0, 1.0));
  vec3 c = mix(b, vec3(0.66, 0.3, 0.2), clamp((smoothstep(0.4, 1.0, r.y) * 0.6), 0.0, 1.0));
  _ret = vec4((c * ((f * 1.4) + 0.35)), 1.0);
}
