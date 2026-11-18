#version 300 es
precision highp float;
precision highp int;

struct Ray {
  vec2 origin;
  vec2 dir;
};
void advance(inout Ray r, float t) {
  r.origin = (r.origin + (r.dir * t));
}

void liftAll_liftAt(inout float[3] ws, float k, int i) {
  ws[i] = mix(ws[i], 1.0, k);
}

void liftAll(inout float[3] ws, float k) {
  liftAll_liftAt(ws, k, 0);
  liftAll_liftAt(ws, k, 1);
  liftAll_liftAt(ws, k, 2);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float a = uv.x;
  float b = uv.y;
  float _list_0 = 0.0;
  float _list_1;
  if ((a > b)) {
    _list_0 = b;
    _list_1 = a;
  } else {
    _list_0 = a;
    _list_1 = b;
  }
  a = _list_0;
  b = _list_1;
  Ray r = Ray(vec2(0.0, 0.0), vec2(0.0, 0.0));
  r.origin = uv;
  r.dir = vec2(0.5, -0.25);
  advance(r, (b - a));
  float[3] w = float[3](a, b, 0.5);
  liftAll(w, 0.25);
  mat2 basis = mat2(vec2(1.0, 0.0), vec2(0.0, 1.0));
  basis[1] = (basis[1] * 0.5);
  vec2 q = (basis * (uv - vec2(0.5, 0.5)));
  color = vec4(fract((r.origin.x * 3.0)), (w[0] * w[1]), (w[2] * (1.0 - length(q))), 1.0);
}
