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
vec3 Ray_at(Ray self_, float t) {
  return (self_.origin + (self_.dir * t));
}

vec3 Ray_forward() {
  return vec3(0.0, 0.0, -1.0);
}

Ray Ray_new(vec3 origin, vec3 dir) {
  vec3 _cse0 = vec3(0.0, 0.0, 0.0);
  Ray self_ = Ray(_cse0, _cse0);
  self_.origin = origin;
  self_.dir = normalize(dir);
  return self_;
}

float Sphere_hit(Sphere self_, Ray r) {
  vec3 oc = (r.origin - self_.center);
  float b = dot(oc, r.dir);
  float c = (dot(oc, oc) - (self_.radius * self_.radius));
  float h = ((b * b) - c);
  if ((h < 0.0)) {
    return -1.0;
  }
  return ((-b) - sqrt(h));
}

Sphere Sphere_new() {
  Sphere self_ = Sphere(vec3(0.0, 0.0, 0.0), 0.0);
  self_.radius = 1.0;
  return self_;
}
in vec2 uv;
layout(location = 0) out vec4 _ret;

vec4 fs_impl(VsOut v) {
  Ray ray = Ray_new(vec3(0.0, 0.0, 2.0), (vec3(v.uv, 0.0) + Ray_forward()));
  Sphere sphere = Sphere_new();
  float t = Sphere_hit(sphere, ray);
  if ((t < 0.0)) {
    return vec4(0.05, 0.05, 0.1, 1.0);
  }
  vec3 n = normalize((Ray_at(ray, t) - sphere.center));
  return vec4(((n * 0.5) + vec3(0.5, 0.5, 0.5)), 1.0);
}

void main() {
  VsOut v;
  v.pos = gl_FragCoord;
  v.uv = uv;
  _ret = fs_impl(v);
}
