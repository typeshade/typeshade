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

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  var xs: array<f32, 3> = array<f32, 3>(-1.0, 3.0, -1.0);
  var ys: array<f32, 3> = array<f32, 3>(-1.0, -1.0, 3.0);
  let i = i32(vi);
  let p = vec2<f32>(xs[i], ys[i]);
  return VsOut(vec4<f32>(p, 0.0, 1.0), p);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4<f32> {
  let _i0a0 = vec3<f32>(0.0, 0.0, 2.0);
  let _i0a1 = (vec3<f32>(v.uv, 0.0) + vec3<f32>(0.0, 0.0, -1.0));
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _i0_self_: Ray = Ray(_cse0, _cse0);
  _i0_self_.origin = _i0a0;
  _i0_self_.dir = normalize(_i0a1);
  var ray: Ray = _i0_self_;
  var _i2_self_: Sphere = Sphere(_cse0, 0.0);
  _i2_self_.radius = 1.0;
  var sphere: Sphere = _i2_self_;
  let _i1_oc = (ray.origin - sphere.center);
  let _i1_b = dot(_i1_oc, ray.dir);
  let _i1_c = (dot(_i1_oc, _i1_oc) - (sphere.radius * sphere.radius));
  let _i1_h = ((_i1_b * _i1_b) - _i1_c);
  let _i1ret = select(((-_i1_b) - sqrt(_i1_h)), -1.0, (_i1_h < 0.0));
  if ((_i1ret < 0.0)) {
    return vec4<f32>(0.05, 0.05, 0.1, 1.0);
  }
  let n = normalize(((ray.origin + (ray.dir * _i1ret)) - sphere.center));
  return vec4<f32>(((n * 0.5) + vec3<f32>(0.5)), 1.0);
}
