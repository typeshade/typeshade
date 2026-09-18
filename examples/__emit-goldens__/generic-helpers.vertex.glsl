#version 300 es
precision highp float;
precision highp int;

float head_f32(float[3] xs) {
  return xs[0];
}

float pick_f32(bool c, float a, float b) {
  return (c ? a : b);
}

void main() {
  uint vi = uint(gl_VertexID);
  float[3] xs = float[3](-1.0, 3.0, -1.0);
  float[3] ys = float[3](-1.0, -1.0, 3.0);
  int i = int(vi);
  gl_Position = vec4(pick_f32((vi == 0u), head_f32(xs), xs[i]), ys[i], 0.0, 1.0);
}
