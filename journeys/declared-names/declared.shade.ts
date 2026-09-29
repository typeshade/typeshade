"use typeshade";

// Helpers named the way their author names them. `fract` is a sawtooth that starts a hundred above
// where the builtin does, `pow` takes the one operand a square needs, and `mix` a midpoint's two:
// each is also a WGSL builtin, and each call the author writes reaches the author's function, as
// TypeScript's lookup has it and as WGSL's own scoping does. A call the compiler writes does not:
// `random(x)` expands to the builtin `fract`, and `Math.pow(a, b)` is the builtin `pow`, whatever
// this file declares (Rule 9.5).

declare const out: storage<array<f32>, "read_write">;

function fract(x: f32): f32 {
  return x + 100.;
}

function pow(x: f32): f32 {
  return x * x;
}

function mix(a: f32, b: f32): f32 {
  return (a + b) * 0.5;
}

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x * 4 >= out.length) {
    return;
  }
  const x = f32(gid.x) * 0.25;
  out[gid.x * 4] = fract(x);
  out[gid.x * 4 + 1] = pow(x) + Math.pow(x, 3.);
  out[gid.x * 4 + 2] = mix(x, 1.);
  // `random` is hash-like and the two tiers' `sin` differ, so this says only what must hold on both:
  // it is a fractional part, below 1, which the author's `fract` (a hundred or more) is not.
  out[gid.x * 4 + 3] = random(x) < 1. ? 1. : 0.;
}
