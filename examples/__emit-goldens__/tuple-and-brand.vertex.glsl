#version 300 es
precision highp float;
precision highp int;

const float HORIZON = 8.0;
float[2] corner(int i) {
  float[3] xs = float[3](-1.0, 3.0, -1.0);
  float[3] ys = float[3](-1.0, -1.0, 3.0);
  return float[2](xs[i], ys[i]);
}

void main() {
  uint vi = uint(gl_VertexID);
  float[2] c = corner(int(vi));
  gl_Position = vec4(c[0], c[1], 0.0, 1.0);
}
