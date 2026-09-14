import { describe, it, expect } from 'vitest'
import {
  fn,
  module,
  add,
  sub,
  mul,
  div,
  pow,
  mix,
  atan2,
  smoothstep,
  f32,
  u32,
  f32T,
  u32T,
  vec3,
  vec3fT,
  type ReadonlyNode,
} from './index.js'
import { emitModule } from '../backends/wgsl.js'

// ═══ #8 B3 — the expression whose LEFT operand is a literal ═══
//
// `a.sub(b)` cannot spell `1 - f(x)`; the corpus writes `f32(1).sub(f(x))` 43 times and
// `pow(f32(10), …)` 15 times, wrapping a constant in a node whose only job is to own the
// method. Every test here pairs the short spelling with the one it replaces and asserts the
// emitted text is the same — these are not a second arithmetic.

// The body takes the fn's own `x`, so nothing here is a foldable constant — the optimizer
// would collapse `(1.0 - 0.25)` to `0.75` and hide the very text these tests read.
const emitBody = (build: (x: ReadonlyNode<'f32'>) => ReadonlyNode<'f32'>): string =>
  emitModule(module({ funcs: [fn('f', { x: f32T }, f32T, ({ x }) => build(x))] }))

describe('#8 B3 — free add/sub/mul/div', () => {
  it('emit the same text as the f32()-wrapped method form', () => {
    type Build = (x: ReadonlyNode<'f32'>) => ReadonlyNode<'f32'>
    const cases: Array<[Build, Build]> = [
      [(x) => sub(1, smoothstep(0, 1, x)), (x) => f32(1).sub(smoothstep(0, 1, x))],
      [(x) => add(0.5, x), (x) => f32(0.5).add(x)],
      [(x) => mul(2, x), (x) => f32(2).mul(x)],
      [(x) => div(1, x), (x) => f32(1).div(x)],
    ]
    for (const [short, long] of cases) expect(emitBody(short)).toBe(emitBody(long))
  })

  it('reads left to right in the emitted text', () => {
    expect(emitBody((x) => sub(1, x))).toContain('return (1.0 - x);')
  })

  it('lets the NODE operand type the literal, as the method form does', () => {
    const src = emitModule(module({ funcs: [fn('g', { n: u32T }, u32T, ({ n }) => sub(3, n))] }))
    // `3u`, not `3.0` — a mixed-scalar `3.0 - n` compiles on neither target.
    expect(src).toContain('return (3u - n);')
    expect(
      emitModule(module({ funcs: [fn('h', { n: u32T }, u32T, ({ n }) => n.sub(3))] })),
    ).toContain('(n - 3u)')
  })

  it('broadcasts a literal over a vector, the scalar-times-vec the method form has', () => {
    const src = emitModule(
      module({ funcs: [fn('c', { p: vec3fT }, vec3fT, ({ p }) => mul(0.5, p))] }),
    )
    expect(src).toContain('return (0.5 * p);')
  })

  it('keeps the node-first form working, broadcast included', () => {
    const src = emitModule(
      module({ funcs: [fn('v', { p: vec3fT }, vec3fT, ({ p }) => mul(p, 2))] }),
    )
    expect(src).toContain('return (p * 2.0);')
    expect(
      emitModule(module({ funcs: [fn('w', {}, vec3fT, () => mul(f32(2), vec3(1, 1, 1)))] })),
    ).toContain('(2.0 * vec3<f32>(1.0, 1.0, 1.0))')
  })

  it('rejects two bare numbers — that fold belongs on the host', () => {
    // @ts-expect-error — #8 B3: no overload takes two numbers, so tsc catches it first.
    expect(() => sub(1, 2)).toThrow(/at least one operand must be a Node/)
  })
})

describe('#8 B3 — literal-first pow / mix / atan2', () => {
  it('pow(10, x) emits what pow(f32(10), x) emits', () => {
    expect(emitBody((x) => pow(10, x.neg()))).toBe(emitBody((x) => pow(f32(10), x.neg())))
    expect(emitBody((x) => pow(10, x.neg()))).toContain('pow(10.0, (-x))')
  })

  it('mix(0.35, 1, s) emits what mix(f32(0.35), f32(1), s) emits', () => {
    expect(emitBody((x) => mix(0.35, 1, x))).toBe(emitBody((x) => mix(f32(0.35), f32(1), x)))
    expect(emitBody((x) => mix(0.35, 1, x))).toContain('mix(0.35, 1.0, x)')
  })

  it('atan2(1, x) emits what atan2(f32(1), x) emits', () => {
    expect(emitBody((x) => atan2(1, x))).toBe(emitBody((x) => atan2(f32(1), x)))
    expect(emitBody((x) => atan2(1, x))).toContain('atan2(1.0, x)')
  })

  it('leaves the node-first vector forms alone', () => {
    const src = emitModule(
      module({
        funcs: [fn('p3', { v: vec3fT }, vec3fT, ({ v }) => pow(v, vec3(2, 2, 2)))],
      }),
    )
    expect(src).toContain('pow(v, vec3<f32>(2.0, 2.0, 2.0))')
  })

  it('a u32 receiver still types its own literal after the refactor', () => {
    // liftAgainst is now one implementation shared by the method and the free form; this is
    // the method half of that, which must not have moved.
    expect(
      emitModule(module({ funcs: [fn('u', { n: u32T }, u32T, ({ n }) => n.add(1))] })),
    ).toContain('(n + 1u)')
    expect(
      emitModule(module({ funcs: [fn('u2', { n: u32T }, u32T, ({ n }) => u32(7).mul(n))] })),
    ).toContain('(7u * n)')
  })
})
