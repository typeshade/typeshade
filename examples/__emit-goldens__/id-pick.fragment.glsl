#version 300 es
precision highp float;
precision highp int;

flat in uint id;
smooth centroid in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  float band = (float((id & 3u)) / 3.0);
  vec2 grid = fract((uv * 8.0));
  float line = (1.0 - step(0.06, min(grid.x, grid.y)));
  float _lc0 = (line * 0.4);
  _ret = (vec4(band, (uv.x * 0.5), (uv.y * 0.5), 1.0) + vec4(_lc0, _lc0, _lc0, 0.0));
}
