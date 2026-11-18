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
  x = mix(x, 0.8, _ifc0);
  u = mix(u, 1.0, _ifc0);
  bool _ifc1 = (i == 2u);
  x = mix(x, 0.0, _ifc1);
  y = mix(y, 0.8, _ifc1);
  u = mix(u, 0.5, _ifc1);
  v = mix(v, 1.0, _ifc1);
  gl_Position = vec4(x, y, 0.0, 1.0);
  uv = vec2(u, v);
}
