#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  color = vec4(uv.x, uv.y, 0.2, 1.0);
}
