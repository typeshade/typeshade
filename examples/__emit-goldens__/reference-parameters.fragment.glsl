#version 300 es
precision highp float;
precision highp int;

struct Ray {
  vec2 origin;
  vec2 dir;
};
Ray Ray_new() {
  vec2 _cse0 = vec2(0.0, 0.0);
  Ray self_ = Ray(_cse0, _cse0);
  return self_;
}

void swap(inout float a, inout float b) {
  float t = a;
  a = b;
  b = t;
}

void order(inout float lo, inout float hi) {
  if ((lo > hi)) {
    swap(lo, hi);
  }
}

void advance(inout Ray r, float t) {
  r.origin = (r.origin + (r.dir * t));
}

void lift(inout float w, float k) {
  w = mix(w, 1.0, k);
}

void shrink(inout vec2 column, float k) {
  column = (column * k);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float a = uv.x;
  float b = uv.y;
  order(a, b);
  Ray r = Ray_new();
  r.origin = uv;
  r.dir = vec2(0.5, -0.25);
  advance(r, (b - a));
  float[3] w = float[3](a, b, 0.5);
  for (int i = 0; (i < 3); i = (i + 1)) {
    lift(w[i], 0.25);
  }
  mat2 basis = mat2(vec2(1.0, 0.0), vec2(0.0, 1.0));
  shrink(basis[1], 0.5);
  vec2 q = (basis * (uv - vec2(0.5, 0.5)));
  color = vec4(fract((r.origin.x * 3.0)), (w[0] * w[1]), (w[2] * (1.0 - length(q))), 1.0);
}
