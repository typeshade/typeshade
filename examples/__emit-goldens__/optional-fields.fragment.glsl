#version 300 es
precision highp float;
precision highp int;

struct _opt_vec2_f32_ {
  vec2 value;
  bool present;
};

struct _opt_f32_ {
  float value;
  bool present;
};

struct Hit {
  float t;
  _opt_vec2_f32_ normal;
  _opt_f32_ radius;
};
Hit Hit_new() {
  Hit self_ = Hit(0.0, _opt_vec2_f32_(vec2(0.0, 0.0), false), _opt_f32_(0.0, false));
  return self_;
}

Hit intersect(vec2 o, vec2 d, float r) {
  Hit h = Hit_new();
  float b = dot(o, d);
  float c = (dot(o, o) - (r * r));
  float disc = ((b * b) - c);
  h.t = 1000.0;
  h.radius = _opt_f32_(r, true);
  if ((disc < 0.0)) {
    return h;
  }
  float t = ((-b) - sqrt(disc));
  if ((t < 0.0)) {
    h.t = 0.0;
    return h;
  }
  h.t = t;
  h.normal = _opt_vec2_f32_(normalize((o + (d * t))), true);
  return h;
}

float shadeOf(Hit h, vec2 light) {
  float _cse0 = (h.radius.present ? h.radius.value : 0.0);
  if (h.normal.present) {
    return (max(dot(h.normal.value, light), 0.0) + (_cse0 * 0.1));
  }
  return ((h.t * 0.5) + _cse0);
}

float clampTo(float x, _opt_f32_ limit) {
  if ((limit.present == false)) {
    return x;
  }
  return min(x, limit.value);
}

float sampleAll(_opt_f32_[4] samples) {
  float s = 0.0;
  for (int i = 0; (i < 4); i = (i + 1)) {
    s += (samples[i].present ? samples[i].value : 0.0);
  }
  return s;
}

float _flow7_fused(float _flow2_input, vec2 _flow4_input) {
  return (_flow2_input * 0.5);
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  vec2 o = ((uv * 2.0) - vec2(1.0, 1.0));
  vec2 _cse0 = vec2(0.0, 1.0);
  Hit hit = intersect((o - vec2(0.0, 2.0)), _cse0, 0.5);
  float r = shadeOf(hit, normalize(vec2(0.3, 1.0)));
  _opt_f32_ _cse1 = _opt_f32_(0.0, false);
  _opt_f32_[4] samples = _opt_f32_[4](_opt_f32_(uv.x, true), _cse1, _opt_f32_(uv.y, true), _cse1);
  float b = (clampTo(sampleAll(samples), _opt_f32_(0.75, true)) + clampTo((uv.x * 0.1), _cse1));
  color = vec4(r, _flow7_fused(uv.x, _cse0), b, 1.0);
}
