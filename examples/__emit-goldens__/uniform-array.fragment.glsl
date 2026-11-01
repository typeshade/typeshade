#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Palette {
  float count;
  float[4] weights;
  vec4[2] stops;
} U;
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float acc_1 = U.weights[0];
  float acc_2 = (acc_1 + (U.weights[1] * 2.0));
  float acc_3 = (acc_2 + (U.weights[2] * 3.0));
  float acc_4 = (acc_3 + (U.weights[3] * 4.0));
  vec4 ramp = mix(U.stops[0], U.stops[1], clamp(uv.x, 0.0, 1.0));
  _ret = (ramp * (acc_4 / max(U.count, 1.0)));
}
