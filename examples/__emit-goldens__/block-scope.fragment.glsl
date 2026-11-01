#version 300 es
precision highp float;
precision highp int;

const float RINGS = 6.0;
uint _f2u(float x) {
  return uint(mix(clamp(x, 0.0, 4294967040.0), 0.0, isnan(x)));
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float r = length(uv);
  float band = (r * RINGS);
  band = (band - 1.0 * trunc(band / 1.0));
  vec2 cell = (uv * RINGS);
  cell = (cell - 1.0 * trunc(cell / 1.0));
  float acc_1 = (step(0.0, band) * 0.25);
  float acc_2 = (acc_1 + (step(0.25, band) * 0.25));
  float acc_3 = (acc_2 + (step(0.5, band) * 0.25));
  float acc_4 = (acc_3 + (step(0.75, band) * 0.25));
  float acc_5 = (acc_4 * (1.0 - (abs((band - 0.3333333333333333)) * 0.5)));
  float acc_6 = (acc_5 * (1.0 - (abs((band - 0.6666666666666666)) * 0.5)));
  float acc_7 = (acc_6 * (1.0 - (abs((band - 1.0)) * 0.5)));
  vec3 tint = vec3(0.1, 0.2, 0.5);
  if ((r < 0.5)) {
    float p_2 = (1.0 - (r * 2.0));
    tint = mix(tint, vec3(1.0, 0.9, 0.6), vec3(p_2, p_2, p_2));
  }
  uint levels = (_f2u((band * 255.0)) >> 4u);
  float stepped = (float((levels << 4u)) / 255.0);
  float grid = min(abs(cell.x), abs(cell.y));
  vec3 shaded = (((tint * acc_7) + (stepped * 0.1)) + (grid * 0.05));
  color = vec4(((shaded / RINGS) * 4.0), 1.0);
}
