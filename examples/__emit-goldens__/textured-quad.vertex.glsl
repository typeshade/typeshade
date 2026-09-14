#version 300 es
precision highp float;
precision highp int;

#ifndef tint
#define tint 0.85
#endif
#ifndef desaturate
#define desaturate 0.0
#endif
out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  float x = ((float((vi & 1u)) * 4.0) - 1.0);
  float y = ((float((vi >> 1u)) * 4.0) - 1.0);
  gl_Position = vec4(x, y, 0.0, 1.0);
  uv = ((vec2(x, y) * 0.5) + vec2(0.5, 0.5));
}
