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

Circle Circle_new(vec2 center, float radius) {
  Circle self_ = Circle(vec2(0.0, 0.0), 0.0);
  Shape _sup = Shape_new(center);
  self_.center = _sup.center;
  self_.radius = radius;
  return self_;
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  Circle circle = Circle_new(vec2(-0.45, 0.0), 0.3);
  vec2 _i4a0 = vec2(0.45, 0.0);
  vec2 _cse0 = vec2(0.0, 0.0);
  Square _i4_self_ = Square(_cse0, 0.0);
  Shape _i4_sup = Shape_new(_i4a0);
  _i4_self_.center = _i4_sup.center;
  _i4_self_.extent = 0.26;
  Square square = _i4_self_;
  vec2 _i6a0 = vec2(0.0, 0.55);
  Ring _i6_self_ = Ring(_cse0, 0.0, 0.0);
  Circle _i6_sup = Circle_new(_i6a0, 0.22);
  _i6_self_.center = _i6_sup.center;
  _i6_self_.radius = _i6_sup.radius;
  _i6_self_.thickness = 0.05;
  Ring ring = _i6_self_;
  vec2 _i1a1 = uv;
  vec2 _i1_d = (_i1a1 - circle.center);
  float _i1_ret = (length(_i1_d) - circle.radius);
  float _i1ret = (1.0 - smoothstep(0.0, 0.02, _i1_ret));
  vec2 _i3a1 = uv;
  vec2 _i3_d = (abs((_i3a1 - square.center)) - vec2(square.extent));
  float _i3_ret = (length(max(_i3_d, vec2(0.0))) + min(max(_i3_d.x, _i3_d.y), 0.0));
  float _i3ret = (1.0 - smoothstep(0.0, 0.02, _i3_ret));
  vec2 _i5a1 = uv;
  vec2 _i5_d = (_i5a1 - ring.center);
  float _i5ret = (length(_i5_d) - ring.radius);
  vec3 lit = (((vec3(0.95, 0.42, 0.3) * _i1ret) + (vec3(0.36, 0.7, 0.98) * _i3ret)) + (vec3(0.98, 0.86, 0.4) * (1.0 - smoothstep(0.0, 0.02, (abs(_i5ret) - ring.thickness)))));
  _ret = vec4((lit + vec3(0.05, 0.05, 0.08)), 1.0);
}
