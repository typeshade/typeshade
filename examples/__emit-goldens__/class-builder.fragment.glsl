#version 300 es
precision highp float;
precision highp int;

struct Disc {
  float radius;
  vec2 center;
  vec3 tint;
};

struct Capped {
  float radius;
  vec2 center;
  vec3 tint;
};
const float Disc_SIZE = 0.2;
const float Capped_SIZE = 0.35;
Disc Disc_at(inout Disc self_, vec2 c) {
  self_.center = c;
  return self_;
}

void Disc_set_size(inout Disc self_, float r) {
  self_.radius = max(r, 0.01);
}

Disc Disc_sized(inout Disc self_, float r) {
  Disc_set_size(self_, r);
  return self_;
}

Disc Disc_tinted(inout Disc self_, vec3 c) {
  self_.tint = c;
  return self_;
}

float Disc_coverage(Disc self_, vec2 p) {
  return (1.0 - smoothstep((self_.radius - 0.01), self_.radius, length((p - self_.center))));
}

Disc Disc_new() {
  vec2 _cse0 = vec2(0.0, 0.0);
  Disc self_ = Disc(0.0, _cse0, vec3(0.0, 0.0, 0.0));
  self_.radius = 0.2;
  self_.center = _cse0;
  self_.tint = vec3(1.0, 1.0, 1.0);
  return self_;
}

Disc Disc_unit() {
  Disc d = Disc_new();
  Disc_set_size(d, Disc_SIZE);
  return d;
}

void Capped_super_Disc_set_size(inout Capped self_, float r) {
  self_.radius = max(r, 0.01);
}

void Capped_set_size(inout Capped self_, float r) {
  Capped_super_Disc_set_size(self_, min(r, 0.3));
}

float Capped_super_Disc_get_size(Capped self_) {
  return self_.radius;
}

float Capped_get_size(Capped self_) {
  return Capped_super_Disc_get_size(self_);
}

Capped Capped_at(inout Capped self_, vec2 c) {
  self_.center = c;
  return self_;
}

Capped Capped_tinted(inout Capped self_, vec3 c) {
  self_.tint = c;
  return self_;
}

float Capped_coverage(Capped self_, vec2 p) {
  return (1.0 - smoothstep((self_.radius - 0.01), self_.radius, length((p - self_.center))));
}

Capped Capped_new() {
  vec2 _cse0 = vec2(0.0, 0.0);
  Capped self_ = Capped(0.0, _cse0, vec3(0.0, 0.0, 0.0));
  self_.radius = 0.2;
  self_.center = _cse0;
  self_.tint = vec3(1.0, 1.0, 1.0);
  return self_;
}

Capped Capped_unit() {
  Capped d = Capped_new();
  Capped_set_size(d, Capped_SIZE);
  return d;
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  Disc a = Disc_unit();
  Disc_at(a, vec2(-0.45, 0.0));
  Disc_tinted(a, vec3(0.95, 0.74, 0.32));
  Capped b = Capped_unit();
  Capped_at(b, vec2(0.4, 0.0));
  Capped_tinted(b, vec3(0.3, 0.6, 0.95));
  Capped_set_size(b, (Capped_get_size(b) * 2.0));
  Disc _chain = Disc_new();
  Disc_at(_chain, vec2(0.0, 0.55));
  Disc_sized(_chain, 0.1);
  Disc c = Disc_tinted(_chain, vec3(0.9, 0.3, 0.4));
  vec3 col = mix(vec3(0.07, 0.08, 0.14), a.tint, Disc_coverage(a, uv));
  col = mix(col, b.tint, Capped_coverage(b, uv));
  col = mix(col, c.tint, Disc_coverage(c, uv));
  color = vec4(col, 1.0);
}
