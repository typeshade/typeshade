#version 300 es
precision highp float;
precision highp int;

struct Rng {
  uint seed;
};

struct Orbit {
  float radius;
  float speed;
};
float Rng_next(inout Rng self_) {
  self_.seed = ((self_.seed * 1664525u) + 1013904223u);
  return (float((self_.seed >> 8u)) * 5.960464477539063e-8);
}

Rng Rng_new() {
  Rng self_ = Rng(0u);
  self_.seed = 7u;
  return self_;
}

float Orbit_get_period(Orbit self_) {
  return (6.2831855 / self_.speed);
}

void Orbit_set_span(inout Orbit self_, float d) {
  self_.radius = (d * 0.5);
}

vec2 Orbit_at(Orbit self_, float t) {
  float a = (t * self_.speed);
  return vec2((cos(a) * self_.radius), (sin(a) * self_.radius));
}

Orbit Orbit_new() {
  Orbit self_ = Orbit(0.0, 0.0);
  self_.radius = 0.45;
  self_.speed = 1.5;
  return self_;
}

float fs_falloff(float d) {
  return (0.004 / ((d * d) + 0.002));
}

vec2 pick_vec2(bool c, vec2 a, vec2 b) {
  if (c) {
    return a;
  }
  return b;
}

vec3 tint(float glow, float lit) {
  return vec3(((0.3 * glow) + lit), ((0.6 * glow) + (0.8 * lit)), (glow + (0.5 * lit)));
}

float ring(vec2 p, float r) {
  return (1.0 - smoothstep(0.0, 0.01, abs((length(p) - r))));
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 p = uv;
  Orbit orbit = Orbit_new();
  Orbit_set_span(orbit, 0.9);
  Rng rng = Rng_new();
  float glow = 0.0;
  for (int i = 0; (i < 5); i = (i + 1)) {
    float _seq0 = Rng_next(rng);
    float t = (((Orbit_get_period(orbit) * float(i)) / 5.0) + ((_seq0 - 0.5) * 0.3));
    vec2 a = Orbit_at(orbit, t);
    vec2 b = Orbit_at(orbit, (t + 0.05));
    glow += fs_falloff(distance(p, pick_vec2((distance(p, a) < distance(p, b)), a, b)));
  }
  vec3 col = min(tint(glow, ring(p, (orbit.radius * 0.6))), vec3(1.0, 1.0, 1.0));
  color = vec4(col, 1.0);
}
