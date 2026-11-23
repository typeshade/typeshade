#version 300 es
precision highp float;
precision highp int;

struct Slot_f32 {
  float a;
  float b;
};

struct Level_f32 {
  float edge;
};
int _f2i(float x) {
  return int(mix(clamp(x, -2147483648.0, 2147483520.0), 0.0, isnan(x)));
}
Slot_f32 Slot_f32_new(float a, float b) {
  return Slot_f32(a, b);
}
layout(location = 0) out vec4 _ret;

void main() {
  vec4 p = gl_FragCoord;
  vec2 uv = fract((p.xy * 0.006));
  Slot_f32 gain = Slot_f32_new(1.15, 0.55);
  vec3 _i0a0 = vec3(0.95, 0.45, 0.28);
  vec3 _i0a1 = vec3(0.18, 0.55, 0.92);
  float[3] _i1a0 = float[3](0.2, 0.55, 0.9);
  float step = _i1a0[_f2i(floor((uv.y * 3.0)))];
  Level_f32 _i2_self_ = Level_f32(0.35);
  float edge = (smoothstep(0.0, _i2_self_.edge, uv.y) * 0.75);
  Slot_f32 _i3_sup = Slot_f32_new(0.4, 0.8);
  float k = (((mix(gain.b, gain.a, (uv.x > 0.5)) * step) * _i3_sup.a) * 0.5);
  _ret = vec4(((mix(_i0a1, _i0a0, bvec3((uv.y > 0.5))) * k) * edge), 1.0);
}
