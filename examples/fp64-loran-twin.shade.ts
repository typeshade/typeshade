"use typeshade"

/* @example
{
  "title": "fp64 hyperbolic navigation (source twin)",
  "blurb": "`fp64-loran.ts` written in the source language: the LORAN chart grid, cyan hyperbolae of constant d1 - d2 to two stations and amber ellipses of constant d1 + d2, with the whole cancellation chain on the emulated half riding `distance()` on a `vec2f64` and a df64 `fract` (§39) and narrowing only the band phase. `vec2f64(u.center.x + f64(dx), ...)` is the lane read plus the f32 widen, `* 0.25` is a literal lifted to the full double beside an `f64`, and `f32(u.st_a.x)` is the per-lane narrow the f32 half of the formula needs. Past ~10⁷·² the coordinate ulp grows wider than a band and the plain-f32 left half dissolves into blocky garbage while the right half stays sharp to 10⁹.",
  "renderable": true,
  "twinOf": "fp64-loran"
}
*/
// The `"use typeshade"` twin of `fp64-loran.ts`.
//
// Hyperbolic radio navigation, the pre-GPS chart grid: two stations, and a position line is
// "d1 - d2 = const", a hyperbola. Three classic f32 killers meet in that one formula. The
// observer sits ~1e7 units from both stations, the usable signal is the DIFFERENCE of two
// nearly-equal distances (catastrophic cancellation), and the band phase needs `fract()` of a
// coordinate-scale value, which an f32 ulp of 1 flattens outright (§39). The f64 half runs the
// whole chain through the vec64 `distance` reduction and a df64 `fract`, and narrows only the
// phase; the plain-f32 left half renders quantized band garbage at any zoom.
//
// The `_fp64` guard the lowering injects lands at (group 0, binding 1) on its own and is
// declared by neither surface.

class Uniforms {
  // The observer, one DF64Vec2 slot: the host writes [hi.x, hi.y, lo.x, lo.y], the same
  // packing for both surfaces, which is why no twin ever spells the split.
  center: vec2f64
  st_a: vec2f64 // master station, swept out with the observer by the DISTANCE slider
  st_b: vec2f64 // secondary station
  resolution: vec2
  zoom_exp: f32 // view span = 10^-zoom_exp world units (negative zooms out)
  fp64: f32 // toggle: 1 = split-screen f32 | f64 (canonical), 0 = all-f32
}

declare const u: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
  // No double rides here: an f64 on a @location is refused (§39), and both halves read the
  // stations out of the uniform in the stage that needs them.
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.
  const y = f32(vi >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

@fragment
export function fs_loran(vo: VsOut): vec4 {
  const span = pow(10.0, -u.zoom_exp)
  const half = vo.uv.x * 2.0
  const sx = half - (vo.uv.x < 0.5 ? 0.0 : 1.0)
  const dx = (sx - 0.5) * span
  const dy = (vo.uv.y - 0.5) * span * (u.resolution.y / u.resolution.x * 2.0)

  const isF32 = vo.uv.x < 0.5 || u.fp64 < 0.5
  // f64 chain: the vec64 `distance` reduction accumulates through the scalar df64 transforms,
  // the subtraction cancels EXACTLY, and only the band phase narrows. The band pitches are the
  // reciprocals the original's LAMBDA_H = 4 and LAMBDA_E = 16 fold to in JavaScript, and a
  // literal beside an f64 is lifted to the full double (§39), so 0.25 and 0.0625 are split
  // rather than widened from their f32 rounding.
  const pos = vec2f64(u.center.x + f64(dx), u.center.y + f64(dy))
  const d1 = distance(pos, u.st_a)
  const d2 = distance(pos, u.st_b)
  const th64 = f32(fract((d1 - d2) * 0.25))
  const te64 = f32(fract((d1 + d2) * 0.0625))
  // f32 twin of the same formulas, everything narrowed first: once the coordinate ulp exceeds
  // a band, d1 and d2 quantize and the band phase becomes garbage.
  const pos32 = vec2(f32(u.center.x) + dx, f32(u.center.y) + dy)
  const d1f = length(pos32 - vec2(f32(u.st_a.x), f32(u.st_a.y)))
  const d2f = length(pos32 - vec2(f32(u.st_b.x), f32(u.st_b.y)))
  const th32 = fract((d1f - d2f) * 0.25)
  const te32 = fract((d1f + d2f) * 0.0625)

  const th = isF32 ? th32 : th64
  const te = isF32 ? te32 : te64

  // Distance to the nearest band line, a triangle fold: continuous across the fract seam,
  // which is exactly where the line sits.
  const dh = min(th, 1. - th)
  const de = min(te, 1. - te)
  const aaH = fwidth(dh) * 1.2 + 1e-4
  const aaE = fwidth(de) * 1.2 + 1e-4
  const lineH = 1. - smoothstep(0., aaH, dh)
  const lineE = 1. - smoothstep(0., aaE, de)

  // Chart styling: deep sea, cyan hyperbolae (the position lines), faint amber ellipses (the
  // range net), a soft band tint to keep the field alive.
  const sea = mix(vec3(0.02, 0.07, 0.13), vec3(0.04, 0.12, 0.2), vo.uv.y)
  const rgb =
    sea +
    vec3(0.0, 0.06, 0.08) * th + // band tint
    vec3(0.25, 0.95, 0.95) * (lineH * 0.9) +
    vec3(0.95, 0.7, 0.25) * (lineE * 0.35)
  return vec4(rgb, 1.)
}
