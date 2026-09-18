#version 300 es
precision highp float;
precision highp int;

struct Body {
  vec2 at;
  vec2 vel;
  float spin;
};
void Body_step(inout Body self_, float dt) {
  self_.at = (self_.at + (self_.vel * dt));
  self_.vel = (self_.vel * 0.985);
}

void Body_turn(inout Body self_, float dt) {
  float a = (self_.spin * dt);
  float c = cos(a);
  float s = sin(a);
  self_.vel = vec2(((self_.vel.x * c) - (self_.vel.y * s)), ((self_.vel.x * s) + (self_.vel.y * c)));
}

void Body_advance(inout Body self_, float dt) {
  Body_turn(self_, dt);
  Body_step(self_, dt);
}

float Body_reach(Body self_) {
  return length(self_.at);
}

Body Body_new() {
  vec2 _cse0 = vec2(0.0, 0.0);
  Body self_ = Body(_cse0, _cse0, 0.0);
  return self_;
}
layout(location = 0) out vec4 _ret;

void main() {
  vec4 frag = gl_FragCoord;
  vec2 uv = (fract((frag.xy * 0.01)) - vec2(0.5, 0.5));
  Body b = Body_new();
  b.at = uv;
  b.vel = (vec2((-uv.y), uv.x) * 0.4);
  b.spin = 2.2;
  for (int n = 0; (n < 8); n = (n + 1)) {
    Body_advance(b, 0.05);
  }
  float glow = (1.0 - smoothstep(0.0, 0.6, Body_reach(b)));
  _ret = vec4(glow, ((glow * 0.4) + (b.spin * 0.1)), (0.6 - (glow * 0.3)), 1.0);
}
