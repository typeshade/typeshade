#version 300 es
precision highp float;
precision highp int;

vec4 discardOutsideCircle(vec2 p) {
  float r = length(p);
  if ((r > 1.0)) {
    discard;
  }
  float edge = fwidth(r);
  float rim = clamp(((1.0 - r) / (edge + 0.0001)), 0.0, 1.0);
  float fall = (exp2(((-r) * 2.0)) * (1.0 - pow(r, 2.0)));
  return vec4((mix(vec3(0.06, 0.1, 0.35), vec3(1.0, 1.0, 1.0), fall) * rim), 1.0);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec4 _dh0 = discardOutsideCircle(uv);
  color = _dh0;
}
