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
float Slot_f32_either(Slot_f32 self_, bool c) {
  return (c ? self_.a : self_.b);
}

Slot_f32 Slot_f32_new(float a, float b) {
  Slot_f32 self_ = Slot_f32(0.0, 0.0);
  self_.a = a;
  self_.b = b;
  return self_;
}

vec3 Slot_vec3_either(Slot_vec3 self_, bool c) {
  return (c ? self_.a : self_.b);
}

Slot_vec3 Slot_vec3_new(vec3 a, vec3 b) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Slot_vec3 self_ = Slot_vec3(_cse0, _cse0);
  self_.a = a;
  self_.b = b;
  return self_;
}

float Bag_f32_nth(Bag_f32 self_, int i) {
  return self_.xs[i];
}

Bag_f32 Bag_f32_new(float[3] xs) {
  Bag_f32 self_ = Bag_f32(float[3](0.0, 0.0, 0.0));
  self_.xs = xs;
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
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.006));
  Slot_f32 gain = Slot_f32_new(1.15, 0.55);
  Slot_vec3 tint = Slot_vec3_new(vec3(0.95, 0.45, 0.28), vec3(0.18, 0.55, 0.92));
  Bag_f32 band = Bag_f32_new(float[3](0.2, 0.55, 0.9));
  float step = Bag_f32_nth(band, int(floor((uv.y * 3.0))));
  Level_f32 level = Level_f32_new(0.35);
  float edge = (smoothstep(0.0, level.edge, uv.y) * Level_unit());
  Marked marked = Marked_new(0.4, 0.8, 0.5);
  float k = (((Slot_f32_either(gain, (uv.x > 0.5)) * step) * Marked_first(marked)) * marked.tag);
  _ret = vec4(((Slot_vec3_either(tint, (uv.y > 0.5)) * k) * edge), 1.0);
}
