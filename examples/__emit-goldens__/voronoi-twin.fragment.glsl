#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float cells;
} U;
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec2 _licm0 = vec2(127.1, 311.7);
  vec2 _licm1 = vec2(269.5, 183.3);
  float _licm2 = U.time;
  vec2 p = (uv * U.cells);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float md = 8.0;
  for (int j = -1; (j <= 1); j = (j + 1)) {
    for (int i = -1; (i <= 1); i = (i + 1)) {
      vec2 g = vec2(float(i), float(j));
      vec2 _sm0_a0 = (cell + g);
      vec2 _sm0_l_h = vec2(dot(_sm0_a0, _licm0), dot(_sm0_a0, _licm1));
      vec2 _sm0_ret = fract((vec2(sin(_sm0_l_h.x), sin(_sm0_l_h.y)) * 43758.5453));
      vec2 orbit = (vec2(sin((_licm2 + (_sm0_ret.x * 6.283))), cos((_licm2 + (_sm0_ret.y * 6.283)))) * 0.18);
      vec2 pt = ((g + ((_sm0_ret * 0.5) + 0.25)) + orbit);
      md = min(md, distance(f, pt));
    }
  }
  float _lc0 = (md * md);
  vec3 c = ((vec3(_lc0, _lc0, _lc0) * vec3(0.35, 0.6, 1.0)) + vec3(0.02, 0.03, 0.06));
  _ret = vec4(c, 1.0);
}
