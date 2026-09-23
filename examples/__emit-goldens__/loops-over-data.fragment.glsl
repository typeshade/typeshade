#version 300 es
precision highp float;
precision highp int;

const float[3] WEIGHTS = float[3](0.25, 0.5, 0.25);
layout(std140) uniform Frame {
  int steps;
  int depth;
} frame;
float march(vec2 uv, int steps) {
  float _licm0 = length((uv - vec2(0.5, 0.5)));
  float acc = 0.0;
  float _cse0 = float(steps);
  for (int i = 0; (i < steps); i = (i + 1)) {
    float t = ((float(i) + 0.5) / _cse0);
    float d = abs((_licm0 - (t * 0.5)));
    acc += (exp(((-d) * 60.0)) / _cse0);
  }
  return acc;
}

int leaves(int depth) {
  int[16] stack = int[16](0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  int sp = 1;
  stack[0] = depth;
  int count = 0;
  for (int _w = 0; (sp > 0); _w = (_w + 1)) {
    sp -= 1;
    int d = stack[sp];
    if (((d <= 0) || (sp >= 14))) {
      count += 1;
    } else {
      int _gv0 = (d - 1);
      stack[sp] = _gv0;
      stack[(sp + 1)] = _gv0;
      sp += 2;
    }
  }
  return count;
}

float isqrt(float x) {
  float a = max(x, 0.0);
  float r = max(a, 1.0);
  for (int _w = 0; true; _w = (_w + 1)) {
    float next = (0.5 * (r + (a / r)));
    if ((abs((next - r)) < 0.0001)) {
      break;
    }
    r = next;
  }
  return r;
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float _licm0 = (uv.x * 4.0);
  float ring = march(uv, frame.steps);
  float n = float(leaves(frame.depth));
  float s = 0.0;
  float k = 0.0;
  for (uint _i = 0u; (_i < 3u); _i = (_i + 1u)) {
    float w = WEIGHTS[_i];
    s += ((w * isqrt((_licm0 + k))) * 0.5);
    k += 1.0;
  }
  color = vec4(ring, fract((n / 7.0)), s, 1.0);
}
