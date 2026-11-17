#version 300 es
precision highp float;
precision highp int;

const float HORIZON = 8.0;

void main() {
  uint vi = uint(gl_VertexID);
  int _sm2_a0 = int(vi);
  float[3] _sm2_l_xs = float[3](-1.0, 3.0, -1.0);
  float[3] _sm2_l_ys = float[3](-1.0, -1.0, 3.0);
  float _sm2_ret_0 = _sm2_l_xs[_sm2_a0];
  float _sm2_ret_1 = _sm2_l_ys[_sm2_a0];
  gl_Position = vec4(_sm2_ret_0, _sm2_ret_1, 0.0, 1.0);
}
