#version 300 es
precision highp float;
precision highp int;

struct VsOut {
  vec4 pos;
  vec2 uv;
};

struct Ray {
  vec3 origin;
  vec3 dir;
};

struct Sphere {
  vec3 center;
  float radius;
};
in vec2 uv;
layout(location = 0) out vec4 _ret;

vec4 fs_impl(VsOut v) {
  vec3 _i0a0 = vec3(0.0, 0.0, 2.0);
  vec3 _i0a1 = (vec3(v.uv, 0.0) + vec3(0.0, 0.0, -1.0));
  Ray _i0_self_ = Ray(_i0a0, normalize(_i0a1));
  Sphere _i2_self_ = Sphere(vec3(0.0, 0.0, 0.0), 1.0);
  vec3 _i1_oc = (_i0a0 - _i2_self_.center);
  float _i1_b = dot(_i1_oc, _i0_self_.dir);
  float _i1_c = (dot(_i1_oc, _i1_oc) - (_i2_self_.radius * _i2_self_.radius));
  float _i1_h = ((_i1_b * _i1_b) - _i1_c);
  float _i1ret = mix(((-_i1_b) - sqrt(_i1_h)), -1.0, (_i1_h < 0.0));
  if ((_i1ret < 0.0)) {
    return vec4(0.05, 0.05, 0.1, 1.0);
  }
  vec3 n = normalize(((_i0a0 + (_i0_self_.dir * _i1ret)) - _i2_self_.center));
  return vec4(((n * 0.5) + vec3(0.5)), 1.0);
}

void main() {
  VsOut v;
  v.pos = gl_FragCoord;
  v.uv = uv;
  _ret = fs_impl(v);
}
