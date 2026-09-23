const SPHERES: array<Sphere, 4> = array<Sphere, 4>(Sphere(vec3<f32>(0.0, (-100.5), (-1.0)), 100.0, vec3<f32>(0.8, 0.8, 0.8), vec3<f32>(0.0, 0.0, 0.0)), Sphere(vec3<f32>(0.0, 0.0, (-1.0)), 0.5, vec3<f32>(0.7, 0.3, 0.3), vec3<f32>(0.0, 0.0, 0.0)), Sphere(vec3<f32>((-1.0), 0.0, (-1.0)), 0.5, vec3<f32>(0.3, 0.7, 0.3), vec3<f32>(0.0, 0.0, 0.0)), Sphere(vec3<f32>(0.0, 2.0, (-1.0)), 0.7, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(6.0, 5.0, 4.0)));

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

fn hitSphere(s: Sphere, ro: vec3<f32>, rd: vec3<f32>) -> f32 {
  let oc = (ro - s.center);
  let b = dot(oc, rd);
  let c = (dot(oc, oc) - (s.radius * s.radius));
  let h = ((b * b) - c);
  if ((h < 0.0)) {
    return -1.0;
  }
  return ((-b) - sqrt(h));
}

fn cosineDir(n: vec3<f32>, seed: f32) -> vec3<f32> {
  let r1 = fract((sin(seed) * 43758.5453123));
  let r2 = fract((sin((seed + 17.13)) * 43758.5453123));
  let phi = (6.2831853 * r1);
  let r = sqrt(r2);
  let t = normalize(cross(select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), (abs(n.x) > 0.9)), n));
  let b = cross(n, t);
  return normalize((((t * (cos(phi) * r)) + (b * (sin(phi) * r))) + (n * sqrt((1.0 - r2)))));
}

fn trace(ro0: vec3<f32>, rd0: vec3<f32>, seed0: f32) -> vec3<f32> {
  let _licm0 = vec3<f32>(0.05, 0.07, 0.1);
  var ro: vec3<f32> = ro0;
  var rd: vec3<f32> = rd0;
  var seed: f32 = seed0;
  var throughput: vec3<f32> = vec3<f32>(1.0, 1.0, 1.0);
  var radiance: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  for (var bounce: i32 = 0; (bounce < 8); bounce = (bounce + 1)) {
    var tMin: f32 = 1e+30;
    var hit: i32 = -1;
    for (var i: i32 = 0; (i < 4); i = (i + 1)) {
      let t = hitSphere(SPHERES[i], ro, rd);
      if (((t > 0.001) && (t < tMin))) {
        tMin = t;
        hit = i;
      }
    }
    if ((hit < 0)) {
      radiance += (throughput * _licm0);
      break;
    }
    let s = SPHERES[hit];
    let p = (ro + (rd * tMin));
    let n = normalize((p - s.center));
    radiance += (throughput * s.emission);
    throughput = (throughput * s.albedo);
    ro = (p + (n * 0.001));
    seed = (seed + 1.618);
    rd = cosineDir(n, seed);
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
  var color: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  for (var s: i32 = 0; (s < 16); s = (s + 1)) {
    color += trace(_licm0, rd, (_licm1 + (f32(s) * 3.7)));
  }
  let c = (color * 0.0625);
  return vec4<f32>(pow((c / (c + 1.0)), vec3<f32>(0.45454545454545453, 0.45454545454545453, 0.45454545454545453)), 1.0);
}
