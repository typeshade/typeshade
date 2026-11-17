#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
} u;
vec3 pattern(vec2 uv) {
  float d = length((uv - vec2(0.5, 0.5)));
  float rings = step(0.5, fract(((d * 10.0) - (u.time * 0.2))));
  float stripes = step(0.5, fract(((uv.x * 6.0) + (u.time * 0.1))));
  return (mix(vec3(0.1, 0.2, 0.5), vec3(1.0, 0.8, 0.3), vec3(rings, rings, rings)) * (0.6 + (0.4 * stripes)));
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 _licm0 = uv;
  float step = (1.5 / max(u.resolution.x, 1.0));
  vec3 sum = vec3(0.0, 0.0, 0.0);
  float total = 0.0;
  for (int i = -4; (i <= 4); i = (i + 1)) {
    float w = exp(((-float((i * i))) * 0.125));
    sum = (sum + (pattern((_licm0 + vec2((float(i) * step), 0.0))) * w));
    total = (total + w);
  }
  color = vec4((sum / total), 1.0);
}
