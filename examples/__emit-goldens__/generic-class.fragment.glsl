#version 300 es
precision highp float;
precision highp int;

struct Slot_f32 {
  float a;
  float b;
};

struct Bag_f32 {
  float[3] xs;
};

struct Level_f32 {
  float edge;
};

struct Marked {
  float a;
  float b;
  float tag;
};
int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}
Slot_f32 Slot_f32_new(float a, float b) {
  Slot_f32 self_ = Slot_f32(0.0, 0.0);
  self_.a = a;
  self_.b = b;
  return self_;
}

Level_f32 Level_f32_new(float edge) {
  Level_f32 self_ = Level_f32(0.0);
  self_.edge = edge;
  return self_;
}

float Level_unit() {
  return 0.75;
}

float Marked_first(Marked self_) {
  return self_.a;
}

Marked Marked_new(float a, float b, float tag) {
  Marked self_ = Marked(0.0, 0.0, 0.0);
  Slot_f32 _sup = Slot_f32_new(a, b);
  self_.a = _sup.a;
  self_.b = _sup.b;
  self_.tag = tag;
  return self_;
}

float _flow8_fused(float _flow0_input, float _flow1_input, bool _flow5_input) {
  float _flow9_part = 0.0;
  float _flow10_part = 0.0;
  _flow9_part = _flow0_input;
  _flow10_part = _flow1_input;
  float _flow11_part = _flow9_part;
  float _flow12_part = _flow10_part;
  return (_flow5_input ? _flow11_part : _flow12_part);
}

float _flow19_fused(float[3] _flow13_input, int _flow16_input) {
  float _flow20_part = _flow13_input[0u];
  float _flow21_part = _flow13_input[1u];
  float _flow22_part = _flow13_input[2u];
  Bag_f32 _flow14_local = Bag_f32(float[3](0.0, 0.0, 0.0));
  _flow14_local.xs = float[3](_flow20_part, _flow21_part, _flow22_part);
  Bag_f32 _flow17_arg = _flow14_local;
  return _flow17_arg.xs[_flow16_input];
}

vec3 _flow32_fused(vec3 _flow24_input, vec3 _flow25_input, bool _flow29_input) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  vec3 _flow33_part = _cse0;
  vec3 _flow34_part = _cse0;
  _flow33_part = _flow24_input;
  _flow34_part = _flow25_input;
  vec3 _flow35_part = _flow33_part;
  vec3 _flow36_part = _flow34_part;
  return (_flow29_input ? _flow35_part : _flow36_part);
}
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.006));
  Level_f32 level = Level_f32_new(0.35);
  float edge = (smoothstep(0.0, level.edge, uv.y) * Level_unit());
  Marked marked = Marked_new(0.4, 0.8, 0.5);
  float k = (((_flow8_fused(1.15, 0.55, (uv.x > 0.5)) * _flow19_fused(float[3](0.2, 0.55, 0.9), _f2i(floor((uv.y * 3.0))))) * Marked_first(marked)) * marked.tag);
  _ret = vec4(((_flow32_fused(vec3(0.95, 0.45, 0.28), vec3(0.18, 0.55, 0.92), (uv.y > 0.5)) * k) * edge), 1.0);
}
