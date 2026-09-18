"use typeshade"

// The mixin pattern (roadmap 0.3 item T8, #92): `class TintedDisc extends Tinted(Disc)`, a
// class whose base is decided by running a function.
//
// TypeScript runs `Tinted(Disc)` at run time and gets a constructor. There is no run time here,
// so it runs when this file is compiled and gives a list of members. The mixin's `tint` field
// and its `lit` method are spliced into each class that applies it, behind the base's fields
// and ahead of that class's own, which is the order TypeScript's own mixin produces.
//
// Nothing named `Tinted(Disc)` reaches the emitted code: there is no struct for it, because it
// is no layout a value has, and no `Tinted_lit`, because dispatch is static. `TintedDisc` and
// `TintedBar` each carry their own copy of `lit`, exactly as two classes extending one base do.
// The `function Tinted` itself emits nothing at all.

class Disc {
  center: vec2
  radius: f32
}

class Bar {
  center: vec2
  halfWidth: f32
}

/** Everything a shape needs to be drawn, added to whatever geometry it already has. */
function Tinted<TBase extends AnyClass>(Base: TBase) {
  return class extends Base {
    tint: vec3
    /** The colour this surface shows at a coverage between 0 and 1. */
    lit(cover: f32): vec3 {
      return this.tint * smoothstep(0., 1., cover)
    }
  }
}

class TintedDisc extends Tinted(Disc) {
  softness: f32
  constructor(center: vec2, radius: f32, softness: f32, tint: vec3) {
    super()
    this.center = center
    this.radius = radius
    this.softness = softness
    this.tint = tint
  }
  cover(p: vec2): f32 {
    return 1. - smoothstep(this.radius - this.softness, this.radius, length(p - this.center))
  }
}

class TintedBar extends Tinted(Bar) {
  softness: f32
  constructor(center: vec2, halfWidth: f32, softness: f32, tint: vec3) {
    super()
    this.center = center
    this.halfWidth = halfWidth
    this.softness = softness
    this.tint = tint
  }
  cover(p: vec2): f32 {
    return 1. - smoothstep(this.halfWidth - this.softness, this.halfWidth, abs(p.x - this.center.x))
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
export function fs(@builtin("position") frag: vec4): vec4 {
  const p: vec2 = frag.xy * 0.004
  const disc = new TintedDisc(vec2(0.6, 0.6), 0.35, 0.08, vec3(0.95, 0.4, 0.25))
  const bar = new TintedBar(vec2(1.4, 0.), 0.25, 0.05, vec3(0.2, 0.55, 0.9))
  const rgb: vec3 = disc.lit(disc.cover(p)) + bar.lit(bar.cover(p))
  return vec4(rgb, 1.)
}
