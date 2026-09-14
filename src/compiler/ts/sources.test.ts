import { describe, expect, it } from 'vitest'
import { compileTsSources } from './sources.js'
import { TS_CODES } from './codes.js'

describe('compileTsSources', () => {
  it('resolves relative named imports into one WGSL module', () => {
    const r = compileTsSources(
      {
        'math.ts': `
          "use typeshade";
          export function square(x: f32): f32 { return x * x; }
        `,
        'app.ts': `
          "use typeshade";
          import { square } from "./math";
          export function foo(x: f32): f32 { return square(x) + 1.; }
        `,
      },
      { entry: 'app.ts' },
    )
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    expect(r.funcs.map((f) => f.name).sort()).toEqual(['foo', 'square'])
    expect(r.wgsl).toMatch(/fn square/)
    expect(r.wgsl).toMatch(/fn foo/)
    expect(r.wgsl).toMatch(/square\(/)
  })

  it('rejects non-relative imports', () => {
    const r = compileTsSources(
      {
        'app.ts': `
          "use typeshade";
          import { sin } from "some-pkg";
          export function f(x: f32): f32 { return x; }
        `,
      },
      { entry: 'app.ts' },
    )
    expect(r.diagnostics.some((d) => /relative/.test(d.message))).toBe(true)
  })
})

describe('compileTsSources syntax errors', () => {
  it('reports a parse error in any file as SYNTAX, naming the file, and lowers nothing', () => {
    const r = compileTsSources(
      {
        'math.ts': `"use typeshade";\nexport function square(x: f32): f32 { return x * x; }`,
        'app.ts': `"use typeshade";\nimport { square } from "./math";\nexport function foo(x: f32): f32 { return square(x; }`,
      },
      { entry: 'app.ts' },
    )
    expect(r.hasDirective).toBe(true)
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.diagnostics.every((d) => d.code === TS_CODES.SYNTAX)).toBe(true)
    expect(r.diagnostics[0]!.fileName).toBe('app.ts')
    expect(r.funcs).toEqual([])
    expect(r.wgsl).toBeUndefined()
  })
})

describe('compileTsSources symbols', () => {
  // The same promise as `module.ts`'s overload, and here the result names the file the spans
  // index (`sourceFile`), so the test can check them against it directly.
  const files = {
    'a.ts':
      '"use typeshade";\nexport function helper(ha: f32): f32 {\n  const inA = ha;\n  return inA;\n}\n',
    'b.ts':
      '"use typeshade";\nimport { helper } from "./a";\nconst KB: f32 = 2.;\nexport function main(mb: f32): f32 {\n  const inB = helper(mb);\n  return inB;\n}\n',
  }

  for (const entry of ['b.ts', './b.ts', 'b.js']) {
    it(`records the entry file's declarations for entry "${entry}"`, () => {
      const r = compileTsSources(files, { entry })
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
      expect(r.sourceFile.fileName).toBe('b.ts')
      expect(r.symbols.map((s) => `${s.kind}:${s.name}`).sort()).toEqual([
        'const:KB',
        'function:main',
        'local:inB',
        'param:mb',
      ])
      for (const s of r.symbols) {
        expect(r.sourceFile.text.slice(s.start, s.start + s.length)).toBe(s.name)
      }
    })
  }
})
