#version 300 es
precision highp float;
precision highp int;

invariant gl_Position;
flat out uint id;
smooth centroid out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  float[3] xs = float[3](-1.0, 3.0, -1.0);
  float[3] ys = float[3](-1.0, -1.0, 3.0);
  int i = int(vi);
  vec2 p = vec2(xs[i], ys[i]);
  gl_Position = vec4(p, 0.0, 1.0);
  id = (vi + 1u);
  uv = ((p * 0.5) + vec2(0.5, 0.5));
}
