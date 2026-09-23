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
  self_.pos = _cse0;
  self_.vel = _cse0;
  return self_;
}

float Ring_cover(Ring self_, vec2 p) {
  float d = abs((length((p - self_.center.pos)) - self_.radius));
  return (1.0 - smoothstep((self_.width * 0.5), self_.width, d));
}

void Ring_advance(inout Ring self_, float dt) {
  Mover_step(self_.center, dt);
}

Ring Ring_new() {
  vec2 _cse0 = vec2(0.0, 0.0);
  Ring self_ = Ring(Mover(_cse0, _cse0), 0.0, 0.0);
  self_.center = Mover_new();
  self_.radius = 0.3;
  self_.width = 0.04;
  return self_;
}

float Dot_cover(Dot self_, vec2 p) {
  return (1.0 - smoothstep((self_.size * 0.8), self_.size, length((p - self_.center.pos))));
}

Dot Dot_new() {
  vec2 _cse0 = vec2(0.0, 0.0);
  Dot self_ = Dot(Mover(_cse0, _cse0), 0.0);
  self_.center = Mover_new();
  self_.size = 0.1;
  return self_;
}

float coverOf_Ring(Ring m, vec2 p) {
  return Ring_cover(m, p);
}

float coverOf_Dot(Dot m, vec2 p) {
  return Dot_cover(m, p);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  Ring ring = Ring_new();
  ring.center.vel = vec2(0.5, 0.2);
  Ring_advance(ring, 0.5);
  Dot spot = Dot_new();
  spot.center.pos = vec2(-0.45, -0.3);
  vec3 col = vec3(0.06, 0.07, 0.12);
  col = mix(col, vec3(0.95, 0.7, 0.3), coverOf_Ring(ring, uv));
  col = mix(col, vec3(0.3, 0.7, 0.95), coverOf_Dot(spot, uv));
  color = vec4(col, 1.0);
}
