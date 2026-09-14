import { describe, it, expect } from 'vitest'
import { fn, module, Loop, Var, Break, If, toF32, f32, f32T, u32, u32T } from './index.js'
import { emitModule } from '../backends/wgsl.js'

// ═══ #8 B2 — the trip-count Loop ═══
//
// 19 of the corpus's 21 loops start at `u32(0)` and test a constant, so the three-part call
// spends two of its three slots restating the same thing. `Loop(96, body)` says the part that
// differs. It is sugar in the strictest sense: it builds the same `forRange` call, so the
// emitted `for` header is the same text — which is what these tests assert, rather than a
// hand-written expectation the sugar could drift from.

const emit = (body: () => void): string =>
  emitModule(module({ funcs: [fn('f', {}, f32T, () => (body(), f32(0)))] }))

describe('#8 B2 — Loop(count, body)', () => {
  it('emits the same for-header as the spelled-out loop', () => {
    const short = emit(() => {
      const acc = Var('acc', f32(0))
      Loop(96, (i) => {
        acc.assign(acc.add(toF32(i)))
      })
    })
    const long = emit(() => {
      const acc = Var('acc', f32(0))
      Loop(
        u32(0),
        (i) => i.lt(u32(96)),
        (i) => {
          acc.assign(acc.add(toF32(i)))
        },
      )
    })
    expect(short).toBe(long)
    expect(short).toContain('for (var _v0: u32 = 0u; (_v0 < 96u); _v0 = (_v0 + 1u))')
  })

  it('takes a name in the same leading slot the three-part form does', () => {
    const short = emit(() => {
      const acc = Var('acc', f32(0))
      Loop('k', 8, (i) => {
        acc.assign(acc.add(toF32(i)))
      })
    })
    const long = emit(() => {
      const acc = Var('acc', f32(0))
      Loop(
        'k',
        u32(0),
        (i) => i.lt(u32(8)),
        (i) => {
          acc.assign(acc.add(toF32(i)))
        },
      )
    })
    expect(short).toBe(long)
    expect(short).toContain('for (var k: u32 = 0u; (k < 8u); k = (k + 1u))')
  })

  it('hands the body a u32 counter, so a u32 comparison needs no cast', () => {
    const src = emit(() => {
      const acc = Var('acc', f32(0))
      Loop(4, (i) => {
        If(i.gt(u32(2)), () => Break())
        acc.assign(acc.add(toF32(i)))
      })
    })
    expect(src).toContain('> 2u')
    expect(src).toContain('break;')
  })

  it('runs the body once per iteration on the CPU oracle', async () => {
    const { compileModule } = await import('../oracle.js')
    const m = module({
      funcs: [
        fn('sum_to', { n: u32T }, f32T, () => {
          const acc = Var('acc', f32(0))
          Loop(5, (i) => {
            acc.assign(acc.add(toF32(i)))
          })
          return acc
        }),
      ],
    })
    expect(compileModule(m).fns.sum_to!(0)).toBe(0 + 1 + 2 + 3 + 4)
  })

  it('leaves the three-part form untouched — a node init still types its counter', () => {
    const src = emit(() => {
      const acc = Var('acc', f32(0))
      Loop(
        f32(0),
        (i) => i.lt(2),
        (i) => {
          acc.assign(acc.add(i))
        },
        0.5,
      )
    })
    expect(src).toContain('for (var _v0: f32 = 0.0; (_v0 < 2.0); _v0 = (_v0 + 0.5))')
  })
})
