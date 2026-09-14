#version 300 es
precision highp float;
precision highp int;

const uint TILES = 8u;
const int PHASE = -3;
const float GAMMA = 2.2;
const bool INVERT = true;
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float _cse0 = float(TILES);
  uint cx = uint((uv.x * _cse0));
  uint cy = uint((uv.y * _cse0));
  uint parity = (((cx + cy) + uint((PHASE + 8))) & 1u);
  float ramp = pow(uv.y, GAMMA);
  float dark = (ramp * 0.25);
  float v = ((parity == 0u) ? (INVERT ? dark : ramp) : (INVERT ? ramp : dark));
  _ret = vec4(v, v, v, 1.0);
}
