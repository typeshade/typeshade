// Stage 3 TypeShade checks (design doc §5, §10 step 5): builtin allow-list, builtin-to-stage
// compatibility, @compute workgroup shape, missing return annotation on an entry function, and
// (optional) mat2/mat3 rejection. Each gets a positive (stays clean) and a negative (fires with
// the right code) case.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
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
        return vec4(0., 0., 0., 1.);
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
        return vec4(0., 0., 0., 1.);
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_NAME)).toEqual([])
  })

  it('gives the BUILTIN_NAME diagnostic a span over the string literal argument', () => {
    const r = diag(`
      "use typeshade";
      export function vs(@builtin("vertex_idx") i: u32): vec4 {
        return vec4(0., 0., 0., 1.);
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
        return vec4(0., 0., 0., 1.);
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
        return vec4(0., 0., 0., 1.);
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_STAGE)).toEqual([])
  })

  it('accepts position as a vertex output and the same struct field as a fragment input', () => {
    const r = diag(`
      "use typeshade";
      class Clip {
        @builtin("position") pos: vec4;
      }
      @vertex
      export function vs(): Clip {
        return { pos: vec4(0., 0., 0., 1.) };
      }
      @fragment
      export function fs(v: Clip): vec4 {
        return v.pos;
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.BUILTIN_STAGE)).toEqual([])
  })

  it('rejects frag_depth (a fragment output) used as a vertex return struct field', () => {
    const r = diag(`
      "use typeshade";
      class Out {
        @builtin("frag_depth") d: f32;
      }
      @vertex
      export function vs(): Out {
        return { d: 1. };
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

describe('@compute argument shapes (#118, WORKGROUP_ARG)', () => {
  const cs = (deco: string) => `
      "use typeshade";
      const SIZE = 64;
      ${deco}
      export function cs(): void {
      }
    `
  it('refuses an object, a bare number, a string and an identifier instead of defaulting to 64', () => {
    // Every row compiled with zero diagnostics and emitted `@workgroup_size(64)` (#118): the
    // author asked for one size and dispatched against another.
    for (const written of ['{ workgroup: [8, 8, 1] }', '128', '"big"', 'SIZE']) {
      const r = diag(cs(`@compute(${written})`))
      const d = r.diagnostics.find((d) => d.code === TS_CODES.WORKGROUP_ARG)
      expect(d, `expected WORKGROUP_ARG for @compute(${written})`).toBeDefined()
      expect(d!.category).toBe('error')
      expect(d!.message).toContain(`"${written}" is not a workgroup shape`)
      expect(d!.message).toContain('@compute([64, 1, 1])')
    }
  })

  it('refuses an empty array, a fourth axis, a fraction and a zero', () => {
    for (const written of ['[]', '[64, 1, 1, 1]', '[1.5]', '[0]']) {
      const r = diag(cs(`@compute(${written})`))
      expect(
        r.diagnostics.some((d) => d.code === TS_CODES.WORKGROUP_ARG),
        `expected WORKGROUP_ARG for @compute(${written})`,
      ).toBe(true)
    }
  })

  it('keeps the default of 64 for a bare @compute and for @compute()', () => {
    for (const deco of ['@compute', '@compute()']) {
      const r = compile(cs(deco))
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
      expect(r.wgsl).toContain('@workgroup_size(64)')
    }
  })

  it('reads the size the author wrote, across lines and through as const', () => {
    const r1 = compile(
      cs(`@compute([
        128,
        1,
        1,
      ])`),
    )
    expect(r1.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r1.wgsl).toContain('@workgroup_size(128)')
    const r2 = compile(cs('@compute([256] as const)'))
    expect(r2.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r2.wgsl).toContain('@workgroup_size(256)')
  })
})

describe('entry function missing a return type annotation but returning a value (RETURN_SHAPE)', () => {
  it('is an error naming the inferred type', () => {
    const r = diag(`
      "use typeshade";
      @fragment
      export function fs() {
        return vec4(1., 0., 0., 1.);
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
        const x = 1.;
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
        return vec4(1., 0., 0., 1.);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })
})

// `mat2` and `mat3` used to be refused as MAT_UNSUPPORTED, on the recorded ground that "a 2×2
// or 3×3 float matrix lays out differently under the WGSL and GLSL std140 rules". Measured
// (#149), that is half right: a two-ROW matrix diverges and a 3×3 does not, and the divergence
// belongs to the uniform LAYOUT rather than to the type. Every `matCxR` is spellable now; what
// MAT_UNSUPPORTED still marks is the shape the fp64 pass cannot carry.
describe('every matCxR is a type, and the f64 ones are square-only (MAT_UNSUPPORTED)', () => {
  it('accepts mat2<f32> as a parameter type, the generic form that used to be refused', () => {
    const r = diag(`
      "use typeshade";
      export function f(m: mat2<f32>): vec2 {
        return m * vec2(1., 0.);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('accepts mat3<f32> as a return type', () => {
    const r = diag(`
      "use typeshade";
      declare const m: uniform<mat3<f32>>;
      export function f(): mat3<f32> {
        return m;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('accepts every one of the nine shapes, bare and generic', () => {
    for (const cols of [2, 3, 4] as const) {
      for (const rows of [2, 3, 4] as const) {
        const name = `mat${cols}x${rows}`
        const r = diag(`
          "use typeshade";
          export function f(m: ${name}): vec${rows} {
            return m * vec${cols}(${Array.from({ length: cols }, () => '1.').join(', ')})
          }
        `)
        expect(
          r.diagnostics.filter((d) => d.category === 'error'),
          name,
        ).toEqual([])
      }
    }
  })

  it('still refuses a NON-SQUARE matrix of emulated doubles, which the fp64 pass has no body for', () => {
    const r = diag(`
      "use typeshade";
      export function f(m: mat2x3<f64>): f32 {
        return 0.;
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.MAT_UNSUPPORTED)
    expect(d, 'expected a MAT_UNSUPPORTED diagnostic').toBeDefined()
    expect(d!.message).toContain('square matrix of doubles only')
  })

  it('keeps the SQUARE emulated-double matrices working', () => {
    const r = diag(`
      "use typeshade";
      export function f(m: mat3<f64>): mat3<f64> {
        return transpose(m);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })

  it('leaves mat4/mat4x4, bare and generic, working as before', () => {
    const r = diag(`
      "use typeshade";
      declare const m: uniform<mat4<f32>>;
      export function f(): mat4 {
        return m;
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.MAT_UNSUPPORTED)).toEqual([])
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  })
})

// Regression: a misspelled attribute (`@bogus`, `@vertx`, `@framgent`) used to be silent from
// both the compiler and the language service — TypeScript never resolves a decorator on an
// invalid target, so there is no TS2304, and nothing checked the attribute name itself. The
// practical failure is that the function or field just silently stops being an entry point or
// an I/O field, with no diagnostic naming the typo.
describe('attribute name allow-list (ATTRIBUTE_NAME)', () => {
  it('rejects a misspelled stage decorator on a top-level function, with a suggestion', () => {
    const r = diag(`
      "use typeshade";
      @vertx
      export function vs(): vec4 {
        return vec4(0., 0., 0., 1.);
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.ATTRIBUTE_NAME)
    expect(d, 'expected an ATTRIBUTE_NAME diagnostic').toBeDefined()
    expect(d!.category).toBe('error')
    expect(d!.message).toContain('vertx')
    expect(d!.message).toContain('vertex')
  })

  it('rejects a misspelled parameter decorator', () => {
    const r = diag(`
      "use typeshade";
      @vertex
      export function vs(@locaiton(0) x: f32): vec4 {
        return vec4(x, 0., 0., 1.);
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.ATTRIBUTE_NAME)).toBe(true)
  })

  it('rejects a misspelled field decorator on a data class', () => {
    const r = diag(`
      "use typeshade";
      class Clip {
        @buildin("position") pos: vec4;
      }
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.ATTRIBUTE_NAME)).toBe(true)
  })

  it('does not flag any of the five recognized attributes', () => {
    const r = diag(`
      "use typeshade";
      class Clip {
        @builtin("position") pos: vec4;
        @location(0) uv: vec2;
      }
      @vertex
      export function vs(@builtin("vertex_index") i: u32): Clip {
        return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.ATTRIBUTE_NAME)).toEqual([])
  })

  it('does not double up on @align/@std140, which already get their own "not applied" message', () => {
    const r = diag(`
      "use typeshade";
      @std140
      class Camera {
        @align(16) pos: vec3;
      }
      export function f(): f32 { return 0.; }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.ATTRIBUTE_NAME)).toEqual([])
    expect(r.diagnostics.some((d) => /not applied/.test(d.message))).toBe(true)
  })
})

// Regression: a struct field with neither @builtin nor @location, used as an entry function's
// parameter or return type, used to emit invalid WGSL (a member the backend and Tint both
// reject) with zero diagnostics from either the compiler or the language service.
describe('entry-IO struct fields need @builtin or @location (STRUCT_FIELD_MISSING_ATTR)', () => {
  it('rejects an unattributed field in a @vertex return struct', () => {
    const r = diag(`
      "use typeshade";
      class Out {
        @builtin("position") pos: vec4;
        extra: vec4;
      }
      @vertex
      export function vs(): Out {
        return { pos: vec4(0., 0., 0., 1.), extra: vec4(0., 0., 0., 0.) };
      }
    `)
    const d = r.diagnostics.find((d) => d.code === TS_CODES.STRUCT_FIELD_MISSING_ATTR)
    expect(d, 'expected a STRUCT_FIELD_MISSING_ATTR diagnostic').toBeDefined()
    expect(d!.category).toBe('error')
    expect(d!.message).toContain('extra')
  })

  it('rejects an unattributed field in a @fragment input struct', () => {
    const r = diag(`
      "use typeshade";
      class In {
        @location(0) uv: vec2;
        extra: f32;
      }
      @fragment
      export function fs(v: In): vec4 {
        return vec4(v.uv, v.extra, 1.);
      }
    `)
    expect(r.diagnostics.some((d) => d.code === TS_CODES.STRUCT_FIELD_MISSING_ATTR)).toBe(true)
  })

  it('is silent when every entry-IO field carries @builtin or @location', () => {
    const r = diag(`
      "use typeshade";
      class Out {
        @builtin("position") pos: vec4;
        @location(0) uv: vec2;
      }
      @vertex
      export function vs(): Out {
        return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.STRUCT_FIELD_MISSING_ATTR)).toEqual([])
  })

  it('is silent for the same struct shape used only as a plain (non-entry) parameter', () => {
    const r = diag(`
      "use typeshade";
      class Data {
        a: vec4;
        b: vec4;
      }
      export function f(d: Data): vec4 {
        return d.a;
      }
    `)
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.STRUCT_FIELD_MISSING_ATTR)).toEqual([])
  })
})
