#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float twist;
} U;
vec2 screenCoords(vec2 uv, vec2 resolution) {
  float asp = (resolution.x / resolution.y);
  return vec2((((uv.x * 2.0) - 1.0) * asp), ((uv.y * 2.0) - 1.0));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float t = U.time;
  vec2 res = U.resolution;
  vec2 p = screenCoords(uv, res);
  float r = length(p);
  float a = atan(p.y, p.x);
  float depth = ((0.3 / max(r, 0.001)) + (t * 1.4));
  float ang = ((a / 3.14159265) + ((depth * U.twist) * 0.08));
  float cw = (sin((ang * 12.566)) * sin((depth * 9.4248)));
  float shade = ((smoothstep(-0.6, 0.6, cw) * 0.55) + 0.35);
  vec3 tint = mix(vec3(1.0, 0.62, 0.28), vec3(0.42, 0.3, 0.55), ((sin((depth * 0.9)) * 0.5) + 0.5));
  float fog = smoothstep(0.0, 0.55, r);
  float vig = clamp((1.15 - (r * 0.35)), 0.0, 1.0);
  _ret = vec4((((tint * shade) * fog) * vig), 1.0);
}
