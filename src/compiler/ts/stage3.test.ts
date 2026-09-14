// Stage 3 TypeShade checks (design doc §5, §10 step 5): builtin allow-list, builtin-to-stage
// compatibility, @compute workgroup shape, missing return annotation on an entry function, and
// (optional) mat2/mat3 rejection. Each gets a positive (stays clean) and a negative (fires with
// the right code) case.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'

function diag(source: string) {
  return compileTsSource(source)
}

describe('builtin name allow-list (BUILTIN_NAME)', () => {
  it('rejects a typo\'d builtin with a "Did you mean" suggestion', () => {
    const r = diag(`
      "use typeshade";
      export function vs(@builtin("vertex_idx") i: u32): vec4 {
        return vec4(0., 0., 0., 1.)
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.BUILTIN_NAME)
    expect(d, 'expected a BUILTIN_NAME diagnostic').toBeDefined()
    expect(d!.category).toBe('error')
    expect(d!.message).toContain('Unknown builtin "vertex_idx"')
    expect(d!.message).toContain('Did you mean "vertex_index"?')
  })

  it('accepts every real WgslBuiltinName with zero BUILTIN_NAME diagnostics', () => {
    const r = diag(`
      "use typeshade";
      export function vs(@builtin("vertex_index") i: u32): vec4 {
        return vec4(0., 0., 0., 1.)
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_NAME)).toEqual([])
  })

  it('gives the BUILTIN_NAME diagnostic a span over the string literal argument', () => {
    const r = diag(`
      "use typeshade";
      export function vs(@builtin("vertex_idx") i: u32): vec4 {
        return vec4(0., 0., 0., 1.)
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.BUILTIN_NAME)!
    expect(r.sourceFile.text.slice(d.start, d.start + d.length)).toBe('"vertex_idx"')
  })
})

describe('builtin stage/direction compatibility (BUILTIN_STAGE)', () => {
  it('rejects a fragment-only input builtin on a vertex parameter', () => {
    const r = diag(`
      "use typeshade";
      @vertex
      export function vs(@builtin("front_facing") f: bool): vec4 {
        return vec4(0., 0., 0., 1.)
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.BUILTIN_STAGE)
    expect(d, 'expected a BUILTIN_STAGE diagnostic').toBeDefined()
    expect(d!.category).toBe('error')
    expect(d!.message).toContain('front_facing')
    expect(d!.message).toContain('vertex input')
  })

  it('accepts vertex_index as a vertex input', () => {
    const r = diag(`
      "use typeshade";
      @vertex
      export function vs(@builtin("vertex_index") i: u32): vec4 {
        return vec4(0., 0., 0., 1.)
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_STAGE)).toEqual([])
  })

  it('accepts position as a vertex output and the same struct field as a fragment input', () => {
    const r = diag(`
      "use typeshade";
      class Clip {
        @builtin("position") pos: vec4
      }
      @vertex
      export function vs(): Clip {
        return { pos: vec4(0., 0., 0., 1.) }
      }
      @fragment
      export function fs(v: Clip): vec4 {
        return v.pos
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_STAGE)).toEqual([])
  })

  it('rejects frag_depth (a fragment output) used as a vertex return struct field', () => {
    const r = diag(`
      "use typeshade";
      class Out {
        @builtin("frag_depth") d: f32
      }
      @vertex
      export function vs(): Out {
        return { d: 1. }
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.BUILTIN_STAGE)
    expect(d, 'expected a BUILTIN_STAGE diagnostic for the struct field').toBeDefined()
    expect(d!.message).toContain('frag_depth')
    expect(d!.message).toContain('vertex output')
  })

  it('accepts the compute builtins as compute inputs', () => {
    const r = diag(`
      "use typeshade";
      @compute([64])
      export function cs(@builtin("global_invocation_id") id: vec3): void {
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_STAGE)).toEqual([])
  })
})

describe('@compute workgroup shape (WORKGROUP_SHAPE)', () => {
  it('rejects a y axis other than 1', () => {
    const r = diag(`
      "use typeshade";
      @compute([64, 2, 1])
      export function cs(): void {
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.WORKGROUP_SHAPE)
    expect(d, 'expected a WORKGROUP_SHAPE diagnostic').toBeDefined()
    expect(d!.category).toBe('error')
    expect(d!.message).toContain('[64, 2, 1]')
  })

  it('rejects a z axis other than 1', () => {
    const r = diag(`
      "use typeshade";
      @compute([64, 1, 4])
      export function cs(): void {
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.WORKGROUP_SHAPE)).toBe(true)
  })

  it('accepts [64, 1, 1] and the bare single-axis form', () => {
    const r1 = diag(`
      "use typeshade";
      @compute([64, 1, 1])
      export function cs(): void {
      }
    `)
    const r2 = diag(`
      "use typeshade";
      @compute([64])
      export function cs(): void {
      }
    `)
    expect(r1.diagnostics.filter((d) => d.code === TS_CODES.WORKGROUP_SHAPE)).toEqual([])
    expect(r2.diagnostics.filter((d) => d.code === TS_CODES.WORKGROUP_SHAPE)).toEqual([])
  })
})

describe('entry function missing a return type annotation but returning a value (RETURN_SHAPE)', () => {
  it('is an error naming the inferred type', () => {
    const r = diag(`
      "use typeshade";
      @fragment
      export function fs() {
        return vec4(1., 0., 0., 1.)
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.RETURN_SHAPE && d.category === 'error')
    expect(d, 'expected an error-level RETURN_SHAPE diagnostic').toBeDefined()
    expect(d!.message).toContain('vec4<f32>')
    expect(d!.message).toContain('no return type annotation')
  })

  it('stays a warning for an ordinary helper function with no return annotation', () => {
    const r = diag(`
      "use typeshade";
      export function helper() {
        const x = 1.
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.RETURN_SHAPE)
    expect(d, 'expected a RETURN_SHAPE diagnostic').toBeDefined()
    expect(d!.category).toBe('warning')
  })

  it('is silent for an entry function with no return annotation that truly returns nothing', () => {
    const r = diag(`
      "use typeshade";
      @vertex
      export function vs(): void {
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.RETURN_SHAPE)).toEqual([])
  })

  it('still errors (declared type) for an annotated entry function that returns the wrong type', () => {
    const r = diag(`
      "use typeshade";
      @fragment
      export function fs(): vec4 {
        return vec4(1., 0., 0., 1.)
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })
})

describe('mat2/mat3 rejection (MAT_UNSUPPORTED)', () => {
  it('rejects mat2<f32> as a parameter type (the generic form that used to widen to mat4x4)', () => {
    const r = diag(`
      "use typeshade";
      export function f(m: mat2<f32>): vec2 {
        return vec2(0., 0.)
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.MAT_UNSUPPORTED)
    expect(d, 'expected a MAT_UNSUPPORTED diagnostic').toBeDefined()
    expect(d!.category).toBe('error')
    expect(d!.message).toContain('mat2')
  })

  it('rejects mat3<f32> as a return type', () => {
    const r = diag(`
      "use typeshade";
      declare const m: uniform<mat3<f32>>
      export function f(): mat3<f32> {
        return m
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.MAT_UNSUPPORTED)).toBe(true)
  })

  it('leaves mat4/mat4x4, bare and generic, working as before', () => {
    const r = diag(`
      "use typeshade";
      declare const m: uniform<mat4<f32>>
      export function f(): mat4 {
        return m
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.MAT_UNSUPPORTED)).toEqual([])
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })
})
