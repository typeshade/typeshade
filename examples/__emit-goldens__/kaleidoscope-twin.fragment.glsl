#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float segments;
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

vec3 palette(float t) {
  vec3 ph = vec3(0.0, 0.33, 0.67);
  return (vec3(0.5, 0.5, 0.5) + (cos(((t + ph) * 6.283)) * 0.5));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float t = U.time;
  vec2 res = U.resolution;
  vec2 p = screenCoords(uv, res);
  float r = length(p);
  float a0 = atan(p.y, p.x);
  float sector = (6.2831853 / U.segments);
  float am = mod(a0, sector);
  float af = abs((am - (sector * 0.5)));
  vec2 q = (vec2(cos(af), sin(af)) * r);
  float v = fbm(((q * 3.0) + vec2((t * 0.12), (-(t * 0.09)))));
  float rings = ((sin(((r * 9.0) - (t * 0.8))) * 0.5) + 0.5);
  vec3 col = palette(((((v * 0.7) + (rings * 0.15)) + (r * 0.3)) - (t * 0.03)));
  float relief = ((v * 0.9) + 0.35);
  float vig = (1.0 - smoothstep(0.55, 1.25, r));
  _ret = vec4(((col * relief) * vig), 1.0);
}
