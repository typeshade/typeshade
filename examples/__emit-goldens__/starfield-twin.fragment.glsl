#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float density;
} U;
vec2 screenCoords(vec2 uv, vec2 resolution) {
  float asp = (resolution.x / resolution.y);
  return vec2((((uv.x * 2.0) - 1.0) * asp), ((uv.y * 2.0) - 1.0));
}

float hash(vec2 p) {
  return fract((sin(dot(p, vec2(127.1, 311.7))) * 43758.5453));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float _licm0 = (0.92 - (U.density * 0.25));
  vec2 _licm1 = vec2(12.3, 45.6);
  vec2 _licm2 = vec2(78.9, 1.2);
  vec3 _licm3 = vec3(0.75, 0.85, 1.0);
  vec3 _licm4 = vec3(1.0, 0.9, 0.75);
  float t = U.time;
  vec2 res = U.resolution;
  vec2 p = screenCoords(uv, res);
  vec3 col = vec3(0.0, 0.0, 0.0);
  for (uint i = 0u; (i < 3u); i = (i + 1u)) {
    float fi = float(i);
    float scale = ((fi * 14.0) + 18.0);
    float drift = ((fi * 0.014) + 0.01);
    vec2 q = ((vec2((p.x + (t * drift)), p.y) * scale) + (fi * 37.7));
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float h = hash(cell);
    float gate = step(_licm0, h);
    vec2 sp = ((vec2(hash((cell + _licm1)), hash((cell + _licm2))) * 0.7) + 0.15);
    float d = distance(f, sp);
    float rad = (0.06 - (fi * 0.012));
    float core = (1.0 - smoothstep(0.0, rad, d));
    float twinkle = ((sin(((t * ((h * 4.0) + 2.0)) + (h * 40.0))) * 0.4) + 0.6);
    float b = ((((core * core) * twinkle) * gate) * (1.0 - (fi * 0.25)));
    vec3 tint = mix(_licm3, _licm4, h);
    col = (col + (tint * b));
  }
  float s = (p.y + (p.x * 0.35));
  float band = exp((-((s * s) * 6.0)));
  _ret = vec4((col + (vec3(0.09, 0.11, 0.16) * band)), 1.0);
}
