"use typeshade"

// The `"use typeshade"` twin of `ocean.ts`. See `plasma-twin.shade.ts` on the
// repeated fullscreen head.

class Uniforms {
  time: f32
  resolution: vec2
  swell: f32
}

declare const U: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
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
  const u: vec2 = f * f * (vec2(3.) - f * 2.)
  return mix(
    mix(hash(i), hash(i + vec2(1., 0.)), u.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x),
    u.y,
  )
}

@fragment
export function fs(vo: VsOut): vec4 {
  const t = U.time
  const res = U.resolution
  const asp = res.x / res.y
  const x = (vo.uv.x * 2. - 1.) * asp
  const y = vo.uv.y
  const horizon = 0.58
  const sunX = 0.42

  // ── sky: warm haze at the horizon rising to a deep zenith, plus the sun
  const sky = mix(vec3(0.83, 0.58, 0.38), vec3(0.12, 0.28, 0.48), smoothstep(horizon, 1., y))
  // sun distance in ISOTROPIC coordinates — x spans 2·aspect over the width
  // and y·2−1 spans 2 over the height, so units match and the disc stays round
  const y2 = y * 2. - 1.
  const dSun = distance(vec2(x, y2), vec2(sunX, 0.56))
  const sun = 1. - smoothstep(0.035, 0.06, dSun)
  const halo = exp(-(dSun * 4.)) * 0.35
  const skyCol = sky + vec3(1.0, 0.85, 0.6) * (sun + halo)

  // ── sea: perspective-divide the rows below the horizon into a plane,
  // then sum fBm octaves of value noise drifting with time
  const dpt = max(horizon - y, 0.0008) // 0 at the horizon
  const wz = 0.06 / dpt // world distance along the plane
  const sp = vec2(x * wz * 0.6, wz + t * 0.6) * 3.
  // fBm accumulator — 4 octaves, frequency ×2, amplitude ×½
  let h = 0.
  let amp = 0.5
  let freq = 1.
  for (let i: u32 = 0; i < 4; i++) {
    h = h + amp * noise(sp * freq + vec2(t * 0.12, 0.))
    freq = freq * 2.03
    amp = amp * 0.5
  }
  // fade the wave texture right at the horizon (sub-pixel noise reads as static)
  const wave = h * U.swell * smoothstep(0., 0.05, dpt)
  // deep near water lifting to the hazy horizon colour in the distance
  const sea = mix(vec3(0.05, 0.18, 0.28), vec3(0.55, 0.5, 0.45), exp(-(dpt * 7.))) +
    vec3(0.3, 0.38, 0.36) * wave
  // sun-glitter path: bright crests, inside a column under the sun, fading out
  const glint = pow(max(wave - 0.32, 0.) * 2.6, 3.) *
    exp(-(abs(x - sunX) * 2.2)) *
    exp(-(dpt * 2.5))
  const seaCol = sea + vec3(1.0, 0.85, 0.6) * clamp(glint, 0., 1.2)

  const col = mix(seaCol, skyCol, step(horizon, y))
  return vec4(col, 1.)
}
