#version 300 es
precision highp float;
precision highp int;

int _irem(int a, int b) {
  int d = (b == 0 || (a == int(0x80000000u) && b == -1)) ? 1 : b;
  return a - (a / d) * d;
}

void main() {
  uint vi = uint(gl_VertexID);
  int _cse0 = int(vi);
  float x = ((float((_cse0 / 2)) * 4.0) - 1.0);
  float y = ((float(_irem(_cse0, 2)) * 4.0) - 1.0);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
