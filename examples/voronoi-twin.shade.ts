"use typeshade"

/* @example
{
  "title": "Voronoi (source twin)",
  "blurb": "`voronoi.ts` written in the source language, and the gate for issue #40. The 3×3 neighbour scan is spelled the natural way — `for (let j: i32 = -1; j <= 1; j++)` — and that declaration was the one shape the source lowerer could not write: a negative literal is a `PrefixUnaryExpression`, so the two declaration sites that special-cased a `lit` node never saw it. The `for` init emitted `var j: i32 = -1.0;` with zero diagnostics, which Tint refuses with `cannot convert value of type 'abstract-float' to type 'i32'`, while `let k: i32 = -1` outside a loop was refused outright. Everything in the repo except the gate missed it, because no `.shade.ts` example had a signed loop counter. This one does.",
  "renderable": true,
  "twinOf": "voronoi"
}
*/
// The `"use typeshade"` twin of `voronoi.ts`, and the gate for issue #40.
//
// The 3×3 neighbour scan is the reason this file exists. It is spelled the natural way —
// `for (let j: i32 = -1; j <= 1; j++)` — and that declaration was the one shape the source
// lowerer could not write. A negative literal is a `PrefixUnaryExpression`, not a
// `NumericLiteral`, so the two declaration sites that special-cased `init.op === 'lit'` never
// saw it: the `for` init emitted `var j: i32 = -1.0;` with ZERO diagnostics, which Tint
// refuses with `cannot convert value of type 'abstract-float' to type 'i32'` and WebGL2 with
// `'=' : cannot convert from 'const float' to 'highp int'`, while `let k: i32 = -1` outside a
// loop was refused outright and the author was told to cast an integer they had already
// written.
//
// Everything in the repo except the gate missed it: the front end reported nothing, the build
// was clean, the suite passed, `reflect()` deep-equalled the EDSL original, and both goldens
// baked. No `.shade.ts` example had a signed loop counter, so no gate ever compiled one. This
// one does, on Tint and on ANGLE, which is what makes the fix a fact rather than a claim.

interface Uniforms {
  time: f32
  resolution: vec2
  cells: f32
}

declare const U: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.
  const y = f32(vi >> 1) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) }
}

// Hash a cell coordinate into a stable point in [0,1]²: the per-cell feature seed.
function hash2(c: vec2): vec2 {
  const h: vec2 = vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))
  return fract(vec2(sin(h.x), sin(h.y)) * 43758.5453)
}

@fragment
export function fs(v: VsOut): vec4 {
  const p: vec2 = v.uv * U.cells
  const cell: vec2 = floor(p)
  const f: vec2 = fract(p)
  let md = 8.
  // The 3×3 scan, both counters signed and both starting below zero: the nearest feature
  // point may live in any adjacent cell.
  for (let j: i32 = -1; j <= 1; j++) {
    for (let i: i32 = -1; i <= 1; i++) {
      const g: vec2 = vec2(f32(i), f32(j))
      const seed: vec2 = hash2(cell + g)
      const orbit: vec2 = vec2(sin(U.time + seed.x * 6.283), cos(U.time + seed.y * 6.283)) * 0.18
      const pt: vec2 = g + (seed * 0.5 + 0.25) + orbit
      md = min(md, distance(f, pt))
    }
  }
  // Dark cores, cool cell walls.
  const c: vec3 = vec3(md * md, md * md, md * md) * vec3(0.35, 0.6, 1.) + vec3(0.02, 0.03, 0.06)
  return vec4(c, 1.)
}
