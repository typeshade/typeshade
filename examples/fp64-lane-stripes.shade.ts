"use typeshade"

// The emulated-double surface as an author writes it (§39). Every construct this file uses
// was a diagnostic, a type lie or an emit-time SD0041 before #151, so it doubles as the
// gated proof that the front end now admits exactly what the fp64 pass can lower:
//
//   `u.origin` is an `f64` uniform field   — one vec2<f32> slot, the host packs splitF64
//   `o * 2.5`, `o * u.span`                — a literal and an f32 lift beside a scalar f64
//   `const stripe: f64 = 0.125`            — a literal in a DECLARED f64 position
//   `round(o)`, `p[2]`, `vec3(p)`          — the ties-to-even df64 round, a lane of a
//                                            vec64 (a swizzle of the hi/lo planes), and the
//                                            per-lane narrow
//   `length`/`dot` on a vec64              — typed f64, which the pass already emitted
//
// WHY THE STRIPES. A world coordinate near 1e7 has an f32 ulp of 1, so `fract(x)` on the
// plain-f32 path is a constant and the field goes flat; the same expression on the f64 path
// keeps every sub-unit digit and stripes cleanly. The fragment stage draws both halves, so
// the picture itself says whether the emulation ran.
//
// WHY NOTHING CROSSES THE ENTRY BOUNDARY. A double cannot be a varying: a @location field
// interpolates its two f32 words one at a time, which is not the interpolation of the double
// they encode, and the compiler refuses one at the declaration. There is no author-facing
// way to split a double into words and rebuild it, deliberately — the words are the
// emulation's business, not the language's. So the fragment stage READS the uniform itself:
// a uniform carries an f64 and every stage can see one, which is the remedy the refusal
// names and the shape a real program wants anyway.

class Uniforms {
  // One vec2<f32> slot on both targets; the host writes splitF64(origin) into it.
  origin: f64
  // World units swept across the screen.
  span: f32
}

declare const u: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
  // No f64 here, and no words standing in for one: `@location(1) origin: f64` is refused at
  // this declaration, and the fragment stage reads `u.origin` instead.
}

@vertex
export function vs(@builtin("vertex_index") idx: u32): VsOut {
  const x = f32(idx & 1) * 4. - 1.
  const y = f32(idx >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

// The whole numeric core, as a plain function so the CPU oracle can call it directly: the
// fragment stage below is the same expression with the uniform read inlined. That is what
// makes the "CPU agrees with the GPU" claim checkable rather than asserted —
// `examples/fp64-lane-stripes.test.ts` evaluates THIS function twice, once on the oracle
// (which computes an f64 as a JavaScript double) and once on the fp64-lowered module under
// f32 rounding (which is the arithmetic the GPU runs), and requires the two to agree.
export function stripeAt(origin: f64, offset: f32): f64 {
  // An f32 beside an f64 widens exactly — the pass wraps it as vec2<f32>(x, 0.0).
  const world = origin + offset
  // A literal in a declared f64 position keeps the double the author wrote.
  const stripe: f64 = 0.125
  return fract(world / stripe)
}

@fragment
export function fs(vo: VsOut): vec4 {
  // The uniform, read in the stage that needs it. A literal beside a scalar f64 is lifted to
  // an f64 literal carrying the full double, so the pass splits 2.5 rather than widening the
  // f32 rounding of it.
  const origin: f64 = u.origin * 2.5
  const offset = u.span * (vo.uv.x - 0.5)
  const bands = stripeAt(origin, offset)

  // A vec64 built from scalar doubles, then read lane by lane and as a whole. `round` on a
  // double goes through df64_round — ties to the EVEN integer, as WGSL defines `round` and as
  // the CPU oracle answers it; df64_nint, which the trig reduction uses, breaks them toward
  // +infinity instead.
  const p = vec3f64(origin + offset, round(origin), bands)
  const narrowed: vec3 = vec3(p)

  // Left half plain f32, right half emulated: the SAME expression, two precisions. Near 1e7
  // an f32 ulp is 1, so a coordinate a sixteenth of the way into a 0.125-wide stripe rounds
  // to the stripe boundary and the left half goes flat, while the right half — reading the
  // band back through an indexed lane of the vec64 — keeps striping.
  const flat = fract(f32(origin + offset) / 0.125)
  const shade = vo.uv.x < 0.5 ? flat : f32(p[2])
  // How far the two precisions have drifted apart, which is what the picture is about: 0
  // where f32 still holds the coordinate, and up to half a stripe once it cannot.
  const drift = abs(narrowed.z - flat)
  return vec4(shade, drift, fract(narrowed.y * 0.5), 1.)
}
