#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
layout(location = 0) out vec4 _ret;

void main() {
  vec2 _cse0 = vec2(-0.45, 0.0);
  vec2 _i4a0 = vec2(0.45, 0.0);
  vec2 _i6a0 = vec2(0.0, 0.55);
  vec2 _i1a1 = uv;
  vec2 _i1_d = (_i1a1 - _cse0);
  float _i1_ret = (length(_i1_d) - 0.3);
  float _i1ret = (1.0 - smoothstep(0.0, 0.02, _i1_ret));
  vec2 _i3a1 = uv;
  vec2 _i3_d = (abs((_i3a1 - _i4a0)) - vec2(0.26));
  float _i3_ret = (length(max(_i3_d, vec2(0.0))) + min(max(_i3_d.x, _i3_d.y), 0.0));
  float _i3ret = (1.0 - smoothstep(0.0, 0.02, _i3_ret));
  vec2 _i5a1 = uv;
  vec2 _i5_d = (_i5a1 - _i6a0);
  float _i5ret = (length(_i5_d) - 0.22);
  vec3 lit = (((vec3(0.95, 0.42, 0.3) * _i1ret) + (vec3(0.36, 0.7, 0.98) * _i3ret)) + (vec3(0.98, 0.86, 0.4) * (1.0 - smoothstep(0.0, 0.02, (abs(_i5ret) - 0.05)))));
  _ret = vec4((lit + vec3(0.05, 0.05, 0.08)), 1.0);
}
