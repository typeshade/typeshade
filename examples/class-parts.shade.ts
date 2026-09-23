"use typeshade"

/* @example
{
  "title": "Objects inside objects, a const that holds one, a field that holds a function, and an interface as a contract",
  "blurb": "`ring.advance(dt)` moves the ring by calling `step` on the `Mover` it holds, so `advance` changes its own object and takes it by reference, whichever class `step` belongs to (Rule 8.10). `const ring = new Ring()` is written through as TypeScript writes it, since nothing else holds what `new` built (Rule 6.10). `Ring.cover` is a field that holds an arrow function, a method under the field's name (Rule 8.16), and `coverOf<T extends Mark>` takes the interface `Mark` as the contract both classes implement, one function for each (Rule 6.9). Renders a ring and a dot.",
  "renderable": true
}
*/

// Four forms of an ordinary TypeScript class, on the GPU (§26):
//
// - a method that calls a changing method on a field of `this` changes `this` too, so it takes
//   its object by reference (Rule 8.10);
// - a `const` that holds what `new` built may be written through, and is a `var` from the first
//   write (Rule 6.10);
// - a field that holds an arrow function is a method under the field's name (Rule 8.16);
// - an interface that declares a method is a contract: `implements` and a type parameter's
//   constraint, never a value's type (Rule 6.9).

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

class FsOut {
  @location(0) color: vec4
}

// Fullscreen triangle, as `rng-method.shade.ts` draws it.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.
  const y = f32(vi >> u32(1)) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) }
}

/** Something that covers part of the screen, which a ring and a dot each supply. */
interface Mark {
  cover(p: vec2): f32
}

/** A point that moves: `step` changes its object. */
class Mover {
  pos: vec2 = vec2(0.)
  vel: vec2 = vec2(0.)
  step(dt: f32): void {
    this.pos += this.vel * dt
  }
}

/** A ring around a moving centre. */
class Ring implements Mark {
  center: Mover = new Mover()
  radius: f32 = 0.3
  width: f32 = 0.04
  // A field that holds a function: `Ring_cover(self_: Ring, p: vec2<f32>) -> f32`.
  cover = (p: vec2): f32 => {
    const d = abs(length(p - this.center.pos) - this.radius)
    return 1. - smoothstep(this.width * 0.5, this.width, d)
  }
  // Changes the ring through the `Mover` it holds.
  advance(dt: f32): void {
    this.center.step(dt)
  }
}

/** A dot, with a plain method for the contract. */
class Dot implements Mark {
  center: Mover = new Mover()
  size: f32 = 0.1
  cover(p: vec2): f32 {
    return 1. - smoothstep(this.size * 0.8, this.size, length(p - this.center.pos))
  }
}

/** Any mark's coverage: one function for each class it is called with. */
function coverOf<T extends Mark>(m: T, p: vec2): f32 {
  return m.cover(p)
}

@fragment
export function fs(v: VsOut): FsOut {
  // Nothing else holds what `new` built, so the const is the ring itself.
  const ring = new Ring()
  ring.center.vel = vec2(0.5, 0.2)
  ring.advance(0.5)
  const spot = new Dot()
  spot.center.pos = vec2(-0.45, -0.3)
  let col = vec3(0.06, 0.07, 0.12)
  col = mix(col, vec3(0.95, 0.7, 0.3), coverOf(ring, v.uv))
  col = mix(col, vec3(0.3, 0.7, 0.95), coverOf(spot, v.uv))
  return { color: vec4(col, 1.) }
}
