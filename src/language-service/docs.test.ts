import { describe, it, expect } from 'vitest'
import { SHADE_DTS } from './ambient.js'
import {
  FUNCTION_DOCS,
  CONSTANT_DOCS,
  ATTRIBUTE_DOCS,
  MATH_MEMBER_DOCS,
  DOCUMENTED_FUNCTION_NAMES,
  DOCUMENTED_CONSTANT_NAMES,
} from './docs.js'

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
