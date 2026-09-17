"use typeshade"

// The `"use typeshade"` twin of `tunnel.ts`. `screenCoords` is a helper function
// here rather than an import — see `plasma-twin.shade.ts` on the repeated head.

class Uniforms {
  time: f32
  resolution: vec2
  twist: f32
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

@fragment
export function fs(vo: VsOut): vec4 {
  const t = U.time
  const res = U.resolution
  const p = screenCoords(vo.uv, res)
  const r = length(p)
  const a = atan2(p.y, p.x)
  // 1/r is the tunnel: the wall recedes as the radius shrinks
  const depth = 0.3 / max(r, 0.001) + t * 1.4
  const ang = a / 3.14159265 + depth * U.twist * 0.08
  const cw = sin(ang * 12.566) * sin(depth * 9.4248)
  const shade = smoothstep(-0.6, 0.6, cw) * 0.55 + 0.35
  const tint = mix(vec3(1.0, 0.62, 0.28), vec3(0.42, 0.3, 0.55), sin(depth * 0.9) * 0.5 + 0.5)
  const fog = smoothstep(0.0, 0.55, r)
  const vig = clamp(1.15 - r * 0.35, 0., 1.)
  return vec4(tint * shade * fog * vig, 1.)
}
