#version 300 es
precision highp float;
precision highp int;

const vec3 UP = vec3(0.0, 1.0, 0.0);
const vec4 SKY = vec4(0.36, 0.55, 0.85, 1.0);
const float[3] STOPS = float[3](0.2, 0.5, 0.8);
const vec4[3] PALETTE = vec4[3](vec4(0.95, 0.55, 0.2, 1.0), vec4(0.2, 0.7, 0.45, 1.0), vec4(0.55, 0.3, 0.8, 1.0));
const float HALF = 0.5;
const vec3 GREY = vec3(HALF, HALF, HALF);
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float t = ((uv.x * HALF) + HALF);
  vec4 band = SKY;
  if ((t > STOPS[0])) {
    band = PALETTE[0];
  }
  if ((t > STOPS[1])) {
    band = PALETTE[1];
  }
  if ((t > STOPS[2])) {
    band = PALETTE[2];
  }
  vec3 tinted = ((band.rgb * HALF) + (GREY * HALF));
  color = vec4(tinted, 1.0);
}
