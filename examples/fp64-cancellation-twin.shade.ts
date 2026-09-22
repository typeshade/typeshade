"use typeshade"

// The `"use typeshade"` twin of `fp64-cancellation.ts`.
//
// The numerics-textbook figure, live on the GPU: (x-1)^7 evaluated in EXPANDED form
// (x^7 - 7x^6 + 21x^5 - 35x^4 + 35x^3 - 21x^2 + 7x - 1) near x = 1. Every term is ~1 while the
// true value is ~w^7 (about 1e-9 at the default half-width), so eight ~1-sized numbers must
// cancel to nine digits, which f32 (7 digits) cannot do at all: its result is +/-5e-6 noise,
// thousands of times the whole plot range (CPU-verified: 7300x signal). The df64 side (about
// 14 digits) hugs the true curve. The thin reference line is the FACTORED form, (x-1)^7 with
// the subtraction first and no cancellation, which even f32 evaluates cleanly: the fix is
// always to restructure the maths, and fp64 is for when you cannot.
//
// Narrow the half-width slider and even df64 starts to fray, as w^7 sinks toward its own
// 14-digit floor: the same budget wall, two decades further out.
//
// The `_fp64` guard uniform is injected by the lowering and is not declared here, on either
// surface; the render harnesses bind it to 1.0f by probing the program for the Fp64Guard
// block.

class Uniforms {
  resolution: vec2
  half_width: f32 // plot spans x in [1-w, 1+w]
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
export function fs_cancel(vo: VsOut): vec4 {
  const w = u.half_width
  const halfUv = vo.uv.x * 2.
  const sx = halfUv - (vo.uv.x < 0.5 ? 0.0 : 1.0)
  // The original names this local `u`, which is the uniform binding's name here: a local `u`
  // is TS8023 "Duplicate binding" and every later `u.resolution` would read the local. Only
  // the name moves, and `semanticDiff` ignores names.
  const d = (sx - 0.5) * (w * 2.) // x - 1, in [-w, w]

  const isF32 = vo.uv.x < 0.5 || u.fp64 < 0.5
  // f64: the expanded polynomial, every term in extended precision; only the ~w^7-sized
  // RESULT narrows, and small values narrow harmlessly because f32 precision is relative.
  // The bare 1. sits beside an f64 and is lifted to a full double (§39), which is
  // what the EDSL spells as `f64(1)`.
  const xd = 1. + f64(d)
  const x2 = xd * xd
  const x3 = x2 * xd
  const x4 = x2 * x2
  const x5 = x4 * xd
  const x6 = x3 * x3
  const x7 = x6 * xd
  const p64 = f32(
    x7 - x6 * 7.0 + x5 * 21.0 - x4 * 35.0 + x3 * 35.0 - x2 * 21.0 + xd * 7.0 - 1.0,
  )
  // f32 twin of the same polynomial: eight ~1-sized terms, seven digits.
  const xf = 1. + d
  const f2 = xf * xf
  const f3 = f2 * xf
  const f4 = f2 * f2
  const f5 = f4 * xf
  const f6 = f3 * f3
  const f7 = f6 * xf
  const p32 = f7 - f6 * 7.0 + f5 * 21.0 - f4 * 35.0 + f3 * 35.0 - f2 * 21.0 + xf * 7.0 - 1.0
  const pv = isF32 ? p32 : p64

  // Plot in units of the true amplitude w^7, so the picture is w-invariant.
  const yscale = pow(w, 7.) * 1.3
  const v = pv / yscale // computed curve, +/-0.77 at the edges
  const d2 = d * d
  const truth = d2 * d2 * d2 * d / yscale // factored (x-1)^7, no cancellation
  const py = (vo.uv.y - 0.5) * 2.
  const px = 2. / u.resolution.y // plot-units per pixel

  // Graph-paper styling: parchment with a pale grid (10 columns per half, 0.2-plot-unit
  // rows), ink axes.
  const gxf = fract(sx * 10.)
  const gyf = fract((py + 1.) * 5.)
  const dgx = min(gxf, 1. - gxf) // distance to column line, in cells
  const dgy = min(gyf, 1. - gyf)
  const aaCx = 30. / u.resolution.x // ~1.5 px in cell units
  const aaCy = 15. / u.resolution.y
  const grid = 1. - smoothstep(0., aaCx, dgx) + (1. - smoothstep(0., aaCy, dgy))
  const paper = vec3(0.96, 0.94, 0.88)
  const rgb0 = mix(paper, vec3(0.72, 0.78, 0.86), min(grid, 1.) * 0.45)

  // Fill below the computed curve: its BOUNDARY is the visible verdict, a smooth odd curve
  // on the f64 side, a full-height noise barcode on f32.
  const fill = step(py, v)
  const rgb1 = mix(rgb0, vec3(0.62, 0.74, 0.9), fill * 0.5)
  // Ink the computed curve where it is on-screen and locally flat enough.
  const ink = 1. - smoothstep(px * 1.2, px * 3., abs(v - py))
  const rgb2 = mix(rgb1, vec3(0.13, 0.16, 0.3), ink * 0.85)
  // The factored-form reference in warm red, clean on BOTH halves. The original calls this
  // `ref`, which a source local cannot be: it is a WGSL reserved word (TS8068), and a source
  // local is emitted under the name it is written with while the EDSL's `Let` picks its own.
  const refLine = 1. - smoothstep(px * 0.8, px * 2.2, abs(truth - py))
  const rgb3 = mix(rgb2, vec3(0.8, 0.25, 0.2), refLine * 0.65)
  // Axes: y = 0 and x = 1, the cancellation point.
  const axis = min(
    smoothstep(0., px * 1.5, abs(py)),
    smoothstep(0., px * 1.5, abs(sx - 0.5) * 2.),
  )
  const rgb = mix(vec3(0.35, 0.33, 0.3), rgb3, axis)
  return vec4(rgb, 1.)
}
