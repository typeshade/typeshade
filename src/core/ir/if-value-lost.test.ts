import { describe, it, expect } from 'vitest'
import { fn, module, If, Return, Var, when, f32, f32T, vec2, vec2fT } from './index.js'
import { emitModule } from '../backends/wgsl.js'

// ═══ #8 B4 — the branch body that returns a value ═══
//
// `If(c, () => { return f32(1) })` and `If(c, () => { Return(f32(1)) })` differ by three
// characters. The first computes a value nothing reads and emits an empty `if` block; the
// second is the early return the author meant. subBody has always dropped that value on
// purpose — a captured one would be an invisible early return reading as fall-through — but
// dropping it silently is what made the two spellings indistinguishable at the call site.

describe('#8 B4 — a branch is a statement block', () => {
  it('rejects a value returned from an If body', () => {
    expect(() =>
      fn('f', { x: f32T }, f32T, ({ x }) => {
        If(x.gt(0), () => f32(1))
        return f32(0)
      }),
    ).toThrow(/SD0115/)
  })

  it('names the type and the fix', () => {
    let msg = ''
    try {
      fn('f', { x: f32T }, vec2fT, ({ x }) => {
        If(x.gt(0), () => vec2(x, x))
        return vec2(x, x)
      })
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain('vec2<f32>')
    expect(msg).toContain('a branch is a statement block')
    expect(msg).toContain('Return(value)')
  })

  it('covers elif and else too', () => {
    expect(() =>
      fn('g', { x: f32T }, f32T, ({ x }) => {
        If(x.gt(0), () => {}).elif(x.lt(0), () => f32(2))
        return f32(0)
      }),
    ).toThrow(/SD0115/)
    expect(() =>
      fn('h', { x: f32T }, f32T, ({ x }) => {
        If(x.gt(0), () => {}).else(() => f32(3))
        return f32(0)
      }),
    ).toThrow(/SD0115/)
  })

  it('leaves every statement body alone — Return, assign, Break and a plain block', () => {
    const early = fn(
      'early',
      { x: f32T },
      f32T,
      ({ x }) => {
        If(x.gt(0), () => {
          Return(f32(1))
        })
        Return(f32(0))
      },
      { allowEarlyReturn: true },
    )
    expect(emitModule(module({ funcs: [early] }))).toContain('return 1.0;')

    const mutate = fn('mutate', { x: f32T }, f32T, ({ x }) => {
      const v = Var('v', f32(0))
      // The body's last expression IS the assign call, whose value is void — the shape the
      // corpus uses, which must keep working.
      If(x.gt(0), () => v.assign(v.add(x)))
      return v
    })
    expect(emitModule(module({ funcs: [mutate] }))).toContain('v = (v + x);')
  })

  it('points at the surface that does carry a value out', () => {
    const w = fn('w', { x: f32T }, f32T, ({ x }) =>
      when(
        x.gt(0),
        () => f32(1),
        () => f32(0),
      ),
    )
    expect(emitModule(module({ funcs: [w] }))).toContain('if ((x > 0.0))')
  })
})
