"use typeshade";

/* @example
{
  "title": "Functions that take a function",
  "blurb": "`cover` and `around4` take a distance field as a function, `f: Field`, and are compiled once for each function a call hands them, as a generic function is once per set of type arguments (Rule 8.18): `cover_circle`, `around4_fs_petal`. A call hands one over by its name, a local function included, or as an arrow function written there, which reads and writes the variables of the body it is written in (Rule 8.17): `petal` reads `r`, and the arrow `times3` is handed adds to `glow` through a pointer. `any(bands, (b) => …)` hands a fold its test the same way. Renders a disc, four petals, three rings and a glow.",
  "renderable": true
}
*/

// A function whose parameter has a function type takes a function (Rule 8.18, surface §14):
//
// - it is compiled once for each function its calls hand it: `cover_circle`;
// - a call hands one over by its name, or as an arrow function written in the call, which is a
//   local function of the calling body and takes its types from the parameter's type;
// - what that function captures, the copy takes and passes on, by reference where it writes;
// - a fold takes an arrow function the same way.

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

/** A distance field: how far `p` is outside a shape, negative inside it. */
type Field = (p: vec2) => f32;

/** How much of the pixel at `p` a field's shape covers. */
function cover(f: Field, p: vec2): f32 {
  return 1. - smoothstep(0., 0.01, f(p));
}

/** A field copied four times around the origin: the nearest of the four quarter turns. */
function around4(f: Field, p: vec2): f32 {
  let best = 1000.;
  for (let i = 0; i < 4; i++) {
    const a = f32(i) * 1.5707964;
    const q = vec2(p.x * cos(a) + p.y * sin(a), p.y * cos(a) - p.x * sin(a));
    best = min(best, f(q));
  }
  return best;
}

/** Runs `body` three times, handing it the trip. */
function times3(body: (i: i32) => void): void {
  for (let i = 0; i < 3; i++) {
    body(i);
  }
}

function circle(p: vec2): f32 {
  return length(p) - 0.2;
}

@fragment
export function fs(v: VsOut): FsOut {
  const p = v.uv;
  const r = 0.1;
  // A local function, handed to `around4` inside an arrow that `cover` is handed.
  const petal = (q: vec2): f32 => length(q - vec2(0.5, 0.)) - r;
  let col = vec3(0.05, 0.06, 0.1);
  col = mix(col, vec3(0.95, 0.7, 0.3), cover(circle, p));
  col = mix(col, vec3(0.3, 0.7, 0.95), cover((q) => around4(petal, q), p));
  // `glow` is written through a pointer by the arrow `times3` is handed.
  let glow = 0.;
  times3((i) => {
    glow += 0.15 / (1. + 40. * abs(length(p) - 0.3 - 0.05 * f32(i)));
  });
  col += vec3(glow * 0.3, glow * 0.2, glow * 0.6);
  // A fold's test, written as an arrow that reads `p`.
  const bands = array<f32, 3>(0.8, 0.88, 0.96);
  if (any(bands, (b) => abs(length(p) - b) < 0.012)) {
    col = vec3(1.);
  }
  return { color: vec4(col, 1.) };
}
