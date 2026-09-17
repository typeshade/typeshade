#version 300 es
precision highp float;
precision highp int;

struct VsOut {
  vec4 pos;
  vec2 uv;
};
out vec2 uv;

VsOut vs_impl(uint i) {
  float x;
  float y;
  x = -1.0;
  y = -1.0;
  if ((i == 1u)) {
    x = 3.0;
  }
  if ((i == 2u)) {
    y = 3.0;
  }
  vec4 pos = vec4(x, y, 0.0, 1.0);
  vec2 uv = ((vec2(x, y) * 0.5) + vec2(0.5, 0.5));
  return VsOut(pos, uv);
}

void main() {
  VsOut _out = vs_impl(uint(gl_VertexID));
  gl_Position = _out.pos;
  uv = _out.uv;
}
