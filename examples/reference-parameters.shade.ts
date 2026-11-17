"use typeshade";

/* @example
{
  "title": "Objects are passed as JavaScript passes them",
  "blurb": "A function that writes a field or an element of its parameter changes the caller's object, with no mark on the parameter or at the call (§70): `advance` moves a struct in place, and `liftAll` bends an array's elements through a local function that captures the array. A number and a vector are values, as they are in JavaScript, so a function gives them back: `lift` and `project` return one value, and `order` returns two in a list that the caller takes apart with `[a, b] = order(a, b)`. WGSL spells the object parameter as a pointer, `advance(&r, t)`, and GLSL ES 3.00 as an `inout` parameter; the author writes neither.",
  "renderable": true
}
*/

// An object is the caller's object (Rule 8.25, change 0142). A struct, an instance of a class and
// an array have the identity a JavaScript object has: when a function writes `r.origin` or
// `ws[i]` through its parameter, the caller sees the write. The compiler reads which parameters a
// function writes and passes each as the caller's place. The author writes no qualifier, no `*`
// and no `&`, and member access through the parameter is the ordinary `r.origin`.
//
// A number, a `bool`, a vector and a matrix are values. An assignment to such a parameter changes
// the function's own copy, as in JavaScript, so a function that computes one returns it. A
// function that computes two returns a list, and the caller assigns its names from the list:
// `[a, b] = order(a, b)`.
//
// The fragment stage uses each shape: two numbers put in order (`order`, which hands its values
// on to `swap`), a struct moved in place (`advance`), an array bent element by element from a
// local function that captures it, as a local function captures any variable (Rule 8.17)
// (`liftAll`), a matrix's column written from a result (`shrink`), and a vector returned
// (`project`).

interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}

interface Color {
  color: vec4;
}

class Ray {
  origin: vec2;
  dir: vec2;
}

/** Two values, exchanged. */
function swap(a: f32, b: f32): [f32, f32] {
  return [b, a];
}

/** Two values in order: the smaller comes first. */
function order(lo: f32, hi: f32): [f32, f32] {
  return lo > hi ? swap(lo, hi) : [lo, hi];
}

/** Move a ray along its direction, in the caller's struct. */
function advance(r: Ray, t: f32): void {
  r.origin = r.origin + r.dir * t;
}

/** One weight, bent toward 1. */
function lift(w: f32, k: f32): f32 {
  return mix(w, 1, k);
}

/** Bend every weight toward 1, in the caller's array: the local function writes the array it
 *  captures. */
function liftAll(ws: array<f32, 3>, k: f32): void {
  const liftAt = (i: i32): void => {
    ws[i] = lift(ws[i], k);
  };
  for (let i = 0; i < 3; i++) {
    liftAt(i);
  }
}

/** A point mapped through a matrix. */
function project(m: mat2x2<f32>, p: vec2): vec2 {
  return m * p;
}

/** One column of a matrix, scaled. */
function shrink(column: vec2, k: f32): vec2 {
  return column * k;
}

@vertex
export function vs(vi: builtin<"vertex_index">): VsOut {
  const xs: array<f32, 3> = [-1, 3, -1];
  const ys: array<f32, 3> = [-1, -1, 3];
  const i = i32(vi);
  const p: vec2 = vec2(xs[i], ys[i]);
  return { pos: vec4(p, 0, 1), uv: p * 0.5 + vec2(0.5, 0.5) };
}

@fragment
export function fs(v: VsOut): Color {
  let a = v.uv.x;
  let b = v.uv.y;
  [a, b] = order(a, b);
  let r = new Ray();
  r.origin = v.uv;
  r.dir = vec2(0.5, -0.25);
  advance(r, b - a);
  let w = array<f32, 3>(a, b, 0.5);
  liftAll(w, 0.25);
  let basis = mat2(1, 0, 0, 1);
  basis[1] = shrink(basis[1], 0.5);
  const q = project(basis, v.uv - vec2(0.5, 0.5));
  return { color: vec4(fract(r.origin.x * 3), w[0] * w[1], w[2] * (1 - length(q)), 1) };
}
