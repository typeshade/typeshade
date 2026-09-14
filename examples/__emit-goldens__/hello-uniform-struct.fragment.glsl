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
  _ret = vec4((u.tint.rgb * (uv.y * u.gain)), u.tint.a);
}
