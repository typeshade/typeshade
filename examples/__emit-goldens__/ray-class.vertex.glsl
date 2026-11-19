#version 300 es
precision highp float;
precision highp int;

out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  float xs[3] = float[3](-1.0, 3.0, -1.0);
  float ys[3] = float[3](-1.0, -1.0, 3.0);
  int i = int(vi);
  vec2 p = vec2(xs[i], ys[i]);
  gl_Position = vec4(p, 0.0, 1.0);
  uv = p;
}
