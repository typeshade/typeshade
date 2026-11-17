#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float twist;
} U;
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float t = U.time;
  vec2 res = U.resolution;
  vec2 _sm0_a0 = uv;
  float _sm0_l_asp = (res.x / res.y);
  float _gv0 = (((_sm0_a0.x * 2.0) - 1.0) * _sm0_l_asp);
  float _gv1 = ((_sm0_a0.y * 2.0) - 1.0);
  vec2 _sm0_ret = vec2(_gv0, _gv1);
  float r = length(_sm0_ret);
  float a = atan(_gv1, _gv0);
  float depth = ((0.3 / max(r, 0.001)) + (t * 1.4));
  float ang = ((a / 3.14159265) + ((depth * U.twist) * 0.08));
  float cw = (sin((ang * 12.566)) * sin((depth * 9.4248)));
  float shade = ((smoothstep(-0.6, 0.6, cw) * 0.55) + 0.35);
  vec3 tint = mix(vec3(1.0, 0.62, 0.28), vec3(0.42, 0.3, 0.55), ((sin((depth * 0.9)) * 0.5) + 0.5));
  float fog = smoothstep(0.0, 0.55, r);
  float vig = clamp((1.15 - (r * 0.35)), 0.0, 1.0);
  _ret = vec4((((tint * shade) * fog) * vig), 1.0);
}
