#version 300 es
precision highp float;
precision highp int;

struct Hit {
  float t;
  vec2 normal;
};

struct _opt_f32_ {
  float value;
  bool present;
};

struct _opt_Hit_ {
  Hit value;
  bool present;
};

struct _opt_vec2_f32_ {
  vec2 value;
  bool present;
};
Hit Hit_new() {
  Hit self_ = Hit(0.0, vec2(0.0, 0.0));
  return self_;
}

_opt_f32_ root(float x) {
  if ((x < 0.0)) {
    return _opt_f32_(0.0, false);
  }
  return _opt_f32_(sqrt(x), true);
}

float ramp(float x) {
  return (x * 0.5);
}

_opt_f32_ halfOf(float x) {
  if ((x <= 0.0)) {
    return _opt_f32_(0.0, false);
  }
  return _opt_f32_((x * 0.5), true);
}

float nearest(_opt_f32_ a, _opt_f32_ b) {
  if ((a.present && b.present)) {
    return min(a.value, b.value);
  }
  _opt_f32_ _sel0;
  if (a.present) {
    _sel0 = a;
  } else {
    _sel0 = b;
  }
  _opt_f32_ _opt = _sel0;
  return (_opt.present ? _opt.value : 1000.0);
}

_opt_Hit_ intersect(vec2 o, vec2 d, float r) {
  float b = dot(o, d);
  float c = (dot(o, o) - (r * r));
  float disc = ((b * b) - c);
  _opt_Hit_ _cse0 = _opt_Hit_(Hit(0.0, vec2(0.0, 0.0)), false);
  if ((disc < 0.0)) {
    return _cse0;
  }
  float t = ((-b) - sqrt(disc));
  if ((t < 0.0)) {
    return _cse0;
  }
  Hit h = Hit_new();
  h.t = t;
  h.normal = normalize((o + (d * t)));
  return _opt_Hit_(h, true);
}

float offsetOf(_opt_Hit_ h, float far) {
  _opt_f32_ _opt = _opt_f32_(h.value.t, h.present);
  return (_opt.present ? _opt.value : far);
}

float sampleOr_root(float x, float fallback) {
  _opt_f32_ v = root(x);
  if ((v.present == false)) {
    return fallback;
  }
  return v.value;
}

float sampleOr_ramp(float x, float fallback) {
  _opt_f32_ v = _opt_f32_(ramp(x), true);
  if ((v.present == false)) {
    return fallback;
  }
  return v.value;
}
in vec2 uv;
layout(location = 0) out vec4 color;

void main() {
  float x = ((uv.x * 2.0) - 1.0);
  _opt_f32_ shade = _opt_f32_(0.0, false);
  if ((uv.y > 0.5)) {
    shade = _opt_f32_(uv.y, true);
  }
  float r = (sampleOr_root(x, 0.0) + sampleOr_ramp(uv.x, 0.0));
  float g = (nearest(root(x), halfOf(uv.y)) * (shade.present ? shade.value : 0.25));
  vec2 o = ((uv * 2.0) - vec2(1.0, 1.0));
  _opt_Hit_ hit = intersect((o - vec2(0.0, 2.0)), vec2(0.0, 1.0), 0.5);
  float b = offsetOf(hit, 0.0);
  _opt_vec2_f32_ _opt = _opt_vec2_f32_(hit.value.normal, hit.present);
  vec2 n = (_opt.present ? _opt.value : vec2(0.0, 0.0));
  color = vec4(r, g, ((b * 0.5) + (n.x * 0.25)), 1.0);
}
