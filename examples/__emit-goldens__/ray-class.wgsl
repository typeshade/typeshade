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
  let _sm0_a0 = vec3<f32>(0.0, 0.0, 2.0);
  let _sm0_a1 = (vec3<f32>(v.uv, 0.0) + vec3<f32>(0.0, 0.0, -1.0));
  let _cse0 = vec3<f32>(0.0, 0.0, 0.0);
  var _sm0_l_self_: Ray = Ray(_cse0, _cse0);
  _sm0_l_self_.origin = _sm0_a0;
  _sm0_l_self_.dir = normalize(_sm0_a1);
  var ray: Ray = _sm0_l_self_;
  var _sm2_l_self_: Sphere = Sphere(_cse0, 0.0);
  _sm2_l_self_.radius = 1.0;
  var sphere: Sphere = _sm2_l_self_;
  var _sm1_ret: f32;
  let _sm1_l_oc = (ray.origin - sphere.center);
  let _sm1_l_b = dot(_sm1_l_oc, ray.dir);
  let _sm1_l_c = (dot(_sm1_l_oc, _sm1_l_oc) - (sphere.radius * sphere.radius));
  let _sm1_l_h = ((_sm1_l_b * _sm1_l_b) - _sm1_l_c);
  if ((_sm1_l_h < 0.0)) {
    _sm1_ret = -1.0;
  } else {
    _sm1_ret = ((-_sm1_l_b) - sqrt(_sm1_l_h));
  }
  let t = _sm1_ret;
  if ((t < 0.0)) {
    return vec4<f32>(0.05, 0.05, 0.1, 1.0);
  }
  let n = normalize(((ray.origin + (ray.dir * t)) - sphere.center));
  return vec4<f32>(((n * 0.5) + vec3<f32>(0.5)), 1.0);
}
