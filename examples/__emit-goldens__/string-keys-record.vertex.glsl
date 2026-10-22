#version 300 es
precision highp float;
precision highp int;

const float[3] GAIN = float[3](0.5, 1.0, 1.5);

void main() {
  uint i = uint(gl_VertexID);
  vec2 p = vec2(-1.0, -1.0);
  if ((i == 1u)) {
    p = vec2(3.0, -1.0);
  }
  if ((i == 2u)) {
    p = vec2(-1.0, 3.0);
  }
  gl_Position = vec4(p, 0.0, 1.0);
}
