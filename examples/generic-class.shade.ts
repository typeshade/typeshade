"use typeshade"

/* @example
{
  "title": "A generic class by monomorphisation",
  "blurb": "A `class Slot<T>` used at f32 and at vec3, so the module carries `Slot_f32` and `Slot_vec3` as separate structs, each with its own constructor and its own copy of every method (§32). Neither target has a generic struct: a WGSL or GLSL struct is one layout. Nothing called `Slot` is emitted. A type parameter's default is read the way TypeScript reads it, so `Level` needs no type argument; a static cannot mention `T`, so it is one function under the class's own name; and a base written `extends Slot<f32>` inherits the instance.",
  "renderable": true
}
*/

// A generic CLASS by monomorphisation (roadmap 0.3 item T9, #92), the half of that item the
// generic functions in `generic-helpers.shade.ts` are the other of.
//
// Neither target has a generic struct: a WGSL or GLSL struct is ONE layout, its fields' types
// fixed. So a generic class is collected once per set of type arguments the file writes it
// with. `Slot<f32>` and `Slot<vec3>` below are the structs `Slot_f32` and `Slot_vec3`, each
// with its own constructor and its own copy of every method. Nothing called `Slot` is emitted —
// a generic is not a struct the module has, its instances are.
//
// The same limit the function half has, and it is TypeScript's rather than this compiler's:
// arithmetic on an unconstrained `T` is "Operator '+' cannot be applied to types 'T' and 'T'",
// so a generic here holds, selects, indexes and returns, and the arithmetic happens on what it
// gives back. That is what a generic container is for.

/** Two of something, and a run-time choice between them. */
class Slot<T> {
  a: T
  b: T

  constructor(a: T, b: T) {
    this.a = a
    this.b = b
  }

  // Written once in terms of `T`, compiled once per instance: at f32 and at vec3 below.
  either(c: bool): T {
    return c ? this.a : this.b
  }

  first(): T {
    return this.a
  }
}

/** A fixed-length list of `T`, with the index kept inside. A type parameter is a type wherever
 *  a type is written, `array<T, 3>` included. */
class Bag<T> {
  xs: array<T, 3>

  constructor(xs: array<T, 3>) {
    this.xs = xs
  }

  nth(i: i32): T {
    return this.xs[i]
  }
}

/** Every type parameter has a default, so the bare name is the instance those defaults give:
 *  `Level` and `Level<f32>` are one struct, exactly as TypeScript reads them. */
class Level<T = f32> {
  edge: T

  constructor(edge: T) {
    this.edge = edge
  }

  // A static cannot mention `T` — TypeScript refuses that outright — so it is ONE function
  // however many instances there are, and is emitted under the class's own name, `Level_unit`.
  static unit(): f32 {
    return 0.75
  }
}

/** A base written with type arguments is the INSTANCE it names: this inherits `Slot_f32`'s two
 *  f32 fields and its methods, not a layout `Slot` would have had. */
class Marked extends Slot<f32> {
  tag: f32

  constructor(a: f32, b: f32, tag: f32) {
    super(a, b)
    this.tag = tag
  }
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.]
  const ys: array<f32, 3> = [-1., -1., 3.]
  const i = i32(vi)
  return vec4(xs[i], ys[i], 0., 1.)
}

@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const uv: vec2 = fract(p.xy * 0.006)

  // One declaration, two instances: a scalar one and a vector one.
  const gain = new Slot<f32>(1.15, 0.55)
  const tint = new Slot<vec3>(vec3(0.95, 0.45, 0.28), vec3(0.18, 0.55, 0.92))

  const band = new Bag<f32>([0.2, 0.55, 0.9])
  const step = band.nth(i32(floor(uv.y * 3.)))

  // The type argument is left out, and the class's default supplies it.
  const level = new Level(0.35)
  const edge = smoothstep(0., level.edge, uv.y) * Level.unit()

  const marked = new Marked(0.4, 0.8, 0.5)

  const k = gain.either(uv.x > 0.5) * step * marked.first() * marked.tag
  return vec4(tint.either(uv.y > 0.5) * k * edge, 1.)
}
