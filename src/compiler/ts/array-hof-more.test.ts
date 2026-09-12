import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'

describe('any / all / zip', () => {
  it('unrolls any(xs, pred) to || of calls', () => {
    const r = compileTsSource(`
      "use typeshade";
      function pos(x: f32): bool { return x > 0.; }
      export function f(xs: array<f32, 3>): bool {
        return any(xs, pos);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs.find((fn) => fn.name === 'f')!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('logical')
  })

  it('unrolls all(xs, pred) to && of calls', () => {
    const r = compileTsSource(`
      "use typeshade";
      function pos(x: f32): bool { return x > 0.; }
      export function f(xs: array<f32, 2>): bool {
        return all(xs, pos);
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const ret = r.funcs.find((fn) => fn.name === 'f')!.body[0]
    if (ret!.s === 'return') expect(ret.expr?.op).toBe('logical')
  })

  it('unrolls zip(xs, ys, add)', () => {
    const r = compileTsSource(`
      "use typeshade";
      function add(a: f32, b: f32): f32 { return a + b; }
      export function f(xs: array<f32, 2>, ys: array<f32, 2>): f32 {
        const zs = zip(xs, ys, add);
        return 0.;
      }
    `)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const letS = r.funcs.find((fn) => fn.name === 'f')!.body.find((s) => s.s === 'let')
    if (letS && letS.s === 'let' && letS.expr.op === 'construct') {
      expect(letS.expr.args).toHaveLength(2)
    }
  })

  it('rejects zip length mismatch', () => {
    const r = compileTsSource(`
      "use typeshade";
      function add(a: f32, b: f32): f32 { return a + b; }
      export function f(xs: array<f32, 2>, ys: array<f32, 3>): f32 {
        const zs = zip(xs, ys, add);
        return 0.;
      }
    `)
    expect(r.diagnostics.some((d) => /length mismatch/.test(d.message))).toBe(true)
  })
})
