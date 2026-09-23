"use typeshade";

/* @example
{
  "title": "Loops over data",
  "blurb": "The three loops a program over data writes, through Tint and a real WebGL2 context: a `for` whose bound is a uniform the host sets, a `while` that walks an explicit stack until it is empty (the BVH traversal shape), and a `while (true)` iteration that leaves at a `break` once it has converged, and a `for…of` over a constant array (Rule 7.5, #203).",
  "renderable": true
}
*/

// The gated example for Rule 7.5 as #203 rewrote it. Until then the rule refused a `for` over
// a count the host sets (`TS8006 for exit must compare "i" to a constant bound`), capped every
// `for` at 256 trips, and accepted a `while` only by accident of its condition's shape. Both
// targets accept all three loops below as written; this file is the compile gate's evidence.
//
// - `march` counts to `frame.steps`, a uniform. The step is a constant, so the compiler still
//   checks it moves toward the bound.
// - `leaves` walks a binary tree of depth `depth` with a stack of pending nodes, a loop whose
//   exit is "the stack is empty" and not a bound on a counter: an open loop.
// - `isqrt` runs Newton's iteration for a square root until two steps agree, and leaves at a
//   `break`. `while (true)` is refused only when nothing in its body can leave it.
// - `fs` weighs three samples with `for (const w of WEIGHTS)`, the loop a TypeScript author
//   writes over an array: a counted loop over its indices, with the element read each trip.

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

interface Frame {
  steps: i32;
  depth: i32;
}

declare const frame: uniform<Frame>;

const WEIGHTS: array<f32, 3> = [0.25, 0.5, 0.25];

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(i32(vi) / 2) * 4. - 1.;
  const y = f32(i32(vi) % 2) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) * 0.5 + vec2(0.5, 0.5) };
}

/** Accumulates a soft ring along the ray, in as many steps as the host asks for. */
function march(uv: vec2, steps: i32): f32 {
  let acc = 0.;
  for (let i: i32 = 0; i < steps; i++) {
    const t = (f32(i) + 0.5) / f32(steps);
    const d = abs(length(uv - vec2(0.5, 0.5)) - t * 0.5);
    acc += exp(-d * 60.) / f32(steps);
  }
  return acc;
}

/** The number of leaves of a binary tree of the given depth, walked with a stack. */
function leaves(depth: i32): i32 {
  let stack: array<i32, 16> = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let sp: i32 = 1;
  stack[0] = depth;
  let count: i32 = 0;
  while (sp > 0) {
    sp -= 1;
    const d = stack[sp];
    if (d <= 0 || sp >= 14) {
      count += 1;
    } else {
      stack[sp] = d - 1;
      stack[sp + 1] = d - 1;
      sp += 2;
    }
  }
  return count;
}

/** The square root of `x`, by Newton's iteration until two steps agree. The iteration is
 *  taken on `max(x, 0.)`: from a negative `x` it runs to -infinity, two steps never agree,
 *  and an open loop is the author's to end (Rule 7.5), so the guard is the author's too. */
function isqrt(x: f32): f32 {
  const a = max(x, 0.);
  let r = max(a, 1.);
  while (true) {
    const next = 0.5 * (r + a / r);
    if (abs(next - r) < 0.0001) {
      break;
    }
    r = next;
  }
  return r;
}

@fragment
export function fs(v: VsOut): Color {
  const ring = march(v.uv, frame.steps);
  const n = f32(leaves(frame.depth));
  let s = 0.;
  let k = 0.;
  for (const w of WEIGHTS) {
    s += w * isqrt(v.uv.x * 4. + k) * 0.5;
    k += 1.;
  }
  return { color: vec4(ring, fract(n / 7.), s, 1.) };
}
