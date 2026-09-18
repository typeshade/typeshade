#version 300 es
precision highp float;
precision highp int;


void main() {
  uint vi = uint(gl_VertexID);
  float[3] xs = float[3](-1.0, 3.0, -1.0);
  float[3] ys = float[3](-1.0, -1.0, 3.0);
  int i = int(vi);
  gl_Position = vec4(xs[i], ys[i], 0.0, 1.0);
}
