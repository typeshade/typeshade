"use typeshade"

// The `"use typeshade"` twin of `fp64-deep-zoom.ts`.
//
// The emulated-double surface in one screen: a world coordinate near 1e8, where an f32 ulp is
// 8 and every sub-integer detail is already gone, is swept across the screen and drawn as
// fract() stripes. The LEFT half computes in plain f32, the origin narrowed on purpose with
// f32(), and collapses to a flat field; the RIGHT half runs the SAME formula on the f64 type
// and keeps clean stripes. The authoring surface is the same either way, `+`, `*` and
// `fract()`, and only the declared type of the uniform differs: fp64Lower rewrites the f64
// side into df64_* calls against the injected emulation library.
//
// The lowering also injects the `_fp64` guard uniform, the anti-fast-math guard of
// core/fp64/df64-lib.ts, which is why nothing here declares it: it is added at LOWERING, so it
// is absent from the authored reflect() on both surfaces, and the render harnesses bind 1.0f
// into it by probing the program for the Fp64Guard block.

class Uniforms {
  origin: f64 // occupies one vec2<f32> slot, the host packs the two words
  span: f32 // world units swept across the screen
  fp64: f32 // toggle: 1 = split-screen f32 | f64 (canonical), 0 = all-f32
}

declare const u: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

// Oversized fullscreen triangle, the same pattern as gradient-pass.ts. The original reaches it
// with If().elif() over an auto-var, which here is a reassigned `let`; the comparison is `===`
// because `==` is refused with TS8099.
@vertex
export function vs_full(@builtin("vertex_index") idx: u32): VsOut {
  let pos = vec2(-1., -1.)
  if (idx === 1) {
    pos = vec2(3., -1.)
  } else if (idx === 2) {
    pos = vec2(-1., 3.)
  }
  return { pos: vec4(pos, 0., 1.), uv: vec2((pos.x + 1.) * 0.5, (pos.y + 1.) * 0.5) }
}

@fragment
export function fs_stripes(vo: VsOut): vec4 {
  const sweep = vo.uv.x * u.span
  // f64 path: the full-precision world coordinate keeps its fraction. `f64(sweep)` widens the
  // f32 sweep exactly (§39), and `fract` is one of the ten builtins with a df64 body.
  const stripes64 = f32(fract(u.origin + f64(sweep)))
  // f32 twin, SAME formula, origin narrowed: the fraction is unrepresentable.
  const stripes32 = fract(f32(u.origin) + sweep)
  // fp64 toggle off, and the WHOLE screen takes the f32 path: the right half collapses flat in
  // place, which is what makes the emulation's contribution tangible.
  const v = (vo.uv.x < 0.5 || u.fp64 < 0.5) ? stripes32 : stripes64
  return vec4(v, v, v, 1.0)
}
