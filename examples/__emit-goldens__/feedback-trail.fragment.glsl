#version 300 es
precision highp float;
precision highp int;

uniform sampler2D trail;
int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}

ivec2 _f2i(vec2 x) {
  return ivec2(_f2i(x.x), _f2i(x.y));
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec3 hdr = texelFetch(trail, _f2i(gl_FragCoord.xy), int(0u)).rgb;
  vec3 mapped = (hdr / (hdr + vec3(1.0, 1.0, 1.0)));
  vec3 ground = vec3(0.03, 0.03, 0.06);
  color = vec4((ground + mapped), 1.0);
}
