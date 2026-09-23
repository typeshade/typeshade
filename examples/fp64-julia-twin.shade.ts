"use typeshade"

/* @example
{
  "title": "fp64 Julia set (source twin)",
  "blurb": "`fp64-julia.ts` written in the source language: the seed is fixed and the pixel becomes z₀, so the `if`/`else` split runs the same escape loop over an `f64` on one side and a plain `f32` on the other. The double half spells nothing the emulation does not already carry, a `vec2f64` lane read, `f64(dx)` widening the pixel offset, and the seed and bailout lifted to full doubles beside it (§39), and the f64 half lowers to `df64_sqr` for every square, one `df64_mul` for `zx * zy` with its doubling an exact `* 2.0` on the two words, and `df64_add` / `df64_sub` / `df64_le` around them, against the very same f32 ops.",
  "renderable": true,
  "twinOf": "fp64-julia"
}
*/
// The `"use typeshade"` twin of `fp64-julia.ts`.
//
// The Julia face of the double-float technique: the SEED is fixed
// (c = -0.8 + 0.156i) and the PIXEL becomes z0, so the precision-critical value
// is the per-pixel starting point itself, which is exactly the
// extended-precision `center + offset` add that df64 exists for. The camera
// parks on a Julia-set point BESIDE the repelling fixed point
// z* = (1 + sqrt(1 - 4c))/2 (repelling fixed points lie ON the set, and their
// neighbourhood keeps escape times low and self-similar to any depth), bisected
// along the horizontal line y = f32(Im z*) so that the center's y survives f32
// narrowing EXACTLY: the plain-f32 left half then collapses to horizontal escape
// BANDS (the x axis dies first, the same signature as fp64-mandelbrot's
// thin-line left half) instead of vanishing into a solid interior fill.
//
// The `_fp64` guard binding is injected by the lowering (§39, "The guard"), not
// declared here; the render harnesses bind it to 1.0 by probing the program for
// the Fp64Guard block.

// The seed and the camera are module constants in the original, where they are
// JavaScript numbers that vanish into the node graph. A `.shade.ts` file cannot
// import and a shader `const` would emit a `let`, so the twin spells each where
// the original spells its constant:
//   c        = -0.8 + 0.156i, both components exactly f32-representable, so the
//              f32 half degrades ONLY through the pixel coordinate
//   center   = (1.5255044073468653, -0.07591217756271362), the y exactly
//              f32-representable and the x CPU-bisected onto the escape boundary
//              along that line, verified to keep 44+ distinct escape bands per
//              40^2 window down to a 1e-12 span
//   ITER     = 128

class Uniforms {
  center: vec2f64 // one DF64Vec2 slot, the host packs [hi.x, hi.y, lo.x, lo.y]
  resolution: vec2
  zoom_exp: f32 // view span = 10^-zoom_exp complex units
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
export function fs_julia(vo: VsOut): vec4 {
  const span = pow(10.0, -u.zoom_exp)
  // Each half maps its own 0..1 sub-range onto the SAME complex window
  // (pan lives on the HOST in full double precision, see fp64-mandelbrot.ts).
  const half = vo.uv.x * 2.0
  const sx = half - (vo.uv.x < 0.5 ? 0.0 : 1.0)
  const dx = (sx - 0.5) * span
  const dy = (vo.uv.y - 0.5) * span * (u.resolution.y / u.resolution.x * 2.0)

  let it = 0.
  let m2 = 0. // |z|^2 at escape (frozen once the guard fails)
  if (vo.uv.x < 0.5 || u.fp64 < 0.5) {
    // f32 twin: z0 built from the narrowed center. At deep zoom the pixel
    // coordinate quantizes to f32 ulps and whole columns collapse.
    let zx = f32(u.center.x) + dx
    let zy = f32(u.center.y) + dy
    for (let j: u32 = 0; j < 128; j++) {
      if (zx * zx + zy * zy <= 16.0) {
        const nzx = zx * zx - zy * zy + -0.8
        zy = zx * zy * 2.0 + 0.156
        zx = nzx
        it = it + 1.0
      }
    }
    m2 = zx * zx + zy * zy
  } else {
    // f64: identical authoring, z0 keeps its extended-precision position. The
    // literals beside an f64 are lifted to full doubles (§39), and `f64(dx)`
    // widens the f32 pixel offset exactly.
    let zx = u.center.x + f64(dx)
    let zy = u.center.y + f64(dy)
    for (let j: u32 = 0; j < 128; j++) {
      if (zx * zx + zy * zy <= 16.0) {
        const nzx = zx * zx - zy * zy + -0.8
        zy = zx * zy * 2.0 + 0.156
        zx = nzx
        it = it + 1.0
      }
    }
    m2 = f32(zx * zx + zy * zy)
  }

  // Smooth escape time (the same log2 log2 treatment as fp64-mandelbrot.ts)
  // through a cool cosine palette; interior stays black.
  const sn = it - log2(max(log2(max(m2, 1.0001)), 0.0001)) + 1.0
  const inside = step(128. - 0.5, it)
  const s = sn / 128.
  const ph = vec3(0.0, 0.25, 0.6)
  // Annotated for the EDITOR, not for the compiler. TypeScript types
  // `vec3 * scalar` as `number`, so `rgb` would lose its lanes and draw TS2345
  // at the `vec4(...)` that returns it, on a program that compiles (issue #43).
  // Emit-neutral: the WGSL and GLSL are byte-identical without it.
  const rgb: vec3 = (vec3(0.5) + cos(ph + s * 5.5 + 2.2) * 0.5) * mix(0.35, 1.0, s) * (1. - inside)
  return vec4(rgb, 1.)
}
