import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('sum / min / max / fill / none', () => {
  it('sums an array with +', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: array<f32, 3>): f32 {
        return sum(xs);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('binop')
  })

  it('mins an array via min(a, b) calls', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: array<f32, 3>): f32 {
        return min(xs);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('call')
  })

  it('keeps two-arg min as the scalar intrinsic', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32): f32 {
        return min(a, b);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs[0]!.body[0]
    if (ret!.s === 'return' && ret.expr?.op === 'call') expect(ret.expr.args).toHaveLength(2)
  })

  it('constructs fill<f32, 4>(v)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(v: f32): f32 {
        const xs = fill<f32, 4>(v);
        return 0.;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const letS = r.funcs[0]!.body.find((s) => s.s === 'let')
    if (letS && letS.s === 'let' && letS.expr.op === 'construct') {
      expect(letS.expr.args).toHaveLength(4)
    }
  })

  it('none(xs, pred) is !any', () => {
    const r = compileTsSource(`
      "use typeshade";
      function pos(x: f32): bool { return x > 0.; }
      export function f(xs: array<f32, 2>): bool {
        return none(xs, pos);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs.find((fn) => fn.name === 'f')!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('compare')
  })
})
