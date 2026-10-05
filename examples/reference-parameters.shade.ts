"use typeshade";

/* @example
{
  "title": "Reference parameters",
  "blurb": "Functions that change their caller's variables: a parameter declared `Ref<T>` names the caller's place, and the call passes it as `ref(x)` (§70). `swap` and `order` exchange two locals, `advance` moves a struct in place and `lift` bends array elements one at a time. WGSL spells each reference as a pointer, `swap(&a, &b)` with `*a = *b` in the body, and GLSL ES 3.00 as an `inout` parameter, the model a method that changes its object already has (§26).",
  "renderable": true
}
*/

// A reference parameter (Rule 8.25, change 0040). The parameter is declared `Ref<T>`, the call
// writes `ref(x)`, and inside the body the parameter reads and writes the caller's variable as
// if it were a local: no `*`, no `&`, and member access through it is the ordinary `r.origin`,
// as `this.origin` is in a method.
//
// The fragment stage uses every shape the rule takes: two locals (`order`, which hands its own
// references on to `swap` as they are), a struct (`advance`), and an element of a local array
// picked by a loop index (`lift`), which WGSL takes as `&w[i]` and GLSL ES 3.00 as the l-value
// `w[i]` of an `inout` parameter. Every call names distinct variables: one call never takes two
// references to one variable that it writes (TS8074).

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
  for (let i = 0; i < 3; i++) {
    lift(ref(w[i]), 0.25);
  }
  return { color: vec4(fract(r.origin.x * 3.), w[0] * w[1], w[2], 1.) };
}
