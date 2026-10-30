#version 300 es
precision highp float;
precision highp int;

struct Shape {
  vec2 center;
};

struct Circle {
  vec2 center;
  float radius;
};

struct Square {
  vec2 center;
  float extent;
};

struct Ring {
  vec2 center;
  float radius;
  float thickness;
};
Shape Shape_new(vec2 center) {
  Shape self_ = Shape(vec2(0.0, 0.0));
  self_.center = center;
  return self_;
}

float Circle_sdf(Circle self_, vec2 p) {
  vec2 d = (p - self_.center);
  return (length(d) - self_.radius);
}

Circle Circle_new(vec2 center, float radius) {
  Circle self_ = Circle(vec2(0.0, 0.0), 0.0);
  Shape _sup = Shape_new(center);
  self_.center = _sup.center;
  self_.radius = radius;
  return self_;
}

float Square_sdf(Square self_, vec2 p) {
  vec2 d = (abs((p - self_.center)) - vec2(self_.extent));
  return (length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0));
}

float Ring_super_Circle_sdf(Ring self_, vec2 p) {
  vec2 d = (p - self_.center);
  return (length(d) - self_.radius);
}

float Ring_sdf(Ring self_, vec2 p) {
  return (abs(Ring_super_Circle_sdf(self_, p)) - self_.thickness);
}

float _flow9_fused(vec2 _flow0_input, float _flow1_input, vec2 _flow6_input) {
  vec2 _flow10_part = vec2(0.0, 0.0);
  float _flow11_part = 0.0;
  Shape _flow15_whole = Shape_new(_flow0_input);
  vec2 _flow12_part = _flow15_whole.center;
  _flow10_part = _flow12_part;
  _flow11_part = _flow1_input;
  vec2 _flow13_part = _flow10_part;
  float _flow14_part = _flow11_part;
  return (1.0 - smoothstep(0.0, 0.02, Circle_sdf(Circle(_flow13_part, _flow14_part), _flow6_input)));
}

float _flow25_fused(vec2 _flow16_input, float _flow17_input, vec2 _flow22_input) {
  vec2 _flow26_part = vec2(0.0, 0.0);
  float _flow27_part = 0.0;
  Shape _flow31_whole = Shape_new(_flow16_input);
  vec2 _flow28_part = _flow31_whole.center;
  _flow26_part = _flow28_part;
  _flow27_part = _flow17_input;
  vec2 _flow29_part = _flow26_part;
  float _flow30_part = _flow27_part;
  return (1.0 - smoothstep(0.0, 0.02, Square_sdf(Square(_flow29_part, _flow30_part), _flow22_input)));
}

float _flow43_fused(vec2 _flow32_input, float _flow33_input, float _flow34_input, vec2 _flow40_input) {
  vec2 _flow44_part = vec2(0.0, 0.0);
  float _flow45_part = 0.0;
  float _flow46_part = 0.0;
  Circle _flow52_whole = Circle_new(_flow32_input, _flow33_input);
  vec2 _flow47_part = _flow52_whole.center;
  float _flow48_part = _flow52_whole.radius;
  _flow44_part = _flow47_part;
  _flow45_part = _flow48_part;
  _flow46_part = _flow34_input;
  vec2 _flow49_part = _flow44_part;
  float _flow50_part = _flow45_part;
  float _flow51_part = _flow46_part;
  return (1.0 - smoothstep(0.0, 0.02, Ring_sdf(Ring(_flow49_part, _flow50_part, _flow51_part), _flow40_input)));
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec3 lit = (((vec3(0.95, 0.42, 0.3) * _flow9_fused(vec2(-0.45, 0.0), 0.3, uv)) + (vec3(0.36, 0.7, 0.98) * _flow25_fused(vec2(0.45, 0.0), 0.26, uv))) + (vec3(0.98, 0.86, 0.4) * _flow43_fused(vec2(0.0, 0.55), 0.22, 0.05, uv)));
  _ret = vec4((lit + vec3(0.05, 0.05, 0.08)), 1.0);
}
