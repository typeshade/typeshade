"use typeshade";

/* @example
{
  "title": "Return types the body says",
  "blurb": "No function here writes a return type, and each returns what its body does, as TypeScript infers it (Rule 8.19): `Orbit.at` a `vec2`, the getter `period` an `f32`, the generic `pick` its arguments' type, `tint` a `vec3` and `ring` an `f32` although both are declared below the entry that calls them, and the local arrow function `falloff` what its expression is. `Rng.next` changes its object and returns an `f32`. Renders five jittered dots on an orbit, a ring and a falloff.",
  "renderable": true
}
*/

// A function that writes no return type returns what its body does (Rule 8.19, surface §14):
//
// - the type of its first `return` with a value, and nothing where it has none;
// - an arrow function's expression body returns its value;
// - a call that needs the type before the body's turn lowers the body first, so `tint` and
//   `ring` are called above their declarations;
// - a method, a getter and each instance of a generic function say theirs the same way.
//
// Each returns a constructor or a scalar, which the editor's TypeScript types as the compiler
// does; it types a product of vectors `number` (surface §14, #162).

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

/** A linear congruential generator: `next` changes `seed` and returns a value in [0, 1). */
class Rng {
  seed: u32 = u32(7);
  next() {
    this.seed = this.seed * u32(1664525) + u32(1013904223);
    return f32(this.seed >> u32(8)) / 16777216.;
  }
}

/** A circle the dots run on. */
class Orbit {
  radius: f32 = 0.45;
  speed: f32 = 1.5;
  get period() {
    return 6.2831855 / this.speed;
  }
  at(t: f32) {
    const a = t * this.speed;
    return vec2(cos(a) * this.radius, sin(a) * this.radius);
  }
}

/** `a` where `c` holds, `b` where it does not, whichever type they are. */
function pick<T>(c: bool, a: T, b: T) {
  if (c) {
    return a;
  }
  return b;
}

@fragment
export function fs(v: VsOut): FsOut {
  const p = v.uv;
  const orbit = new Orbit();
  let rng = new Rng();
  const falloff = (d: f32) => 0.004 / (d * d + 0.002);
  let glow = 0.;
  for (let i = 0; i < 5; i++) {
    const t = orbit.period * f32(i) / 5. + (rng.next() - 0.5) * 0.3;
    const a = orbit.at(t);
    const b = orbit.at(t + 0.05);
    glow += falloff(distance(p, pick(distance(p, a) < distance(p, b), a, b)));
  }
  const col = min(tint(glow, ring(p, orbit.radius * 0.6)), vec3(1.));
  return { color: vec4(col, 1.) };
}

/** The dots' blue and the ring's amber, added. */
function tint(glow: f32, lit: f32) {
  return vec3(0.3 * glow + lit, 0.6 * glow + 0.8 * lit, glow + 0.5 * lit);
}

/** A thin ring of radius `r` around the origin. */
function ring(p: vec2, r: f32) {
  return 1. - smoothstep(0., 0.01, abs(length(p) - r));
}
