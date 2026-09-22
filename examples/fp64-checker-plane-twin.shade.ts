"use typeshade"

// The `"use typeshade"` twin of `fp64-checker-plane.ts`.
//
// The map-engine failure mode in its purest form: a 1x1-unit checkerboard on a world plane,
// viewed 100 million units from the origin, where ulp_f32(1e8) = 8, EIGHT whole cells wide.
// The tile grid is recovered with floor/fract ON THE f64 TYPE, both of which have a df64 body
// (§39): parity = fract((floor(x) + floor(y)) / 2) stays exact because floor(x) at 1e8 does not
// FIT in an f32, so narrowing first is precisely the bug. The plain-f32 left half only ever
// sees the coordinate in 8-cell steps, parity never flips and the checker collapses FLAT; the
// f64 right half stays a crisp checkerboard with anti-aliased cell borders.
//
// The `_fp64` guard uniform is injected by the lowering, not by either surface, so nothing here
// declares it; the render harnesses bind it to 1.0f by probing the program for the Fp64Guard
// block.

class Uniforms {
  center: vec2f64 // one DF64Vec2 slot, the host packs [hi.x, hi.y, lo.x, lo.y]
  resolution: vec2
  zoom_exp: f32 // view span = 10^-zoom_exp world units (negative = zoom out)
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
export function fs_checker(vo: VsOut): vec4 {
  const span = pow(10.0, -u.zoom_exp)
  const half = vo.uv.x * 2.0
  const sx = half - (vo.uv.x < 0.5 ? 0.0 : 1.0)
  const dx = (sx - 0.5) * span
  const dy = (vo.uv.y - 0.5) * span * (u.resolution.y / u.resolution.x * 2.0)

  const isF32 = vo.uv.x < 0.5 || u.fp64 < 0.5
  // f64 path: floor/fract in extended precision, only RESULTS narrow. `u.center.x` is a lane
  // READ of the vec2f64 (§39), `f64(dx)` widens the f32 offset exactly, and the literal beside
  // an f64 in `* 0.5` is lifted to the full double. Cell parity comes back 0 or 0.5 exactly and
  // the in-cell fraction is sub-unit, so `f32()` on each result loses nothing.
  const px = u.center.x + f64(dx)
  const py = u.center.y + f64(dy)
  const par64 = f32(fract((floor(px) + floor(py)) * 0.5))
  const fx64 = f32(fract(px))
  const fy64 = f32(fract(py))
  // f32 twin, SAME formulas, world coordinate narrowed first with the per-lane `f32(lane)`: at
  // 1e8 the coordinate moves in 8-cell steps, so parity NEVER flips, it stays even, and the
  // fraction is identically 0. That half renders flat.
  const px32 = f32(u.center.x) + dx
  const py32 = f32(u.center.y) + dy
  const par32 = fract((floor(px32) + floor(py32)) * 0.5)
  const fx32 = fract(px32)
  const fy32 = fract(py32)

  const par = isF32 ? par32 : par64
  const fx = isF32 ? fx32 : fx64
  const fy = isF32 ? fy32 : fy64

  // Two-tone slate/ivory checker plus anti-aliased cell borders. The AA width comes from the
  // analytic pixel size in WORLD units, span over the half-width in px: fwidth(fract(x)) would
  // spike across the cell seam itself.
  const chk = step(0.25, par)
  const edge = min(min(fx, 1. - fx), min(fy, 1. - fy))
  const pixw = span / (u.resolution.x * 0.5)
  const line = smoothstep(0., pixw * 1.5 + 1e-9, edge)
  const ivory = vec3(0.93, 0.9, 0.82)
  const slate = vec3(0.23, 0.29, 0.36)
  // Annotated for the EDITOR, not for the compiler. TypeScript types
  // `vec3 * scalar` as `number`, so `rgb` would lose its lanes and draw TS2345
  // at the `vec4(...)` that returns it, on a program that compiles (issue #43).
  // Emit-neutral: the WGSL and GLSL are byte-identical without it.
  const rgb: vec3 = mix(ivory, slate, chk) * mix(0.35, 1.0, line)
  return vec4(rgb, 1.)
}
