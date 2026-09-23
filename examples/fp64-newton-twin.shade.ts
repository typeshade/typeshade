"use typeshade";

/* @example
{
  "title": "fp64 Newton fractal (source twin)",
  "blurb": "`fp64-newton.ts` written in the source language: Newton's method for z³ = 1 as a counted 48-step loop with a full complex DIVISION every step, so its f64 branch is the one place in the family that exercises `df64_div`. The split screen is a plain `if`/`else` over `uv.x < 0.5 || u.fp64 < 0.5`, and where the EDSL had to spell `f64(1.0)` to get a double reciprocal, the twin writes `1.0 / (gx * gx + gy * gy)` and §39 lifts the literal beside the `f64`.",
  "renderable": true,
  "twinOf": "fp64-newton"
}
*/
// The `"use typeshade"` twin of `fp64-newton.ts`.
//
// The fp64 family's DIVISION showcase: Newton's method z <- z - (z^3-1)/(3z^2) runs a full
// complex division every iteration, and the f64 side does it with df64_div (the long-division
// EFT), the one emulated op an add/mul-only demo never touches. The camera sits on a basin
// boundary of the three cube roots; the boundary is the Julia set of the Newton map and has
// the Wada property (every boundary point touches ALL THREE basins), so any zoom depth shows
// the three colours interleaved, CPU-verified to 50+ distinct (root, steps) cells per 48^2
// window down to a 1e-11 span. The plain-f32 left half collapses once the span drops under
// one ulp of the center (~1e-7).
//
// The `_fp64` guard uniform is injected by the lowering (§39), never declared here; the
// render harnesses bind it to 1.0f.

// The uniform head. `center` is one DF64Vec2 slot: the host packs [hi.x, hi.y, lo.x, lo.y],
// the same packing on both surfaces, which is why no splitting is spelled in the shader.
// Field ORDER is the std140 byte layout, so it matches the original field for field.
class Uniforms {
  center: vec2f64;
  resolution: vec2;
  zoom_exp: f32; // view span = 10^-zoom_exp complex units
  fp64: f32; // toggle: 1 = split-screen f32 | f64 (canonical), 0 = all-f32
}

declare const u: uniform<Uniforms>;

// A `.shade.ts` file cannot import, so the fullscreen head `_fullscreen.ts` gives the original
// is re-spelled here, exactly as `julia-twin.shade.ts` does.
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
export function fs_newton(vo: VsOut): vec4 {
  const span = pow(10.0, -u.zoom_exp);
  const half = vo.uv.x * 2.0;
  const sx = half - (vo.uv.x < 0.5 ? 0.0 : 1.0);
  const dx = (sx - 0.5) * span;
  const dy = (vo.uv.y - 0.5) * span * (u.resolution.y / u.resolution.x * 2.0);

  // Iterate to convergence; hand the FINAL z (narrowed) + step count out.
  let fx = 0.; // final Re z
  let fy = 0.; // final Im z
  let it = 0.; // steps until the update went sub-epsilon
  if (vo.uv.x < 0.5 || u.fp64 < 0.5) {
    // f32 twin: z0 from the narrowed center, so at deep zoom every pixel starts at the SAME
    // quantized point and the basins collapse flat.
    let zx = f32(u.center.x) + dx;
    let zy = f32(u.center.y) + dy;
    for (let j: u32 = 0; j < 48; j++) {
      const z2x = zx * zx - zy * zy;
      const z2y = zx * zy * 2.0;
      const nx = z2x * zx - z2y * zy - 1.0; // Re(z^3-1)
      const ny = z2x * zy + z2y * zx; // Im(z^3-1)
      const gx = z2x * 3.0; // Re(3z^2)
      const gy = z2y * 3.0;
      const inv = 1.0 / (gx * gx + gy * gy);
      const qx = (nx * gx + ny * gy) * inv;
      const qy = (ny * gx - nx * gy) * inv;
      zx = zx - qx;
      zy = zy - qy;
      if (qx * qx + qy * qy > 1e-14) {
        it = it + 1.0;
      }
    }
    fx = zx;
    fy = zy;
  } else {
    // f64: the SAME Newton step; the quotient runs through df64_div. Every literal here sits
    // beside an f64, so §39 lifts it to the full double, which is what the original
    // asked for by hand with `f64(1.0)`.
    let zx = u.center.x + f64(dx);
    let zy = u.center.y + f64(dy);
    for (let j: u32 = 0; j < 48; j++) {
      const z2x = zx * zx - zy * zy;
      const z2y = zx * zy * 2.0;
      const nx = z2x * zx - z2y * zy - 1.0;
      const ny = z2x * zy + z2y * zx;
      const gx = z2x * 3.0;
      const gy = z2y * 3.0;
      const inv = 1.0 / (gx * gx + gy * gy);
      const qx = (nx * gx + ny * gy) * inv;
      const qy = (ny * gx - nx * gy) * inv;
      zx = zx - qx;
      zy = zy - qy;
      // The step-size test is an f32 question, so the sum is narrowed before the compare;
      // a comparison against an f32 literal on an f64 would be a df64 compare the original
      // does not run.
      if (f32(qx * qx + qy * qy) > 1e-14) {
        it = it + 1.0;
      }
    }
    fx = f32(zx);
    fy = f32(zy);
  }

  // Classify the landing root (attracting fixed points, so f32 suffices) and shade by
  // convergence speed: boundary-hugging pixels stay near-black. 0.8660254037844386 is
  // sqrt(3)/2, the imaginary part of the two non-real cube roots; the EDSL's R_IM was a
  // build-time JavaScript const, so it is inlined here, where a source const would be a
  // shader let the original does not have.
  const d0 = (fx - 1.0) * (fx - 1.0) + fy * fy;
  const d1 = (fx + 0.5) * (fx + 0.5) + (fy - 0.8660254037844386) * (fy - 0.8660254037844386);
  const d2 = (fx + 0.5) * (fx + 0.5) + (fy + 0.8660254037844386) * (fy + 0.8660254037844386);
  const c0 = vec3(0.91, 0.34, 0.22); // root 1, vermilion
  const c1 = vec3(0.2, 0.66, 0.88); // root e^{2pi i/3}, sky
  const c2 = vec3(0.98, 0.78, 0.22); // root e^{-2pi i/3}, gold
  const base = (d0 <= d1 && d0 <= d2) ? c0 : (d1 <= d2 ? c1 : c2);
  const speed = 1. - it / 48.;
  // Annotated for the EDITOR, not for the compiler. TypeScript types
  // `vec3 * scalar` as `number`, so `rgb` would lose its lanes and draw TS2345
  // at the `vec4(...)` that returns it, on a program that compiles (issue #43).
  // Emit-neutral: the WGSL and GLSL are byte-identical without it.
  const rgb: vec3 = base * mix(0.25, 1.0, speed);
  return vec4(rgb, 1.);
}
