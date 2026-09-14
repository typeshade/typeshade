#version 300 es
precision highp float;
precision highp int;

const uint TILES = 8u;
const int PHASE = -3;
const float GAMMA = 2.2;
const bool INVERT = true;
out vec2 uv;

void main() {
  uint idx = uint(gl_VertexID);
  float x = ((float((idx & 1u)) * 4.0) - 1.0);
  float y = ((float((idx >> 1u)) * 4.0) - 1.0);
  gl_Position = vec4(x, y, 0.0, 1.0);
  uv = vec2(((x * 0.5) + 0.5), ((y * 0.5) + 0.5));
}
