"use typeshade"

// The `"use typeshade"` twin of `domain-warp.ts`. `screenCoords` is a helper
// function here rather than an import — see `plasma-twin.shade.ts` on the
// repeated head.

class Uniforms {
  time: f32
  resolution: vec2
  warp: f32
}

declare const U: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

// Centred, isotropic screen coordinates: y spans ±1 over the height and x spans
// ±aspect over the width, so one unit covers the same pixels on both axes.
function screenCoords(uv: vec2, resolution: vec2): vec2 {
  const asp = resolution.x / resolution.y
  return vec2((uv.x * 2. - 1.) * asp, uv.y * 2. - 1.)
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.
  const y = f32(vi >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

// scalar hash of a lattice point → [0,1)
function hash(p: vec2): f32 {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)
}

// bilinear value noise with smootherstep weights
function noise(p: vec2): f32 {
  const i = floor(p)
  const f = fract(p)
  const u = f * f * (vec2(3.) - f * 2.)
  return mix(
    mix(hash(i), hash(i + vec2(1., 0.)), u.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x),
    u.y,
  )
}

// 4-octave fbm, unrolled so the helper stays a pure value expression
function fbm(p: vec2): f32 {
  return noise(p) * 0.5 + noise(p * 2.02) * 0.25 + noise(p * 4.08) * 0.125 +
    noise(p * 8.2) * 0.0625
}

@fragment
export function fs(vo: VsOut): vec4 {
  const t = U.time
  const res = U.resolution
  const p = screenCoords(vo.uv, res) * 1.8
  const w = U.warp
  // first warp: q = (fbm(p), fbm(p + k₁))
  const q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)))
  // second warp: r = (fbm(p + w·q + k₂ + drift), fbm(p + w·q + k₃))
  const pq = p + q * w
  const r = vec2(
    fbm(pq + vec2(1.7, 9.2) + vec2(t * 0.15, t * 0.12)),
    fbm(pq + vec2(8.3, 2.8)),
  )
  // final field
  const f = fbm(p + r * w)
  // colour: base by f², tinted by the warp magnitudes (iq's construction)
  const a = mix(vec3(0.09, 0.12, 0.2), vec3(0.85, 0.83, 0.72), clamp(f * f * 2.8, 0., 1.))
  const b = mix(a, vec3(0.2, 0.5, 0.55), clamp(length(q) * 0.9, 0., 1.))
  const c = mix(b, vec3(0.66, 0.3, 0.2), clamp(smoothstep(0.4, 1., r.y) * 0.6, 0., 1.))
  return vec4(c * (f * 1.4 + 0.35), 1.)
}
