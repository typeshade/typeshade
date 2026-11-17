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

float[2] swap(float a, float b) {
  return float[2](b, a);
}

float[2] order(float lo, float hi) {
  float[2] _sel0;
  if ((lo > hi)) {
    _sel0 = swap(lo, hi);
  } else {
    _sel0 = float[2](lo, hi);
  }
  return _sel0;
}

void advance(inout Ray r, float t) {
  r.origin = (r.origin + (r.dir * t));
}

float lift(float w, float k) {
  return mix(w, 1.0, k);
}

void liftAll_liftAt(inout float[3] ws, float k, int i) {
  ws[i] = lift(ws[i], k);
}

void liftAll(inout float[3] ws, float k) {
  liftAll_liftAt(ws, k, 0);
  liftAll_liftAt(ws, k, 1);
  liftAll_liftAt(ws, k, 2);
}

vec2 project(mat2 m, vec2 p) {
  return (m * p);
}

vec2 shrink(vec2 column, float k) {
  return (column * k);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float a = uv.x;
  float b = uv.y;
  float[2] _list = order(a, b);
  a = _list[0u];
  b = _list[1u];
  Ray r = Ray_new();
  r.origin = uv;
  r.dir = vec2(0.5, -0.25);
  advance(r, (b - a));
  float[3] w = float[3](a, b, 0.5);
  liftAll(w, 0.25);
  mat2 basis = mat2(vec2(1.0, 0.0), vec2(0.0, 1.0));
  basis[1] = shrink(basis[1], 0.5);
  vec2 q = project(basis, (uv - vec2(0.5, 0.5)));
  color = vec4(fract((r.origin.x * 3.0)), (w[0] * w[1]), (w[2] * (1.0 - length(q))), 1.0);
}
