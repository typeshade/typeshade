"use typeshade"

// The `"use typeshade"` twin of `mandelbrot.ts`. `screenCoords` is a helper
// function here rather than an import — see `plasma-twin.shade.ts` on the
// repeated head.

class Uniforms {
  time: f32
  resolution: vec2
  zoom: f32
  mouse: vec4
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

// Iridescent cosine palette: 0.5 + 0.5·cos(2π(t + phase)).
function palette(t: f32): vec3 {
  const ph = vec3(0.0, 0.33, 0.67)
  return vec3(0.5) + cos((t + ph) * 6.283) * 0.5
}

@fragment
export function fs(vo: VsOut): vec4 {
  const res = U.resolution
  const p = screenCoords(vo.uv, res)
  // breathing zoom into the seahorse valley (−0.7453 + 0.1127i)
  const s = exp(-(U.zoom + (sin(U.time * 0.2) * 0.75 + 0.75))) * 2.4
  // pointer pans the view: the pointer maps into the same isotropic space as
  // p and offsets the centre, scaled by the current zoom. mu.w = 0 (never
  // touched) keeps the canonical seahorse-valley framing.
  const mu = U.mouse
  const pan = screenCoords(vec2(mu.x / res.x, mu.y / res.y), res) * s * mu.w
  const c = vec2(p.x * s - 0.7453 + pan.x, p.y * s + 0.1127 + pan.y)
  let z = vec2(0., 0.)
  let it = 0.
  for (let i: u32 = 0; i < 120; i++) {
    if (dot(z, z) > 16.) {
      break
    } // escaped
    z = vec2(z.x * z.x - z.y * z.y + c.x, z.x * z.y * 2. + c.y)
    it = it + 1.
  }
  // smooth iteration count — subtract the fractional escape overshoot
  const m = dot(z, z)
  const sn = it - log2(max(log2(max(m, 1.0001)), 0.0001)) + 1.
  // interior (never escaped) stays black
  const inside = step(119.5, it)
  const col = palette(sn * 0.035 + U.time * 0.02) * (1. - inside)
  return vec4(col, 1.)
}
