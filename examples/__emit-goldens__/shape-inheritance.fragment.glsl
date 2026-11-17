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
  vec2 _sm4_a0 = vec2(0.45, 0.0);
  vec2 _cse0 = vec2(0.0, 0.0);
  Square _sm4_l_self_ = Square(_cse0, 0.0);
  Shape _sm4_l_sup = Shape_new(_sm4_a0);
  _sm4_l_self_.center = _sm4_l_sup.center;
  _sm4_l_self_.extent = 0.26;
  Square square = _sm4_l_self_;
  vec2 _sm6_a0 = vec2(0.0, 0.55);
  Ring _sm6_l_self_ = Ring(_cse0, 0.0, 0.0);
  Circle _sm6_l_sup = Circle_new(_sm6_a0, 0.22);
  _sm6_l_self_.center = _sm6_l_sup.center;
  _sm6_l_self_.radius = _sm6_l_sup.radius;
  _sm6_l_self_.thickness = 0.05;
  Ring ring = _sm6_l_self_;
  vec2 _sm1_a1 = uv;
  vec2 _sm1_l_sm0_l_d = (_sm1_a1 - circle.center);
  float _sm1_l_sm0_ret = (length(_sm1_l_sm0_l_d) - circle.radius);
  float _sm1_ret = (1.0 - smoothstep(0.0, 0.02, _sm1_l_sm0_ret));
  vec2 _sm3_a1 = uv;
  vec2 _sm3_l_sm2_l_d = (abs((_sm3_a1 - square.center)) - vec2(square.extent));
  float _sm3_l_sm2_ret = (length(max(_sm3_l_sm2_l_d, vec2(0.0))) + min(max(_sm3_l_sm2_l_d.x, _sm3_l_sm2_l_d.y), 0.0));
  float _sm3_ret = (1.0 - smoothstep(0.0, 0.02, _sm3_l_sm2_ret));
  vec2 _sm5_a1 = uv;
  vec2 _sm5_l_d = (_sm5_a1 - ring.center);
  float _sm5_ret = (length(_sm5_l_d) - ring.radius);
  vec3 lit = (((vec3(0.95, 0.42, 0.3) * _sm1_ret) + (vec3(0.36, 0.7, 0.98) * _sm3_ret)) + (vec3(0.98, 0.86, 0.4) * (1.0 - smoothstep(0.0, 0.02, (abs(_sm5_ret) - ring.thickness)))));
  _ret = vec4((lit + vec3(0.05, 0.05, 0.08)), 1.0);
}
