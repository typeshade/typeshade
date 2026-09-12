import { describe, expect, it } from 'vitest'
import { compileTsSources } from './sources.js'

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
