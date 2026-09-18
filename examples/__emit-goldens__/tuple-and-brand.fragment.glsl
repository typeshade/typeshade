#version 300 es
precision highp float;
precision highp int;

const float HORIZON = 8.0;
float[2] bounds(float scale) {
  return float[2]((0.05 * scale), (HORIZON * scale));
}

float mid(float[2] span) {
  return ((span[0] + span[1]) * 0.5);
}
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.01));
  float[2] span = bounds(uv.x);
  float depth = mid(float[2](span[0], span[1]));
  _ret = vec4(uv.x, uv.y, (depth / HORIZON), 1.0);
}
