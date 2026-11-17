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

void Orbit_set_span(inout Orbit self_, float d) {
  self_.radius = (d * 0.5);
}

vec2 Orbit_at(Orbit self_, float t) {
  float a = (t * self_.speed);
  return (vec2(cos(a), sin(a)) * self_.radius);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 p = uv;
  Orbit orbit = Orbit(0.0, 0.0);
  orbit.radius = 0.45;
  orbit.speed = 1.5;
  Orbit_set_span(orbit, 0.9);
  Rng rng = Rng(0u);
  rng.seed = 7u;
  float glow = 0.0;
  for (int i = 0; (i < 5); i = (i + 1)) {
    float _seq0 = Rng_next(rng);
    float t = ((((6.2831855 / orbit.speed) * float(i)) / 5.0) + ((_seq0 - 0.5) * 0.3));
    vec2 a = Orbit_at(orbit, t);
    vec2 b = Orbit_at(orbit, (t + 0.05));
    bool _sm3_a0 = (distance(p, a) < distance(p, b));
    vec2 _sm3_ret;
    if (_sm3_a0) {
      _sm3_ret = a;
    } else {
      _sm3_ret = b;
    }
    float _sm2_a0 = distance(p, _sm3_ret);
    glow += (0.004 / ((_sm2_a0 * _sm2_a0) + 0.002));
  }
  float _sm4_a1 = (1.0 - smoothstep(0.0, 0.01, abs((length(p) - (orbit.radius * 0.6)))));
  vec3 col = min(vec3(((0.3 * glow) + _sm4_a1), ((0.6 * glow) + (0.8 * _sm4_a1)), (glow + (0.5 * _sm4_a1))), vec3(1.0));
  color = vec4(col, 1.0);
}
