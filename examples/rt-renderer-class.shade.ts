"use typeshade";

/* @example
{
  "title": "Class-based ray tracer",
  "blurb": "A conventional object-oriented ray tracer expressed with TypeShade classes: Ray, Material, Sphere, PointLight, Camera and Renderer. The same class methods used by ordinary TypeScript-style code are lowered to the shader program; the renderer traces three reflection bounces with direct lighting and emissive surfaces.",
  "renderable": true
}
*/

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Frame {
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

  at(t: f32): vec3 {
    return this.origin + this.direction * t;
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

  hit(ray: Ray): f32 {
    const oc = ray.origin - this.center;
    const b = dot(oc, ray.direction);
    const c = dot(oc, oc) - this.radius * this.radius;
    const h = b * b - c;

    if (h < 0.) {
      return -1.;
    }

    const root = sqrt(h);
    const near = -b - root;
    if (near > 0.001) {
      return near;
    }

    const far = -b + root;
    if (far > 0.001) {
      return far;
    }

    return -1.;
  }

  normalAt(p: vec3): vec3 {
    return normalize(p - this.center);
  }
}

class PointLight {
  position: vec3;
  color: vec3;
  intensity: f32;

  constructor(position: vec3, color: vec3, intensity: f32) {
    this.position = position;
    this.color = color;
    this.intensity = intensity;
  }

  irradiance(p: vec3): vec3 {
    const delta = this.position - p;
    const d2 = max(dot(delta, delta), 1.);
    return this.color * (this.intensity / d2);
  }
}

class Camera {
  position: vec3;
  target: vec3;
  fov: f32;

  constructor(position: vec3, target: vec3, fov: f32) {
    this.position = position;
    this.target = target;
    this.fov = fov;
  }

  ray(ndc: vec2): Ray {
    const forward = normalize(this.target - this.position);
    const right = normalize(cross(forward, vec3(0., 1., 0.)));
    const up = cross(right, forward);
    const scale = tan(this.fov * 0.5);

    return new Ray(
      this.position,
      normalize(forward + right * ndc.x * scale + up * ndc.y * scale),
    );
  }
}

class Renderer {
  primary: Sphere;
  secondary: Sphere;
  gold: Sphere;
  ground: Sphere;
  light: PointLight;

  constructor() {
    this.primary = new Sphere(
      vec3(-1.1, 0., -1.6),
      1.,
      new Material(vec3(0.72, 0.12, 0.08), 0., 0.42, vec3(0.)),
    );

    this.secondary = new Sphere(
      vec3(1.0, 0.15, -1.9),
      1.05,
      new Material(vec3(0.08, 0.3, 0.82), 0.15, 0.24, vec3(0.)),
    );

    this.gold = new Sphere(
      vec3(0., 1.25, -2.8),
      1.,
      new Material(vec3(0.9, 0.66, 0.12), 0.95, 0.1, vec3(0.)),
    );

    this.ground = new Sphere(
      vec3(0., -1001.1, -1.5),
      1000.,
      new Material(vec3(0.7, 0.73, 0.78), 0., 0.9, vec3(0.)),
    );

    this.light = new PointLight(
      vec3(-2.5, 4.8, 2.0),
      vec3(1.0, 0.88, 0.72),
      70.,
    );
  }

  hit(ray: Ray): f32 {
    let closest = 1e30;

    const t0 = this.primary.hit(ray);
    if (t0 > 0. && t0 < closest) {
      closest = t0;
    }

    const t1 = this.secondary.hit(ray);
    if (t1 > 0. && t1 < closest) {
      closest = t1;
    }

    const t2 = this.gold.hit(ray);
    if (t2 > 0. && t2 < closest) {
      closest = t2;
    }

    const t3 = this.ground.hit(ray);
    if (t3 > 0. && t3 < closest) {
      closest = t3;
    }

    if (closest == 1e30) {
      return -1.;
    }

    return closest;
  }

  shadeSphere(s: Sphere, ray: Ray, t: f32): vec3 {
    const p = ray.at(t);
    const n = s.normalAt(p);
    const view = ray.direction.neg();

    const l = this.light.position - p;
    const distance2 = max(dot(l, l), 1.);
    const ld = normalize(l);
    const ndl = max(dot(n, ld), 0.);

    const shadowRay = new Ray(p + n * 0.003, ld);
    const shadowT = this.hit(shadowRay);
    const occluded = shadowT > 0. && shadowT * shadowT < distance2 - 0.01;
    const visibility = 1. - f32(occluded);

    const irradiance = this.light.irradiance(p);
    const diffuse = s.material.albedo * (1. - s.material.metallic) * ndl;

    const h = normalize(ld + view);
    const specular = pow(
      max(dot(n, h), 0.),
      mix(16., 128., 1. - s.material.roughness),
    );

    const f0 = mix(
      vec3(0.04),
      s.material.albedo,
      s.material.metallic,
    );
    const fresnel = f0 + (vec3(1.) - f0) * pow(1. - max(dot(n, view), 0.), 5.);

    return s.material.emission
      + visibility * irradiance * (diffuse + fresnel * specular);
  }

  shadeHit(ray: Ray, t: f32): vec3 {
    const p = ray.at(t);

    const d0 = this.primary.hit(ray);
    if (d0 == t) {
      return this.shadeSphere(this.primary, ray, t);
    }

    const d1 = this.secondary.hit(ray);
    if (d1 == t) {
      return this.shadeSphere(this.secondary, ray, t);
    }

    const d2 = this.gold.hit(ray);
    if (d2 == t) {
      return this.shadeSphere(this.gold, ray, t);
    }

    return this.shadeSphere(this.ground, ray, t);
  }

  trace(primaryRay: Ray, seed0: f32): vec3 {
    let ray = primaryRay;
    let throughput = vec3(1.);
    let radiance = vec3(0.);
    let seed = seed0;

    for (let bounce: i32 = 0; bounce < 3; bounce++) {
      const t = this.hit(ray);

      if (t < 0.) {
        const sky = max(ray.direction.y, 0.);
        radiance += throughput * mix(
          vec3(0.12, 0.17, 0.28),
          vec3(0.55, 0.72, 0.95),
          sky,
        );
        break;
      }

      const p = ray.at(t);

      const d0 = this.primary.hit(ray);
      const d1 = this.secondary.hit(ray);
      const d2 = this.gold.hit(ray);

      let n = vec3(0., 1., 0.);
      let albedo = this.ground.material.albedo;
      let metallic = this.ground.material.metallic;
      let roughness = this.ground.material.roughness;
      let emission = this.ground.material.emission;

      if (d0 == t) {
        n = this.primary.normalAt(p);
        albedo = this.primary.material.albedo;
        metallic = this.primary.material.metallic;
        roughness = this.primary.material.roughness;
        emission = this.primary.material.emission;
      } else if (d1 == t) {
        n = this.secondary.normalAt(p);
        albedo = this.secondary.material.albedo;
        metallic = this.secondary.material.metallic;
        roughness = this.secondary.material.roughness;
        emission = this.secondary.material.emission;
      } else if (d2 == t) {
        n = this.gold.normalAt(p);
        albedo = this.gold.material.albedo;
        metallic = this.gold.material.metallic;
        roughness = this.gold.material.roughness;
        emission = this.gold.material.emission;
      }

      const direct = this.shadeSphere(
        d0 == t ? this.primary : d1 == t ? this.secondary : d2 == t ? this.gold : this.ground,
        ray,
        t,
      );

      radiance += throughput * direct;

      seed = seed + 7.13;
      const diffuse = cosineDir(n, seed);
      const reflected = normalize(ray.direction - n * (2. * dot(ray.direction, n)));
      const next = normalize(mix(
        diffuse,
        reflected,
        metallic + (1. - roughness) * 0.25,
      ));

      throughput = throughput * mix(albedo, vec3(1.), metallic) * 0.65;
      ray = new Ray(p + n * 0.003, next);
    }

    return radiance;
  }
}

function cosineDir(n: vec3, seed: f32): vec3 {
  const r1 = random(seed);
  const r2 = random(seed + 17.13);
  const phi = 6.2831853 * r1;
  const r = sqrt(r2);
  const t = normalize(
    cross(
      abs(n.x) > 0.9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.),
      n,
    ),
  );
  const b = cross(n, t);

  return normalize(
    t * (cos(phi) * r) +
    b * (sin(phi) * r) +
    n * sqrt(1. - r2),
  );
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

@fragment
export function fs(v: VsOut): vec4 {
  const uv = (v.pos.xy + u.resolution * 0.5 - vec2(0.5)) / u.resolution.y;
  const camera = new Camera(
    vec3(
      sin(u.time * 0.17) * 6.2,
      2.0 + sin(u.time * 0.31) * 0.12,
      cos(u.time * 0.17) * 6.2,
    ),
    vec3(0., 0.65, -1.7),
    1.0,
  );

  const renderer = new Renderer();

  let color = vec3(0.);
  for (let sample: i32 = 0; sample < 2; sample++) {
    const jx = random(
      dot(v.pos.xy, vec2(12.9898, 78.233)) +
      u.frame * 0.71 +
      f32(sample) * 19.17,
    ) - 0.5;
    const jy = random(
      dot(v.pos.xy, vec2(39.346, 11.135)) +
      u.frame * 1.17 +
      f32(sample) * 7.91,
    ) - 0.5;
    const sampleUv = vec2(
      uv.x + jx / u.resolution.x,
      uv.y + jy / u.resolution.y,
    );

    const ray = camera.ray(sampleUv * vec2(u.resolution.x / u.resolution.y, 1.));
    color += renderer.trace(
      ray,
      dot(v.pos.xy, vec2(17.17, 73.19)) + f32(sample) * 3.7 + u.frame * 11.3,
    );
  }

  color = color / 2.;
  color = color / (color + vec3(1.));
  color = pow(color, vec3(1. / 2.2));

  return vec4(color, 1.);
}
