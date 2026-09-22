"use typeshade"

// The `"use typeshade"` twin of `fp64-sine-sweep.ts`.
//
// sin(x) where the argument x is a LARGE base plus a small on-screen sweep. Once the base
// grows past about 2^24, one f32 ulp of x is wider than the whole sweep window, so the
// plain-f32 argument `base + sx * SPAN` quantizes to a few discrete steps and its sine
// renders as a STAIRCASE: the wave the eye expects has dissolved into aliased blocks. The
// f64 side carries the base in extended precision, adds the sweep exactly, and the injected
// df64_sin (3-stage reduction, tabled angle-addition, short Taylor) resolves the smooth
// curve. Drag the BASE slider from 1e4 (both smooth) up to 1e8 (the f32 wave shatters, the
// f64 wave holds); flip the fp64 toggle to shatter both.
//
// This is the transcendental twin of fp64-cancellation: the same graph-paper split, a
// different f32 failure mode, argument-resolution loss rather than term cancellation.
//
// The `_fp64` guard uniform is injected by the lowering and is not declared here, on either
// surface; the render harnesses bind it to 1.0f by probing the program for the Fp64Guard
// block.

class Uniforms {
  resolution: vec2
  base: f64 // large argument base (seconds-like), swept 1e4..1e8
  fp64: f32 // toggle: 1 = split-screen f32 | f64 (canonical), 0 = all-f32
}

declare const u: uniform<Uniforms>

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
export function fs_sweep(vo: VsOut): vec4 {
  // Position within this half: sx in [0, 1] over each half's width.
  const halfUv = vo.uv.x * 2.
  const sx = halfUv - (vo.uv.x < 0.5 ? 0.0 : 1.0)
  const isF32 = vo.uv.x < 0.5 || u.fp64 < 0.5

  // The swept argument = base + sx * SPAN, where SPAN is 8*PI radians across each half,
  // about 4 cycles when the base is small enough to resolve them. The original names that
  // 8*PI in JavaScript, which reaches the IR as the literal it evaluates to, so the twin
  // spells the literal: 25.132741228718345.
  //
  // f64: the base stays a double and the sweep is added in extended precision, then
  // df64_sin, one of the builtins §39 gives an emulated-double body. f32: narrow the base
  // FIRST, exactly where the original narrows, because the point of the left half is that
  // the base's own ulp swallows the sweep.
  const arg64 = u.base + f64(sx * 25.132741228718345)
  const y64 = f32(sin(arg64))
  const y32 = sin(f32(u.base) + sx * 25.132741228718345)
  const v = isF32 ? y32 : y64 // sine value in [-1, 1]

  // Plot: py in [-1, 1] over the height; the curve is v.
  const py = (vo.uv.y - 0.5) * 2.
  const px = 2. / u.resolution.y // plot-units per pixel

  // Graph-paper: parchment plus a pale grid (10 columns per half, 0.25-unit rows).
  const gxf = fract(sx * 10.)
  const gyf = fract((py + 1.) * 4.)
  const dgx = min(gxf, 1. - gxf)
  const dgy = min(gyf, 1. - gyf)
  const aaCx = 30. / u.resolution.x
  const aaCy = 20. / u.resolution.y
  const grid = 1. - smoothstep(0., aaCx, dgx) + (1. - smoothstep(0., aaCy, dgy))
  const paper = vec3(0.96, 0.94, 0.88)
  const rgb0 = mix(paper, vec3(0.72, 0.78, 0.86), min(grid, 1.) * 0.45)

  // Fill under the curve: its boundary reads the verdict at a glance, a smooth sine on the
  // f64 side, a stepped barcode on f32 once the base is large.
  const fill = step(py, v)
  const rgb1 = mix(rgb0, vec3(0.62, 0.74, 0.9), fill * 0.4)
  // Ink the curve.
  const ink = 1. - smoothstep(px * 1.2, px * 3., abs(v - py))
  const rgb2 = mix(rgb1, vec3(0.13, 0.16, 0.3), ink * 0.85)
  // Axes: the midline y = 0 and the half divider.
  const axis = min(
    smoothstep(0., px * 1.5, abs(py)),
    smoothstep(0., px * 1.5, abs(sx - 0.5) * 2.),
  )
  const rgb = mix(vec3(0.35, 0.33, 0.3), rgb2, axis)
  return vec4(rgb, 1.)
}
