#version 300 es
precision highp float;
precision highp int;

struct VsOut {
  vec4 pos;
  vec2 uv;
};
layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  float sun_az;
  float exaggeration;
} U;
vec3 normalize3(vec3 v) {
  return (v * (1.0 / length(v)));
}

float terrain(vec2 p, float t) {
  float h = (((sin(((p.x * 3.0) + t)) * cos((p.y * 3.0))) + ((sin(((p.x * 6.1) - (t * 0.7))) * cos((p.y * 5.3))) * 0.5)) + ((sin((p.x * 12.7)) * cos((p.y * 11.1))) * 0.25));
  return ((h * 0.28) + 0.5);
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  VsOut vo;
  vo.pos = gl_FragCoord;
  vo.uv = uv;
  vec2 uv = vo.uv;
  float t = U.time;
  float az = radians(U.sun_az);
  float ex = U.exaggeration;
  vec2 p = (uv * 6.0);
  float h = terrain(p, t);
  float hx = terrain(vec2((p.x + 0.015), p.y), t);
  float hy = terrain(vec2(p.x, (p.y + 0.015)), t);
  vec3 n = normalize3(vec3(((h - hx) * ex), ((h - hy) * ex), 0.015));
  vec3 sun = normalize3(vec3((cos(az) * 0.6), (sin(az) * 0.6), 0.55));
  float shade = clamp(dot(n, sun), 0.0, 1.0);
  vec3 low = vec3(0.16, 0.32, 0.2);
  vec3 mid = vec3(0.55, 0.49, 0.3);
  vec3 high = vec3(0.93, 0.93, 0.96);
  vec3 base = mix(mix(low, mid, smoothstep(0.3, 0.55, h)), high, smoothstep(0.62, 0.85, h));
  vec3 lit = (base * ((shade * 0.8) + 0.3));
  _ret = vec4(lit, 1.0);
}
