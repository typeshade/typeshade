#version 300 es
precision highp float;
precision highp int;

const float[3] GAIN = float[3](0.5, 1.0, 1.5);
float gain(uint c, float x, float[3] by) {
  float _cse0 = ((x * GAIN[c]) * by[c]);
  switch (c) {
    case 2u: {
      return _cse0;
    }
    case 1u: {
      return _cse0;
    }
    default: {
      return _cse0;
    }
  }
}
layout(location = 0) out vec4 color;

void main() {
  vec4 p = gl_FragCoord;
  uint c = ((p.x < 16.0) ? 2u : ((p.x < 32.0) ? 1u : 0u));
  float[3] by = float[3](0.5, 0.5, 0.5);
  color = vec4(gain(c, 1.0, by), 0.25, 0.5, 1.0);
}
