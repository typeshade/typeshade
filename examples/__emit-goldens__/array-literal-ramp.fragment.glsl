#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec3[3] stops = vec3[3](vec3(0.1, 0.1, 0.35), vec3(0.9, 0.4, 0.2), vec3(1.0, 0.95, 0.7));
  int[3] weights = int[3](1, 2, 1);
  int band = int((uv.x * 3.0));
  if ((band > 2)) {
    band = 2;
  }
  float w = (float(weights[band]) * 0.25);
  vec3 c = (stops[band] * (0.75 + w));
  color = vec4(c, 1.0);
}
