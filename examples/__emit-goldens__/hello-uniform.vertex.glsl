#version 300 es
precision highp float;
precision highp int;


void main() {
  uint vi = uint(gl_VertexID);
  float x = ((float(((vi << 1u) & 2u)) * 2.0) - 1.0);
  float y = ((float((vi & 2u)) * 2.0) - 1.0);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
