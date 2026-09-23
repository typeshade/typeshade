"use typeshade";

/* @example
{
  "title": "A method that changes its object",
  "blurb": "A `class Body` whose `step`, `turn` and `advance` assign to `this`, so each takes its object by reference (§26): GLSL ES 3.00 spells that `inout Body self_`, WGSL spells it `self_: ptr<function, Body>` and reads through it as `(*self_)`, and the call is a plain statement on both. `reach`, which only reads, keeps its object by value. The render twin of `particle-step`, so the gate links the `inout` spelling on a real WebGL2 driver.",
  "renderable": true
}
*/

// A method that changes its object takes it BY REFERENCE (§26). GLSL ES 3.00 spells that
// `inout Body self_`; WGSL spells it as a pointer, `self_: ptr<function, Body>`, and reads
// through it as `(*self_)`. The call is a plain statement either way.
//
// This is the render twin of `particle-step`, which is compute-only: the gate compiles and
// LINKS this one on WebGL2, so the `inout` spelling is checked against a real driver and not
// only against Tint.
//
// It took the struct and RETURNED it until the reference landed, and the call site read the
// receiver, called, and stored the result back — three copies of a struct for one method that
// moves a point. Nothing about the source changed; what a method IS did not change either.

class Body {
  at: vec2;
  vel: vec2;
  spin: f32;

  /** Move one step, and bleed a little speed. */
  step(dt: f32): void {
    this.at = this.at + this.vel * dt;
    this.vel = this.vel * 0.985;
  }

  /** Turn the velocity by the body's own spin. */
  turn(dt: f32): void {
    const a = this.spin * dt;
    const c = cos(a);
    const s = sin(a);
    this.vel = vec2(this.vel.x * c - this.vel.y * s, this.vel.x * s + this.vel.y * c);
  }

  /** One frame of both, which is a method that changes its object by calling two that do. */
  advance(dt: f32): void {
    this.turn(dt);
    this.step(dt);
  }

  /** A method that only READS keeps its object by value, as every method did before. */
  reach(): f32 {
    return length(this.at);
  }
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  return vec4(xs[i], ys[i], 0., 1.);
}

@fragment
export function fs(@builtin("position") frag: vec4): vec4 {
  const uv: vec2 = fract(frag.xy * 0.01) - vec2(0.5);
  let b = new Body();
  b.at = uv;
  b.vel = vec2(-uv.y, uv.x) * 0.4;
  b.spin = 2.2;
  // Eight frames of the body, each one a call that writes through its receiver.
  for (let n = 0; n < 8; n++) {
    b.advance(0.05);
  }
  const glow: f32 = 1. - smoothstep(0., 0.6, b.reach());
  return vec4(glow, glow * 0.4 + b.spin * 0.1, 0.6 - glow * 0.3, 1.);
}
