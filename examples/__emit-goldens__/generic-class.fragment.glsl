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
  float xs[3];
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
  vec3 _i0a0 = vec3(0.95, 0.45, 0.28);
  vec3 _i0a1 = vec3(0.18, 0.55, 0.92);
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Slot_vec3 _i0_self_ = Slot_vec3(_cse0, _cse0);
  _i0_self_.a = _i0a0;
  _i0_self_.b = _i0a1;
  Slot_vec3 tint = _i0_self_;
  float _i1a0[3] = float[3](0.2, 0.55, 0.9);
  Bag_f32 _i1_self_ = Bag_f32(float[3](0.0, 0.0, 0.0));
  _i1_self_.xs = _i1a0;
  Bag_f32 band = _i1_self_;
  float step = band.xs[_f2i(floor((uv.y * 3.0)))];
  Level_f32 _i2_self_ = Level_f32(0.0);
  _i2_self_.edge = 0.35;
  Level_f32 level = _i2_self_;
  float edge = (smoothstep(0.0, level.edge, uv.y) * 0.75);
  Marked _i3_self_ = Marked(0.0, 0.0, 0.0);
  Slot_f32 _i3_sup = Slot_f32_new(0.4, 0.8);
  _i3_self_.a = _i3_sup.a;
  _i3_self_.b = _i3_sup.b;
  _i3_self_.tag = 0.5;
  Marked marked = _i3_self_;
  float k = (((mix(gain.b, gain.a, (uv.x > 0.5)) * step) * marked.a) * marked.tag);
  _ret = vec4(((mix(tint.b, tint.a, bvec3((uv.y > 0.5))) * k) * edge), 1.0);
}
