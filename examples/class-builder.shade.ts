"use typeshade";

/* @example
{
  "title": "A builder chain, super on accessors, and statics a subclass inherits",
  "blurb": "`a.at(p).tinted(c)` runs each call on `a`, in order, because a method whose every `return` is `return this` hands back its own object, and `new Disc().at(p).sized(r)` holds what `new` built in a temporary (Rule 8.10). `Capped.unit()` runs the `unit` that `Disc` declares with `this` as `Capped`, so `new this()` builds a `Capped` and `this.SIZE` reads `Capped.SIZE`; the size then goes through `Capped`'s setter, which clamps it and hands it to the base's through `super.size` (Rules 8.11, 8.13). The radius is `protected` and the centre `private` (Rule 8.15). Renders three discs.",
  "renderable": true
}
*/

// The rest of an ordinary TypeScript class, on the GPU (§26):
//
// - a method that returns `this` hands back its object, and a chain that is a whole statement
//   or initializer runs each call on the object it starts from (Rule 8.10);
// - `super.size` in an override reads through the base's getter and writes through its setter,
//   the base's half lowered once more for the derived class (Rule 8.11);
// - a static a class inherits runs with `this` as that class, so `new this()` builds it and
//   `this.SIZE` reads its own static (Rule 8.13);
// - `private` and `protected` are enforced as TypeScript enforces them (Rule 8.15).

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class FsOut {
  @location(0) color: vec4;
}

// Fullscreen triangle, as `rng-method.shade.ts` draws it.
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.;
  const y = f32(vi >> u32(1)) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) };
}

/** A disc: where it is, how big and what colour, each set by a method that hands the disc back. */
class Disc {
  static SIZE = 0.2;

  protected radius: f32 = 0.2;
  private center: vec2 = vec2(0.);
  tint: vec3 = vec3(1.);

  at(c: vec2): Disc {
    this.center = c;
    return this;
  }
  sized(r: f32): Disc {
    this.size = r;
    return this;
  }
  tinted(c: vec3): Disc {
    this.tint = c;
    return this;
  }

  get size(): f32 {
    return this.radius;
  }
  set size(r: f32) {
    this.radius = max(r, 0.01);
  }

  coverage(p: vec2): f32 {
    return 1. - smoothstep(this.radius - 0.01, this.radius, length(p - this.center));
  }

  /** A disc of the class the call names, `SIZE` across. */
  static unit(): Disc {
    let d = new this();
    d.size = this.SIZE;
    return d;
  }
}

/** A disc whose size never passes a ceiling: its setter clamps, then hands on to the base's. */
class Capped extends Disc {
  static SIZE = 0.35;

  set size(r: f32) {
    super.size = min(r, 0.3);
  }
  get size(): f32 {
    return super.size;
  }
}

@fragment
export function fs(v: VsOut): FsOut {
  // A chain as a statement: `at`, then `tinted`, each on `a`.
  let a = Disc.unit();
  a.at(vec2(-0.45, 0.)).tinted(vec3(0.95, 0.74, 0.32));
  // `Disc.unit`'s body run for `Capped`: `SIZE` is 0.35, and `Capped`'s setter clamps it to 0.3,
  // as it clamps the doubling below.
  let b = Capped.unit();
  b.at(vec2(0.4, 0.)).tinted(vec3(0.3, 0.6, 0.95));
  b.size *= 2.;
  // A chain that starts at `new` is held in a temporary, and the declaration takes what it built.
  const c = new Disc().at(vec2(0., 0.55)).sized(0.1).tinted(vec3(0.9, 0.3, 0.4));
  let col = mix(vec3(0.07, 0.08, 0.14), a.tint, a.coverage(v.uv));
  col = mix(col, b.tint, b.coverage(v.uv));
  col = mix(col, c.tint, c.coverage(v.uv));
  return { color: vec4(col, 1.) };
}
