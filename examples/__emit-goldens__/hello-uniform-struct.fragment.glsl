#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  vec4 tint;
  float gain;
} u;
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec3 rgb = (u.tint.rgb * uv.y);
  _ret = vec4(rgb, u.tint.a);
}
