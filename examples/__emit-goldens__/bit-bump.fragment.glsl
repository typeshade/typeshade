#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Frame {
  mat4 m;
} frame;
uint _popcnt(uint x) {
  x = x - ((x >> 1u) & uint(0x55555555u));
  x = (x & uint(0x33333333u)) + ((x >> 2u) & uint(0x33333333u));
  x = (x + (x >> 4u)) & uint(0x0F0F0F0Fu);
  return (x * uint(0x01010101u)) >> 24u;
}

uint _brev(uint x) {
  x = ((x >> 1u) & uint(0x55555555u)) | ((x & uint(0x55555555u)) << 1u);
  x = ((x >> 2u) & uint(0x33333333u)) | ((x & uint(0x33333333u)) << 2u);
  x = ((x >> 4u) & uint(0x0F0F0F0Fu)) | ((x & uint(0x0F0F0F0Fu)) << 4u);
  x = ((x >> 8u) & uint(0x00FF00FFu)) | ((x & uint(0x00FF00FFu)) << 8u);
  return (x >> 16u) | (x << 16u);
}

uint _msb(uint x) {
  uint r = uint(0u);
  uint s = uint(x >= 0x10000u) << 4u;
  x >>= s; r |= s;
  s = uint(x >= 0x100u) << 3u;
  x >>= s; r |= s;
  s = uint(x >= 0x10u) << 2u;
  x >>= s; r |= s;
  s = uint(x >= 0x4u) << 1u;
  x >>= s; r |= s;
  r |= x >> 1u;
  return r - uint(x == 0u);
}

uint _xbits(uint e, uint o, uint c) {
  o = min(o, 32u);
  c = min(c, 32u - o);
  if (c == 0u) return uint(0);
  return (e << (32u - o - c)) >> (32u - c);
}

uint _ibits(uint e, uint n, uint o, uint c) {
  o = min(o, 32u);
  c = min(c, 32u - o);
  if (c == 0u) return e;
  uint mask = uint((0xffffffffu >> (32u - c)) << o);
  return (e & ~mask) | ((n << o) & mask);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec2 c = (uv - vec2(0.5, 0.5));
  vec3 n = normalize(vec3(c.x, c.y, 0.6));
  vec3 toLight = normalize(vec3(-0.4, 0.5, 0.75));
  vec3 fromLight = normalize(vec3(0.4, -0.5, -0.75));
  vec3 toEye = vec3(0.0, 0.0, 1.0);
  vec3 fromEye = vec3(0.0, 0.0, -1.0);
  vec3 nf = faceforward(n, fromEye, n);
  float highlight = pow(max(dot(reflect(fromLight, nf), toEye), 0.0), 16.0);
  vec3 bent = refract(fromEye, nf, 0.75);
  float diffuse = (max(dot(nf, toLight), 0.0) * intBitsToFloat((-1 + 127) << 23));
  float gain = determinant(transpose(frame.m));
  uint col = (uint((uv.x * 255.0)) + 1u);
  uint lead = _msb(col);
  uint nibble = _xbits(_brev(col), 28u, 4u);
  uint word = _ibits(col, _popcnt(col), 8u, 4u);
  float _gv0 = float(lead);
  vec3 bands = vec3((_gv0 * 0.125), (float(nibble) * 0.0625), (float(_xbits(word, 8u, 4u)) * 0.125));
  float edge = min(fwidth(_gv0), 1.0);
  vec3 lit = (bands * diffuse);
  vec3 tint = (bent * 0.1);
  vec3 base = (lit + tint);
  float _lc0 = (highlight * gain);
  vec3 shine = vec3(_lc0, _lc0, _lc0);
  vec3 color = mix(base, vec3(1.0, 1.0, 1.0), edge);
  vec3 out_ = (color + shine);
  _ret = vec4(out_, 1.0);
}
