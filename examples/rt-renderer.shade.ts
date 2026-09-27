"use typeshade";

/* @example
{
  "title": "Realtime ray-traced renderer",
  "blurb": "A small software ray tracer written in the current TypeShade source surface: analytic sphere intersections, hard shadow rays, diffuse + metallic reflection, emissive lighting, three bounces, and animated camera. The scene is a fixed array of structs so the fragment stage stays self-contained and emits to WGSL + GLSL ES 3.00.",
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

class Sphere {
  center: vec3;
  radius: f32;
  albedo: vec3;
  metallic: f32;
  roughness: f32;
  emission: vec3;
}

/*
 * A deliberately small scene that is cheap enough for a fullscreen fragment pass:
 * the large sphere below acts as a ground plane, while the remaining spheres provide
 * diffuse, metal and emissive materials.
 */
const SCENE: array<Sphere, 7> = [
  {
    center: vec3(0., -1002., -1.),
    radius: 1000.,
    albedo: vec3(0.72, 0.74, 0.78),
    metallic: 0.,
    roughness: 0.92,
    emission: vec3(0.),
  },
  {
    center: vec3(-1.15, -0.05, -1.1),
    radius: 0.95,
    albedo: vec3(0.72, 0.12, 0.08),
    metallic: 0.,
    roughness: 0.48,
    emission: vec3(0.),
  },
  {
    center: vec3(1.05, 0.15, -1.7),
    radius: 1.05,
    albedo: vec3(0.06, 0.28, 0.78),
    metallic: 0.15,
    roughness: 0.26,
    emission: vec3(0.),
  },
  {
    center: vec3(-0.1, 1.0, -2.65),
    radius: 1.0,
    albedo: vec3(0.88, 0.66, 0.16),
    metallic: 1.,
    roughness: 0.12,
    emission: vec3(0.),
  },
  {
    center: vec3(2.3, -0.15, -3.7),
    radius: 0.82,
    albedo: vec3(0.9, 0.92, 0.98),
    metallic: 0.92,
    roughness: 0.055,
    emission: vec3(0.),
  },
  {
    center: vec3(-2.45, 0.15, -3.35),
    radius: 0.72,
    albedo: vec3(0.14, 0.68, 0.28),
    metallic: 0.,
    roughness: 0.22,
    emission: vec3(0.),
  },
  {
    center: vec3(0.6, 3.4, -2.1),
    radius: 0.5,
    albedo: vec3(0.95, 0.72, 0.38),
    metallic: 0.,
    roughness: 0.05,
    emission: vec3(8.0, 5.2, 2.8),
  },
];

function hitSphere(s: Sphere, ro: vec3, rd: vec3): f32 {
  const oc = ro - s.center;
  const b = dot(oc, rd);
  const c = dot(oc, oc) - s.radius * s.radius;
  const h = b * b - c;
  if (h < 0.) {
    return -1.;
  }

  const root = sqrt(h);
  const t0 = -b - root;
  if (t0 > 0.001) {
    return t0;
  }

  const t1 = -b + root;
  if (t1 > 0.001) {
    return t1;
  }

  return -1.;
}

function shadow(p: vec3, n: vec3, light: vec3): f32 {
  const ro = p + n * 0.003;
  const toLight = light - ro;
  const maxT = length(toLight);
  const rd = normalize(toLight);
  let blocked = f32(0.);

  for (let i: i32 = 0; i < 7; i++) {
    const t = hitSphere(SCENE[i], ro, rd);
    if (t > 0. && t < maxT - 0.01) {
      blocked = 1.;
      break;
    }
  }

  return 1. - blocked;
}

function sky(rd: vec3): vec3 {
  const horizon = max(rd.y, 0.);
  const top = vec3(0.04, 0.08, 0.16);
  const bottom = vec3(0.55, 0.68, 0.9);
  return mix(bottom, top, horizon);
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

function trace(ro0: vec3, rd0: vec3, seed0: f32): vec3 {
  let ro = ro0;
  let rd = rd0;
  let seed = seed0;
  let throughput = vec3(1.);
  let radiance = vec3(0.);

  for (let bounce: i32 = 0; bounce < 3; bounce++) {
    let closest = 1e30;
    let hit = -1;

    for (let i: i32 = 0; i < 7; i++) {
      const t = hitSphere(SCENE[i], ro, rd);
      if (t > 0.001 && t < closest) {
        closest = t;
        hit = i;
      }
    }

    if (hit < 0) {
      radiance += throughput * sky(rd);
      break;
    }

    const s = SCENE[hit];
    const p = ro + rd * closest;
    const n = normalize(p - s.center);
    const viewCos = max(dot(n, rd.neg()), 0.);

    radiance += throughput * s.emission;

    const keyLight = vec3(
      sin(u.time * 0.7) * 3.5,
      4.8,
      cos(u.time * 0.7) * 3.5 - 1.5,
    );
    const fillLight = vec3(-4.0, 2.5, 1.5);

    const l0 = keyLight - p;
    const d0 = length(l0);
    const ld0 = l0 / d0;
    const vis0 = shadow(p, n, keyLight);
    const ndl0 = max(dot(n, ld0), 0.);
    const h0 = normalize(ld0 + rd.neg());
    const f0 = mix(vec3(0.04), s.albedo, s.metallic);
    const fres0 = f0 + (vec3(1.) - f0) * pow(1. - viewCos, 5.);
    const spec0 = pow(max(dot(n, h0), 0.), mix(18., 140., 1. - s.roughness));
    const light0 = (s.albedo * (1. - s.metallic) * ndl0 + fres0 * spec0) * vis0 / max(d0 * d0, 1.);

    const l1 = fillLight - p;
    const d1 = length(l1);
    const ld1 = l1 / d1;
    const vis1 = shadow(p, n, fillLight);
    const ndl1 = max(dot(n, ld1), 0.);
    const fill = s.albedo * (1. - s.metallic) * ndl1 * vis1 * 0.8 / max(d1 * d1, 1.);

    radiance += throughput * (light0 * 18. + fill * 8. + s.albedo * 0.035);

    seed = seed + 13.17;
    const ideal = normalize(rd - n * (2. * dot(rd, n)));
    const diffuse = cosineDir(n, seed);
    const next = normalize(mix(diffuse, ideal, s.metallic + (1. - s.roughness) * 0.35));

    throughput = throughput * mix(s.albedo, vec3(1.), s.metallic);
    ro = p + n * 0.003;
    rd = next;
  }

  return radiance;
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
  const aspect = u.resolution.x / u.resolution.y;

  const yaw = u.time * 0.18;
  const cam = vec3(
    sin(yaw) * 6.2,
    2.1 + sin(u.time * 0.37) * 0.15,
    cos(yaw) * 6.2,
  );
  const target = vec3(0., 0.7, -1.6);
  const forward = normalize(target - cam);
  const right = normalize(cross(forward, vec3(0., 1., 0.)));
  const up = cross(right, forward);

  let color = vec3(0.);
  for (let sample: i32 = 0; sample < 2; sample++) {
    const jx = random(dot(v.pos.xy, vec2(12.9898, 78.233)) + u.frame * 0.71 + f32(sample) * 19.17) - 0.5;
    const jy = random(dot(v.pos.xy, vec2(39.346, 11.135)) + u.frame * 1.17 + f32(sample) * 7.91) - 0.5;
    const ndc = vec2(
      uv.x + jx / u.resolution.x,
      uv.y + jy / u.resolution.y,
    );
    const rd = normalize(
      forward +
      right * ndc.x * aspect * 0.88 +
      up * ndc.y * 0.88,
    );

    color += trace(cam, rd, dot(v.pos.xy, vec2(17.17, 73.19)) + f32(sample) * 3.7 + u.frame * 11.3);
  }

  color = color / 2.;
  color = color / (color + vec3(1.));
  color = pow(color, vec3(1. / 2.2));

  return vec4(color, 1.);
}
