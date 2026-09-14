"use typeshade"

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class Color {
  @location(0) color: vec4
}

@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  let x: f32
  let y: f32
  x = -1.
  y = -1.
  if (i === 1) {
    x = 3.
  }
  if (i === 2) {
    y = 3.
  }
  const pos = vec4(x, y, 0., 1.)
  const uv = vec2(x, y) * 0.5 + vec2(0.5, 0.5)
  return { pos, uv }
}

@fragment
export function fs(v: VsOut): Color {
  let band: i32 = i32(v.uv.x * 4.)
  band &= 3
  band |= 0
  let shade: i32 = band
  shade <<= 1
  shade >>= 1
  shade ^= 0

  let rgb: vec3
  rgb = vec3(0., 0., 0.)
  switch (shade) {
    case 0:
      rgb = vec3(0.1, 0.1, 0.12)
      break
    case 1:
      rgb = vec3(0.95, 0.55, 0.2)
      break
    case 2: {
      if (v.uv.y > 0.5) {
        rgb = vec3(0.2, 0.5, 0.95)
        break
      }
      rgb = vec3(0.15, 0.35, 0.7)
    }
    default:
      rgb = vec3(0.85, 0.85, 0.9)
  }
  return { color: vec4(rgb, 1.) }
}
