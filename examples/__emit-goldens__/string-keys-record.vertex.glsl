#version 300 es
precision highp float;
precision highp int;

const float[3] GAIN = float[3](0.5, 1.0, 1.5);

void main() {
  uint i = uint(gl_VertexID);
  vec2 p = vec2(-1.0, -1.0);
  p = ((i == 1u) ? vec2(3.0, -1.0) : p);
  p = ((i == 2u) ? vec2(-1.0, 3.0) : p);
  gl_Position = vec4(p, 0.0, 1.0);
}
