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

float Circle_coverage(Circle self_, vec2 p) {
  return (1.0 - smoothstep(0.0, 0.02, Circle_sdf(self_, p)));
}

Circle Circle_new(vec2 center, float radius) {
  Circle self_ = Circle(vec2(0.0, 0.0), 0.0);
  Shape _sup = Shape_new(center);
  self_.center = _sup.center;
  self_.radius = radius;
  return self_;
}

float Square_sdf(Square self_, vec2 p) {
  vec2 d = (abs((p - self_.center)) - vec2(self_.extent, self_.extent));
  return (length(max(d, vec2(0.0, 0.0))) + min(max(d.x, d.y), 0.0));
}

float Square_coverage(Square self_, vec2 p) {
  return (1.0 - smoothstep(0.0, 0.02, Square_sdf(self_, p)));
}

Square Square_new(vec2 center, float extent) {
  Square self_ = Square(vec2(0.0, 0.0), 0.0);
  Shape _sup = Shape_new(center);
  self_.center = _sup.center;
  self_.extent = extent;
  return self_;
}

float Ring_super_Circle_sdf(Ring self_, vec2 p) {
  vec2 d = (p - self_.center);
  return (length(d) - self_.radius);
}

float Ring_sdf(Ring self_, vec2 p) {
  return (abs(Ring_super_Circle_sdf(self_, p)) - self_.thickness);
}

float Ring_coverage(Ring self_, vec2 p) {
  return (1.0 - smoothstep(0.0, 0.02, Ring_sdf(self_, p)));
}

Ring Ring_new(vec2 center, float radius, float thickness) {
  Ring self_ = Ring(vec2(0.0, 0.0), 0.0, 0.0);
  Circle _sup = Circle_new(center, radius);
  self_.center = _sup.center;
  self_.radius = _sup.radius;
  self_.thickness = thickness;
  return self_;
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  Circle circle = Circle_new(vec2(-0.45, 0.0), 0.3);
  Square square = Square_new(vec2(0.45, 0.0), 0.26);
  Ring ring = Ring_new(vec2(0.0, 0.55), 0.22, 0.05);
  vec3 lit = (((vec3(0.95, 0.42, 0.3) * Circle_coverage(circle, uv)) + (vec3(0.36, 0.7, 0.98) * Square_coverage(square, uv))) + (vec3(0.98, 0.86, 0.4) * Ring_coverage(ring, uv)));
  _ret = vec4((lit + vec3(0.05, 0.05, 0.08)), 1.0);
}
