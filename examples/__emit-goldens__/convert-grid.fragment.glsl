#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 scaled = (uv * 4.0);
  uvec2 cell = uvec2(scaled);
  vec2 back = vec2(cell);
  float shade = ((back.x + back.y) / 6.0);
  color = vec4(shade, (1.0 - shade), 0.35, 1.0);
}
