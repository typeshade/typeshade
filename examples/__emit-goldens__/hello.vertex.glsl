#version 300 es
precision highp float;
precision highp int;


void main() {
  uint i = uint(gl_VertexID);
  float x = -0.8;
  float y = -0.8;
  x = mix(x, 0.8, (i == 1u));
  bool _ifc0 = (i == 2u);
  x = mix(x, 0.0, _ifc0);
  y = mix(y, 0.8, _ifc0);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
