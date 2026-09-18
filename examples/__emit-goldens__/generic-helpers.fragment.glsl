#version 300 es
precision highp float;
precision highp int;

float pick_f32(bool c, float a, float b) {
  return (c ? a : b);
}

vec3 pick_vec3(bool c, vec3 a, vec3 b) {
  return (c ? a : b);
}

uint head_u32(uint[3] xs) {
  return xs[0];
}

float[2] pair_f32(float a, float b) {
  float[2] both = float[2](a, b);
  return both;
}
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.01));
  float gain = pick_f32((uv.x > 0.5), 1.2, 0.6);
  vec3 tint = pick_vec3((uv.y > 0.5), vec3(0.9, 0.4, 0.3), vec3(0.2, 0.6, 0.9));
  uint[3] steps = uint[3](2u, 3u, 5u);
  float band = (float(head_u32(steps)) * 0.1);
  float[2] span = pair_f32(uv.x, uv.y);
  _ret = vec4(((tint * gain) * ((span[0] + span[1]) + band)), 1.0);
}
