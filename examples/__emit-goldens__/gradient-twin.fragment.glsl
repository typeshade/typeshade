#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  vec4 top;
  vec4 bottom;
  float mix_bias;
} u;
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float t = (uv.y + u.mix_bias);
  vec3 rgb = mix(u.bottom.rgb, u.top.rgb, t);
  _ret = vec4(rgb, 1.0);
}
