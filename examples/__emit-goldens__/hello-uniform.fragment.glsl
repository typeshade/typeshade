#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform scale_block_ {
  float _value_;
} scale;
layout(location = 0) out vec4 _ret;

void main() {
  _ret = vec4(scale._value_, 0.0, 0.0, 1.0);
}
