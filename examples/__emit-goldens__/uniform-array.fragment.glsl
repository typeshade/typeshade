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
  float[4] _licm0 = U.weights;
  float acc = 0.0;
  for (int i = 0; (i < 4); i = (i + 1)) {
    acc = (acc + (_licm0[i] * float((i + 1))));
  }
  vec4 ramp = mix(U.stops[0], U.stops[1], clamp(uv.x, 0.0, 1.0));
  _ret = (ramp * (acc / max(U.count, 1.0)));
}
