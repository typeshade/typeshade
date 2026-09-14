#version 300 es
precision highp float;
precision highp int;

out vec2 uv;

void main() {
  uint i = uint(gl_VertexID);
  float x = -0.8;
  float y = -0.8;
  float u = 0.0;
  float v = 0.0;
  if ((i == 1u)) {
    x = 0.8;
    u = 1.0;
  }
  if ((i == 2u)) {
    x = 0.0;
    y = 0.8;
    u = 0.5;
    v = 1.0;
  }
  gl_Position = vec4(x, y, 0.0, 1.0);
  uv = vec2(u, v);
}
