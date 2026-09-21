// ═══ Programs this front end accepts and Tint refuses ═══
//
// Every `it` here compiles with ZERO diagnostics today and produces WGSL that Chromium's
// shader compiler rejects. They are written as `it.fails` — vitest's inverted `it`, which is
// red when the body PASSES — so the row cannot be forgotten: the lane that adds the diagnostic
// has to flip `it.fails` to `it` in the same change, or the suite goes red on a fix.
//
// WHY A SUITE OF ITS OWN. These are not argument-check cases belonging to one builtin's file;
// they are the residue of the WGSL spec audit of 2026-09-21 (#144), which asked what the front
// end lets through, and the answer is a class: a program that compiles here, emits, passes the
// GLSL leg, and then fails at `createShaderModule` on the author's machine. Keeping them in one
// place makes the size of that class visible, and shrinking it visible too.
//
// HOW THE TINT COLUMN WAS MEASURED, and why every program reads its value from a UNIFORM.
// Each WGSL below was handed to Tint through the compile gate's own instruments (Chromium's
// WebGPU on SwiftShader, with the deliberately broken shader checked first) on 2026-09-21;
// the refusal Tint gave is quoted on each row. The uniform is load-bearing, not decoration:
// with a `const l: i32 = 2` the front end folds the value to the literal `2`, and a WGSL
// integer LITERAL is an abstract-int that converts to `f32` on its own — Tint accepts it. The
// defect is a non-const `i32` where the spec says `f32` (and `u32` for a shift), so the value
// has to be one no constant folder can reach.
import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

/** Compiles clean AND emits WGSL — the precondition every row below shares, and the reason
 *  none of them is caught by anything: there is nothing for a reader to look at. */
const compilesClean = (src: string): string => {
  const result = compile(src)
  expect(result.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([])
  return result.wgsl ?? ''
}

describe('a uniform holding an array of a type narrower than 16 bytes (L15)', () => {
  // Tint: "'uniform' storage requires that array elements are aligned to 16 bytes, but array
  // element of type 'f32' has a stride of 4 bytes. Consider using a vector or struct as the
  // element type instead." (wgsl.txt:16028-16041)
  const src = `"use typeshade"
interface U {
  xs: array<f32, 4>;
  k: f32;
}
declare const u: uniform<U>
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  return vec4(u.xs[0] + u.k, 0., 0., 1.)
}
`

  it('emits the array with its natural stride, which is the shape Tint refuses', () => {
    expect(compilesClean(src)).toContain('xs: array<f32, 4>')
  })

  it.fails('is refused, or padded, by the front end — flipped by #156 (uniform layout)', () => {
    expect(errorsOf(src)).not.toEqual([])
  })
})

describe('a shift whose right-hand side is not u32 (L38)', () => {
  // Tint: "no matching overload for 'operator << (i32, i32)' … 'operator << (T, u32) -> T'"
  // (wgsl.txt:10163-10173). The compound path already wraps the right-hand side in `u32(...)`
  // (`lower/statement.ts`); the binary path does not.
  const src = `"use typeshade"
interface U {
  x: i32;
  n: i32;
}
declare const u: uniform<U>
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  return vec4(f32(u.x << u.n), 0., 0., 1.)
}
`

  it('emits the shift with an i32 right-hand side, which is the shape Tint refuses', () => {
    expect(compilesClean(src)).toContain('u.x << u.n')
  })

  it.fails('wraps the right-hand side as u32, or refuses — flipped by #160 (operators)', () => {
    const wgsl = compile(src).wgsl ?? ''
    expect(errorsOf(src).length > 0 || wgsl.includes('u32(u.n)')).toBe(true)
  })
})

describe('an integer varying emitted without @interpolate(flat) (L53)', () => {
  // Tint: "integral user-defined vertex outputs must have a '@interpolate(flat)' attribute"
  // (wgsl.txt:14932-14933). The GLSL writer already adds `flat` (`backends/glsl.ts`), so the
  // two targets disagree: the WebGL2 leg links and the WebGPU one does not.
  const src = `"use typeshade"
class VsOut {
  @builtin("position") pos: vec4;
  @location(0) id: u32;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  return { pos: vec4(0., 0., 0., 1.), id: i }
}
@fragment
export function fs(o: VsOut): vec4 {
  return vec4(f32(o.id), 0., 0., 1.)
}
`

  it('emits the integer location with no interpolation attribute, which Tint refuses', () => {
    expect(compilesClean(src)).toContain('@location(0) id: u32,')
  })

  it.fails('emits @interpolate(flat) on an integer varying — flipped by #158 (entry IO)', () => {
    expect(compile(src).wgsl ?? '').toContain('@interpolate(flat)')
  })
})

describe('a helper that assigns to its whole parameter (L25)', () => {
  // Tint: "cannot assign to parameter 'a'" (wgsl.txt:7469, 10896-10899). The surface document
  // admits the bug in its own text; a `var` shadowing the parameter on first write is the fix
  // the audit proposes.
  const src = `"use typeshade"
export function h(a: f32): f32 {
  a = 1.
  return a
}
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  return vec4(h(v.uv.x), 0., 0., 1.)
}
`

  it('emits the assignment to the parameter itself, which Tint refuses', () => {
    expect(compilesClean(src)).toContain('a = 1.0;')
  })

  it.fails('shadows the parameter, or refuses — flipped by #160 (statements)', () => {
    const wgsl = compile(src).wgsl ?? ''
    expect(errorsOf(src).length > 0 || !/fn h\(a: f32\) -> f32 \{\s*a = 1\.0;/.test(wgsl)).toBe(
      true,
    )
  })
})
