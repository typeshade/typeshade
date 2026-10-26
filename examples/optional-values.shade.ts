"use typeshade";

/* @example
{
  "title": "Optional values: T | undefined",
  "blurb": "A function, a local and a callback hold `T | undefined`, and the compiler carries whether the value is there (§76). `root` returns `undefined` below zero and `sampleOr` tests it, `nearest` finds the closest of two optional distances with `??`, `offsetOf` reads a field of an optional struct through `?.`, and `fs` narrows a local by an assignment and an early return. Each `T | undefined` lowers to a struct of the value and a `bool`, `__opt_f32`, on WGSL and GLSL ES 3.00 alike; nothing in it depends on NaN.",
  "renderable": true
}
*/

// An optional value (Rule 7.10, change 0088). An author writes "no value here" the way
// TypeScript writes it: a type `T | undefined`, a `return undefined;`, a test
// `v === undefined` and a fallback `v ?? d`. The compiler adds the presence flag itself and
// follows TypeScript's narrowing: after `if (v === undefined) { return … }` the rest of the
// body reads `v` as a `T`, and so does the right operand of `v !== undefined && …`.
//
// The fragment stage uses each form: a function result (`root`), a callback result that a
// library returns through a function-typed parameter (`sampleOr`, which also takes a plain
// `(x: f32) => f32` and wraps each result as present), `??` on two optionals (`nearest`),
// `?.` on an optional struct (`offsetOf`), a local declared absent and assigned on one path,
// and an inferred result (`halfOf` writes no result type and returns `undefined` beside a value).

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

class Hit {
  t: f32;
  normal: vec2;
}

type Curve = (x: f32) => f32 | undefined;

/** The square root, or nothing below zero. */
function root(x: f32): f32 | undefined {
  if (x < 0.) {
    return undefined;
  }
  return sqrt(x);
}

/** A plain curve: the compiler wraps each of its results where `sampleOr` calls it. */
function ramp(x: f32): f32 {
  return x * 0.5;
}

/** Half of a positive value; the result type is inferred as `f32 | undefined` (Rule 8.19). */
function halfOf(x: f32) {
  if (x <= 0.) {
    return undefined;
  }
  return x * 0.5;
}

/** The curve's value, or `fallback` where it has none. */
function sampleOr(f: Curve, x: f32, fallback: f32): f32 {
  const v = f(x);
  if (v === undefined) {
    return fallback;
  }
  return v;
}

/** The nearer of two optional distances: `??` takes the one that is there. */
function nearest(a: f32 | undefined, b: f32 | undefined): f32 {
  if (a !== undefined && b !== undefined) {
    return min(a, b);
  }
  return a ?? b ?? 1e3;
}

/** A hit along the ray `o + d * t` with the circle of radius `r`, or nothing. */
function intersect(o: vec2, d: vec2, r: f32): Hit | undefined {
  const b = dot(o, d);
  const c = dot(o, o) - r * r;
  const disc = b * b - c;
  if (disc < 0.) {
    return undefined;
  }
  const t = -b - sqrt(disc);
  if (t < 0.) {
    return undefined;
  }
  const h = new Hit();
  h.t = t;
  h.normal = normalize(o + d * t);
  return h;
}

/** The hit's distance through `?.`, or `far` where the ray misses. */
function offsetOf(h: Hit | undefined, far: f32): f32 {
  return h?.t ?? far;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const xs: array<f32, 3> = [-1., 3., -1.];
  const ys: array<f32, 3> = [-1., -1., 3.];
  const i = i32(vi);
  const p: vec2 = vec2(xs[i], ys[i]);
  return { pos: vec4(p, 0., 1.), uv: p * 0.5 + vec2(0.5, 0.5) };
}

@fragment
export function fs(v: VsOut): Color {
  const x = v.uv.x * 2. - 1.;
  // A local declared with no initializer starts absent; one path gives it a value.
  let shade: f32 | undefined;
  if (v.uv.y > 0.5) {
    shade = v.uv.y;
  }
  const r = sampleOr(root, x, 0.) + sampleOr(ramp, v.uv.x, 0.);
  const g = nearest(root(x), halfOf(v.uv.y)) * (shade ?? 0.25);
  const o = v.uv * 2. - vec2(1., 1.);
  const hit = intersect(o - vec2(0., 2.), vec2(0., 1.), 0.5);
  const b = offsetOf(hit, 0.);
  const n = hit?.normal ?? vec2(0., 0.);
  return { color: vec4(r, g, b * 0.5 + n.x * 0.25, 1.) };
}
