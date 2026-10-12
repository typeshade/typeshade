#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Sky {
  vec2 size;
  float time;
} sky;
layout(location = 0) out vec4 color;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = (p.xy / sky.size);
  color = vec4(uv.x, (1.0 - uv.y), (0.5 + (0.5 * cos(sky.time))), 1.0);
}
