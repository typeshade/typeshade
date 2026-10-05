"use typeshade";

/* @example
{
  "title": "Reference parameters",
  "blurb": "Functions that change their caller's variables: a parameter declared `Ref<T>` names the caller's place, and the call passes it as `ref(x)` (§70). `swap` and `order` exchange two locals, `advance` moves a struct in place, `shrink` scales a matrix's column, and `liftAll` bends an array's elements one at a time through a local function that captures the array's reference. WGSL spells each reference as a pointer, `swap(&a, &b)` with `*a = *b` in the body, and GLSL ES 3.00 as an `inout` parameter, the model a method that changes its object already has (§26).",
  "renderable": true
}
*/

// A reference parameter (Rule 8.25, change 0040). The parameter is declared `Ref<T>`, the call
// writes `ref(x)`, and inside the body the parameter reads and writes the caller's variable as
// if it were a local: no `*`, no `&`, and member access through it is the ordinary `r.origin`,
// as `this.origin` is in a method.
//
// The fragment stage uses every shape the rule takes: two locals (`order`, which hands its own
// references on to `swap` as they are), a struct (`advance`), an element of an array picked by
// a loop index (`lift`), which WGSL takes as `&(*ws)[i]` and GLSL ES 3.00 as the l-value `ws[i]`
// of an `inout` parameter, and a matrix's column (`shrink`). `liftAll` hands the elements over
// from a local function that captures its reference, as a local function captures any variable
// (Rule 8.17). Every call names distinct variables: one call never takes two references to one
// variable that it writes (TS8074).

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

class Ray {
  origin: vec2;
  dir: vec2;
}

/** Exchange the values of two of the caller's variables. */
function swap(a: Ref<f32>, b: Ref<f32>): void {
  const t = a;
  a = b;
  b = t;
}

/** Put two values in order, in place: the smaller ends up in `lo`. */
function order(lo: Ref<f32>, hi: Ref<f32>): void {
  if (lo > hi) {
    swap(lo, hi);
  }
}

/** Move a ray along its direction, in the caller's struct. */
function advance(r: Ref<Ray>, t: f32): void {
  r.origin = r.origin + r.dir * t;
}

/** Bend one weight toward 1, in place. */
function lift(w: Ref<f32>, k: f32): void {
  w = mix(w, 1., k);
}

/** Bend every weight toward 1, in place: the local function writes through the reference it
 *  captures. */
function liftAll(ws: Ref<array<f32, 3>>, k: f32): void {
  const liftAt = (i: i32): void => {
    lift(ref(ws[i]), k);
  };
  for (let i = 0; i < 3; i++) {
    liftAt(i);
  }
}

/** Scale one column of a matrix, in place. */
function shrink(column: Ref<vec2>, k: f32): void {
  column = column * k;
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
  let a = v.uv.x;
  let b = v.uv.y;
  order(ref(a), ref(b));
  let r = new Ray();
  r.origin = v.uv;
  r.dir = vec2(0.5, -0.25);
  advance(ref(r), b - a);
  let w = array<f32, 3>(a, b, 0.5);
  liftAll(ref(w), 0.25);
  let basis = mat2(1., 0., 0., 1.);
  shrink(ref(basis[1]), 0.5);
  const q = basis * (v.uv - vec2(0.5, 0.5));
  return { color: vec4(fract(r.origin.x * 3.), w[0] * w[1], w[2] * (1. - length(q)), 1.) };
}
