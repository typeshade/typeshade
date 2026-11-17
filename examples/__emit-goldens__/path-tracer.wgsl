const SPHERES: array<Sphere, 4> = array<Sphere, 4>(Sphere(vec3<f32>(0.0, (-100.5), (-1.0)), 100.0, vec3<f32>(0.8, 0.8, 0.8), vec3<f32>(0.0)), Sphere(vec3<f32>(0.0, 0.0, (-1.0)), 0.5, vec3<f32>(0.7, 0.3, 0.3), vec3<f32>(0.0)), Sphere(vec3<f32>((-1.0), 0.0, (-1.0)), 0.5, vec3<f32>(0.3, 0.7, 0.3), vec3<f32>(0.0)), Sphere(vec3<f32>(0.0, 2.0, (-1.0)), 0.7, vec3<f32>(0.0), vec3<f32>(6.0, 5.0, 4.0)));

struct Sphere {
  center: vec3<f32>,
  radius: f32,
  albedo: vec3<f32>,
  emission: vec3<f32>,
}

struct Frame {
  resolution: vec2<f32>,
  frame: f32,
  camPos: vec3<f32>,
}

@group(0) @binding(0) var<uniform> u: Frame;

fn trace(ro0: vec3<f32>, rd0: vec3<f32>, seed0: f32) -> vec3<f32> {
  let _licm0 = vec3<f32>(0.05, 0.07, 0.1);
  let _licm1 = vec3<f32>(0.0, 1.0, 0.0);
  let _licm2 = vec3<f32>(1.0, 0.0, 0.0);
  var ro: vec3<f32> = ro0;
  var rd: vec3<f32> = rd0;
  var seed: f32 = seed0;
  var throughput: vec3<f32> = vec3<f32>(1.0);
  var radiance: vec3<f32> = vec3<f32>(0.0);
  for (var bounce: i32 = 0; (bounce < 8); bounce = (bounce + 1)) {
    var tMin: f32 = 1e+30;
    var hit: i32 = -1;
    for (var i: i32 = 0; (i < 4); i = (i + 1)) {
      var _sm0_a0: Sphere = SPHERES[i];
      var _sm0_ret: f32;
      let _sm0_l_oc = (ro - _sm0_a0.center);
      let _sm0_l_b = dot(_sm0_l_oc, rd);
      let _sm0_l_c = (dot(_sm0_l_oc, _sm0_l_oc) - (_sm0_a0.radius * _sm0_a0.radius));
      let _sm0_l_h = ((_sm0_l_b * _sm0_l_b) - _sm0_l_c);
      if ((_sm0_l_h < 0.0)) {
        _sm0_ret = -1.0;
      } else {
        _sm0_ret = ((-_sm0_l_b) - sqrt(_sm0_l_h));
      }
      let t = _sm0_ret;
      if (((t > 0.001) && (t < tMin))) {
        tMin = t;
        hit = i;
      }
    }
    if ((hit < 0)) {
      radiance += (throughput * _licm0);
      break;
    }
    var s: Sphere = SPHERES[hit];
    let p = (ro + (rd * tMin));
    let n = normalize((p - s.center));
    radiance += (throughput * s.emission);
    throughput = (throughput * s.albedo);
    ro = (p + (n * 0.001));
    seed = (seed + 1.618);
    let _sm1_l_r1 = fract((sin(seed) * 43758.5453123));
    let _sm1_l_r2 = fract((sin((seed + 17.13)) * 43758.5453123));
    let _sm1_l_phi = (6.2831853 * _sm1_l_r1);
    let _sm1_l_r = sqrt(_sm1_l_r2);
    let _sm1_l_t = normalize(cross(select(_licm2, _licm1, (abs(n.x) > 0.9)), n));
    let _sm1_l_b = cross(n, _sm1_l_t);
    let _sm1_ret = normalize((((_sm1_l_t * (cos(_sm1_l_phi) * _sm1_l_r)) + (_sm1_l_b * (sin(_sm1_l_phi) * _sm1_l_r))) + (n * sqrt((1.0 - _sm1_l_r2)))));
    rd = _sm1_ret;
  }
  return radiance;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let _cse0 = i32(vi);
  let x = ((f32((_cse0 / 2)) * 4.0) - 1.0);
  let y = ((f32((_cse0 % 2)) * 4.0) - 1.0);
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let _licm0 = u.camPos;
  let _licm1 = (dot(pos.xy, vec2<f32>(12.9898, 78.233)) + (u.frame * 7.31));
  let uv = ((pos.xy - (u.resolution * 0.5)) / u.resolution.y);
  let rd = normalize(vec3<f32>(uv.x, (-uv.y), -1.0));
  var color: vec3<f32> = vec3<f32>(0.0);
  for (var s: i32 = 0; (s < 16); s = (s + 1)) {
    color += trace(_licm0, rd, (_licm1 + (f32(s) * 3.7)));
  }
  let c = (color * 0.0625);
  return vec4<f32>(pow((c / (c + 1.0)), vec3<f32>(0.45454545454545453)), 1.0);
}
