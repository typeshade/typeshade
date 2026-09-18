#version 300 es
precision highp float;
precision highp int;

uint seed = 7u;
float next() {
  seed = ((seed * 1664525u) + 1013904223u);
  return (float((seed >> 8u)) * 5.960464477539063e-8);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  uvec2 cell = uvec2(uint(((uv.x + 1.0) * 32.0)), uint(((uv.y + 1.0) * 32.0)));
  seed = (((cell.x * 1973u) + (cell.y * 9277u)) + 26699u);
  float r = next();
  float g = next();
  float b = next();
  color = vec4(r, g, b, 1.0);
}
