struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct Ray {
  origin: vec3<f32>,
  dir: vec3<f32>,
}

struct Sphere {
  center: vec3<f32>,
  radius: f32,
}

fn Ray_at(self_: Ray, t: f32) -> vec3<f32> {
  return (self_.origin + (self_.dir * t));
}

fn Ray_forward() -> vec3<f32> {
  return vec3<f32>(0.0, 0.0, -1.0);
}

fn Ray_new(origin: vec3<f32>, dir: vec3<f32>) -> Ray {
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var self_: Ray = Ray(_cse0, _cse0);
  self_.origin = origin;
  self_.dir = normalize(dir);
  return self_;
}

fn Sphere_hit(self_: Sphere, r: Ray) -> f32 {
  let oc = (r.origin - self_.center);
  let b = dot(oc, r.dir);
  let c = (dot(oc, oc) - (self_.radius * self_.radius));
  let h = ((b * b) - c);
  if ((h < 0.0)) {
    return -1.0;
  }
  return ((-b) - sqrt(h));
}

fn Sphere_new() -> Sphere {
  var self_: Sphere = Sphere(vec3<f32>(0.0, 0.0, 0.0), 0.0);
  self_.radius = 1.0;
  return self_;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), p);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let ray = Ray_new(vec3<f32>(0.0, 0.0, 2.0), (vec3<f32>(v.uv, 0.0) + Ray_forward()));
  let sphere = Sphere_new();
  let t = Sphere_hit(sphere, ray);
  if ((t < 0.0)) {
    return vec4<f32>(0.05, 0.05, 0.1, 1.0);
  }
  let n = normalize((Ray_at(ray, t) - sphere.center));
  return vec4<f32>(((n * 0.5) + vec3<f32>(0.5, 0.5, 0.5)), 1.0);
}
