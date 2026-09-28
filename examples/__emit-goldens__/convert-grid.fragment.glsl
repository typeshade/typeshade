#version 300 es
precision highp float;
precision highp int;

uint _f2u(float x) {
  return uint(mix(clamp(x, 0.0, 4294967040.0), 0.0, isnan(x)));
}

uvec2 _f2u(vec2 x) {
  return uvec2(_f2u(x.x), _f2u(x.y));
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 scaled = (uv * 4.0);
  uvec2 cell = _f2u(scaled);
  vec2 back = vec2(cell);
  float shade = ((back.x + back.y) / 6.0);
  color = vec4(shade, (1.0 - shade), 0.35, 1.0);
}
