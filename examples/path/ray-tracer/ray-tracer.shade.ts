"use typeshade";

// Step 17. A ray from the eye through each pixel hits two spheres and a floor, and bounces once.
interface Frame {
  size: vec2;
}

declare const frame: uniform<Frame>;

class Sphere {
  constructor(
    readonly center: vec3,
    readonly radius: f32,
    readonly color: vec3,
  ) {}

  hit(origin: vec3, direction: vec3): f32 {
    const offset = origin - this.center;
    const b = dot(offset, direction);
    const c = dot(offset, offset) - this.radius * this.radius;
    const discriminant = b * b - c;
    if (discriminant < 0.0) {
      return -1.0;
    }
    return -b - sqrt(discriminant);
  }
}

function sky(direction: vec3): vec3 {
  return mix(vec3(0.95, 0.9, 0.8), vec3(0.3, 0.5, 0.9), clamp(direction.y, 0.0, 1.0));
}

@fragment
export function fs(p: builtin<"position">): vec4 {
  const uv = (2.0 * p.xy - frame.size) / frame.size.y;
  const red = new Sphere(vec3(-0.6, -0.2, 0.0), 0.8, vec3(0.9, 0.2, 0.2));
  const blue = new Sphere(vec3(0.9, -0.5, 0.5), 0.5, vec3(0.2, 0.4, 0.9));
  const light = normalize(vec3(0.5, 1.0, 0.7));
  let origin = vec3(0.0, 0.0, 3.0);
  let direction = normalize(vec3(uv.x, -uv.y, -1.5));
  let weight = 1.0;
  let color = vec3(0.0, 0.0, 0.0);
  for (let bounce: i32 = 0; bounce < 2; bounce++) {
    let nearest = 1000.0;
    let normal = vec3(0.0, 1.0, 0.0);
    let albedo = vec3(0.0, 0.0, 0.0);
    const onRed = red.hit(origin, direction);
    if (onRed > 0.001 && onRed < nearest) {
      nearest = onRed;
      normal = normalize(origin + direction * onRed - red.center);
      albedo = red.color;
    }
    const onBlue = blue.hit(origin, direction);
    if (onBlue > 0.001 && onBlue < nearest) {
      nearest = onBlue;
      normal = normalize(origin + direction * onBlue - blue.center);
      albedo = blue.color;
    }
    if (direction.y < 0.0) {
      const onFloor = (-1.0 - origin.y) / direction.y;
      if (onFloor > 0.001 && onFloor < nearest) {
        nearest = onFloor;
        normal = vec3(0.0, 1.0, 0.0);
        const spot = origin + direction * onFloor;
        const tile = fract(0.5 * (floor(spot.x + 0.31) + floor(spot.z + 0.17)));
        albedo = vec3(0.35 + 0.5 * tile, 0.35 + 0.5 * tile, 0.35 + 0.5 * tile);
      }
    }
    if (nearest >= 1000.0) {
      color += weight * sky(direction);
      weight = 0.0;
      break;
    }
    const point = origin + direction * nearest;
    let lit = max(dot(normal, light), 0.0);
    if (red.hit(point, light) > 0.001 || blue.hit(point, light) > 0.001) {
      lit = lit * 0.3;
    }
    color += weight * 0.65 * albedo * (0.2 + 0.8 * lit);
    weight = weight * 0.35;
    origin = point;
    direction = reflect(direction, normal);
  }
  color += weight * sky(direction);
  return vec4(sqrt(color), 1.0);
}
