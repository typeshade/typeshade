// A name a target reserves, refused where it is written (#103). Before this, the author got a
// line number in text they never wrote:
//
//   glsl: fragment: ERROR: 0:16: 'half' : Illegal use of reserved word
//
// Every expectation below was measured on the compilers that receive the emit, through the
// compile gate's own instrument (Chromium: Tint for WGSL, a real WebGL2 context for GLSL):
//
//   WGSL on Tint      var discard: f32   REFUSED  expected identifier for variable declaration
//                     var as: f32        REFUSED  'as' is a reserved keyword
//                     var filter: f32    REFUSED  'filter' is a reserved keyword
//                     var __x: f32       REFUSED  identifiers must not start with two or more underscores
//                     struct S { half }  accepted — WGSL does not reserve `half`
//                     const half: f32    accepted
//   GLSL ES 3.00      struct { vec2 half }   REFUSED  'half' : Illegal use of reserved word
//   on ANGLE          float filter           REFUSED  'filter' : Illegal use of reserved word
//                     float image2D          REFUSED  'image2D' : Illegal use of reserved word
//                     float sample           REFUSED  'sample' : Illegal use of reserved word
//                     float input            REFUSED  'input' : Illegal use of reserved word
//                     float buffer           accepted — an ES 3.10 keyword, free at 300
//                     float shared           accepted — the same
//                     float packed           accepted — reserved in ES 1.00, free at 300
//
// The last three are why `GLSL_ES300_RESERVED` is read off ANGLE's version-gated lexer rather
// than off a later spec: refusing them would refuse programs that compile.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

/** The source text the one diagnostic underlines. */
const underlines = (src: string): string => {
  const d = compileTsSource(src).diagnostics.filter((e) => e.category === 'error')[0]
  if (!d) throw new Error('expected a diagnostic')
  return src.slice(d.start, d.start + d.length)
}

const GLSL = (quoted: string, noun: string) =>
  `${TS_CODES.RESERVED_NAME} ${quoted} is reserved in GLSL ES 3.00, so ${noun} of that name cannot be emitted for the WebGL2 target. Rename it.`
const WGSL = (quoted: string, noun: string) =>
  `${TS_CODES.RESERVED_NAME} ${quoted} is reserved in WGSL, so ${noun} of that name cannot be emitted for the WebGPU target. Rename it.`

const render = (decls: string, body = 'return vec4(1., 0., 0., 1.)') => `"use typeshade"
${decls}
@fragment
export function fs(): vec4 { ${body} }
`

describe('GLSL ES 3.00 reserves the name, and the module has a GLSL form (#103)', () => {
  it('refuses a struct field named half, on the field', () => {
    const src = `"use typeshade"
class V {
  @builtin("position") pos: vec4
  @location(0) half: vec2
}
@vertex
export function vs(): V { return { pos: vec4(0., 0., 0., 1.), half: vec2(0., 0.) } }
@fragment
export function fs(v: V): vec4 { return vec4(v.half, 0., 1.) }
`
    expect(errorsOf(src)).toEqual([GLSL('"half"', 'a field')])
    expect(underlines(src)).toBe('half')
  })

  it.each([
    ['const half: f32 = 0.5', '"half"', 'a module constant'],
    ['declare const half: uniform<f32>', '"half"', 'a binding'],
    ['declare const half: override<f32>', '"half"', 'an override'],
    ['let input: perInvocation<f32> = 0.', '"input"', 'a module variable'],
  ])('refuses %s', (decl, quoted, noun) => {
    expect(errorsOf(render(decl))).toEqual([GLSL(quoted, noun)])
  })

  it('refuses a struct whose own name is reserved', () => {
    const src = `"use typeshade"
class filter {
  @builtin("position") pos: vec4
}
@vertex
export function vs(): filter { return { pos: vec4(0., 0., 0., 1.) } }
`
    // `filter` is on BOTH lists, and WGSL is every module's target, so WGSL is what answers.
    expect(errorsOf(src)).toContain(WGSL('"filter"', 'a struct'))
  })
})

describe('WGSL reserves the name (#103)', () => {
  it.each([
    ['let as: f32 = 1.; return vec4(as, 0., 0., 1.)', '"as"', 'a local'],
    ['let discard: f32 = 1.; return vec4(discard, 0., 0., 1.)', '"discard"', 'a local'],
  ])('refuses %s', (body, quoted, noun) => {
    expect(errorsOf(render('', body))).toEqual([WGSL(quoted, noun)])
  })

  it('refuses a parameter', () => {
    expect(
      errorsOf(`"use typeshade"
export function g(as: f32): f32 { return as }
@fragment
export function fs(): vec4 { return vec4(g(1.), 0., 0., 1.) }
`),
    ).toEqual([WGSL('"as"', 'a parameter')])
  })

  it('refuses the two shapes the spec rules out beside the word lists', () => {
    expect(errorsOf(render('', 'let __t: f32 = 1.; return vec4(__t, 0., 0., 1.)'))).toEqual([
      `${TS_CODES.RESERVED_NAME} "__t" begins with two underscores, which WGSL reserves, so a local of that name cannot be emitted for the WebGPU target. Rename it.`,
    ])
    expect(errorsOf(render('', 'let _: f32 = 1.; return vec4(_, 0., 0., 1.)'))).toEqual([
      `${TS_CODES.RESERVED_NAME} "_" is WGSL's phony assignment target, not an identifier, so a local of that name cannot be emitted for the WebGPU target. Rename it.`,
    ])
  })
})

describe('the name that reaches the backend is the FLATTENED one (#103)', () => {
  it('names both spellings for a static field, whose emitted name is Cls_member', () => {
    const src = `"use typeshade"
class atomic { static uint: u32 = 1 }
@fragment
export function fs(): vec4 { return vec4(f32(atomic.uint), 0., 0., 1.) }
`
    expect(errorsOf(src)).toEqual([
      `${TS_CODES.RESERVED_NAME} "uint" is emitted as "atomic_uint", which is reserved in GLSL ES 3.00, so this module constant cannot be emitted for the WebGL2 target. Rename it.`,
    ])
    // On the member the author wrote, not on the spelling only the emit has.
    expect(underlines(src)).toBe('uint')
  })

  it('does the same for a namespace member, and for a WGSL word', () => {
    expect(
      errorsOf(`"use typeshade"
namespace thread { export const local: f32 = 1. }
@fragment
export function fs(): vec4 { return vec4(thread.local, 0., 0., 1.) }
`),
    ).toEqual([
      `${TS_CODES.RESERVED_NAME} "local" is emitted as "thread_local", which is reserved in WGSL, so this module constant cannot be emitted for the WebGPU target. Rename it.`,
    ])
  })

  it('leaves a flattened name that is NOT reserved alone', () => {
    // A class `S` with a static `half` is `S_half`, which neither target reserves. The written
    // name alone would have refused it — which is the reason the check reads the emitted one.
    const r = compile(`"use typeshade"
class S { static half: f32 = 0.5 }
@fragment
export function fs(): vec4 { return vec4(S.half, 0., 0., 1.) }
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.wgsl).toContain('S_half')
  })
})

describe('a module the target never reaches is not held to its list (#103)', () => {
  it('keeps a field named half in a compute-only module, which emits no GLSL', () => {
    const r = compile(`"use typeshade"
declare let sink: storage<array<f32>>
class P { half: f32 }
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  const p: P = { half: 2. }
  sink[gid.x] = p.half
}
`)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    // Measured: Tint accepts `half` as a struct member; GLSL ES 3.00 is not a target here.
    expect(r.wgsl).toContain('half')
    expect(r.glsl).toBeUndefined()
  })

  it('keeps the names the GLSL writer renames for itself', () => {
    // `out` and `in` are GLSL keywords, and `sanitizeReservedIdents` rewrites a local, a
    // parameter and a function name consistently with every reference — so these have always
    // compiled and still do. Only the module surface it cannot rename is refused above.
    const r = compile(render('', 'let out: f32 = 1.; return vec4(out, 0., 0., 1.)'))
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.glsl?.fragment).toContain('out_')
    expect(r.wgsl).toContain('out')
  })
})
