#version 300 es
precision highp float;
precision highp int;

uniform sampler2D trail;
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec3 hdr = textureLod(trail, uv, 0.0).rgb;
  vec3 mapped = (hdr / (hdr + vec3(1.0, 1.0, 1.0)));
  vec3 ground = vec3(0.03, 0.03, 0.06);
  color = vec4((ground + mapped), 1.0);
}
