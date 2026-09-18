#version 300 es
precision highp float;
precision highp int;

const vec3 WARM = vec3(1.0, 0.72, 0.42);
vec3 grade(vec3 c, float gamma) {
  float _cse0 = (1.0 / gamma);
  return pow(max(c, vec3(0.0, 0.0, 0.0)), vec3(_cse0, _cse0, _cse0));
}

float vignette(vec2 uv, float strength, float softness) {
  return (1.0 - (strength * smoothstep(0.0, softness, dot(uv, uv))));
}

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
  vec3 lit = (mixed * vignette(uv, 0.8, 1.35));
  _ret = vec4(grade(lit, 2.2), 1.0);
}
