#version 300 es
precision highp float;
precision highp int;

uniform sampler2D trail;

layout(std140) uniform Uniforms {
  float time;
  vec2 resolution;
  uint frame;
} u;
int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}

ivec2 _f2i(vec2 x) {
  return ivec2(_f2i(x.x), _f2i(x.y));
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec3 before = texelFetch(trail, _f2i(gl_FragCoord.xy), int(0u)).rgb;
  float keep = ((u.frame == 0u) ? 0.0 : 0.96);
  float aspect = (u.resolution.x / max(u.resolution.y, 1.0));
  vec2 at = (vec2(0.5, 0.5) + (vec2(cos((u.time * 1.3)), sin((u.time * 2.1))) * 0.3));
  float d = length(((uv - at) * vec2(aspect, 1.0)));
  float spot = smoothstep(0.04, 0.0, d);
  vec3 hue = (vec3(0.5, 0.5, 0.5) + (vec3(cos(u.time), cos((u.time + 2.1)), cos((u.time + 4.2))) * 0.5));
  color = vec4(((before * keep) + (hue * (spot * 1.5))), 1.0);
}
