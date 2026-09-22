"use typeshade"

/* @example
{
  "title": "fp64 long-uptime clock (source twin)",
  "blurb": "`fp64-clock.ts` written in the source language: the mission-time epoch read from the uniform as an `f64`, the live `time` widened with `f64(x)` and added in extended precision, the f32 `speed` lifted beside the double, and only the sub-unit `fract()` phase narrowed with `f32(x)` to drive the dial (§39). The left dial narrows the epoch first and freezes once one f32 ulp is wider than a second, past about 10⁷·² s; the right one keeps sweeping to 10⁹ s. Nothing crosses the entry boundary as a double: the fragment stage reads the uniform itself, which is the remedy the varying refusal names.",
  "renderable": true,
  "twinOf": "fp64-clock"
}
*/
// The `"use typeshade"` twin of `fp64-clock.ts`.
//
// The "shader time" bug every long-running app ships eventually: animate with `fract(t)` once
// t has grown large and f32 time stops moving. At t near 1e8 seconds (a bit over 3 years) one
// f32 ulp is 8 s, so every sub-8-second phase is gone. Here the epoch base lives in the
// uniform as an f64, the live `time` uniform is added IN extended precision, and only the
// fract() phase, a sub-unit value, narrows to f32 to drive the dial. The right clock sweeps
// smoothly; the plain-f32 left clock (the base narrowed with f32() before the add) is frozen
// solid. Flip the fp64 toggle and the right one freezes too.
//
// The `_fp64` guard uniform is injected by the lowering, not declared here (§39): the render
// harnesses bind it to 1.0 by probing the program for it.

class Uniforms {
  time: f32
  resolution: vec2
  epoch: f64 // mission-time base seconds, swept 1e4..1e9 by the host's UPTIME slider
  speed: f32 // dial revolutions per second
  fp64: f32 // toggle: 1 = split-screen f32 | f64 (canonical), 0 = all-f32
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

@fragment
export function fs_clock(vo: VsOut): vec4 {
  // Absolute mission time = epoch + live seconds; the ADD runs in df64 on the right (exact)
  // and in plain f32 on the left (the +time vanishes under ulp(1e8) = 8 s). `f64(U.time)` is
  // the exact widen, `* U.speed` lifts the f32 speed beside the double (§39), and only the
  // sub-unit phase ever narrows.
  const phase64 = f32(fract((U.epoch + f64(U.time)) * U.speed))
  // f32 twin: the epoch narrowed to a plain f32 before the add. Once its ulp grows past a
  // second, `time` is absorbed and the dial only lurches when the sum crosses an ulp.
  const phase32 = fract((f32(U.epoch) + U.time) * U.speed)

  const isF32 = vo.uv.x < 0.5 || U.fp64 < 0.5
  const phase = isF32 ? phase32 : phase64

  // Each half gets its own dial: remap the half's uv to centred isotropic coords (y ±1 over
  // the height, x ±half-aspect over the half's width).
  const halfUv = vo.uv.x * 2.0
  const sx = halfUv - (vo.uv.x < 0.5 ? 0.0 : 1.0)
  const c = vec2(
    (sx * 2.0 - 1.0) * ((U.resolution.x * 0.5) / U.resolution.y),
    vo.uv.y * 2.0 - 1.0,
  )
  const r = length(c)
  // Angle as a 0..1 turn, 12-o'clock = 0, clockwise, which matches the phase.
  const a01 = fract(0.25 - atan2(c.y, c.x) / 6.283185307179586)

  // Dial face: outer bezel ring, 12 tick marks, sweep hand + decay trail.
  const px = 2. / U.resolution.y // isotropic px size
  const bezel = 1. - smoothstep(px * 1.5, px * 3.0, abs(r - 0.82) - 0.012)
  const tickA = -abs(fract(a01 * 12.0) - 0.5) + 0.5 // 0 at each tick
  const tick =
    (1. - smoothstep(0.0, 0.035, tickA)) *
    smoothstep(0.62, 0.66, r) *
    (1. - smoothstep(0.78, 0.8, r))
  // Angular distance BEHIND the hand (0 at the hand, growing clockwise-past).
  const behind = fract(phase - a01 + 1.0)
  const hand =
    (1. - smoothstep(0.0, 0.006, min(behind, 1. - behind))) *
    step(r, 0.6) *
    smoothstep(0.05, 0.1, r)
  const trail = exp(behind * -5.0) * 0.35 * step(r, 0.58)
  const hub = 1. - smoothstep(px * 2.0, px * 5.0, r)

  const face = mix(vec3(0.03, 0.045, 0.08), vec3(0.05, 0.075, 0.12), r)
  const rgb =
    face +
    vec3(0.85, 0.9, 1.0) * (bezel * 0.35) +
    vec3(0.8, 0.85, 0.95) * (tick * 0.5) +
    vec3(1.0, 0.72, 0.2) * hand +
    vec3(1.0, 0.6, 0.15) * trail +
    vec3(1.0, 0.85, 0.5) * hub
  return vec4(rgb, 1.)
}
