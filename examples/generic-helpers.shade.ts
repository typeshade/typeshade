"use typeshade"

// Generics by monomorphisation (roadmap 0.3 item T9, #92). WGSL and GLSL ES 3.00 have no
// generics: a function has one signature. So a generic declaration is compiled once per set of
// argument types the file uses it with, and each call names the instance it meant.
//
// `pick` below is called on an f32 and on a vec3, so the module carries `pick_f32` and
// `pick_vec3`; `head` is called on an f32 array and on a u32 one. Nothing called `pick` is
// emitted — a generic is not a function the module has, its instances are.
//
// A type parameter is a type wherever a type is written: a parameter, a return, `array<T, N>`,
// and a local inside the body. What TypeScript will NOT take is arithmetic on an unconstrained
// one (`a + a` is "Operator '+' cannot be applied to types 'T' and 'T'"), which is its limit
// and not this compiler's, so a generic here composes calls, selects, indexes and field reads.

/** Either value, chosen at run time. The shape a generic takes best: no arithmetic on T. */
function pick<T>(c: bool, a: T, b: T): T {
  return c ? a : b
}

/** The first element of a fixed-length list, whatever it holds. */
function head<T>(xs: array<T, 3>): T {
  return xs[0]
}

/** A pair, built and returned as the array a tuple is (§28). */
function pair<T>(a: T, b: T): array<T, 2> {
  const both: array<T, 2> = [a, b]
  return both
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  const i = i32(vi)
  return vec4(pick(vi === u32(0), head(xs), xs[i]), ys[i], 0., 1.)
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv: vec2 = fract(p.xy * 0.01)
  // pick at f32, and again at vec3: two instances of one declaration.
  const gain = pick(uv.x > 0.5, 1.2, 0.6)
  const tint = pick(uv.y > 0.5, vec3(0.9, 0.4, 0.3), vec3(0.2, 0.6, 0.9))
  // head at u32, a third instance of a different declaration.
  const steps: array<u32, 3> = [2, 3, 5]
  const band = f32(head(steps)) * 0.1
  const span = pair(uv.x, uv.y)
  return vec4(tint * gain * (span[0] + span[1] + band), 1.)
}
