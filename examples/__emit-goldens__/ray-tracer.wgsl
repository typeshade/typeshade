struct Frame {
  size: vec2<f32>,
}

struct Sphere {
  center: vec3<f32>,
  radius: f32,
  color: vec3<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

fn Sphere_hit(self_: ptr<function, Sphere>, origin: vec3<f32>, direction: vec3<f32>) -> f32 {
  let offset = (origin - (*self_).center);
  let b = dot(offset, direction);
  let c = (dot(offset, offset) - ((*self_).radius * (*self_).radius));
  let discriminant = ((b * b) - c);
  if ((discriminant < 0.0)) {
    return -1.0;
  }
  return ((-b) - sqrt(discriminant));
}

fn sky(direction: vec3<f32>) -> vec3<f32> {
  return mix(vec3<f32>(0.95, 0.9, 0.8), vec3<f32>(0.3, 0.5, 0.9), clamp(direction.y, 0.0, 1.0));
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (((2.0 * p.xy) - frame.size) / frame.size.y);
  let _cse0 = vec3<f32>(-0.6, -0.2, 0.0);
  let _cse1 = vec3<f32>(0.9, 0.2, 0.2);
  var red: Sphere = Sphere(_cse0, 0.8, _cse1);
  let _cse2 = vec3<f32>(0.9, -0.5, 0.5);
  let _cse3 = vec3<f32>(0.2, 0.4, 0.9);
  var blue: Sphere = Sphere(_cse2, 0.5, _cse3);
  let light = normalize(vec3<f32>(0.5, 1.0, 0.7));
  var origin: vec3<f32> = vec3<f32>(0.0, 0.0, 3.0);
  var direction: vec3<f32> = normalize(vec3<f32>(uv.x, (-uv.y), -1.5));
  var weight: f32 = 1.0;
  let _cse4 = vec3<f32>(0.0, 0.0, 0.0);
  var color: vec3<f32> = _cse4;
  let _cse5 = vec3<f32>(0.0, 1.0, 0.0);
  for (var bounce: i32 = 0; (bounce < 2); bounce = (bounce + 1)) {
    var nearest: f32 = 1000.0;
    var normal: vec3<f32> = _cse5;
    var albedo: vec3<f32> = _cse4;
    let onRed = Sphere_hit(&red, origin, direction);
    let _ifc0 = ((onRed > 0.001) && (onRed < nearest));
    nearest = select(nearest, onRed, _ifc0);
    normal = select(normal, normalize(((origin + (direction * onRed)) - _cse0)), _ifc0);
    albedo = select(albedo, _cse1, _ifc0);
    let onBlue = Sphere_hit(&blue, origin, direction);
    let _ifc1 = ((onBlue > 0.001) && (onBlue < nearest));
    nearest = select(nearest, onBlue, _ifc1);
    normal = select(normal, normalize(((origin + (direction * onBlue)) - _cse2)), _ifc1);
    albedo = select(albedo, _cse3, _ifc1);
    if ((direction.y < 0.0)) {
      let onFloor = ((-1.0 - origin.y) / direction.y);
      if (((onFloor > 0.001) && (onFloor < nearest))) {
        nearest = onFloor;
        normal = _cse5;
        let spot = (origin + (direction * onFloor));
        let tile = fract((0.5 * (floor((spot.x + 0.31)) + floor((spot.z + 0.17)))));
        let _lc0 = (0.35 + (0.5 * tile));
        albedo = vec3<f32>(_lc0, _lc0, _lc0);
      }
    }
    if ((nearest >= 1000.0)) {
      color += (weight * sky(direction));
      weight = 0.0;
      break;
    }
    let point = (origin + (direction * nearest));
    var lit: f32 = max(dot(normal, light), 0.0);
    let _ifc2 = ((Sphere_hit(&red, point, light) > 0.001) || (Sphere_hit(&blue, point, light) > 0.001));
    lit = select(lit, (lit * 0.3), _ifc2);
    color += (((weight * 0.65) * albedo) * (0.2 + (0.8 * lit)));
    weight = (weight * 0.35);
    origin = point;
    direction = reflect(direction, normal);
  }
  color += (weight * sky(direction));
  return vec4<f32>(sqrt(color), 1.0);
}
