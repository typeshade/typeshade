#version 300 es
precision highp float;
precision highp int;

out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  int _cse0 = int(vi);
  float x = ((float((_cse0 / 2)) * 4.0) - 1.0);
  float y = ((float((_cse0 % 2)) * 4.0) - 1.0);
  gl_Position = vec4(x, y, 0.0, 1.0);
  uv = ((vec2(x, y) * 0.5) + vec2(0.5, 0.5));
}
