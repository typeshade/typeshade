"use typeshade";

/* @example
{
  "title": "Optional fields, elements and parameters",
  "blurb": "A struct field, an array element and a parameter hold `T | undefined` (§76, change 0093). `Hit` carries `normal: vec2 | undefined` and `radius?: f32`, built in a function and read through `??`, `?.` and a member path narrowed by `if (h.normal !== undefined)`; `samples` is an `array<f32 | undefined, 4>` filled on some indices and folded in a loop; `clampTo` takes `limit?: f32` and is called with and without it. The optional struct `_opt_f32_` is declared before `Hit`, which holds it, on WGSL and GLSL ES 3.00 alike.",
  "renderable": true
}
*/

// Optional positions (Rule 7.10, change 0093). Change 0088 let a local, a parameter and a
// function's result hold `T | undefined`; this change lets a struct field and an array element
// hold one in function scope, and lets a parameter be written `x?: T`. A binding, a module
// variable or an entry's IO that holds one is refused where it is declared, naming the field.
//
// The fragment stage uses each form: a struct built in a function with one field present on a
// path and one absent (`intersect`), a member path narrowed by a test (`shadeOf`), an array of
// optionals filled on some indices and folded through `??` (`sampleAll`), an optional field
// written `radius?: f32` that an object literal omits (`circle`), and a helper with `limit?: f32`
// called with and without the argument (`clampTo`).

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

class Color {
  @location(0) color: vec4;
}

/** A hit along a ray: the distance, the normal where the surface has one, and the circle's
 *  radius where the object is a circle. */
class Hit {
  t: f32;
  normal: vec2 | undefined;
  radius?: f32;
}

/** The hit of the ray `o + d * t` with the circle of radius `r`: the normal is present on a
 *  hit from outside, absent when the ray starts inside the circle. */
function intersect(o: vec2, d: vec2, r: f32): Hit {
  const h = new Hit();
  const b = dot(o, d);
  const c = dot(o, o) - r * r;
  const disc = b * b - c;
  h.t = 1e3;
  h.radius = r;
  if (disc < 0.) {
    return h;
  }
  const t = -b - sqrt(disc);
  if (t < 0.) {
    h.t = 0.;
    return h;
  }
  h.t = t;
  h.normal = normalize(o + d * t);
  return h;
}

/** A hit with no normal and no radius: the literal omits `radius?`, and the omitted field is
 *  absent. */
function circle(t: f32): Hit {
  return { t, normal: undefined };
}

/** The shade of a hit: the normal's facing where the hit has one, through a narrowed member
 *  path, and `?.` and `??` where the author prefers one expression. */
function shadeOf(h: Hit, light: vec2): f32 {
  if (h.normal !== undefined) {
    return max(dot(h.normal, light), 0.) + (h.radius ?? 0.) * 0.1;
  }
  return h.t * 0.5 + (h?.radius ?? 0.);
}

/** `x`, or `x` held to `limit` where one is given: an omitted argument is the absent value. */
function clampTo(x: f32, limit?: f32): f32 {
  if (limit === undefined) {
    return x;
  }
  return min(x, limit);
}

/** The sum of the samples that are there, over an array of optionals. */
function sampleAll(samples: array<f32 | undefined, 4>): f32 {
  let s = 0.;
  for (let i = 0; i < 4; i++) {
    s += samples[i] ?? 0.;
  }
  return s;
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
  const o = v.uv * 2. - vec2(1., 1.);
  const hit = intersect(o - vec2(0., 2.), vec2(0., 1.), 0.5);
  const flat = circle(v.uv.x);
  const r = shadeOf(hit, normalize(vec2(0.3, 1.)));
  const g = shadeOf(flat, vec2(0., 1.));
  // Some indices hold a value, and the others hold nothing.
  const samples: array<f32 | undefined, 4> = [v.uv.x, undefined, v.uv.y, undefined];
  const b = clampTo(sampleAll(samples), 0.75) + clampTo(v.uv.x * 0.1);
  return { color: vec4(r, g, b, 1.) };
}
