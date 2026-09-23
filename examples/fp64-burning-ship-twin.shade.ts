"use typeshade"

/* @example
{
  "title": "fp64 Burning Ship (source twin)",
  "blurb": "`fp64-burning-ship.ts` written in the source language: the |Re z|, |Im z| fold spelled as `abs` on an `f64` inside the extended-precision iteration, the centre read lane by lane off a `vec2f64`, and every literal beside a double lifted to one (§39). The half-selection is a ternary and the split screen an `if`/`else` over `||`, and the f32 half narrows with `f32(x)` exactly where the EDSL spelled `toF32`.",
  "renderable": true,
  "twinOf": "fp64-burning-ship"
}
*/
// The `"use typeshade"` twin of `fp64-burning-ship.ts`.
//
// The Burning Ship (z <- (|Re z| + i*|Im z|)^2 + c) is the fp64 family's showcase for `abs`
// ON THE f64 TYPE: the fold happens inside the extended-precision iteration, not after a
// narrowing. df64 abs is exact (negate both planes), so the fold costs no precision.
// The camera sits on the set's spike at c = -1.748 on the real axis (the axis itself never
// escapes, the same real dynamics as the Mandelbrot needle), where the CPU check keeps
// 40 to 110 distinct escape bands per 48^2 window from a 1e-5 span all the way down to
// 1e-12. The plain-f32 left half collapses flat once the span drops under one ulp of 1.748
// (about 1e-7).
//
// The `_fp64` guard uniform is auto-injected by the lowering, so it is not declared here;
// the render harnesses bind it to 1.0f by probing the program for the Fp64Guard block.
//
// A `.shade.ts` file cannot import (PORTING.md, "Hazards"), so `VsOut` and the fullscreen
// vertex stage that `_fullscreen.ts` shares are re-spelled below.

class Uniforms {
  center: vec2f64 // one DF64Vec2 slot, host packs [hi.x, hi.y, lo.x, lo.y]
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
  const x = f32(vi & 1) * 4. - 1. // -1, 3, -1
  const y = f32(vi >> 1) * 4. - 1. // -1, -1, 3
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

@fragment
export function fs_ship(vo: VsOut): vec4 {
  const span = pow(10.0, -u.zoom_exp)
  const half = vo.uv.x * 2.0
  const sx = half - (vo.uv.x < 0.5 ? 0.0 : 1.0)
  const dx = (sx - 0.5) * span
  const dy = (vo.uv.y - 0.5) * span * (u.resolution.y / u.resolution.x * 2.0)

  let it = 0.
  let m2 = 0. // |z|^2 of the last z the loop reached: the escape test and the colouring's input
  if (vo.uv.x < 0.5 || u.fp64 < 0.5) {
    // f32 twin, SAME fold-and-square, center narrowed.
    const cx = f32(u.center.x) + dx
    const cy = f32(u.center.y) + dy
    // The escape loop is written as fp64-julia's (fp64-julia.ts records why and what it
    // saves): |z|^2 is carried in m2 beside z, the squares beside it so none is computed
    // twice a trip, and the loop leaves at the first escaped z with a `break` (the
    // condition `j < 128 && m2 <= 16.0` is TS8006, Rule 7.5). z0 = 0, so all start at 0.
    let zx = 0.
    let zy = 0.
    let x2 = 0.
    let y2 = 0.
    for (let j: u32 = 0; j < 128; j++) {
      if (m2 > 16.0) {
        break
      }
      const nzx = x2 - y2 + cx
      zy = abs(zx * zy) * 2.0 + cy
      zx = nzx
      it = it + 1.0
      x2 = zx * zx
      y2 = zy * zy
      m2 = x2 + y2
    }
  } else {
    // f64: the |Re|, |Im| fold in extended precision. 2|zx*zy| is the |Im| fold of the
    // squared form: (|zx| + i|zy|)^2 has Im = 2|zx||zy| = 2|zx*zy|. The lane reads
    // `u.center.x` and `u.center.y` stay doubles, and every literal beside one is lifted
    // to the full double (§39), so nothing in the loop narrows.
    const cx = u.center.x + f64(dx)
    const cy = u.center.y + f64(dy)
    // The escape test reads an f32 |z|^2 squared from the narrowed words, as in
    // fp64-julia: 48 bits move |z|^2 across 16 only from within an f32 rounding of it.
    let zx: f64 = 0.
    let zy: f64 = 0.
    for (let j: u32 = 0; j < 128; j++) {
      if (m2 > 16.0) {
        break
      }
      const nzx = zx * zx - zy * zy + cx
      zy = abs(zx * zy) * 2.0 + cy
      zx = nzx
      it = it + 1.0
      const hx = f32(zx)
      const hy = f32(zy)
      m2 = hx * hx + hy * hy
    }
  }

  // Smooth escape time through an ember palette (dark hull, orange flame, pale smoke);
  // interior stays black. Same log2 log2 smoothing as fp64-mandelbrot.ts.
  const sn = it - log2(max(log2(max(m2, 1.0001)), 0.0001)) + 1.0
  const inside = step(128. - 0.5, it)
  const s = sn / 128.
  const ease = s * s * (3. - s * 2.) // s^2(3-2s) ember ramp
  // Annotated for the EDITOR, not for the compiler. TypeScript types
  // `vec3 * scalar` as `number`, so `rgb` would lose its lanes and draw TS2345
  // at the `vec4(...)` that returns it, on a program that compiles (issue #43).
  // Emit-neutral: the WGSL and GLSL are byte-identical without it.
  const rgb: vec3 = mix(
    mix(vec3(0.06, 0.02, 0.05), vec3(0.95, 0.45, 0.08), ease),
    vec3(1.0, 0.93, 0.75),
    s * s,
  ) * (1. - inside)
  return vec4(rgb, 1.)
}
