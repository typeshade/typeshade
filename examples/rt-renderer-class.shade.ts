"use typeshade";

/* @example
{
  "title": "Class-based 3D SDF ray tracer",
  "blurb": "A 3D signed-distance-field renderer built with an abstract SdfShape base class and concrete Sphere, Box, Torus and Plane subclasses. The shared base owns materials and finite-difference normals; each subclass supplies its distance field, while Scene performs sphere tracing and Renderer handles lighting, reflections and sampling.",
  "renderable": true
}
*/

const SURFACE_EPSILON: f32 = 0.001;
const RAY_EPSILON: f32 = 0.003;
const MAX_DISTANCE: f32 = 40.;
const MAX_STEPS: i32 = 96;
const MAX_BOUNCES: i32 = 3;
const SAMPLES_PER_PIXEL: i32 = 2;

class VsOut {
  @builtin("position") pos: vec4;
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
    const shininess = mix(16., 128., 1. - this.roughness);
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

abstract class SdfShape {
  material: Material;

  constructor(material: Material) {
    this.material = material;
  }

  /** Every concrete primitive supplies its signed distance; the shared normal uses that method. */
  abstract distanceTo(point: vec3): f32;

  normalAt(point: vec3): vec3 {
    const epsilon = 0.0015;
    const dx = this.distanceTo(point + vec3(epsilon, 0., 0.))
      - this.distanceTo(point - vec3(epsilon, 0., 0.));
    const dy = this.distanceTo(point + vec3(0., epsilon, 0.))
      - this.distanceTo(point - vec3(0., epsilon, 0.));
    const dz = this.distanceTo(point + vec3(0., 0., epsilon))
      - this.distanceTo(point - vec3(0., 0., epsilon));

    return normalize(vec3(dx, dy, dz));
  }
}

class SdfSphere extends SdfShape {
  center: vec3;
  radius: f32;

  constructor(
    center: vec3,
    radius: f32,
    material: Material,
  ) {
    super(material);
    this.center = center;
    this.radius = radius;
  }

  distanceTo(point: vec3): f32 {
    return length(point - this.center) - this.radius;
  }
}

class SdfBox extends SdfShape {
  center: vec3;
  halfSize: vec3;

  constructor(
    center: vec3,
    halfSize: vec3,
    material: Material,
  ) {
    super(material);
    this.center = center;
    this.halfSize = halfSize;
  }

  distanceTo(point: vec3): f32 {
    const local = abs(point - this.center) - this.halfSize;
    const outside = max(local, vec3(0.));
    const inside = min(
      max(local.x, max(local.y, local.z)),
      0.,
    );
    return length(outside) + inside;
  }
}

class SdfTorus extends SdfShape {
  center: vec3;
  majorRadius: f32;
  minorRadius: f32;

  constructor(
    center: vec3,
    majorRadius: f32,
    minorRadius: f32,
    material: Material,
  ) {
    super(material);
    this.center = center;
    this.majorRadius = majorRadius;
    this.minorRadius = minorRadius;
  }

  distanceTo(point: vec3): f32 {
    const local = point - this.center;
    const ring = length(vec2(local.x, local.z)) - this.majorRadius;
    return length(vec2(ring, local.y)) - this.minorRadius;
  }
}

class SdfPlane extends SdfShape {
  height: f32;

  constructor(
    height: f32,
    material: Material,
  ) {
    super(material);
    this.height = height;
  }

  distanceTo(point: vec3): f32 {
    return point.y - this.height;
  }
}

class Hit {
  distance: f32;
  objectIndex: i32;

  constructor(distance: f32, objectIndex: i32) {
    this.distance = distance;
    this.objectIndex = objectIndex;
  }

  isValid(): bool {
    return this.objectIndex >= 0;
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
  lookAt: vec3;
  fov: f32;

  constructor(
    position: vec3,
    lookAt: vec3,
    fov: f32,
  ) {
    this.position = position;
    this.lookAt = lookAt;
    this.fov = fov;
  }

  rayFor(ndc: vec2): Ray {
    const forward = normalize(this.lookAt - this.position);
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
  redSphere: SdfSphere;
  blueBox: SdfBox;
  goldTorus: SdfTorus;
  ground: SdfPlane;
  light: PointLight;

  constructor() {
    this.redSphere = new SdfSphere(
      vec3(-1.15, 0.2, -1.7),
      1.0,
      new Material(
        vec3(0.78, 0.12, 0.08),
        0.,
        0.4,
        vec3(0.),
      ),
    );

    this.blueBox = new SdfBox(
      vec3(1.05, 0.25, -2.0),
      vec3(0.75, 0.75, 0.75),
      new Material(
        vec3(0.08, 0.3, 0.84),
        0.2,
        0.3,
        vec3(0.),
      ),
    );

    this.goldTorus = new SdfTorus(
      vec3(0., 1.35, -2.9),
      0.72,
      0.24,
      new Material(
        vec3(0.95, 0.65, 0.1),
        0.9,
        0.12,
        vec3(0.),
      ),
    );

    this.ground = new SdfPlane(
      -1.0,
      new Material(
        vec3(0.68, 0.72, 0.8),
        0.,
        0.92,
        vec3(0.),
      ),
    );

    this.light = new PointLight(
      vec3(-2.5, 4.8, 2.0),
      vec3(1.0, 0.88, 0.72),
      70.,
    );
  }

  sample(point: vec3): Hit {
    let closestDistance = MAX_DISTANCE;
    let closestObjectIndex: i32 = -1;

    const sphereDistance = this.redSphere.distanceTo(point);
    if (sphereDistance < closestDistance) {
      closestDistance = sphereDistance;
      closestObjectIndex = 0;
    }

    const boxDistance = this.blueBox.distanceTo(point);
    if (boxDistance < closestDistance) {
      closestDistance = boxDistance;
      closestObjectIndex = 1;
    }

    const torusDistance = this.goldTorus.distanceTo(point);
    if (torusDistance < closestDistance) {
      closestDistance = torusDistance;
      closestObjectIndex = 2;
    }

    const groundDistance = this.ground.distanceTo(point);
    if (groundDistance < closestDistance) {
      closestDistance = groundDistance;
      closestObjectIndex = 3;
    }

    return new Hit(closestDistance, closestObjectIndex);
  }

  raymarch(ray: Ray, maxDistance: f32): Hit {
    let distance = 0.;
    let objectIndex: i32 = -1;

    for (let step: i32 = 0; step < MAX_STEPS; step++) {
      const point = ray.at(distance);
      const field = this.sample(point);

      if (field.distance < SURFACE_EPSILON) {
        objectIndex = field.objectIndex;
        return new Hit(distance, objectIndex);
      }

      distance = distance + field.distance;

      if (distance > maxDistance) {
        break;
      }
    }

    return new Hit(-1., objectIndex);
  }

  normalAt(index: i32, point: vec3): vec3 {
    if (index === 0) {
      return this.redSphere.normalAt(point);
    }
    if (index === 1) {
      return this.blueBox.normalAt(point);
    }
    if (index === 2) {
      return this.goldTorus.normalAt(point);
    }
    return this.ground.normalAt(point);
  }

  isVisible(point: vec3, normal: vec3): bool {
    const toLight = this.light.position - point;
    const distanceToLight = length(toLight);
    const lightDirection = normalize(toLight);
    const shadowRay = new Ray(
      point + normal * RAY_EPSILON,
      lightDirection,
    );
    const shadowHit = this.raymarch(shadowRay, distanceToLight);

    return !shadowHit.isValid();
  }

  materialAt(index: i32): Material {
    if (index === 0) {
      return this.redSphere.material;
    }
    if (index === 1) {
      return this.blueBox.material;
    }
    if (index === 2) {
      return this.goldTorus.material;
    }
    return this.ground.material;
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
      const hit = this.scene.raymarch(ray, MAX_DISTANCE);

      if (!hit.isValid()) {
        radiance += throughput * this.sky(ray);
        break;
      }

      const point = ray.at(hit.distance);
      const normal = this.scene.normalAt(hit.objectIndex, point);
      const material = this.scene.materialAt(hit.objectIndex);

      radiance += throughput * this.shade(
        ray,
        point,
        normal,
        material,
      );

      seed = seed + 7.13;
      const diffuseDirection = cosineDirection(normal, seed);
      const reflectedDirection = reflectDirection(ray.direction, normal);
      const bounceAmount = material.metallic
        + (1. - material.roughness) * 0.25;
      const nextDirection = normalize(
        mix(
          diffuseDirection,
          reflectedDirection,
          bounceAmount,
        ),
      );

      throughput = throughput * material.bounceWeight();
      ray = new Ray(
        point + normal * RAY_EPSILON,
        nextDirection,
      );
    }

    return radiance;
  }

  shade(
    ray: Ray,
    point: vec3,
    normal: vec3,
    material: Material,
  ): vec3 {
    const viewDirection = -ray.direction;
    const lightDirection = normalize(this.scene.light.position - point);

    let visibility: f32 = 0.;
    if (this.scene.isVisible(point, normal)) {
      visibility = 1.;
    }

    return material.emission
      + visibility
      * this.scene.light.irradianceAt(point)
      * material.directResponse(
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

function createCamera(time: f32): Camera {
  return new Camera(
    vec3(
      sin(time * 0.17) * 6.2,
      2.0 + sin(time * 0.31) * 0.12,
      cos(time * 0.17) * 6.2,
    ),
    vec3(0., 0.6, -1.8),
    1.0,
  );
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

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;

  return {
    pos: vec4(x, y, 0., 1.),
  };
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
