#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
} u;
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 _licm0 = uv;
  vec2 _licm1 = vec2(0.5, 0.5);
  float _licm2 = (u.time * 0.2);
  float _licm3 = (u.time * 0.1);
  vec3 _licm4 = vec3(0.1, 0.2, 0.5);
  vec3 _licm5 = vec3(1.0, 0.8, 0.3);
  float step = (1.5 / max(u.resolution.x, 1.0));
  vec3 sum = vec3(0.0, 0.0, 0.0);
  float total = 0.0;
  for (int i = -4; (i <= 4); i = (i + 1)) {
    float w = exp(((-float((i * i))) * 0.125));
    vec2 _sm0_a0 = (_licm0 + vec2((float(i) * step), 0.0));
    float _sm0_l_d = length((_sm0_a0 - _licm1));
    float _sm0_l_rings = step(0.5, fract(((_sm0_l_d * 10.0) - _licm2)));
    float _sm0_l_stripes = step(0.5, fract(((_sm0_a0.x * 6.0) + _licm3)));
    vec3 _sm0_ret = (mix(_licm4, _licm5, vec3(_sm0_l_rings, _sm0_l_rings, _sm0_l_rings)) * (0.6 + (0.4 * _sm0_l_stripes)));
    sum = (sum + (_sm0_ret * w));
    total = (total + w);
  }
  color = vec4((sum / total), 1.0);
}
