#version 300 es
precision highp float;
precision highp int;

const float HORIZON = 8.0;
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.01));
  float _i0a0 = uv.x;
  float span_0 = (0.05 * _i0a0);
  float span_1 = (HORIZON * _i0a0);
  float depth = ((span_0 + span_1) * 0.5);
  _ret = vec4(uv.x, uv.y, (depth / HORIZON), 1.0);
}
