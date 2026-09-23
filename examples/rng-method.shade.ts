"use typeshade"

/* @example
{
  "title": "A method that changes its object and returns a value",
  "blurb": "A `class Rng` whose `next()` advances the generator's state and returns the draw: it takes its object by reference, a pointer on WGSL and `inout` on GLSL ES 3.00, and returns an `f32` like any method (§26). Three draws inside one `vec3(...)` and a draw in one arm of `?:` run in source order, each bound to a `let` ahead of its statement, and the arm is an `if`, so it draws only where it is chosen (Rule 7.9). Renders coloured grain with a few sparkles.",
  "renderable": true
}
*/

// A method that changes its object may return a value (§26): `next()` steps the generator's
// state and returns the draw, which is the shape every random-number generator has. It takes
// its object by reference, as every method that writes `this` does, so the return is free for
// the draw. It returned nothing until that reference landed, because the struct itself was
// what came back.
//
// The class twin of `private-state.shade.ts`, which keeps the same state in a module variable.
// Here the draws are made inside expressions, which is what that one's `const r = next()`
// lines avoided: `vec3(rng.next(), rng.next(), rng.next())` is three lets ahead of the
// constructor, in that order, on WGSL and on GLSL ES 3.00, which leaves the order of an
// operator's operands to the driver (Rule 7.9).

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class FsOut {
  @location(0) color: vec4
}

// Fullscreen triangle, as `private-state.shade.ts` draws it.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.
  const y = f32(vi >> u32(1)) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) }
}

/** A PCG generator: a linear congruential step, then O'Neill's RXS-M-XS permutation of the
 *  state as the output. */
class Rng {
  state: u32

  constructor(seed: u32) {
    this.state = seed
    // One step to scatter neighbouring seeds; the draw it returns is dropped.
    this.next()
  }

  /** Step the state, and return the top 24 bits of the permuted word as a draw in [0, 1). */
  next(): f32 {
    this.state = this.state * 747796405 + 2891336453
    const word = ((this.state >> ((this.state >> 28) + 4)) ^ this.state) * 277803737
    return f32(((word >> 22) ^ word) >> 8) / 16777216.
  }
}

@fragment
export function fs(v: VsOut): FsOut {
  const cell = vec2u(u32((v.uv.x + 1.) * 96.), u32((v.uv.y + 1.) * 96.))
  let rng = new Rng(cell.x * 1973 + cell.y * 9277 + 26699)
  // Three draws in one constructor: three lets ahead of it, first to last.
  const grain = vec3(rng.next(), rng.next(), rng.next())
  // The second draw is made only where the first one says so: the arm is an `if`, where a
  // `select` would draw on every pixel.
  const sparkle = rng.next() > 0.985 ? rng.next() : 0.
  const base = mix(vec3(0.08, 0.1, 0.16), vec3(0.3, 0.22, 0.35), v.uv.y * 0.5 + 0.5)
  return { color: vec4(base + (grain - vec3(0.5)) * 0.12 + vec3(sparkle), 1.) }
}
