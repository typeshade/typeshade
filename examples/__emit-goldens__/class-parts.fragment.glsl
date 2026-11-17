#version 300 es
precision highp float;
precision highp int;

struct Mover {
  vec2 pos;
  vec2 vel;
};

struct Ring {
  Mover center;
  float radius;
  float width;
};

struct Dot {
  Mover center;
  float size;
};
void Mover_step(inout Mover self_, float dt) {
  self_.pos += (self_.vel * dt);
}

Mover Mover_new() {
  vec2 _cse0 = vec2(0.0, 0.0);
  Mover self_ = Mover(_cse0, _cse0);
  vec2 _cse1 = vec2(0.0);
  self_.pos = _cse1;
  self_.vel = _cse1;
  return self_;
}

void Ring_advance(inout Ring self_, float dt) {
  Mover_step(self_.center, dt);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  Ring ring = Ring(Mover(vec2(0.0, 0.0), vec2(0.0, 0.0)), 0.0, 0.0);
  ring.center = Mover_new();
  ring.radius = 0.3;
  ring.width = 0.04;
  ring.center.vel = vec2(0.5, 0.2);
  Ring_advance(ring, 0.5);
  Dot spot = Dot(Mover(vec2(0.0, 0.0), vec2(0.0, 0.0)), 0.0);
  spot.center = Mover_new();
  spot.size = 0.1;
  spot.center.pos = vec2(-0.45, -0.3);
  vec3 col = vec3(0.06, 0.07, 0.12);
  vec2 _sm3_a1 = uv;
  float _sm3_l_sm0_l_d = abs((length((_sm3_a1 - ring.center.pos)) - ring.radius));
  float _sm3_l_sm0_ret = (1.0 - smoothstep((ring.width * 0.5), ring.width, _sm3_l_sm0_l_d));
  col = mix(col, vec3(0.95, 0.7, 0.3), _sm3_l_sm0_ret);
  col = mix(col, vec3(0.3, 0.7, 0.95), (1.0 - smoothstep((spot.size * 0.8), spot.size, length((uv - spot.center.pos)))));
  color = vec4(col, 1.0);
}
