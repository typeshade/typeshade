#version 300 es
precision highp float;
precision highp int;

const float HORIZON = 8.0;

void main() {
  uint vi = uint(gl_VertexID);
  int _i2a0 = int(vi);
  float[3] _i2_xs = float[3](-1.0, 3.0, -1.0);
  float[3] _i2_ys = float[3](-1.0, -1.0, 3.0);
  float _i2ret_0 = _i2_xs[_i2a0];
  float _i2ret_1 = _i2_ys[_i2a0];
  gl_Position = vec4(_i2ret_0, _i2ret_1, 0.0, 1.0);
}
