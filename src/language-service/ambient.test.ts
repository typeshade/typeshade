import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createTypeshadeLanguageService } from './service.js'
import { TypeshadeHost, AMBIENT_LIB_URI } from './host.js'
import { ATTRIBUTE_NAMES, WGSL_BUILTIN_NAMES } from './ambient.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLES_DIR = join(HERE, '..', '..', 'examples')
const SOT_FILE = join(HERE, '..', 'core', 'sot.ts')
const FUNCTION_FILE = join(HERE, '..', 'compiler', 'ts', 'lower', 'function.ts')
const STRUCTS_FILE = join(HERE, '..', 'compiler', 'ts', 'structs.ts')
// `'builtin'` itself is matched in builtin-check.ts now (shared by function.ts's parameter
// decorator and structs.ts's field decorator, so the allow-list/stage checks live in one
// place) — included here so this test still covers where `@builtin(...)` is actually parsed.
const BUILTIN_CHECK_FILE = join(HERE, '..', 'compiler', 'ts', 'builtin-check.ts')

/** Every `"use typeshade"` example, read from the directory rather than listed by hand so a new
 * one joins this corpus by existing. The corpus was the five `hello*` files, which are all
 * vertex and fragment shaders; `compute-reduction-twin.shade.ts` is what caught the ambient
 * `array`'s read-only index signature, since a compute kernel is the only program that writes
 * to a storage binding. */
const SHADE_EXAMPLES = readdirSync(EXAMPLES_DIR)
  .filter((name) => name.endsWith('.shade.ts'))
  .sort()

/** The names this corpus must contain: a `readdirSync` that resolved nothing, or an examples
 * directory that lost its compute kernel, would otherwise leave the suite below green over
 * nothing at all. */
const REQUIRED_EXAMPLES = [
  'compute-reduction-twin.shade.ts',
  'hello-camera.shade.ts',
  // #18's uniform struct: the first example in this corpus whose fragment multiplies a vector
  // and hands the product to `vec4(...)`, which is the shape issue #43 is about.
  'hello-uniform-struct.shade.ts',
  'hello-uniform.shade.ts',
  'hello-vsin.shade.ts',
  'hello-vsout.shade.ts',
  'hello.shade.ts',
]

describe('SHADE_DTS: every .shade.ts example produces zero diagnostics', () => {
  it('reads a corpus that still holds every example this suite was built on', () => {
    for (const name of REQUIRED_EXAMPLES) {
      expect(SHADE_EXAMPLES, `${name} is missing from the examples corpus`).toContain(name)
    }
  })

  for (const name of SHADE_EXAMPLES) {
    it(`${name}: zero TypeScript diagnostics and zero TypeShade diagnostics`, () => {
      const text = readFileSync(join(EXAMPLES_DIR, name), 'utf8')
      const service = createTypeshadeLanguageService()
      service.openDocument(name, text)
      const diagnostics = service.getDiagnostics(name)
      // Zero, not "zero but for TS1206": `@vertex`/`@compute` on a top-level function and
      // `@builtin(...)` on its parameters are the one grammar no ambient lib can declare away,
      // and `diagnostics.ts` already filters exactly that shape (design doc §6).
      expect(
        diagnostics.map((d) => `${d.source} ${d.code}: ${d.message}`),
        `${name} should compile clean under the ambient lib`,
      ).toEqual([])
    })
  }
})

// Regression for the false positive PR #31's tarball measurement surfaced and the Playground
// reported as "compute reduction: output[idx] = sum shows an error": the ambient `array`'s index
// signature was `readonly`, which made the store every compute kernel ends with a TS2542 in the
// editor while the compiler lowered it happily. The example suite above now covers the same
// ground through `compute-reduction-twin.shade.ts`; this arm names the one construct, so a
// regression says what broke rather than which file stopped compiling.
describe('a storage array is writable in the editor, as it is in the compiler', () => {
  const kernel = (body: string): string =>
    '"use typeshade"\n' +
    'declare let out: storage<array<f32>>\n' +
    '@compute([64, 1, 1])\n' +
    'export function k(@builtin("global_invocation_id") gid: vec3u): void {\n' +
    `  ${body}\n` +
    '}\n'

  it('out[gid.x] = value reports no TS2542, and nothing else either', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', kernel('out[gid.x] = 1.'))
    const diagnostics = service.getDiagnostics('a.ts')
    expect(diagnostics.filter((d) => d.source === 'typescript' && d.code === 2542)).toEqual([])
    expect(diagnostics.map((d) => `${d.source} ${d.code}: ${d.message}`)).toEqual([])
  })

  it('keeps length read-only, so the change reaches the index signature only', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', kernel('out.length = 2'))
    const diagnostics = service.getDiagnostics('a.ts')
    expect(diagnostics.some((d) => d.source === 'typescript' && d.code === 2540)).toBe(true)
  })
})

// Issue #43: `v * s` is typed `number`, so using the product AS a vector was rejected at every
// call, and 11 of the 17 `.shade.ts` files in the project (this corpus plus the twins on
// `feat/gradient-twin` and `feat/porting-twins`) failed the gate above on that one shape while
// every one of them compiled and linked on Tint and WebGL2. `hello-uniform-struct.shade.ts` is
// in the corpus above, but it pays for the gate with an annotated local (`const rgb: vec3 = ...`,
// see the comment in that file), so the line it actually wanted is pinned here instead: the
// twins cannot take that workaround, since a twin is supposed to mirror its EDSL original.
describe('a vector product used as a vector is clean in the editor (issue #43)', () => {
  const uniformStructFragment =
    '"use typeshade"\n' +
    'class Uniforms {\n' +
    '  tint: vec4\n' +
    '  gain: f32\n' +
    '}\n' +
    'declare const u: uniform<Uniforms>\n' +
    'class VsOut {\n' +
    '  @builtin("position") pos: vec4\n' +
    '  @location(0) uv: vec2\n' +
    '}\n' +
    '@fragment\n' +
    'export function fs(vo: VsOut): vec4 {\n' +
    '  return vec4(u.tint.rgb * (vo.uv.y * u.gain), u.tint.a)\n' +
    '}\n'

  it('hello-uniform-struct.shade.ts (#18) without its annotated local has zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument('a.ts', uniformStructFragment)
    expect(
      service.getDiagnostics('a.ts').map((d) => `${d.source} ${d.code}: ${d.message}`),
    ).toEqual([])
  })

  it('still type-checks the constructor itself (two scalars are not a vec3 and a scalar)', () => {
    const service = createTypeshadeLanguageService()
    service.openDocument(
      'a.ts',
      '"use typeshade"\nexport function f(c: vec4): vec4 {\n  return vec4(1., c.a)\n}\n',
    )
    expect(
      service.getDiagnostics('a.ts').some((d) => d.source === 'typescript' && d.code === 2345),
    ).toBe(true)
  })
})

// Regression for the blocker where `VecOf`'s use of the standard-lib `Pick` helper resolved to
// an error type under `lib: []` (`Pick` is declared by `lib.es5.d.ts`, never loaded here), which
// silently collapsed every vector type to `any` instead of raising a TypeScript error inside
// the ambient lib itself. The zero-diagnostics suite above cannot catch this: it can only see
// false positives on the examples, never a type system that has gone permissive. This is the
// real §6 guard.
describe('AMBIENT_LIB_URI: the bundled shade.d.ts itself must type-check cleanly', () => {
  it('produces zero TypeScript diagnostics against its own compiler options', () => {
    const host = new TypeshadeHost()
    host.openDocument('a.ts', '"use typeshade"\nexport function f(): void {}\n')
    const ls = ts.createLanguageService(host, ts.createDocumentRegistry())
    const diagnostics = [
      ...ls.getSyntacticDiagnostics(AMBIENT_LIB_URI),
      ...ls.getSemanticDiagnostics(AMBIENT_LIB_URI),
    ]
    expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
  })

  it('actually type-checks vector arguments (a vec2 does not satisfy a vec4 parameter)', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\n' +
      'function g(a: vec4): void {}\n' +
      'export function f(): void {\n' +
      '  g(vec2(1, 2))\n' +
      '}\n'
    service.openDocument('a.ts', source)
    const diagnostics = service.getDiagnostics('a.ts')
    expect(diagnostics.some((d) => d.source === 'typescript' && d.code === 2345)).toBe(true)
  })

  it('actually type-checks member access on a vector (no member named "nope")', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\n' + 'export function f(a: vec4): f32 {\n' + '  return a.nope\n' + '}\n'
    service.openDocument('a.ts', source)
    const diagnostics = service.getDiagnostics('a.ts')
    expect(diagnostics.some((d) => d.source === 'typescript' && d.code === 2339)).toBe(true)
  })
})

// Regression for the major finding where a REQUIRED unique-symbol brand on f32/i32/u32/f64 made
// an ordinary valid "use typeshade" program report TS2322, because nothing in the authoring
// surface ever produces a literal value that already carries the brand. The corpus here is
// deliberately wider than the five hello examples (none of which annotates an f32 return or
// local), since that narrower corpus is exactly what let the bug through originally.
describe('scalar brands: an f32/u32/... annotation never false-positives on a plain number', () => {
  it('an f32 helper function with an f32 parameter and return has zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\n' +
      'export function h(a: f32, b: f32): f32 {\n' +
      '  return a * b\n' +
      '}\n'
    service.openDocument('a.ts', source)
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })

  it('a bare float literal returned from an f32-annotated function has zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    const source = '"use typeshade"\nexport function h(a: f32): f32 {\n  return a + 1.\n}\n'
    service.openDocument('a.ts', source)
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })

  it('an f32-typed local initialized from a float literal has zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\nexport function h(): f32 {\n  let t: f32 = 1.0\n  return t\n}\n'
    service.openDocument('a.ts', source)
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })

  it('dot(...), typed number in the ambient lib, satisfies an f32 return with zero diagnostics', () => {
    const service = createTypeshadeLanguageService()
    const source =
      '"use typeshade"\nexport function h(a: vec4, b: vec4): f32 {\n  return dot(a, b)\n}\n'
    service.openDocument('a.ts', source)
    expect(service.getDiagnostics('a.ts')).toEqual([])
  })
})

describe('WGSL_BUILTIN_NAMES stays in sync with core/sot.ts#WgslBuiltinName', () => {
  it('matches the type alias exactly', () => {
    const text = readFileSync(SOT_FILE, 'utf8')
    const sf = ts.createSourceFile(SOT_FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    let names: string[] | undefined
    sf.forEachChild((node) => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === 'WgslBuiltinName') {
        const type = node.type
        if (ts.isUnionTypeNode(type)) {
          names = type.types.map((member) => {
            if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
              return member.literal.text
            }
            throw new Error('WgslBuiltinName member is not a string literal')
          })
        }
      }
    })
    expect(names, 'WgslBuiltinName type alias not found in core/sot.ts').toBeDefined()
    expect([...WGSL_BUILTIN_NAMES].sort()).toEqual([...names!].sort())
  })
})

describe('ATTRIBUTE_NAMES matches what lower/function.ts and structs.ts actually parse', () => {
  it('every listed name is checked for by the two decorator readers', () => {
    const fn = readFileSync(FUNCTION_FILE, 'utf8')
    const structs = readFileSync(STRUCTS_FILE, 'utf8')
    const builtinCheck = readFileSync(BUILTIN_CHECK_FILE, 'utf8')
    const combined = fn + structs + builtinCheck
    for (const name of ATTRIBUTE_NAMES) {
      expect(combined, `${name} should be a literal this pipeline checks for`).toContain(
        `'${name}'`,
      )
    }
  })

  it('does not list a name the compiler does not implement (interpolate/align/size/ignore)', () => {
    const fn = readFileSync(FUNCTION_FILE, 'utf8')
    const structs = readFileSync(STRUCTS_FILE, 'utf8')
    // structs.ts only ever *rejects* @align ("on a field is not applied") — it never reads one
    // as a real decorator the way builtinDecoratorArg/numberDecorator read builtin/location.
    for (const name of ['interpolate', 'align', 'size', 'ignore']) {
      expect(ATTRIBUTE_NAMES, `${name} is not implemented by the compiler`).not.toContain(name)
    }
    expect(fn + structs).not.toContain("'interpolate'")
  })
})
