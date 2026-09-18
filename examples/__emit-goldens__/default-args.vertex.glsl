#version 300 es
precision highp float;
precision highp int;

const vec3 WARM = vec3(1.0, 0.72, 0.42);
out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  float[3] xs = float[3](-1.0, 3.0, -1.0);
  float[3] ys = float[3](-1.0, -1.0, 3.0);
  int i = int(vi);
  vec2 p = vec2(xs[i], ys[i]);
  gl_Position = vec4(p, 0.0, 1.0);
  uv = p;
}
