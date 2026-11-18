#version 300 es
precision highp float;
precision highp int;


void main() {
  uint i = uint(gl_VertexID);
  float x = -0.8;
  float y = -0.8;
  x = ((i == 1u) ? 0.8 : x);
  bool _ifc0 = (i == 2u);
  x = (_ifc0 ? 0.0 : x);
  y = (_ifc0 ? 0.8 : y);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
