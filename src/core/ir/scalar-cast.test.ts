import { describe, it, expect } from 'vitest'
import {
  fn,
  module,
  f32,
  i32,
  u32,
  f64,
  toF32,
  toI32,
  toU32,
  toF64,
  vec3,
  bool,
  f32T,
  u32T,
  i32T,
  f64T,
  boolT,
  vec3fT,
  type Node,
} from './index.js'
import { emitModule } from '../backends/wgsl.js'
import { compileModule } from '../oracle.js'

// ═══ #8 S1 — the cast, spelled the way it is read ═══
//
// Two complaints, one node. `f32(i)` is what WGSL writes and what the `"use typeshade"`
// surface accepts; on this surface it was a TypeError, and the cast was `toF32(i)`. And a cast
// in the middle of a chain forced the whole chain inside out:
// `toF32(vi.bitAnd(u32(1))).mul(4).sub(1)` is read from the middle, `vi.bitAnd(1).f32().mul(4)
// .sub(1)` from the left. Every spelling builds the one `call` node the `to*` functions build.

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const emit = (m: ReturnType<typeof module>): string => emitModule(m)

describe('#8 S1 — f32/i32/u32/f64 as casts', () => {
  it('f32(node) emits what toF32(node) emits', () => {
    const a = emit(module({ funcs: [fn('g', { n: u32T }, f32T, ({ n }) => f32(n))] }))
    const b = emit(module({ funcs: [fn('g', { n: u32T }, f32T, ({ n }) => toF32(n))] }))
    expect(a).toBe(b)
    expect(a).toContain('return f32(n);')
  })

  it('i32, u32 and f64 do the same', () => {
    const pairs: Array<[string, string]> = [
      [
        emit(module({ funcs: [fn('g', { x: f32T }, i32T, ({ x }) => i32(x))] })),
        emit(module({ funcs: [fn('g', { x: f32T }, i32T, ({ x }) => toI32(x))] })),
      ],
      [
        emit(module({ funcs: [fn('g', { x: f32T }, u32T, ({ x }) => u32(x))] })),
        emit(module({ funcs: [fn('g', { x: f32T }, u32T, ({ x }) => toU32(x))] })),
      ],
      [
        emit(module({ funcs: [fn('g', { x: f32T }, f64T, ({ x }) => f64(x))] })),
        emit(module({ funcs: [fn('g', { x: f32T }, f64T, ({ x }) => toF64(x))] })),
      ],
    ]
    for (const [short, long] of pairs) expect(short).toBe(long)
  })

  it('keeps the literal meaning of a number argument', () => {
    const src = emit(module({ funcs: [fn('g', {}, f32T, () => f32(0.5))] }))
    expect(src).toContain('return 0.5;')
    expect(emit(module({ funcs: [fn('h', {}, u32T, () => u32(7))] }))).toContain('return 7u;')
  })

  it('casts a bool, which WGSL reads as 1.0 / 0.0', () => {
    const m = module({ funcs: [fn('g', { b: boolT }, f32T, ({ b }) => f32(b))] })
    expect(emit(m)).toContain('return f32(b);')
    expect(compileModule(m).fns.g!(true)).toBe(1)
  })

  it('rejects a vector operand — the hole both surfaces had', () => {
    // @ts-expect-error — #8 S1: the cast operand is bounded to a scalar key.
    expect(() => f32(vec3(1, 2, 3))).toThrow(/SD0116[\s\S]*vec3<f32>/)
  })

  it('turns away a value that is neither a number nor a node', () => {
    // @ts-expect-error — not a number and not a node: nothing to lift or convert.
    expect(() => f32('0.5')).toThrow(/takes a numeric literal or a scalar Node/)
  })
})

describe('#8 S1 — .f32() / .i32() / .u32() / .f64() methods', () => {
  it('read left to right where the free function reads inside out', () => {
    const chained = emit(
      module({
        funcs: [fn('g', { vi: u32T }, f32T, ({ vi }) => vi.bitAnd(1).f32().mul(4).sub(1))],
      }),
    )
    const nested = emit(
      module({
        funcs: [
          fn('g', { vi: u32T }, f32T, ({ vi }) =>
            toF32(vi.bitAnd(u32(1)))
              .mul(4)
              .sub(1),
          ),
        ],
      }),
    )
    expect(chained).toBe(nested)
    expect(chained).toContain('((f32((vi & 1u)) * 4.0) - 1.0)')
  })

  it('each method carries the key its cast produces', () => {
    fn('g', { x: f32T }, f32T, ({ x }) => {
      const _i: Exact<ReturnType<typeof x.i32>, Node<'i32'>> = true
      const _u: Exact<ReturnType<typeof x.u32>, Node<'u32'>> = true
      const _d: Exact<ReturnType<typeof x.f64>, Node<'f64'>> = true
      expect([_i, _u, _d]).toEqual([true, true, true])
      return x
    })
  })

  it('evaluates as the conversion on the CPU oracle', () => {
    const m = module({ funcs: [fn('g', { x: f32T }, i32T, ({ x }) => x.i32())] })
    expect(compileModule(m).fns.g!(3.7)).toBe(3)
  })

  it('is a tsc error on a vector receiver, and throws when the bound is bypassed', () => {
    const v = vec3(1, 2, 3)
    // @ts-expect-error — #8 S1: NonComposite maps a vec key to never, as it does for .lt/.gt.
    expect(() => v.f32()).toThrow(/SD0116[\s\S]*vec3<f32>/)
    const bypassed = vec3(1, 2, 3) as unknown as { u32: () => unknown }
    expect(() => bypassed.u32()).toThrow(/SD0116/)
  })

  it('leaves the to* aliases in place, widened operand included', () => {
    // The free functions keep their `ReadonlyNode<string>` domain: narrowing them would retype
    // helper code that takes an unparameterised node, which this change does not do.
    const g = fn('g', { p: vec3fT }, f32T, ({ p }) => toF32(p.x))
    expect(emit(module({ funcs: [g] }))).toContain('f32(p.x)')
    expect(bool(true).expr).toMatchObject({ op: 'lit', value: true })
  })
})
