#version 300 es
precision highp float;
precision highp int;


void main() {
  uint i = uint(gl_VertexID);
  float x = -0.8;
  float y = -0.8;
  if ((i == 1u)) {
    x = 0.8;
  }
  if ((i == 2u)) {
    x = 0.0;
    y = 0.8;
  }
  gl_Position = vec4(x, y, 0.0, 1.0);
}
