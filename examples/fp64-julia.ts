// ═══ typeshade example — fp64 deep-zoom Julia set ═══
//
// The Julia twin of fp64-mandelbrot.ts: the SEED is fixed (c = −0.8 + 0.156i)
// and the PIXEL becomes z₀, so the precision-critical value is the per-pixel
// starting point itself — exactly the extended-precision `center + offset` add
// that df64 exists for. The camera parks on a Julia-set point BESIDE the
// repelling fixed point z* = (1 + √(1−4c))/2 (repelling fixed points lie ON
// the set, and its neighbourhood keeps escape times low and self-similar to
// any depth), bisected along the horizontal line y = toF32(Im z*) so that the
// center's y survives f32 narrowing EXACTLY: the plain-f32 left half then
// collapses to horizontal escape BANDS (the x axis dies first — same
// signature as fp64-mandelbrot's thin-line left half) instead of vanishing
// into a solid interior fill.
//
// The `_fp64` guard uniform is auto-injected by the lowering; the render
// harnesses bind it to 1.0f by probing the program for the Fp64Guard block.

import {
  fn,
  module,
  vec3,
  vec4,
  f32,
  pow,
  cos,
  log2,
  max,
  mix,
  step,
  toF32,
  toF64,
  f32T,
  vec2fT,
  vec2f64T,
  If,
  Loop,
  Var,
  Let,
  u32,
  uniformStruct,
} from '../src/index.js'
import { VsOut, vs } from './_fullscreen.js'
import type { ShaderExample } from './_shared.js'

// Seed of the Julia set; both components are exactly f32-representable, so the
// f32 half degrades ONLY through the pixel coordinate — the cleanest A/B.
const C_RE = -0.8
const C_IM = 0.156
// On the Julia set beside the repelling fixed point (|2z*| ≈ 3.06 > 1):
// y is EXACTLY f32-representable (toF32(Im z*)), x is CPU-bisected onto the
// escape boundary along that line — verified to keep 44+ distinct escape
// bands per 40² window down to a 1e-12 span, with ~7 surviving row bands on
// the narrowed f32 side.
const CENTER_X = 1.5255044073468653
const CENTER_Y = -0.07591217756271362
const ITER = 128

const U = uniformStruct(
  'Uniforms',
  { group: 0, binding: 0, as: 'u' },
  {
    center: vec2f64T, // one DF64Vec2 slot — host packs [hi.x, hi.y, lo.x, lo.y]
    resolution: vec2fT,
    zoom_exp: f32T, // view span = 10^-zoom_exp complex units
    fp64: f32T, // toggle: 1 = split-screen f32 | f64 (canonical), 0 = all-f32
  },
)

const fsJulia = fn(
  'fs_julia',
  { vo: VsOut },
  (p) => {
    const span = Let(pow(f32(10.0), U.field.zoom_exp.neg()))
    // Each half maps its own 0..1 sub-range onto the SAME complex window
    // (pan lives on the HOST in full double precision — see fp64-mandelbrot.ts).
    const half = Let(p.vo.uv.x.mul(2.0))
    const sx = Let(half.sub(p.vo.uv.x.lt(0.5).select(0.0, 1.0)))
    const dx = Let(sx.sub(0.5).mul(span))
    const dy = Let(
      p.vo.uv.y.sub(0.5).mul(span).mul(U.field.resolution.y.div(U.field.resolution.x).mul(2.0)),
    )

    // |z|² of the last z the loop reached, CARRIED beside z: set from z₀ before the loop,
    // refreshed after every step, read by the escape test, and after the loop already the
    // |z|² the smooth colouring wants. The test is one compare, so a trip after escape costs
    // that compare and the counter's own step. It used to recompute |z|² every trip, escaped
    // or not, and on the right half in df64: 106 f32 operations and 3 compares a trip,
    // counted over the emitted helpers.
    //
    // The test belongs in the loop condition, `j < ITER && m2 <= 16`, which EXITS where this
    // SKIPS. This file can say it (`Loop(u32(0), (j) => j.lt(u32(ITER)).and(m2.le(16.0)), …)`
    // lowers to that `for`, and Tint and WebGL2 accept it); the twin cannot. The source
    // language's `for` is counted (surface §17, Rule 7.5 of docs/language-design.md), its
    // condition is read as ONE comparison of the counter against a constant, and the
    // conjunction is TS8006. A twin spells what its original spells, so both skip. Measured
    // on the GPU-like evaluator (the fp64-lowered module at f32 precision) over 256×256
    // pixels a half, the exit shape gives the same `it`, m2 and colour bit for bit on both
    // halves, and what it would save is small now that a skipped trip computes nothing. A
    // wave runs until its LAST lane leaves: 302 of 1024 8×8 tiles on the right half have
    // every lane escape before trip 128 at the default zoom (500 at a 1e-10 span), and each
    // would drop its remaining trips, which cost a u32 increment, two compares and a branch.
    const it = Var(f32(0))
    const m2 = Var(f32(0))
    If(p.vo.uv.x.lt(0.5).or(U.field.fp64.lt(0.5)), () => {
      // f32 twin — z₀ built from the narrowed center: at deep zoom the pixel
      // coordinate quantizes to f32 ulps and whole columns collapse.
      const zx = Var(toF32(U.field.center.x).add(dx))
      const zy = Var(toF32(U.field.center.y).add(dy))
      m2.assign(zx.mul(zx).add(zy.mul(zy)))
      Loop(
        u32(0),
        (j) => j.lt(u32(ITER)),
        () => {
          If(m2.le(16.0), () => {
            const nzx = Let(zx.mul(zx).sub(zy.mul(zy)).add(C_RE))
            zy.assign(zx.mul(zy).mul(2.0).add(C_IM))
            zx.assign(nzx)
            it.assign(it.add(1.0))
            m2.assign(zx.mul(zx).add(zy.mul(zy)))
          })
        },
      )
    }).else(() => {
      // f64 — the same loop, z₀ keeps its extended-precision position, and ONE thing differs
      // from the left half: how m2 is taken. The escape test asks only which side of 16 |z|²
      // lies on, and 48 bits change that answer only within an f32 rounding of the
      // threshold, so m2 is squared in f32 from the narrowed words instead of in df64. Per
      // trip that is two df64_narrow, two multiplies and an add (5 f32 operations) in place
      // of two df64_mul, a df64_add and a df64_le (106, and three compares); the trip as a
      // whole goes from 354 f32 operations to 253. `toF32(zx)` rounds hi + lo, which is the
      // high word itself up to a half-ulp tie; the high word alone is not an author's to
      // name (the split is compiler-internal, §2.4 of docs/language-design.md).
      //
      // Near |z|² = 16 a pixel can escape one step earlier or later than the df64 test had
      // it, and the smooth colouring absorbs the step: `sn` subtracts log₂ log₂ |z|², which
      // rises by about one as |z|² squares past the threshold and cancels the extra count.
      // Measured on the GPU-like evaluator over 256×256 pixels at spans of 1e-4, 1e-7, 1e-10
      // and 1e-13, no pixel's count moved, `sn` moved by 7.6e-6 at most on an escaped
      // pixel, and the colour by 1.2e-4 of an 8-bit step; the closest any test came to 16
      // was 6.3e-6 relative, about 50 f32 ulps. Bisecting 560 count boundaries at 1e-4 down
      // to adjacent f32 uv values finds the case: 3 of 10,080 samples there escape one step
      // later, with `sn` moved by 0.027 and the colour by 0.11 of an 8-bit step.
      const zx = Var(U.field.center.x.add(toF64(dx)))
      const zy = Var(U.field.center.y.add(toF64(dy)))
      const hx0 = Let(toF32(zx))
      const hy0 = Let(toF32(zy))
      m2.assign(hx0.mul(hx0).add(hy0.mul(hy0)))
      Loop(
        u32(0),
        (j) => j.lt(u32(ITER)),
        () => {
          If(m2.le(16.0), () => {
            const nzx = Let(zx.mul(zx).sub(zy.mul(zy)).add(C_RE))
            zy.assign(zx.mul(zy).mul(2.0).add(C_IM))
            zx.assign(nzx)
            it.assign(it.add(1.0))
            const hx = Let(toF32(zx))
            const hy = Let(toF32(zy))
            m2.assign(hx.mul(hx).add(hy.mul(hy)))
          })
        },
      )
    })

    // Smooth escape time (same log₂ log₂ treatment as fp64-mandelbrot.ts)
    // through a cool cosine palette; interior stays black.
    const sn = Let(it.sub(log2(max(log2(max(m2, 1.0001)), 0.0001))).add(1.0))
    const inside = Let(step(f32(ITER).sub(0.5), it))
    const s = Let(sn.div(ITER))
    const ph = vec3(0.0, 0.25, 0.6)
    const rgb = vec3(0.5)
      .add(cos(ph.add(s.mul(5.5)).add(2.2)).mul(0.5))
      .mul(mix(f32(0.35), f32(1.0), s))
      .mul(f32(1).sub(inside))
    return vec4(rgb, f32(1))
  },
  { stage: 'fragment', retAttr: '@location(0)' },
)

// `_fp64` guard lands at (group 0, binding 1) automatically.
const fp64JuliaModule = module({
  funcs: [vs, fsJulia],
  uses: [U, VsOut],
})

export const fp64Julia: ShaderExample = {
  id: 'fp64-julia',
  title: 'fp64 Julia set',
  blurb:
    'The Julia-set face of the double-float technique: the seed c is fixed and the PIXEL becomes z₀, so precision lives entirely in the starting coordinate. The camera parks on a repelling fixed point — a point that is ON the Julia set at every scale — and dives: the plain-f32 left half collapses flat past a ~1e-7 span while the emulated-double right half keeps spiralling to the df64 floor. Drag to pan, wheel to zoom, flip the fp64 toggle to collapse the right half in place.',
  category: 'generic',
  file: 'fp64-julia.ts',
  module: fp64JuliaModule,
  renderable: true,
  splitLabels: ['f32', 'f64 (emulated)'],
  controls: {
    center: {
      kind: 'pan2d',
      value: [CENTER_X, CENTER_Y],
      zoomExpField: 'zoom_exp',
      unitsPerWidth: 2,
    },
    resolution: { kind: 'resolution' },
    zoom_exp: {
      kind: 'slider',
      label: 'Zoom 10^-x',
      min: 0,
      max: 16,
      step: 0.05,
      value: 4,
      wheel: true,
    },
    fp64: { kind: 'toggle', label: 'fp64 emulation', value: true },
  },
}
