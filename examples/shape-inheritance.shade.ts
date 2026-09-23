"use typeshade";

/* @example
{
  "title": "Inheritance",
  "blurb": "An `abstract class Shape` with a concrete method and an abstract one, two classes that extend it, and one that extends a subclass and calls `super` (§26). A struct is flat, with the base's fields first, and dispatch is static: a class inherits a method by lowering the base's body again with `this` typed as itself, so `coverage` calls each class's own `sdf` and no `Shape_coverage` is emitted.",
  "renderable": true
}
*/

// Inheritance (roadmap 0.3 item T5, §26): an `abstract class Shape` with a field, a concrete
// method and an abstract one, two classes that extend it, and one that extends a subclass and
// calls `super` twice over: `super(center)` in a constructor runs the base's and copies its
// fields in, and `super.sdf(p)` in an override runs the base's body on this object. A struct
// here is flat, with the base's fields first, so `Square` is `Shape`'s
// layout with more on the end. Dispatch is static: a class inherits a method by lowering the
// base's body again with `this` typed as itself, which is why `Shape`'s `coverage` calls
// `Square_sdf` in one and `Circle_sdf` in the other, and why there is no `Shape_coverage` at
// all. A base-typed name cannot hold a derived value, which is what makes that agree with
// TypeScript. Both targets take a struct by value, so the gate runs the same program through
// Tint and a WebGL2 context.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

abstract class Shape {
  center: vec2;
  constructor(center: vec2) {
    this.center = center;
  }
  abstract sdf(p: vec2): f32;
  // Inherited, not overridden: lowered once per concrete class, where `this.sdf` is that
  // class's own.
  coverage(p: vec2): f32 {
    return 1. - smoothstep(0., 0.02, this.sdf(p));
  }
}

class Circle extends Shape {
  radius: f32;
  constructor(center: vec2, radius: f32) {
    super(center);
    this.radius = radius;
  }
  sdf(p: vec2): f32 {
    const d: vec2 = p - this.center;
    return length(d) - this.radius;
  }
}

class Square extends Shape {
  extent: f32;
  constructor(center: vec2, extent: f32) {
    super(center);
    this.extent = extent;
  }
  sdf(p: vec2): f32 {
    const d: vec2 = abs(p - this.center) - vec2(this.extent);
    return length(max(d, vec2(0.))) + min(max(d.x, d.y), 0.);
  }
}

class Ring extends Circle {
  thickness: f32;
  constructor(center: vec2, radius: f32, thickness: f32) {
    super(center, radius);
    this.thickness = thickness;
  }
  // An override that wants the base's answer: `super.sdf` is `Circle`'s body, lowered against
  // `Ring`.
  sdf(p: vec2): f32 {
    return abs(super.sdf(p)) - this.thickness;
  }
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  const p: vec2 = vec2(xs[i], ys[i]);
  return { pos: vec4(p, 0., 1.), uv: p };
}

@fragment
export function fs(v: VsOut): vec4 {
  const circle = new Circle(vec2(-0.45, 0.), 0.3);
  const square = new Square(vec2(0.45, 0.), 0.26);
  const ring = new Ring(vec2(0., 0.55), 0.22, 0.05);
  const lit: vec3 =
    vec3(0.95, 0.42, 0.3) * circle.coverage(v.uv) +
    vec3(0.36, 0.7, 0.98) * square.coverage(v.uv) +
    vec3(0.98, 0.86, 0.4) * ring.coverage(v.uv);
  return vec4(lit + vec3(0.05, 0.05, 0.08), 1.);
}
