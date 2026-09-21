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
// HOW THE TINT COLUMN WAS MEASURED. Each WGSL below was handed to Tint through the compile
// gate's own instruments (Chromium's WebGPU on SwiftShader, with the deliberately broken
// shader checked first) on 2026-09-21; the refusal Tint gave is quoted on each row.
//
// TWO OF THE FOUR READ THEIR OPERAND FROM A UNIFORM, and that is load-bearing rather than
// decoration. Written as `const n: i32 = 2` the front end folds the value to the literal `2`,
// and a WGSL integer LITERAL is an abstract-int that converts to `f32` (or `u32`) on its own —
// measured on Tint, which ACCEPTS that program. So a defect that is about a non-const `i32` in
// a slot the spec types otherwise needs a value no constant folder can reach: the shift below,
// and the texture rows in `texture-dims.test.ts`. The other two are structural — an integer
// varying's missing attribute and a write to a parameter — and need no such care.
// SPEC CITATIONS. `wgsl.txt:N` and `glsl-es-300.txt:N` are the audit's own coordinates — the
// line in the W3C WGSL and Khronos GLSL ES 3.00 spec TEXTS as #144 read them, not files in
// this repository. They are kept verbatim so a row here can be matched against the issue
// that filed it; `core.def:N` is Tint's intrinsic table, of which
// `src/core/spec-conformance/fixtures/` holds the checked-in texture and stage slices.
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

describe('a struct field named with a WGSL reserved keyword', () => {
  // Tint, measured 2026-09-21: "'ref' is a reserved keyword" (wgsl.txt §2.3, the reserved-word
  // list). Found by the adversarial review of this very suite: an earlier draft of the texture
  // rows in `texture-dims.test.ts` named a uniform field `ref`, which made those programs
  // Tint-invalid for a reason that had nothing to do with the row they were pinning.
  //
  // THE ASYMMETRY IS THE INTERESTING HALF. `src/core/reserved-words.ts` exists and the GLSL
  // path uses it — a field named `filter` is refused by the JS-array check, and the GLSL
  // sanitiser renames a colliding identifier — but `emit-alias.ts` applies the rename to
  // GENERATED identifiers only, so an AUTHORED name reaches the WGSL verbatim. Nine keywords
  // were measured to compile clean here and be refused by Tint: `ref`, `typedef`, `union`,
  // `shared`, `do`, `asm`, `enum`, `inline`, `static`; `var` is refused by Tint's parser
  // instead ("expected '}' for struct declaration").
  //
  // NO ISSUE YET — this one was found by writing the suite rather than by the audit. It belongs
  // with the other author-surface refusals; the lane that files it should flip this row.
  const RESERVED = ['ref', 'typedef', 'union', 'shared', 'do', 'asm', 'enum', 'inline', 'static']

  const withField = (name: string): string => `"use typeshade"
interface U {
  ${name}: f32;
}
declare const u: uniform<U>
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  return vec4(u.${name}, 0., 0., 1.)
}
`

  it('reaches the emitted WGSL verbatim today, which is the shape Tint refuses', () => {
    for (const name of RESERVED) {
      expect(compilesClean(withField(name)), name).toContain(`${name}: f32,`)
    }
  })

  it.fails(
    'refuses a field name WGSL reserves, as the GLSL path already does — no issue yet',
    () => {
      const accepted = RESERVED.filter((name) => errorsOf(withField(name)).length === 0)
      expect(accepted).toEqual([])
    },
  )
})
