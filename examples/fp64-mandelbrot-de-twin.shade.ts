"use typeshade";

/* @example
{
  "title": "fp64 distance estimate (source twin)",
  "blurb": "`fp64-mandelbrot-de.ts` written in the source language: the mixed-precision distance estimate with the split spelled per value, the orbit's `let zx: f64 = 0.` beside the derivative's plain `let ux = 0.`, and `f32(zx)` narrowing z once per step so the `2*z*dz + 1` recurrence stays in f32. `u.center.x` is a lane read of a `vec2f64` (§39), and `log` / `exp`, which have no emulated-double form, are reached only after the narrow, exactly where the original reaches them. The twin with two escape-time loops in one entry, an all-f32 branch and an f64-orbit branch, one per half of the split screen.",
  "renderable": true,
  "twinOf": "fp64-mandelbrot-de"
}
*/
// The `"use typeshade"` twin of `fp64-mandelbrot-de.ts`.
//
// MIXED precision on purpose: the ORBIT (z) iterates in f64, its absolute position is what
// deep zoom destroys, while the DERIVATIVE (dz = 2*z*dz + 1) iterates in plain f32 from a
// per-step narrowed z, because the distance estimate d = 1/2*|z|*ln|z| / |dz| only ever needs
// |dz| to a few digits. Precision goes where it pays: the classic df64 discipline, opt in per
// VALUE and not per shader (§39). The boundary distance, normalised by the view span, shades
// glowing filaments that stay crisp at any depth on the f64 side; the f32 left half collapses
// past a ~1e-7 span.
//
// The `_fp64` guard uniform is injected by the lowering, not declared here, so it is absent
// from `reflect()` on both surfaces and present in both WGSL emits (§39, "The guard").

class Uniforms {
  center: vec2f64; // one DF64Vec2 slot; the host packs [hi.x, hi.y, lo.x, lo.y]
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

// The camera sits on a needle filament beside the period-3 minibrot (x ~ -1.7489); y = 0
// keeps the never-escaping real axis, and so the set's boundary, mid-frame at every depth.
// The centre and the zoom arrive through the uniform, so the twin spells neither.
@fragment
export function fs_de(vo: VsOut): vec4 {
  const span = pow(10.0, -u.zoom_exp);
  // Split screen: each half is a full view, so the right half's uv is folded back by one.
  const half = vo.uv.x * 2.0;
  const sx = half - (vo.uv.x < 0.5 ? 0.0 : 1.0);
  const dx = (sx - 0.5) * span;
  const dy = (vo.uv.y - 0.5) * span * (u.resolution.y / u.resolution.x * 2.0);

  // The escape radius is large, 1e6 rather than the usual 4, because that tightens the
  // distance estimate.
  let m2f = 0.; // |z|^2 when the orbit stopped (<= 1e6, the escape radius, means interior)
  let dm2 = 1.; // |dz|^2 at that moment
  if (vo.uv.x < 0.5 || u.fp64 < 0.5) {
    // f32 twin: orbit AND derivative in f32, centre narrowed once with f32(x) (§39).
    const cx = f32(u.center.x) + dx;
    const cy = f32(u.center.y) + dy;
    let zx = 0.;
    let zy = 0.;
    let ux = 0.; // dz
    let uy = 0.;
    for (let j: u32 = 0; j < 160; j++) {
      if (zx * zx + zy * zy <= 1e6) {
        const nux = (zx * ux - zy * uy) * 2.0 + 1.0;
        uy = (zx * uy + zy * ux) * 2.0;
        ux = nux;
        const nzx = zx * zx - zy * zy + cx;
        zy = zx * zy * 2.0 + cy;
        zx = nzx;
      }
    }
    m2f = zx * zx + zy * zy;
    dm2 = ux * ux + uy * uy;
  } else {
    // f64 orbit, f32 derivative: z is narrowed once per step for the dz twin. `u.center.x` is
    // a lane READ of a vec2<f64> and `0.` in a declared f64 position keeps the whole double,
    // both §39; a lane may not be written, but nothing here writes one.
    const cx = u.center.x + f64(dx);
    const cy = u.center.y + f64(dy);
    let zx: f64 = 0.;
    let zy: f64 = 0.;
    let ux = 0.;
    let uy = 0.;
    for (let j: u32 = 0; j < 160; j++) {
      // The escape test is a comparison of magnitudes, so it costs nothing to make it in f32.
      if (f32(zx * zx + zy * zy) <= 1e6) {
        const zx32 = f32(zx);
        const zy32 = f32(zy);
        const nux = (zx32 * ux - zy32 * uy) * 2.0 + 1.0;
        uy = (zx32 * uy + zy32 * ux) * 2.0;
        ux = nux;
        const nzx = zx * zx - zy * zy + cx;
        zy = zx * zy * 2.0 + cy;
        zx = nzx;
      }
    }
    m2f = f32(zx * zx + zy * zy);
    dm2 = ux * ux + uy * uy;
  }

  // d = 1/2*|z|*ln|z| / |dz|, normalised by the span, which makes the shading depth-invariant.
  // Everything from here on is f32 on both halves, so `log` and `exp`, which have no emulated
  // double form, are reached with an f32 operand exactly as the original reaches them.
  const mz = sqrt(max(m2f, 1.0));
  const de = mz * log(mz) * 0.5 / sqrt(max(dm2, 1e-30));
  const t = min(de / (span * 0.012), 40.0);
  // Interior (never escaped) gets no glow; filaments glow where d/span goes to 0.
  const escaped = m2f > 1e6 ? 1.0 : 0.0;
  const glow = exp(-t * 1.2) * escaped;
  const body = exp(-t * 0.25) * escaped;
  const rgb = vec3(0.02, 0.03, 0.08) + vec3(0.12, 0.2, 0.42) * body + vec3(1.0, 0.85, 0.45) * glow;
  return vec4(rgb, 1.);
}
