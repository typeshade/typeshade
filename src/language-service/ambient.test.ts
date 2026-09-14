import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createTypeshadeLanguageService } from './service.js'
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

const HELLO_EXAMPLES = [
  'hello.shade.ts',
  'hello-uniform.shade.ts',
  'hello-vsin.shade.ts',
  'hello-vsout.shade.ts',
  'hello-camera.shade.ts',
]

describe('SHADE_DTS: the five hello examples produce zero diagnostics', () => {
  for (const name of HELLO_EXAMPLES) {
    it(`${name}: zero TypeScript diagnostics and zero TypeShade diagnostics`, () => {
      const text = readFileSync(join(EXAMPLES_DIR, name), 'utf8')
      const service = createTypeshadeLanguageService()
      service.openDocument(name, text)
      const diagnostics = service.getDiagnostics(name)
      expect(
        diagnostics.map((d) => `${d.source} ${d.code}: ${d.message}`),
        `${name} should compile clean under the ambient lib`,
      ).toEqual([])
    })
  }
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
