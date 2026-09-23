"use typeshade"

/* @example
{
  "title": "Hillshade (source twin)",
  "blurb": "`hillshade.ts` written in the source language: the Horn 3x3 gradient over a procedural height field, lit by a sun azimuth. The cartographic twin — the shading maths reads the same on both surfaces because it is all plain arithmetic.",
  "renderable": true,
  "twinOf": "hillshade"
}
*/

// The `"use typeshade"` twin of `hillshade.ts`.

class Uniforms {
  time: f32
  resolution: vec2
  sun_az: f32
  exaggeration: f32
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

// normalize() is a builtin, but the original spells the reciprocal-length form inline; the
// twin keeps that so the two surfaces build the same expression.
function normalize3(v: vec3): vec3 {
  return v * (1. / length(v))
}

// Reusable terrain height field, ~[0,1]. Emitted once, called 3× — a real function.
function terrain(p: vec2, t: f32): f32 {
  const h =
    sin(p.x * 3. + t) * cos(p.y * 3.) +
    sin(p.x * 6.1 - t * 0.7) * cos(p.y * 5.3) * 0.5 +
    sin(p.x * 12.7) * cos(p.y * 11.1) * 0.25
  return h * 0.28 + 0.5
}

@fragment
export function fs(vo: VsOut): vec4 {
  const uv = vo.uv
  const t = U.time
  const az = radians(U.sun_az)
  const ex = U.exaggeration
  // Annotated for the EDITOR, not for the compiler. TypeScript types `vec * scalar` as
  // `number`, so the product loses `.x` and `.y` and draws TS2345 where it is next used, on a
  // program that compiles (issue #43). Both annotated locals in this file, `p` here and `lit`
  // below, are that and only that: emit-neutral, the WGSL and GLSL are byte-identical without
  // them.
  const p: vec2 = uv * 6.
  const eps = 0.015

  // Height + two neighbours → a finite-difference surface normal.
  const h = terrain(p, t)
  const hx = terrain(vec2(p.x + eps, p.y), t)
  const hy = terrain(vec2(p.x, p.y + eps), t)
  const n = normalize3(vec3((h - hx) * ex, (h - hy) * ex, eps))

  // Sun from the azimuth (fixed elevation) → Lambert term.
  const sun = normalize3(vec3(cos(az) * 0.6, sin(az) * 0.6, 0.55))
  const shade = clamp(dot(n, sun), 0., 1.)

  // Hypsometric tint: lowland green → upland tan → snow.
  const low = vec3(0.16, 0.32, 0.2)
  const mid = vec3(0.55, 0.49, 0.3)
  const high = vec3(0.93, 0.93, 0.96)
  const base = mix(mix(low, mid, smoothstep(0.3, 0.55, h)), high, smoothstep(0.62, 0.85, h))
  const lit: vec3 = base * (shade * 0.8 + 0.3)
  return vec4(lit, 1.)
}
