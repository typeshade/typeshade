#version 300 es
precision highp float;
precision highp int;

const float RINGS = 6.0;
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float r = length(uv);
  float band = (r * RINGS);
  band = (band - 1.0 * trunc(band / 1.0));
  vec2 cell = (uv * RINGS);
  cell = (cell - 1.0 * trunc(cell / 1.0));
  float acc = 0.0;
  for (uint i = 0u; (i < 4u); i = (i + 1u)) {
    float p = (float(i) * 0.25);
    acc = (acc + (step(p, band) * 0.25));
  }
  for (uint i_1 = 0u; (i_1 < 3u); i_1 = (i_1 + 1u)) {
    float p_1 = (float((i_1 + 1u)) / 3.0);
    acc = (acc * (1.0 - (abs((band - p_1)) * 0.5)));
  }
  vec3 tint = vec3(0.1, 0.2, 0.5);
  if ((r < 0.5)) {
    float p_2 = (1.0 - (r * 2.0));
    tint = mix(tint, vec3(1.0, 0.9, 0.6), vec3(p_2, p_2, p_2));
  }
  uint levels = (uint((band * 255.0)) >> 4u);
  float stepped = (float((levels << 4u)) / 255.0);
  float grid = min(abs(cell.x), abs(cell.y));
  vec3 shaded = (((tint * acc) + (stepped * 0.1)) + (grid * 0.05));
  color = vec4(((shaded / RINGS) * 4.0), 1.0);
}
