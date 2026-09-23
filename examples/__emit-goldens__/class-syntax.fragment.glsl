#version 300 es
precision highp float;
precision highp int;

struct Ring {
  float width;
  vec2 center;
  float radius;
};
const float Ring_MIN_WIDTH = 0.01;
float Ring_drawn = 0.0;
float Ring_get_width(Ring self_) {
  return self_.width;
}

void Ring_set_width(inout Ring self_, float w) {
  self_.width = max(w, Ring_MIN_WIDTH);
}

void Ring_set_relativeWidth(inout Ring self_, float f) {
  Ring_set_width(self_, (self_.radius * f));
}

float Ring_distance(Ring self_, vec2 p) {
  return (abs((length((p - self_.center)) - self_.radius)) - (self_.width * 0.5));
}

float Ring_coverage(Ring self_, vec2 p) {
  return (1.0 - smoothstep(0.0, 0.012, Ring_distance(self_, p)));
}

Ring Ring_new(vec2 center, float radius) {
  Ring self_ = Ring(0.0, vec2(0.0, 0.0), 0.0);
  self_.center = center;
  self_.radius = radius;
  self_.width = 0.05;
  return self_;
}

Ring Ring_get_unit() {
  return Ring_new(vec2(0.0, 0.0), 0.5);
}

void Ring_count() {
  Ring_drawn += 1.0;
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  Ring a = Ring_get_unit();
  Ring_set_relativeWidth(a, 0.16);
  Ring b = Ring_new(vec2(0.35, 0.2), 0.3);
  Ring_set_width(b, (Ring_get_width(b) - 0.1));
  Ring_count();
  Ring_count();
  float ink = max(Ring_coverage(a, uv), Ring_coverage(b, uv));
  vec3 tint = mix(vec3(0.07, 0.08, 0.14), vec3(0.95, 0.74, 0.32), ink);
  color = vec4((tint * (Ring_drawn * 0.5)), 1.0);
}
