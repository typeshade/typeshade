import { describe, expect, it } from 'vitest'
import { compileTsSources } from './module.js'

describe('compileTsSources import', () => {
  it('resolves relative named import onto declRef', () => {
    const r = compileTsSources([
      {
        fileName: 'math.ts',
        source: `
          "use typeshade";
          export function square(x: f32): f32 {
            return x * x;
          }
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          "use typeshade";
          import { square } from "./math";
          export function foo(x: f32): f32 {
            return square(x) + 1;
          }
        `,
      },
    ])
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const foo = r.funcs.find((f) => f.name === 'foo')
    expect(foo).toBeTruthy()
    const ret = foo!.body[0]
    expect(ret!.s).toBe('return')
    if (ret!.s === 'return' && ret.expr && ret.expr.op === 'binop' && ret.expr.a.op === 'call') {
      expect(ret.expr.a.fn).toBe('square')
      expect(ret.expr.a.declRef?.name).toBe('square')
    }
    expect(r.wgsl).toMatch(/fn square/)
    expect(r.wgsl).toMatch(/fn foo/)
  })

  it('rejects a missing module', () => {
    const r = compileTsSources([
      {
        fileName: 'app.ts',
        source: `
          "use typeshade";
          import { square } from "./nope";
          export function foo(x: f32): f32 { return square(x); }
        `,
      },
    ])
    expect(r.diagnostics.some((d) => /Cannot resolve import/.test(d.message))).toBe(true)
  })
})
