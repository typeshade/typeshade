import { describe, it, expect } from 'vitest'
import { SHADE_DTS } from './ambient.js'
import {
  FUNCTION_DOCS,
  CONSTANT_DOCS,
  ATTRIBUTE_DOCS,
  MATH_MEMBER_DOCS,
  DOCUMENTED_FUNCTION_NAMES,
  DOCUMENTED_CONSTANT_NAMES,
  TYPE_DOCS,
  DOCUMENTED_TYPE_NAMES,
} from './docs.js'
import { SUPPORTED_TYPE_NAMES } from '../compiler/ts/type-map.js'

describe('ambient lib JSDoc', () => {
  it('every declare function line in SHADE_DTS is preceded by a JSDoc line ending in */', () => {
    const lines = SHADE_DTS.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      // Skip unique-symbol tags and Math object itself
      if (
        line.startsWith('declare const') &&
        (line.includes('Tag: unique symbol') || line === 'declare const Math: MathObject')
      ) {
        continue
      }
      if (
        line.startsWith('declare function') ||
        (line.startsWith('declare const') && !line.includes('Tag'))
      ) {
        // This line should be preceded by a JSDoc block
        expect(
          i > 0 && lines[i - 1].trim().endsWith('*/'),
          `Line ${i + 1} ("${line}") should be preceded by JSDoc block ending with */`,
        ).toBe(true)
      }
    }
  })

  it('every member line inside interface MathObject is preceded by a JSDoc line', () => {
    const lines = SHADE_DTS.split('\n')
    let inMathObject = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.includes('interface MathObject')) {
        inMathObject = true
        continue
      }
      if (inMathObject && line === '}') {
        break
      }
      if (inMathObject) {
        const trimmed = line.trim()
        // Skip empty lines and the opening brace
        if (trimmed && trimmed !== '{' && !trimmed.startsWith('*') && !trimmed.startsWith('/**')) {
          // This is a member line (not a JSDoc continuation)
          // It should be preceded by a JSDoc block ending with */
          let foundJSDocEnd = false
          for (let j = i - 1; j >= 0; j--) {
            const prevLine = lines[j].trim()
            if (prevLine.endsWith('*/')) {
              foundJSDocEnd = true
              break
            }
            if (!prevLine.startsWith('*') && !prevLine.startsWith('/**')) {
              // Found a non-JSDoc line without finding the JSDoc end
              break
            }
          }
          expect(
            foundJSDocEnd,
            `Line ${i + 1} ("${trimmed}") in MathObject should be preceded by JSDoc block`,
          ).toBe(true)
        }
      }
    }
  })

  it('FUNCTION_DOCS keys match declare function names in SHADE_DTS', () => {
    // Extract all declare function names from SHADE_DTS
    // Matches both `declare function name(` and `declare function name<T>(...)`
    const functionNameRegex = /declare function (\w+)[\(<]/g
    const declaredNames = new Set<string>()
    let match
    while ((match = functionNameRegex.exec(SHADE_DTS)) !== null) {
      declaredNames.add(match[1])
    }

    // Check that every documented function is declared
    for (const name of DOCUMENTED_FUNCTION_NAMES) {
      expect(
        declaredNames.has(name),
        `Function ${name} in FUNCTION_DOCS but not declared in SHADE_DTS`,
      ).toBe(true)
    }

    // Check that every declared function is documented (except attribute decorators which are in ATTRIBUTE_DOCS).
    // Derived from ATTRIBUTE_DOCS rather than listed again: a hand-written copy of its keys is a
    // second list to keep in step, and §53 adding `@interpolate`, `@invariant` and `@blend_src`
    // is exactly the update that gets forgotten.
    const attributeDecorators = new Set(Object.keys(ATTRIBUTE_DOCS))
    for (const name of declaredNames) {
      if (!attributeDecorators.has(name)) {
        expect(
          DOCUMENTED_FUNCTION_NAMES.includes(name),
          `Function ${name} is declared in SHADE_DTS but not in FUNCTION_DOCS`,
        ).toBe(true)
      }
    }
  })

  it('CONSTANT_DOCS covers every language constant', () => {
    // Check that CONSTANT_DOCS has the expected constants
    const expectedConstants = ['PI', 'TAU', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E']
    for (const name of expectedConstants) {
      expect(
        DOCUMENTED_CONSTANT_NAMES.includes(name),
        `Constant ${name} should be in CONSTANT_DOCS`,
      ).toBe(true)
    }
  })

  it('JSDoc text ends with a period, is at most three sentences, has no em/en dash', () => {
    const allDocs = [
      ...Object.values(FUNCTION_DOCS),
      ...Object.values(CONSTANT_DOCS),
      ...Object.values(ATTRIBUTE_DOCS),
      ...Object.values(MATH_MEMBER_DOCS),
    ]

    for (const doc of allDocs) {
      if (!doc) continue
      // Check ends with period
      expect(doc.endsWith('.'), `Doc should end with period: "${doc}"`).toBe(true)

      // Check no em dash (U+2014) or en dash (U+2013)
      expect(
        !doc.includes('—') && !doc.includes('–'),
        `Doc should not contain em or en dash: "${doc}"`,
      ).toBe(true)

      // Check no */
      expect(!doc.includes('*/'), `Doc should not contain '*/': "${doc}"`).toBe(true)

      // Check no question marks
      expect(!doc.includes('?'), `Doc should not contain question mark: "${doc}"`).toBe(true)

      // Count sentences (roughly by periods)
      const sentenceCount = doc.split('. ').length
      expect(sentenceCount <= 3, `Doc should have at most 3 sentences: "${doc}"`).toBe(true)
    }
  })
})

describe('TYPE_DOCS: every matrix name the compiler takes has a row', () => {
  // Regression: the table held `mat4` and `mat4x4` only, while the compiler takes every
  // `matCxR` and the square `matN` shorthands (surface §40; the TS8002 sentence lists them),
  // so hover documented two of the twelve and the reference page listed two matrix types.
  const MATRIX_NAMES = SUPPORTED_TYPE_NAMES.filter((n) => /^mat\d/.test(n))

  it('the compiler takes all twelve, so the check below is not vacuous', () => {
    expect([...MATRIX_NAMES].sort()).toEqual(
      [
        'mat2',
        'mat2x2',
        'mat2x3',
        'mat2x4',
        'mat3',
        'mat3x2',
        'mat3x3',
        'mat3x4',
        'mat4',
        'mat4x2',
        'mat4x3',
        'mat4x4',
      ].sort(),
    )
  })

  it('each one has a documented row naming its shape', () => {
    const missing = MATRIX_NAMES.filter((n) => TYPE_DOCS[n] === undefined)
    expect(missing).toEqual([])
    for (const n of MATRIX_NAMES) {
      const [, c, r] = /^mat(\d)(?:x(\d))?$/.exec(n)!
      expect(TYPE_DOCS[n], n).toContain(`${c}x${r ?? c} matrix`)
    }
  })

  it('each row reads like the rest of the table', () => {
    for (const n of MATRIX_NAMES) {
      const doc = TYPE_DOCS[n]!
      expect(doc.endsWith('.'), n).toBe(true)
      expect(doc.includes('\u2014') || doc.includes('\u2013'), n).toBe(false)
    }
  })
})

describe('TYPE_DOCS: every type name the compiler takes has a row', () => {
  // Regression: `DOCUMENTED_TYPE_NAMES` was `SUPPORTED_TYPE_NAMES` itself, so nothing checked
  // that a name the compiler takes had a TYPE_DOCS row, and `sampler`, `sampler_comparison` and
  // every `texture_*` name went without one: hover said nothing on them and semantic tokens
  // left them without the `gpu` modifier. The list is read from the compiler, not copied.
  it('the compiler list includes the handle types, so the check below is not vacuous', () => {
    expect(SUPPORTED_TYPE_NAMES).toContain('sampler')
    expect(SUPPORTED_TYPE_NAMES).toContain('texture_2d')
    expect(SUPPORTED_TYPE_NAMES).toContain('texture_storage_2d')
  })

  it('no supported type name is missing a row', () => {
    const missing = SUPPORTED_TYPE_NAMES.filter((n) => TYPE_DOCS[n] === undefined)
    expect(missing).toEqual([])
  })

  it('DOCUMENTED_TYPE_NAMES is the set of rows, and covers the compiler list', () => {
    expect([...DOCUMENTED_TYPE_NAMES].sort()).toEqual(Object.keys(TYPE_DOCS).sort())
    for (const n of SUPPORTED_TYPE_NAMES) expect(DOCUMENTED_TYPE_NAMES, n).toContain(n)
  })

  it('each row reads like the rest of the table', () => {
    for (const [n, doc] of Object.entries(TYPE_DOCS)) {
      expect(doc.endsWith('.'), n).toBe(true)
      expect(doc.includes('—') || doc.includes('–'), n).toBe(false)
      expect(doc.includes('*/'), n).toBe(false)
    }
  })
})
