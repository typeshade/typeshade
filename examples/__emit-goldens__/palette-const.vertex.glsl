#version 300 es
precision highp float;
precision highp int;

const vec3 UP = vec3(0.0, 1.0, 0.0);
const vec4 SKY = vec4(0.36, 0.55, 0.85, 1.0);
const float[3] STOPS = float[3](0.2, 0.5, 0.8);
const vec4[3] PALETTE = vec4[3](vec4(0.95, 0.55, 0.2, 1.0), vec4(0.2, 0.7, 0.45, 1.0), vec4(0.55, 0.3, 0.8, 1.0));
const float HALF = 0.5;
const vec3 GREY = vec3(HALF, HALF, HALF);
out vec2 uv;

void main() {
  uint vi = uint(gl_VertexID);
  float x = ((float((vi & 1u)) * 4.0) - 1.0);
  float y = ((float((vi >> 1u)) * 4.0) - 1.0);
  gl_Position = vec4(x, (y * UP.y), 0.0, 1.0);
  uv = vec2(x, y);
}
