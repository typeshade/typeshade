#version 300 es
precision highp float;
precision highp int;

const vec3 WARM = vec3(1.0, 0.72, 0.42);
vec3 bands(vec2 uv, vec3 tint, float count) {
  float t = ((fract((uv.y * count)) * 0.35) + 0.65);
  return (tint * t);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec3 cool = bands(uv, vec3(0.38, 0.6, 1.0), 10.0);
  vec3 warm = bands(uv, WARM, 6.0);
  vec3 mixed = mix(cool, warm, smoothstep(-1.0, 1.0, uv.x));
  vec2 _i0a0 = uv;
  vec3 lit = (mixed * (1.0 - (0.8 * smoothstep(0.0, 1.35, dot(_i0a0, _i0a0)))));
  _ret = vec4(pow(max(lit, vec3(0.0)), vec3(0.45454545454545453)), 1.0);
}
