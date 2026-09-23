"use typeshade"

/* @example
{
  "title": "Path tracer",
  "blurb": "A small path tracer as ordinary TypeScript: four spheres with diffuse and emissive materials, eight bounces per path as an iterative loop with an early `break`, cosine-weighted sampling from `random(seed)`, a constant array of structs as the scene, and sixteen paths per pixel, tone-mapped. The first program of #199's domain table outside shading: it compiles with no diagnostic on both targets, and it renders on WebGPU (measured on Tint with SwiftShader).",
  "renderable": true
}
*/

// A path tracer, written to test whether TypeShade is a general language rather than a shading
// tool (#199). Every piece is something a path tracer needs and a shader language often makes
// awkward: the bounce loop is an iterative `for` with a `break` rather than recursion (which
// WGSL has no call stack for, TS8031), the scene is a constant array of structs indexed by a
// runtime value, the random numbers come from `random(seed)` (surface §55), and each bounce
// picks a cosine-weighted direction on the hemisphere around the normal.
//
// The host fills `u` each frame: the resolution, a frame counter that reseeds the samples, and
// the camera position. Progressive accumulation across frames (averaging this frame into the
// last) needs a second pass that reads the previous image, which is host work today; #204 is the
// design for that half. A BVH over a mesh needs a loop over a runtime-length buffer, which the
// loop rule refuses today; #203 is the decision for that.
//
// A local built from vector arithmetic carries its type (`const oc: vec3 = ro - s.center`). The
// compiler infers it without one, but TypeScript types `a - b` on two objects as `number`, so
// the editor needs the annotation to stay green (#162, the ambient-DX row).

class Sphere {
  center: vec3
  radius: f32
  albedo: vec3
  emission: vec3
}

interface Frame {
  resolution: vec2
  frame: f32
  camPos: vec3
}
declare const u: uniform<Frame>

const SPHERES: array<Sphere, 4> = [
  { center: vec3(0., -100.5, -1.), radius: 100., albedo: vec3(0.8, 0.8, 0.8), emission: vec3(0.) },
  { center: vec3(0., 0., -1.), radius: 0.5, albedo: vec3(0.7, 0.3, 0.3), emission: vec3(0.) },
  { center: vec3(-1., 0., -1.), radius: 0.5, albedo: vec3(0.3, 0.7, 0.3), emission: vec3(0.) },
  { center: vec3(0., 2., -1.), radius: 0.7, albedo: vec3(0.), emission: vec3(6., 5., 4.) },
]

function hitSphere(s: Sphere, ro: vec3, rd: vec3): f32 {
  const oc: vec3 = ro - s.center
  const b = dot(oc, rd)
  const c = dot(oc, oc) - s.radius * s.radius
  const h = b * b - c
  if (h < 0.) {
    return -1.
  }
  return -b - sqrt(h)
}

function cosineDir(n: vec3, seed: f32): vec3 {
  const r1 = random(seed)
  const r2 = random(seed + 17.13)
  const phi = 6.2831853 * r1
  const r = sqrt(r2)
  const t = normalize(cross(abs(n.x) > 0.9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.), n))
  const b = cross(n, t)
  return normalize(t * (cos(phi) * r) + b * (sin(phi) * r) + n * sqrt(1. - r2))
}

function trace(ro0: vec3, rd0: vec3, seed0: f32): vec3 {
  let ro = ro0
  let rd = rd0
  let seed = seed0
  let throughput = vec3(1.)
  let radiance = vec3(0.)
  for (let bounce: i32 = 0; bounce < 8; bounce++) {
    let tMin: f32 = 1e30
    let hit: i32 = -1
    for (let i: i32 = 0; i < 4; i++) {
      const t = hitSphere(SPHERES[i], ro, rd)
      if (t > 0.001 && t < tMin) {
        tMin = t
        hit = i
      }
    }
    if (hit < 0) {
      radiance += throughput * vec3(0.05, 0.07, 0.1)
      break
    }
    const s = SPHERES[hit]
    const p: vec3 = ro + rd * tMin
    const n: vec3 = normalize(p - s.center)
    radiance += throughput * s.emission
    throughput = throughput * s.albedo
    ro = p + n * 0.001
    seed = seed + 1.618
    rd = cosineDir(n, seed)
  }
  return radiance
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const x = f32(i32(vi) / 2) * 4. - 1.
  const y = f32(i32(vi) % 2) * 4. - 1.
  return vec4(x, y, 0., 1.)
}

@fragment
export function fs(@builtin("position") pos: vec4): vec4 {
  const uv: vec2 = (pos.xy - u.resolution * 0.5) / u.resolution.y
  const rd = normalize(vec3(uv.x, -uv.y, -1.))
  let color = vec3(0.)
  for (let s: i32 = 0; s < 16; s++) {
    color += trace(u.camPos, rd, dot(pos.xy, vec2(12.9898, 78.233)) + u.frame * 7.31 + f32(s) * 3.7)
  }
  const c: vec3 = color / 16.
  return vec4(pow(c / (c + 1.), vec3(1. / 2.2)), 1.)
}
