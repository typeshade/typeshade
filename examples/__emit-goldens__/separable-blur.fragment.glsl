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
  vec2 _licm0 = gl_FragCoord.xy;
  vec2 size = max(u.resolution, vec2(1.0, 1.0));
  vec3 sum = vec3(0.0, 0.0, 0.0);
  float total = 0.0;
  for (int i = -4; (i <= 4); i = (i + 1)) {
    float w = exp(((-float((i * i))) * 0.125));
    vec2 at = ((_licm0 + vec2(0.0, (float(i) * 1.5))) / size);
    sum = (sum + (textureLod(blurX, at, 0.0).rgb * w));
    total = (total + w);
  }
  color = vec4((sum / total), 1.0);
}
