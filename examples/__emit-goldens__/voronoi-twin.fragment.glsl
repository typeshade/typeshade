#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float cells;
} U;
vec2 hash2(vec2 c) {
  vec2 h = vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)));
  return fract((vec2(sin(h.x), sin(h.y)) * 43758.5453));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float _licm0 = U.time;
  vec2 p = (uv * U.cells);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float md = 8.0;
  for (int j = -1; (j <= 1); j = (j + 1)) {
    for (int i = -1; (i <= 1); i = (i + 1)) {
      vec2 g = vec2(float(i), float(j));
      vec2 seed = hash2((cell + g));
      vec2 orbit = (vec2(sin((_licm0 + (seed.x * 6.283))), cos((_licm0 + (seed.y * 6.283)))) * 0.18);
      vec2 pt = ((g + ((seed * 0.5) + 0.25)) + orbit);
      md = min(md, distance(f, pt));
    }
  }
  float _lc0 = (md * md);
  vec3 c = ((vec3(_lc0, _lc0, _lc0) * vec3(0.35, 0.6, 1.0)) + vec3(0.02, 0.03, 0.06));
  _ret = vec4(c, 1.0);
}
