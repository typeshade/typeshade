import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { createTypeshadeLanguageService } from './service.js'
import { TypeshadeHost } from './host.js'
import { GPU_BRAND_TAGS } from './ambient.js'
import { SUPPORTED_TYPE_NAMES } from '../compiler/ts/type-map.js'
import type { TypeshadeDiagnostic } from './types.js'

const URI = 'a.ts'

function diagnosticsOf(source: string): readonly TypeshadeDiagnostic[] {
  const service = createTypeshadeLanguageService()
  service.openDocument(URI, source)
  return service.getDiagnostics(URI)
}

/** The diagnostics an editor would attribute to TypeScript itself, which is what §6's "zero
 * false positives on a valid program" is about; a `"use typeshade"` diagnostic is the compiler
 * front end speaking and is asserted on separately below. */
function typeScriptDiagnosticsOf(source: string): string[] {
  return diagnosticsOf(source)
    .filter((d) => d.source === 'typescript')
    .map((d) => `TS${d.code}: ${d.message}`)
}

const entry = (
  body: string,
  signature = 'v: vec3, s: f32, a: vec3, b: vec3, c: vec4, m: mat4',
): string => `"use typeshade"\nexport function f(${signature}): void {\n${body}\n}\n`

// Issue #21: every vector expression in a `"use typeshade"` program drew TS2362/TS2363/TS2365,
// and the TS2322 that follows from arithmetic being typed `number`, because the ambient lib
// brands vectors and matrices as object types and a branded object type is not a `number` to
// TypeScript's arithmetic check. The brands are what keep a `vec3` from satisfying a `vec2`, so
// the fix is a filter over the diagnostics rather than a weaker ambient lib.
describe('vector and matrix arithmetic draws no TypeScript diagnostic (issue #21)', () => {
  const cases: Readonly<Record<string, string>> = {
    'a vector times a scalar': entry('  const p = v * s\n'),
    'two vectors added': entry('  const p = a + b\n'),
    'a swizzle times a float literal': entry('  const p = c.rgb * 0.5\n'),
    'a constructor times Math.PI': entry('  const p = vec4(0.) * Math.PI\n'),
    'a compound assignment': entry('  v *= 2.\n'),
    'a matrix times a vector': entry('  const p = m * c\n'),
    'a vector-annotated return of vector arithmetic':
      '"use typeshade"\nexport function f(v: vec3, s: f32): vec3 {\n  return v * s\n}\n',
    'a vector-annotated local of vector arithmetic':
      '"use typeshade"\nexport function f(a: vec3, b: vec3): vec3 {\n  let t: vec3 = a + b\n  return t\n}\n',
  }
  for (const [name, source] of Object.entries(cases)) {
    it(`${name}: no TypeScript-sourced diagnostic`, () => {
      expect(typeScriptDiagnosticsOf(source), source).toEqual([])
    })
  }
})

describe('a program that is genuinely wrong still reports', () => {
  it('v * "x" keeps the TypeScript diagnostic about the string operand', () => {
    const source = '"use typeshade"\nexport function f(v: vec3): vec3 {\n  return v * "x"\n}\n'
    // TS2363 is the right-hand operand's, so filtering per operand (rather than dropping the
    // whole expression because ONE operand is a vector) is what leaves this visible.
    expect(diagnosticsOf(source).some((d) => d.source === 'typescript' && d.code === 2363)).toBe(
      true,
    )
  })

  it('1 * "x", with no vector anywhere, is untouched', () => {
    const source = '"use typeshade"\nexport function f(): f32 {\n  return 1 * "x"\n}\n'
    expect(diagnosticsOf(source).some((d) => d.source === 'typescript' && d.code === 2363)).toBe(
      true,
    )
  })

  it('a vector assigned into a scalar keeps TS2322', () => {
    const source =
      '"use typeshade"\nexport function f(v: vec3): f32 {\n  let n: f32 = v\n  return n\n}\n'
    // The target is `f32`, which IS a `number` to TypeScript, so the mismatch is not the
    // brand's doing and the TS2322 rule must not reach it.
    expect(diagnosticsOf(source).some((d) => d.source === 'typescript' && d.code === 2322)).toBe(
      true,
    )
  })
})

describe('the compiler front end stays the authority on what combines with what', () => {
  it('vec3(1.) + vec2(1.) is reported once, by the compiler', () => {
    const source = '"use typeshade"\nexport function f(): vec3 {\n  return vec3(1.) + vec2(1.)\n}\n'
    const diagnostics = diagnosticsOf(source)
    expect(typeScriptDiagnosticsOf(source), 'TypeScript would say this twice over').toEqual([])
    expect(
      diagnostics.map((d) => `${d.source} ${d.code}`),
      'the editor should show exactly the compiler TYPE_MISMATCH',
    ).toEqual(['typeshade TS8003'])
  })
})

/** Every unique-symbol brand `SHADE_DTS` puts on the named types, read back through the checker
 * the same way `diagnostics.ts` reads it: a property whose escaped name is `__@<tag>@<id>`. */
function brandTagsOf(typeNames: readonly string[]): string[] {
  const source =
    '"use typeshade"\n' +
    typeNames.map((name, i) => `declare const value${i}: ${name}`).join('\n') +
    '\n'
  const host = new TypeshadeHost()
  host.openDocument(URI, source)
  const service = ts.createLanguageService(host, ts.createDocumentRegistry())
  const program = service.getProgram()!
  const checker = program.getTypeChecker()
  const tags = new Set<string>()
  program.getSourceFile(URI)!.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return
    for (const declaration of node.declarationList.declarations) {
      for (const property of checker.getTypeAtLocation(declaration.name).getProperties()) {
        const tag = /^__@(.+)@\d+$/.exec(property.getName())?.[1]
        if (tag !== undefined) tags.add(tag)
      }
    }
  })
  return [...tags].sort()
}

const VECTOR_AND_MATRIX_NAMES = SUPPORTED_TYPE_NAMES.filter((name) => /^(vec|mat)/.test(name))
const SCALAR_NAMES = SUPPORTED_TYPE_NAMES.filter((name) => !/^(vec|mat)/.test(name))

// The list in `ambient.ts` is what `diagnostics.ts` matches a type against, so a brand added to
// SHADE_DTS without a decision about its arithmetic must fail here rather than quietly widen or
// narrow which diagnostics the editor drops.
describe('GPU_BRAND_TAGS is exactly what SHADE_DTS brands vectors and matrices with', () => {
  it('equals the tag set of every vector and matrix type name the compiler supports', () => {
    expect(
      VECTOR_AND_MATRIX_NAMES.length,
      'no vector names resolved from type-map.ts',
    ).toBeGreaterThan(0)
    expect(brandTagsOf(VECTOR_AND_MATRIX_NAMES)).toEqual([...GPU_BRAND_TAGS].sort())
  })

  it('excludes the scalar and array brands, whose arithmetic TypeScript already accepts', () => {
    // A scalar IS a `number` to TypeScript and indexing an `array` is not arithmetic, so
    // neither needs, or should get, the vector treatment.
    const other = brandTagsOf([...SCALAR_NAMES, 'array<f32>'])
    expect(other.length, 'the scalar and array brands should be readable').toBeGreaterThan(0)
    expect(other.filter((tag) => GPU_BRAND_TAGS.includes(tag))).toEqual([])
  })
})
