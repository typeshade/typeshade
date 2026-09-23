#version 300 es
precision highp float;
precision highp int;

float circle(vec2 p) {
  return (length(p) - 0.2);
}

float cover_circle(vec2 p) {
  return (1.0 - smoothstep(0.0, 0.01, circle(p)));
}

float fs_petal(float r, vec2 q) {
  return (length((q - vec2(0.5, 0.0))) - r);
}

float around4_fs_petal(float r, vec2 p) {
  float _licm0 = p.x;
  float _licm1 = p.y;
  float best = 1000.0;
  for (int i = 0; (i < 4); i = (i + 1)) {
    float a = (float(i) * 1.5707964);
    float _lc0 = cos(a);
    float _lc1 = sin(a);
    vec2 q = vec2(((_licm0 * _lc0) + (_licm1 * _lc1)), ((_licm1 * _lc0) - (_licm0 * _lc1)));
    best = min(best, fs_petal(r, q));
  }
  return best;
}

float fs_f(float r, vec2 q) {
  return around4_fs_petal(r, q);
}

float cover_fs_f(float r, vec2 p) {
  return (1.0 - smoothstep(0.0, 0.01, fs_f(r, p)));
}

void fs_body(inout float glow, vec2 p, int i) {
  glow += (0.15 / (1.0 + (40.0 * abs(((length(p) - 0.3) - (0.05 * float(i)))))));
}

void times3_fs_body(inout float glow, vec2 p) {
  for (int i = 0; (i < 3); i = (i + 1)) {
    fs_body(glow, p, i);
  }
}

bool fs_any(vec2 p, float b) {
  return (abs((length(p) - b)) < 0.012);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 p = uv;
  vec3 col = vec3(0.05, 0.06, 0.1);
  col = mix(col, vec3(0.95, 0.7, 0.3), cover_circle(p));
  col = mix(col, vec3(0.3, 0.7, 0.95), cover_fs_f(0.1, p));
  float glow = 0.0;
  times3_fs_body(glow, p);
  col += vec3((glow * 0.3), (glow * 0.2), (glow * 0.6));
  float[3] bands = float[3](0.8, 0.88, 0.96);
  if (((fs_any(p, bands[0]) || fs_any(p, bands[1])) || fs_any(p, bands[2]))) {
    col = vec3(1.0, 1.0, 1.0);
  }
  color = vec4(col, 1.0);
}
