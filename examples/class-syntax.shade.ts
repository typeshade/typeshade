"use typeshade";

/* @example
{
  "title": "Getters, setters, private names and parameter properties",
  "blurb": "A `class Ring` written the way TypeScript classes are: its centre and radius are parameter properties, its band width a private `#width` behind a getter and a setter that clamps it, its distance a private method, and `Ring.unit` a static getter. Each accessor half is a function of the module, `Ring_get_width` and `Ring_set_width`, and `b.width -= 0.1` reads through the one and writes through the other (§26, Rules 8.11 to 8.14). A static counter the file writes is a per-invocation variable. Renders two gold rings.",
  "renderable": true
}
*/

// The class syntax an ordinary TypeScript class uses, on the GPU (§26):
//
// - `constructor(public center: vec2, readonly radius: f32)` declares two fields and assigns
//   them from the arguments (Rule 8.14);
// - `#width = 0.05` is a private field whose type comes from its initializer, emitted as the
//   member `width`, and only this class's body may name it (Rule 8.12);
// - `get width()` and `set width(w)` are `Ring_get_width` and `Ring_set_width`; the setter writes
//   its object, so it takes it by reference like any method that does (Rule 8.11);
// - `static drawn` is written, so it is the per-invocation variable `Ring_drawn`, and `this` in
//   the static `count()` is the class (Rule 8.13).

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

/** A ring: a centre and a radius, and a band width kept above a minimum by its setter. */
class Ring {
  static readonly MIN_WIDTH = 0.01;
  static drawn = 0.;

  #width = 0.05;

  constructor(
    public center: vec2,
    readonly radius: f32,
  ) {}

  get width(): f32 {
    return this.#width;
  }
  set width(w: f32) {
    this.#width = max(w, Ring.MIN_WIDTH);
  }

  /** The width as a fraction of the radius, written through the width's own setter. */
  set relativeWidth(f: f32) {
    this.width = this.radius * f;
  }

  /** The signed distance from `p` to the band. */
  #distance(p: vec2): f32 {
    return abs(length(p - this.center) - this.radius) - this.#width * 0.5;
  }

  coverage(p: vec2): f32 {
    return 1. - smoothstep(0., 0.012, this.#distance(p));
  }

  static get unit(): Ring {
    return new Ring(vec2(0.), 0.5);
  }

  static count(): void {
    this.drawn += 1.;
  }
}

@fragment
export function fs(v: VsOut): FsOut {
  let a = Ring.unit;
  a.relativeWidth = 0.16;
  let b = new Ring(vec2(0.35, 0.2), 0.3);
  // Read through the getter, written through the setter, which clamps it to MIN_WIDTH.
  b.width -= 0.1;
  Ring.count();
  Ring.count();
  const ink = max(a.coverage(v.uv), b.coverage(v.uv));
  const tint = mix(vec3(0.07, 0.08, 0.14), vec3(0.95, 0.74, 0.32), ink);
  return { color: vec4(tint * (Ring.drawn * 0.5), 1.) };
}
