"use typeshade";

/* @example
{
  "title": "Class-based ray tracer",
  "blurb": "A conventional object-oriented ray tracer expressed with TypeShade classes: Ray, Material, Sphere, PointLight, Camera, Scene and Renderer. Geometry intersection, material response and path tracing are separated into small class responsibilities while the full program remains ordinary TypeScript-style source.",
  "renderable": true
}
*/

const RAY_EPSILON: f32 = 0.003;
const MAX_BOUNCES: i32 = 3;
const SAMPLES_PER_PIXEL: i32 = 2;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

interface Frame {
  resolution: vec2;
  time: f32;
  frame: f32;
}

declare const u: uniform<Frame>;

class Ray {
  origin: vec3;
  direction: vec3;

  constructor(origin: vec3, direction: vec3) {
    this.origin = origin;
    this.direction = direction;
  }

  at(distance: f32): vec3 {
    return this.origin + this.direction * distance;
  }
}

class Material {
  albedo: vec3;
  metallic: f32;
  roughness: f32;
  emission: vec3;

  constructor(
    albedo: vec3,
    metallic: f32,
    roughness: f32,
    emission: vec3,
  ) {
    this.albedo = albedo;
    this.metallic = metallic;
    this.roughness = roughness;
    this.emission = emission;
  }

  directResponse(
    normal: vec3,
    viewDirection: vec3,
    lightDirection: vec3,
  ): vec3 {
    const ndl = max(dot(normal, lightDirection), 0.);
    const diffuse = this.albedo * (1. - this.metallic) * ndl;

    const halfDirection = normalize(lightDirection + viewDirection);
    const shininess = mix(
      16.,
      128.,
      1. - this.roughness,
    );
    const specular = pow(
      max(dot(normal, halfDirection), 0.),
      shininess,
    );

    const baseReflectance = mix(
      vec3(0.04),
      this.albedo,
      this.metallic,
    );
    const fresnel = baseReflectance
      + (vec3(1.) - baseReflectance)
      * pow(1. - max(dot(normal, viewDirection), 0.), 5.);

    return diffuse + fresnel * specular;
  }

  bounceWeight(): vec3 {
    return mix(this.albedo, vec3(1.), this.metallic) * 0.65;
  }
}

class Sphere {
  center: vec3;
  radius: f32;
  material: Material;

  constructor(
    center: vec3,
    radius: f32,
    material: Material,
  ) {
    this.center = center;
    this.radius = radius;
    this.material = material;
  }

  intersect(ray: Ray): f32 {
    const offset = ray.origin - this.center;
    const halfB = dot(offset, ray.direction);
    const c = dot(offset, offset) - this.radius * this.radius;
    const discriminant = halfB * halfB - c;

    if (discriminant < 0.) {
      return -1.;
    }

    const root = sqrt(discriminant);
    const nearDistance = -halfB - root;

    if (nearDistance > RAY_EPSILON) {
      return nearDistance;
    }

    const farDistance = -halfB + root;
    if (farDistance > RAY_EPSILON) {
      return farDistance;
    }

    return -1.;
  }

  normalAt(point: vec3): vec3 {
    return normalize(point - this.center);
  }
}

class Hit {
  distance: f32;
  sphereIndex: i32;

  constructor(distance: f32, sphereIndex: i32) {
    this.distance = distance;
    this.sphereIndex = sphereIndex;
  }

  isValid(): bool {
    return this.sphereIndex >= 0;
  }
}

class PointLight {
  position: vec3;
  color: vec3;
  intensity: f32;

  constructor(
    position: vec3,
    color: vec3,
    intensity: f32,
  ) {
    this.position = position;
    this.color = color;
    this.intensity = intensity;
  }

  irradianceAt(point: vec3): vec3 {
    const offset = this.position - point;
    const distanceSquared = max(dot(offset, offset), 1.);
    return this.color * (this.intensity / distanceSquared);
  }
}

class Camera {
  position: vec3;
  target: vec3;
  fov: f32;

  constructor(
    position: vec3,
    target: vec3,
    fov: f32,
  ) {
    this.position = position;
    this.target = target;
    this.fov = fov;
  }

  rayFor(ndc: vec2): Ray {
    const forward = normalize(this.target - this.position);
    const right = normalize(cross(forward, vec3(0., 1., 0.)));
    const up = cross(right, forward);
    const scale = tan(this.fov * 0.5);

    const direction = normalize(
      forward
        + right * ndc.x * scale
        + up * ndc.y * scale,
    );

    return new Ray(this.position, direction);
  }
}

class Scene {
  primary: Sphere;
  secondary: Sphere;
  gold: Sphere;
  ground: Sphere;
  light: PointLight;

  constructor() {
    this.primary = new Sphere(
      vec3(-1.1, 0., -1.6),
      1.,
      new Material(
        vec3(0.72, 0.12, 0.08),
        0.,
        0.42,
        vec3(0.),
      ),
    );

    this.secondary = new Sphere(
      vec3(1.0, 0.15, -1.9),
      1.05,
      new Material(
        vec3(0.08, 0.3, 0.82),
        0.15,
        0.24,
        vec3(0.),
      ),
    );

    this.gold = new Sphere(
      vec3(0., 1.25, -2.8),
      1.,
      new Material(
        vec3(0.9, 0.66, 0.12),
        0.95,
        0.1,
        vec3(0.),
      ),
    );

    this.ground = new Sphere(
      vec3(0., -1001.1, -1.5),
      1000.,
      new Material(
        vec3(0.7, 0.73, 0.78),
        0.,
        0.9,
        vec3(0.),
      ),
    );

    this.light = new PointLight(
      vec3(-2.5, 4.8, 2.0),
      vec3(1.0, 0.88, 0.72),
      70.,
    );
  }

  intersect(ray: Ray): Hit {
    let closestDistance = 1e30;
    let closestSphereIndex: i32 = -1;

    const primaryDistance = this.primary.intersect(ray);
    if (this.isCloser(primaryDistance, closestDistance)) {
      closestDistance = primaryDistance;
      closestSphereIndex = 0;
    }

    const secondaryDistance = this.secondary.intersect(ray);
    if (this.isCloser(secondaryDistance, closestDistance)) {
      closestDistance = secondaryDistance;
      closestSphereIndex = 1;
    }

    const goldDistance = this.gold.intersect(ray);
    if (this.isCloser(goldDistance, closestDistance)) {
      closestDistance = goldDistance;
      closestSphereIndex = 2;
    }

    const groundDistance = this.ground.intersect(ray);
    if (this.isCloser(groundDistance, closestDistance)) {
      closestDistance = groundDistance;
      closestSphereIndex = 3;
    }

    return new Hit(closestDistance, closestSphereIndex);
  }

  isVisible(point: vec3, normal: vec3): bool {
    const toLight = this.light.position - point;
    const lightDistanceSquared = dot(toLight, toLight);
    const lightDirection = normalize(toLight);
    const shadowRay = new Ray(
      point + normal * RAY_EPSILON,
      lightDirection,
    );

    const shadowHit = this.intersect(shadowRay);
    return !shadowHit.isValid()
      || shadowHit.distance * shadowHit.distance >= lightDistanceSquared - 0.01;
  }

  shade(ray: Ray, hit: Hit): vec3 {
    const sphere = this.sphereAt(hit.sphereIndex);
    const point = ray.at(hit.distance);
    const normal = sphere.normalAt(point);
    const viewDirection = -ray.direction;
    const lightDirection = normalize(this.light.position - point);
    let visibility: f32 = 0.;
    if (this.isVisible(point, normal)) {
      visibility = 1.;
    }

    return sphere.material.emission
      + visibility
      * this.light.irradianceAt(point)
      * sphere.material.directResponse(
        normal,
        viewDirection,
        lightDirection,
      );
  }

  sky(ray: Ray): vec3 {
    const horizon = vec3(0.12, 0.17, 0.28);
    const zenith = vec3(0.55, 0.72, 0.95);
    const skyFactor = max(ray.direction.y, 0.);
    return mix(horizon, zenith, skyFactor);
  }

  sphereAt(index: i32): Sphere {
    if (index == 0) {
      return this.primary;
    }
    if (index == 1) {
      return this.secondary;
    }
    if (index == 2) {
      return this.gold;
    }
    return this.ground;
  }

  private isCloser(distance: f32, currentBest: f32): bool {
    return distance > RAY_EPSILON && distance < currentBest;
  }
}

class Renderer {
  scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  trace(primaryRay: Ray, seed0: f32): vec3 {
    let ray = primaryRay;
    let throughput = vec3(1.);
    let radiance = vec3(0.);
    let seed = seed0;

    for (let bounce: i32 = 0; bounce < MAX_BOUNCES; bounce++) {
      const hit = this.scene.intersect(ray);

      if (!hit.isValid()) {
        radiance += throughput * this.scene.sky(ray);
        break;
      }

      radiance += throughput * this.scene.shade(ray, hit);

      const sphere = this.scene.sphereAt(hit.sphereIndex);
      const point = ray.at(hit.distance);
      const normal = sphere.normalAt(point);

      seed = seed + 7.13;
      const diffuseDirection = cosineDirection(normal, seed);
      const reflectedDirection = reflectDirection(ray.direction, normal);
      const bounceAmount = sphere.material.metallic
        + (1. - sphere.material.roughness) * 0.25;
      const nextDirection = normalize(
        mix(diffuseDirection, reflectedDirection, bounceAmount),
      );

      throughput = throughput * sphere.material.bounceWeight();
      ray = new Ray(
        point + normal * RAY_EPSILON,
        nextDirection,
      );
    }

    return radiance;
  }
}

function cosineDirection(normal: vec3, seed: f32): vec3 {
  const r1 = random(seed);
  const r2 = random(seed + 17.13);
  const phi = 6.2831853 * r1;
  const radius = sqrt(r2);

  const tangent = normalize(
    cross(
      abs(normal.x) > 0.9
        ? vec3(0., 1., 0.)
        : vec3(1., 0., 0.),
      normal,
    ),
  );
  const bitangent = cross(normal, tangent);

  return normalize(
    tangent * (cos(phi) * radius)
      + bitangent * (sin(phi) * radius)
      + normal * sqrt(1. - r2),
  );
}

function reflectDirection(direction: vec3, normal: vec3): vec3 {
  return direction - normal * (2. * dot(direction, normal));
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;

  return {
    pos: vec4(x, y, 0., 1.),
    uv: vec2(x, y),
  };
}

function createCamera(time: f32): Camera {
  return new Camera(
    vec3(
      sin(time * 0.17) * 6.2,
      2.0 + sin(time * 0.31) * 0.12,
      cos(time * 0.17) * 6.2,
    ),
    vec3(0., 0.65, -1.7),
    1.0,
  );
}

function renderSample(
  renderer: Renderer,
  camera: Camera,
  position: vec2,
  resolution: vec2,
  frame: f32,
  sample: i32,
): vec3 {
  const uv = (position - resolution * 0.5 + vec2(0.5))
    / resolution.y;
  const jitter = pixelJitter(position, frame, sample);
  const sampleUv = vec2(
    uv.x + jitter.x / resolution.x,
    uv.y + jitter.y / resolution.y,
  );
  const ray = camera.rayFor(
    sampleUv * vec2(resolution.x / resolution.y, 1.),
  );
  const seed = dot(position, vec2(17.17, 73.19))
    + frame * 11.3
    + f32(sample) * 3.7;

  return renderer.trace(ray, seed);
}

function toneMap(color: vec3): vec3 {
  const mapped = color / (color + vec3(1.));
  return pow(mapped, vec3(1. / 2.2));
}

@fragment
export function fs(v: VsOut): vec4 {
  const camera = createCamera(u.time);
  const renderer = new Renderer(new Scene());

  let color = vec3(0.);
  for (let sample: i32 = 0; sample < SAMPLES_PER_PIXEL; sample++) {
    color += renderSample(
      renderer,
      camera,
      v.pos.xy,
      u.resolution,
      u.frame,
      sample,
    );
  }

  color = toneMap(color / f32(SAMPLES_PER_PIXEL));
  return vec4(color, 1.);
}

function pixelJitter(
  position: vec2,
  frame: f32,
  sample: i32,
): vec2 {
  return vec2(
    random(
      dot(position, vec2(12.9898, 78.233))
        + frame * 0.71
        + f32(sample) * 19.17,
    ) - 0.5,
    random(
      dot(position, vec2(39.346, 11.135))
        + frame * 1.17
        + f32(sample) * 7.91,
    ) - 0.5,
  );
}
"
