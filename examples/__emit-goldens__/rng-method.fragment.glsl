#version 300 es
precision highp float;
precision highp int;

struct Rng {
  uint state;
};
float Rng_next(inout Rng self_) {
  self_.state = ((self_.state * 747796405u) + 2891336453u);
  uint word = (((self_.state >> ((self_.state >> 28u) + 4u)) ^ self_.state) * 277803737u);
  return (float((((word >> 22u) ^ word) >> 8u)) * 5.960464477539063e-8);
}

Rng Rng_new(uint seed) {
  Rng self_ = Rng(0u);
  self_.state = seed;
  Rng_next(self_);
  return self_;
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  uvec2 cell = uvec2(uint(((uv.x + 1.0) * 96.0)), uint(((uv.y + 1.0) * 96.0)));
  Rng rng = Rng_new((((cell.x * 1973u) + (cell.y * 9277u)) + 26699u));
  float _seq0 = Rng_next(rng);
  float _seq1 = Rng_next(rng);
  float _seq2 = Rng_next(rng);
  vec3 grain = vec3(_seq0, _seq1, _seq2);
  float _seq3 = Rng_next(rng);
  float _seq4;
  if ((_seq3 > 0.985)) {
    _seq4 = Rng_next(rng);
  } else {
    _seq4 = 0.0;
  }
  float sparkle = _seq4;
  vec3 base = mix(vec3(0.08, 0.1, 0.16), vec3(0.3, 0.22, 0.35), ((uv.y * 0.5) + 0.5));
  color = vec4(((base + ((grain - vec3(0.5, 0.5, 0.5)) * 0.12)) + vec3(sparkle, sparkle, sparkle)), 1.0);
}
