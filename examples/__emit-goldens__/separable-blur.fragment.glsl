#version 300 es
precision highp float;
precision highp int;

uniform sampler2D blurX;

layout(std140) uniform Uniforms {
  vec2 resolution;
} u;
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 _licm0 = uv;
  float step = (1.5 / max(u.resolution.y, 1.0));
  vec3 sum = vec3(0.0, 0.0, 0.0);
  float total = 0.0;
  for (int i = -4; (i <= 4); i = (i + 1)) {
    float w = exp(((-float((i * i))) * 0.125));
    sum = (sum + (textureLod(blurX, (_licm0 + vec2(0.0, (float(i) * step))), 0.0).rgb * w));
    total = (total + w);
  }
  color = vec4((sum / total), 1.0);
}
