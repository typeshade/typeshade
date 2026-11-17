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
  vec3 _sm0_a0 = vec3(0.0, 0.0, 2.0);
  vec3 _sm0_a1 = (vec3(v.uv, 0.0) + vec3(0.0, 0.0, -1.0));
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Ray _sm0_l_self_ = Ray(_cse0, _cse0);
  _sm0_l_self_.origin = _sm0_a0;
  _sm0_l_self_.dir = normalize(_sm0_a1);
  Ray ray = _sm0_l_self_;
  Sphere _sm2_l_self_ = Sphere(_cse0, 0.0);
  _sm2_l_self_.radius = 1.0;
  Sphere sphere = _sm2_l_self_;
  float _sm1_ret = 0.0;
  vec3 _sm1_l_oc = (ray.origin - sphere.center);
  float _sm1_l_b = dot(_sm1_l_oc, ray.dir);
  float _sm1_l_c = (dot(_sm1_l_oc, _sm1_l_oc) - (sphere.radius * sphere.radius));
  float _sm1_l_h = ((_sm1_l_b * _sm1_l_b) - _sm1_l_c);
  if ((_sm1_l_h < 0.0)) {
    _sm1_ret = -1.0;
  } else {
    _sm1_ret = ((-_sm1_l_b) - sqrt(_sm1_l_h));
  }
  float t = _sm1_ret;
  if ((t < 0.0)) {
    return vec4(0.05, 0.05, 0.1, 1.0);
  }
  vec3 n = normalize(((ray.origin + (ray.dir * t)) - sphere.center));
  return vec4(((n * 0.5) + vec3(0.5)), 1.0);
}

void main() {
  VsOut v;
  v.pos = gl_FragCoord;
  v.uv = uv;
  _ret = fs_impl(v);
}
