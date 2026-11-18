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
  bool _ifc0 = (i == 1u);
  x = (_ifc0 ? 0.8 : x);
  u = (_ifc0 ? 1.0 : u);
  bool _ifc1 = (i == 2u);
  x = (_ifc1 ? 0.0 : x);
  y = (_ifc1 ? 0.8 : y);
  u = (_ifc1 ? 0.5 : u);
  v = (_ifc1 ? 1.0 : v);
  gl_Position = vec4(x, y, 0.0, 1.0);
  uv = vec2(u, v);
}
