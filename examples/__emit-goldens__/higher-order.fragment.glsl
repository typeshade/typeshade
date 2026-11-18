#version 300 es
precision highp float;
precision highp int;

struct Ring {
  int n;
  float radius;
};
float around4_fs_petal(float r, vec2 p) {
  float _licm0 = p.x;
  float _licm1 = p.y;
  vec2 _licm2 = vec2(0.5, 0.0);
  float best = 1000.0;
  for (int i = 0; (i < 4); i = (i + 1)) {
    float a = (float(i) * 1.5707964);
    float _lc0 = cos(a);
    float _lc1 = sin(a);
    vec2 q = vec2(((_licm0 * _lc0) + (_licm1 * _lc1)), ((_licm1 * _lc0) - (_licm0 * _lc1)));
    best = min(best, (length((q - _licm2)) - r));
  }
  return best;
}

void fs_body(inout float glow, vec2 p, int i) {
  glow += (0.15 / (1.0 + (40.0 * abs(((length(p) - 0.3) - (0.05 * float(i)))))));
}

void times3_fs_body(inout float glow, vec2 p) {
  fs_body(glow, p, 0);
  fs_body(glow, p, 1);
  fs_body(glow, p, 2);
}

void fs_dot(inout float dots, vec2 p, vec2 c) {
  dots = max(dots, (1.0 - smoothstep(0.03, 0.04, length((p - c)))));
}

void Ring_each_fs_dot(inout float dots, vec2 p, Ring self_) {
  for (int i = 0; (i < self_.n); i = (i + 1)) {
    float a = ((float(i) * 6.2831855) / float(self_.n));
    fs_dot(dots, p, (vec2(cos(a), sin(a)) * self_.radius));
  }
}

bool array_some_fs_p(vec2 p, float[3] bands) {
  float _cse0 = length(p);
  if ((abs((_cse0 - bands[0])) < 0.012)) {
    return true;
  }
  if ((abs((_cse0 - bands[1])) < 0.012)) {
    return true;
  }
  if ((abs((_cse0 - bands[2])) < 0.012)) {
    return true;
  }
  return false;
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 p = uv;
  vec3 col = vec3(0.05, 0.06, 0.1);
  col = mix(col, vec3(0.95, 0.7, 0.3), (1.0 - smoothstep(0.0, 0.01, (length(p) - 0.2))));
  col = mix(col, vec3(0.3, 0.7, 0.95), (1.0 - smoothstep(0.0, 0.01, around4_fs_petal(0.1, p))));
  float glow = 0.0;
  times3_fs_body(glow, p);
  col += vec3((glow * 0.3), (glow * 0.2), (glow * 0.6));
  Ring _i0_self_ = Ring(0, 0.0);
  _i0_self_.n = 6;
  _i0_self_.radius = 0.7;
  Ring ring = _i0_self_;
  float dots = 0.0;
  Ring_each_fs_dot(dots, p, ring);
  col = mix(col, vec3(0.9, 0.3, 0.5), dots);
  float[3] bands = float[3](0.8, 0.88, 0.96);
  bool _ifc0 = array_some_fs_p(p, bands);
  col = mix(col, vec3(1.0), bvec3(_ifc0));
  color = vec4(col, 1.0);
}
