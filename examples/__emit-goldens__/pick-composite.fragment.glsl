#version 300 es
precision highp float;
precision highp int;

struct Palette {
  vec3 lo;
  vec3 hi;
};
layout(location = 0) out vec4 _ret;

void main() {
  vec4 frag = gl_FragCoord;
  vec2 uv = fract((frag.xy * 0.008));
  Palette warm = Palette(vec3(0.35, 0.1, 0.05), vec3(1.0, 0.75, 0.35));
  Palette cool = Palette(vec3(0.04, 0.1, 0.3), vec3(0.5, 0.85, 1.0));
  Palette _sel0;
  if ((uv.x > 0.5)) {
    _sel0 = warm;
  } else {
    _sel0 = cool;
  }
  Palette shade = _sel0;
  float[3] rising = float[3](0.15, 0.5, 0.9);
  float[3] falling = float[3](0.9, 0.5, 0.15);
  float[3] _sel1;
  if ((uv.y > 0.5)) {
    _sel1 = rising;
  } else {
    _sel1 = falling;
  }
  float[3] steps = _sel1;
  int band = int(floor((uv.y * 3.0)));
  float t = smoothstep(0.0, 1.0, steps[band]);
  _ret = vec4(mix(shade.lo, shade.hi, t), 1.0);
}
