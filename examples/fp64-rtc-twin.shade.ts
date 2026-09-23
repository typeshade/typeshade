"use typeshade";

/* @example
{
  "title": "fp64 relative-to-center (source twin)",
  "blurb": "`fp64-rtc.ts` written in the source language: a survey marker a few fractional units from the eye, drawn as a reticle. The f64 half reads both `vec2f64` world positions from the uniform, subtracts them as doubles and narrows the small delta with `f32(...)`; the f32 half narrows first and subtracts after, so at 10⁸ both operands land on the same 8-unit ulp grid and the reticle snaps off-target in whole-ulp jumps. The twin that shows §39's subtract-then-narrow discipline in one expression: `f32(u.center.x + f64(dx) - u.mark.x)` against `f32(u.center.x) + dx - f32(u.mark.x)`.",
  "renderable": true,
  "twinOf": "fp64-rtc"
}
*/
// The `"use typeshade"` twin of `fp64-rtc.ts`.
//
// Relative-to-center, the technique every planet-scale engine ships: a survey marker sits at
// world (10^8 + 3.7, 5*10^7 + 2.3) and the only value the shader needs is delta = marker - eye,
// a small number f32 carries perfectly, PROVIDED the subtraction happens in extended precision
// FIRST. The f64 right half subtracts as a double and narrows the result: a crisp reticle. The
// f32 left half narrows first and subtracts after, so both operands quantize to ulp(10^8) = 8
// world units, the delta comes out in 8-unit steps, and the reticle snaps to a coarse grid.
//
// The `_fp64` guard binding is injected by the lowering, not declared here (§39); the
// render harnesses bind it to 1.0.

class Uniforms {
  center: vec2f64; // camera/eye, one DF64Vec2 slot [hi.x, hi.y, lo.x, lo.y]
  mark: vec2f64; // marker world position (eye + a few fractional units)
  resolution: vec2;
  zoom_exp: f32; // view span = 10^-zoom_exp world units (negative = zoom out)
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
export function fs_rtc(vo: VsOut): vec4 {
  const span = pow(10.0, -u.zoom_exp);
  const half = vo.uv.x * 2.0;
  const sx = half - (vo.uv.x < 0.5 ? 0.0 : 1.0);
  const dx = (sx - 0.5) * span;
  const dy = (vo.uv.y - 0.5) * span * (u.resolution.y / u.resolution.x * 2.0);

  const isF32 = vo.uv.x < 0.5 || u.fp64 < 0.5;
  // f64 path: subtract FIRST as a double (exact by Sterbenz-style cancellation), narrow the
  // small result after. The pixel's world position is eye + offset, so delta = (eye + offset)
  // - marker. `f64(dx)` widens the f32 offset exactly, `f32(...)` narrows the small delta.
  const ex64 = f32(u.center.x + f64(dx) - u.mark.x);
  const ey64 = f32(u.center.y + f64(dy) - u.mark.y);
  // f32 twin: narrow FIRST, subtract after. At 10^8 both operands live on the 8-unit ulp
  // grid, so the delta quantizes to 8-unit steps.
  const ex32 = f32(u.center.x) + dx - f32(u.mark.x);
  const ey32 = f32(u.center.y) + dy - f32(u.mark.y);
  const ex = isF32 ? ex32 : ex64;
  const ey = isF32 ? ey32 : ey64;

  // Radar-style reticle in world units, everything scaled by the span so the picture is
  // zoom-invariant: rings every span/8, a crosshair, a hot dot.
  const rw = span * 0.125; // ring spacing
  const r = length(vec2(ex, ey));
  const pixw = span / (u.resolution.x * 0.5);
  const tri = (-abs(fract(r / rw) - 0.5) + 0.5) * rw; // dist to ring
  const ring = 1. - smoothstep(0., pixw * 1.6 + 1e-9, tri);
  const cross = 1. - smoothstep(0., pixw * 1.4 + 1e-9, min(abs(ex), abs(ey)));
  const dotGlow = exp(-(r / (pixw * 6.0 + 1e-9)));
  const vignette = max(0., 1. - r / (span * 0.75));

  const bg = mix(vec3(0.01, 0.04, 0.02), vec3(0.02, 0.09, 0.045), vignette);
  const rgb =
    bg +
    vec3(0.1, 0.75, 0.3) * (ring * 0.8) +
    vec3(0.12, 0.9, 0.4) * (cross * 0.55) +
    vec3(1.0, 0.45, 0.25) * dotGlow;
  return vec4(rgb, 1.);
}
