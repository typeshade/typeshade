#version 300 es
precision highp float;
precision highp int;

const float Disc_SIZE = 0.2;
const float Capped_SIZE = 0.35;
out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  float x = ((float((vi & 1u)) * 4.0) - 1.0);
  float y = ((float((vi >> 1u)) * 4.0) - 1.0);
  gl_Position = vec4(x, y, 0.0, 1.0);
  uv = vec2(x, y);
}
