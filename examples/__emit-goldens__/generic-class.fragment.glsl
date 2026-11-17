#version 300 es
precision highp float;
precision highp int;

struct Slot_f32 {
  float a;
  float b;
};

struct Slot_vec3 {
  vec3 a;
  vec3 b;
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
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.006));
  Slot_f32 gain = Slot_f32_new(1.15, 0.55);
  vec3 _sm0_a0 = vec3(0.95, 0.45, 0.28);
  vec3 _sm0_a1 = vec3(0.18, 0.55, 0.92);
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Slot_vec3 _sm0_l_self_ = Slot_vec3(_cse0, _cse0);
  _sm0_l_self_.a = _sm0_a0;
  _sm0_l_self_.b = _sm0_a1;
  Slot_vec3 tint = _sm0_l_self_;
  float[3] _sm1_a0 = float[3](0.2, 0.55, 0.9);
  Bag_f32 _sm1_l_self_ = Bag_f32(float[3](0.0, 0.0, 0.0));
  _sm1_l_self_.xs = _sm1_a0;
  Bag_f32 band = _sm1_l_self_;
  float step = band.xs[_f2i(floor((uv.y * 3.0)))];
  Level_f32 _sm2_l_self_ = Level_f32(0.0);
  _sm2_l_self_.edge = 0.35;
  Level_f32 level = _sm2_l_self_;
  float edge = (smoothstep(0.0, level.edge, uv.y) * 0.75);
  Marked _sm3_l_self_ = Marked(0.0, 0.0, 0.0);
  Slot_f32 _sm3_l_sup = Slot_f32_new(0.4, 0.8);
  _sm3_l_self_.a = _sm3_l_sup.a;
  _sm3_l_self_.b = _sm3_l_sup.b;
  _sm3_l_self_.tag = 0.5;
  Marked marked = _sm3_l_self_;
  float k = (((((uv.x > 0.5) ? gain.a : gain.b) * step) * marked.a) * marked.tag);
  _ret = vec4(((((uv.y > 0.5) ? tint.a : tint.b) * k) * edge), 1.0);
}
