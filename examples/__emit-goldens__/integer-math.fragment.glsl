#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Grid {
  ivec2 origin;
  uvec2 span;
} grid;
uint _idot(uvec2 a, uvec2 b) {
  return a.x * b.x + a.y * b.y;
}

int _idot(ivec2 a, ivec2 b) {
  return a.x * b.x + a.y * b.y;
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  ivec2 at = ivec2(int((uv.x * 64.0)), int((uv.y * 64.0)));
  uvec2 cell = uvec2(uint(at.x), uint(at.y));
  uvec2 magnitude = cell;
  uint width = grid.span.x;
  ivec2 offset = abs((at - grid.origin));
  int squared = _idot(offset, offset);
  uint spread = _idot(magnitude, magnitude);
  vec2 _cse0 = (uv - vec2(0.5, 0.5));
  float radial = dot(_cse0, _cse0);
  float rings = (float((squared % 97)) / 97.0);
  float bands = (float((spread % 53u)) / 53.0);
  float edge = (float((width % 7u)) / 7.0);
  _ret = vec4(rings, bands, ((edge * 0.5) + (radial * 0.5)), (1.0 - ((float(squared) * 0.000244140625) * 0.0)));
}
