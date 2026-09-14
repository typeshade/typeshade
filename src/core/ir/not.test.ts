import { describe, it, expect } from 'vitest'
import { fn, module, If, Discard, bool, boolT, f32, f32T, vec4fT, vec4 } from './index.js'
import { emitModule } from '../backends/wgsl.js'
import { compileModule } from '../oracle.js'

// ═══ #8 B7 — .not() ═══
//
// `.and` and `.or` could say every boolean expression except the simplest one. The node `.not`
// builds is `this == false`, which is exactly what the `"use typeshade"` compiler lowers a
// source-level `!a` to (`lower/expression.ts` lowerPrefixUnary) — so a helper moved between
// the two authoring surfaces keeps its emit, rather than meeting in two different IRs.

describe('#8 B7 — .not()', () => {
  it('builds the node the surface-A `!a` lowers to', () => {
    const g = fn('g', { b: boolT }, boolT, ({ b }) => b.not())
    const e = g.decl.body[0]
    expect(e).toMatchObject({
      s: 'return',
      expr: { op: 'compare', cop: '==', b: { op: 'lit', value: false } },
    })
    expect(emitModule(module({ funcs: [g] }))).toContain('return (b == false);')
  })

  it('emits what the explicit eq(bool(false)) spelling emits', () => {
    const short = emitModule(module({ funcs: [fn('g', { b: boolT }, boolT, ({ b }) => b.not())] }))
    const long = emitModule(
      module({ funcs: [fn('g', { b: boolT }, boolT, ({ b }) => b.eq(bool(false)))] }),
    )
    expect(short).toBe(long)
  })

  it('evaluates as negation on the CPU oracle', () => {
    const m = module({ funcs: [fn('g', { b: boolT }, boolT, ({ b }) => b.not())] })
    const cpu = compileModule(m)
    expect(cpu.fns.g!(true)).toBe(false)
    expect(cpu.fns.g!(false)).toBe(true)
  })

  it('reads as a guard, which is what it is for', () => {
    const fs = fn(
      'fs',
      { keep: boolT },
      vec4fT,
      ({ keep }) => {
        If(keep.not(), () => {
          Discard()
        })
        return vec4(1, 1, 1, 1)
      },
      { stage: 'fragment' },
    )
    const src = emitModule(module({ funcs: [fs] }))
    expect(src).toContain('if ((keep == false))')
    expect(src).toContain('discard;')
  })

  it('chains with .and and .or', () => {
    const g = fn('g', { a: boolT, b: boolT }, boolT, ({ a, b }) => a.not().and(b))
    expect(emitModule(module({ funcs: [g] }))).toContain('((a == false) && b)')
  })

  it('is a tsc error on a non-bool receiver, and throws when the bound is bypassed', () => {
    const x = f32(1)
    // @ts-expect-error — #8 B7: the `this:` bound admits a bool receiver only, the same bound
    // `.select()` carries. A widened `ReadonlyNode<string>` does not satisfy it either.
    expect(() => x.not()).toThrow(/SD0004[\s\S]*f32/)
    // Reached only from untyped (JavaScript) code or a cast, which is what the throw is for.
    const bypassed = f32(1) as unknown as { not: () => unknown }
    expect(() => bypassed.not()).toThrow(/SD0004/)
  })

  it('does not disturb the existing comparison surface', () => {
    const g = fn('g', { x: f32T }, boolT, ({ x }) => x.gt(0))
    expect(emitModule(module({ funcs: [g] }))).toContain('return (x > 0.0);')
  })
})
