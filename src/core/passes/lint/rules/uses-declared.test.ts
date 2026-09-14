import { describe, it, expect } from 'vitest'
import { lintModule } from '../../validate.js'
import { validate } from '../../validate.js'
import {
  module,
  fn,
  Var,
  Let,
  If,
  Return,
  f32,
  f32T,
  u32T,
  vec4fT,
  vec4,
} from '../../../ir/index.js'
import { uniformStruct, storageBuffer } from '../../../sot.js'
import { emitModule } from '../../../backends/wgsl.js'

// ═══ #8 B4 — the handle left out of `uses:` ═══
//
// `module({ funcs: [fs] })` assembles what it is handed. A fs reading `U.field.time` with `U`
// absent from `uses:` emits no `var<uniform>`, and the first report of it is the driver at
// pipeline creation. Everything up to there — tsc, validate, both writers — is green.

const ids = (m: ReturnType<typeof module>): string[] =>
  lintModule(m)
    .filter((d) => d.ruleId === 'uses-declared')
    .map((d) => d.message)

describe('#8 B4 — uses-declared', () => {
  const U = uniformStruct('Globals', { group: 0, binding: 0, as: 'globals' }, { time: f32T })

  it('reports a uniform read by a fn the module does not declare', () => {
    const m = module({
      funcs: [fn('fs', {}, vec4fT, () => vec4(U.field.time, 0, 0, 1), { stage: 'fragment' })],
    })
    expect(ids(m)).toHaveLength(1)
    expect(ids(m)[0]).toContain("reads 'globals'")
    expect(ids(m)[0]).toContain('module({ uses: [...] })')
  })

  it('is what the module is missing — the emit really has no declaration', () => {
    const m = module({
      funcs: [fn('fs', {}, vec4fT, () => vec4(U.field.time, 0, 0, 1), { stage: 'fragment' })],
    })
    // The evidence the diagnostic is about, not a style opinion: `globals` is read and never
    // declared, which is not a WGSL module.
    expect(emitModule(m)).toContain('globals.time')
    expect(emitModule(m)).not.toContain('var<uniform>')
  })

  it('says nothing once the handle is in uses', () => {
    const m = module({
      uses: [U],
      funcs: [fn('fs', {}, vec4fT, () => vec4(U.field.time, 0, 0, 1), { stage: 'fragment' })],
    })
    expect(ids(m)).toEqual([])
    expect(emitModule(m)).toContain('var<uniform> globals')
  })

  it('covers a storage buffer the same way', () => {
    const xs = storageBuffer('xs', f32T, { group: 0, binding: 1, access: 'read' })
    const body = fn('g', { i: u32T }, f32T, ({ i }) => xs.at(i))
    expect(ids(module({ funcs: [body] }))[0]).toContain("reads 'xs'")
    expect(ids(module({ uses: [xs], funcs: [body] }))).toEqual([])
  })

  it('never reports a local, a param or a loop counter', () => {
    const m = module({
      funcs: [
        fn('locals', { x: f32T }, f32T, ({ x }) => {
          const a = Let('a', x.mul(2))
          const v = Var('v', f32(0))
          v.assign(v.add(a))
          return v
        }),
      ],
    })
    expect(ids(m)).toEqual([])
  })

  it('reports each unresolved name once per function, not once per read', () => {
    const m = module({
      funcs: [
        fn('fs', {}, vec4fT, () => vec4(U.field.time, U.field.time, U.field.time, 1), {
          stage: 'fragment',
        }),
      ],
    })
    expect(ids(m)).toHaveLength(1)
  })

  it('stays out of the emit-time ruleset — validate() still passes', () => {
    // `passes/validate.ts`'s charter: a composer injects names as raw target text, and no name
    // rule can tell that from a typo. So the diagnostic is reported by lintModule/diagnose and
    // never throws at emit. If this ever flips, it is a deliberate decision, not a drift.
    const m = module({
      funcs: [fn('fs', {}, vec4fT, () => vec4(U.field.time, 0, 0, 1), { stage: 'fragment' })],
    })
    expect(() => validate(m)).not.toThrow()
    expect(() => emitModule(m)).not.toThrow()
  })

  it('skips a function holding a raw statement — raw text can declare anything', () => {
    const m = module({
      funcs: [
        fn(
          'r',
          {},
          f32T,
          (_p, b) => {
            b.raw({ wgsl: 'let injected: f32 = 1.0;', glsl: 'float injected = 1.0;' })
            If(f32(1).gt(0), () => {
              Return(f32(0))
            })
            Return(f32(0))
          },
          { allowEarlyReturn: true },
        ),
      ],
    })
    expect(ids(m)).toEqual([])
  })
})
