"use typeshade";

/* @example
{
  "title": "fp64 Julia set (source twin)",
  "blurb": "`fp64-julia.ts` written in the source language: the seed is fixed and the pixel becomes z₀, so the `if`/`else` split runs the same escape loop over an `f64` on one side and a plain `f32` on the other. The double half spells nothing the emulation does not already carry, a `vec2f64` lane read, `f64(dx)` widening the pixel offset, and the seed lifted to full doubles beside it (§39), and the double half lowers to `df64_sqr` for each square, one `df64_mul` for `zx * zy` with its doubling an exact `* 2.0` on the two words, and `df64_add` / `df64_sub` around them, against plain f32 ops. The escape test reads an f32 |z|² on both halves: the double half narrows its words for it, since 48 bits move a value across 16 only from within an f32 rounding of it, and the f32 half carries its squares beside it, so no square is computed twice a trip. Both loops leave with a `break` at the first escaped z.",
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
  center: vec2f64; // one DF64Vec2 slot, the host packs [hi.x, hi.y, lo.x, lo.y]
  resolution: vec2;
  zoom_exp: f32; // view span = 10^-zoom_exp complex units
  fp64: f32; // toggle: 1 = split-screen f32 | f64 (canonical), 0 = all-f32
}

declare const u: uniform<Uniforms>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.;
  const y = f32(vi >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) };
}

@fragment
export function fs_julia(vo: VsOut): vec4 {
  const span = pow(10.0, -u.zoom_exp);
  // Each half maps its own 0..1 sub-range onto the SAME complex window
  // (pan lives on the HOST in full double precision, see fp64-mandelbrot.ts).
  const half = vo.uv.x * 2.0;
  const sx = half - (vo.uv.x < 0.5 ? 0.0 : 1.0);
  const dx = (sx - 0.5) * span;
  const dy = (vo.uv.y - 0.5) * span * (u.resolution.y / u.resolution.x * 2.0);

  // |z|^2 of the last z the loop reached, CARRIED beside z: set from z0 before
  // the loop, refreshed after every step, read by the escape test, and after the
  // loop already the |z|^2 the smooth colouring wants. The test is one compare.
  //
  // The loop leaves at the first escaped z, with a `break` at the top of the
  // trip, instead of running to 128 and skipping its body. The natural spelling
  // is the loop condition, `j < 128 && m2 <= 16.0`, which this surface does not
  // accept: a `for` is counted (surface §17, Rule 7.5 of docs/language-design.md),
  // its condition is read as ONE comparison of the counter against a constant,
  // and the conjunction is TS8006. A `break` is the same program in the counted
  // form; `fp64-julia.ts` records what exiting does and does not save.
  let it = 0.
  let m2 = 0.
  if (vo.uv.x < 0.5 || u.fp64 < 0.5) {
    // f32 twin: z0 built from the narrowed center. At deep zoom the pixel
    // coordinate quantizes to f32 ulps and whole columns collapse.
    //
    // The squares are carried as well, beside m2. The step needs zx^2 and zy^2,
    // and the m2 refresh at the end of the trip before squared that same z;
    // squaring it again in the step puts the two on opposite sides of the loop's
    // back edge, where no CSE can share them (two multiplies a trip; the counts
    // are in `fp64-julia.ts`).
    let zx = f32(u.center.x) + dx
    let zy = f32(u.center.y) + dy
    let x2 = zx * zx
    let y2 = zy * zy
    m2 = x2 + y2
    for (let j: u32 = 0; j < 128; j++) {
      if (m2 > 16.0) {
        break
      }
      const nzx = x2 - y2 + -0.8
      zy = zx * zy * 2.0 + 0.156
      zx = nzx
      it = it + 1.0
      x2 = zx * zx
      y2 = zy * zy
      m2 = x2 + y2
    }
  } else {
    // f64: the same loop, z0 keeps its extended-precision position. The
    // literals beside an f64 are lifted to full doubles (§39), and `f64(dx)`
    // widens the f32 pixel offset exactly. m2 is taken differently. The escape
    // test asks only which side of 16 |z|^2 lies on, and 48 bits change that
    // answer only within an f32 rounding of the threshold, so m2 is squared in
    // f32 from the narrowed words instead of in df64: two df64 squares, a
    // df64_add and a df64_le fewer every trip. `f32(zx)` rounds hi + lo, which
    // is the high word itself up to a half-ulp tie; the high word alone is not a
    // name this surface has (the split is compiler-internal, Rule 2.2 of
    // docs/language-design.md). So this half has no squares to carry: the step
    // squares z in df64 and the refresh squares its narrowed words in f32, two
    // different values. A pixel within an f32 rounding of |z|^2 = 16 can escape
    // one step earlier or later than a df64 test would have it, and the smooth
    // colouring absorbs the step; the counts are in `fp64-julia.ts`.
    let zx = u.center.x + f64(dx)
    let zy = u.center.y + f64(dy)
    const hx0 = f32(zx)
    const hy0 = f32(zy)
    m2 = hx0 * hx0 + hy0 * hy0
    for (let j: u32 = 0; j < 128; j++) {
      if (m2 > 16.0) {
        break
      }
      const nzx = zx * zx - zy * zy + -0.8
      zy = zx * zy * 2.0 + 0.156
      zx = nzx
      it = it + 1.0
      const hx = f32(zx)
      const hy = f32(zy)
      m2 = hx * hx + hy * hy
    }
  }

  // Smooth escape time (the same log2 log2 treatment as fp64-mandelbrot.ts)
  // through a cool cosine palette; interior stays black.
  const sn = it - log2(max(log2(max(m2, 1.0001)), 0.0001)) + 1.0;
  const inside = step(128. - 0.5, it);
  const s = sn / 128.;
  const ph = vec3(0.0, 0.25, 0.6);
  // Annotated for the EDITOR, not for the compiler. TypeScript types
  // `vec3 * scalar` as `number`, so `rgb` would lose its lanes and draw TS2345
  // at the `vec4(...)` that returns it, on a program that compiles (issue #43).
  // Emit-neutral: the WGSL and GLSL are byte-identical without it.
  const rgb: vec3 = (vec3(0.5) + cos(ph + s * 5.5 + 2.2) * 0.5) * mix(0.35, 1.0, s) * (1. - inside);
  return vec4(rgb, 1.);
}
