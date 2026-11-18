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
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Ray _i0_self_ = Ray(_cse0, _cse0);
  _i0_self_.origin = _i0a0;
  _i0_self_.dir = normalize(_i0a1);
  Ray ray = _i0_self_;
  Sphere _i2_self_ = Sphere(_cse0, 0.0);
  _i2_self_.radius = 1.0;
  Sphere sphere = _i2_self_;
  vec3 _i1_oc = (ray.origin - sphere.center);
  float _i1_b = dot(_i1_oc, ray.dir);
  float _i1_c = (dot(_i1_oc, _i1_oc) - (sphere.radius * sphere.radius));
  float _i1_h = ((_i1_b * _i1_b) - _i1_c);
  float _i1ret = ((_i1_h < 0.0) ? -1.0 : ((-_i1_b) - sqrt(_i1_h)));
  if ((_i1ret < 0.0)) {
    return vec4(0.05, 0.05, 0.1, 1.0);
  }
  vec3 n = normalize(((ray.origin + (ray.dir * _i1ret)) - sphere.center));
  return vec4(((n * 0.5) + vec3(0.5)), 1.0);
}

void main() {
  VsOut v;
  v.pos = gl_FragCoord;
  v.uv = uv;
  _ret = fs_impl(v);
}
