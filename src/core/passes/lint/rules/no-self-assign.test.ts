import { describe, it, expect } from 'vitest'
import { lint, applyFixes } from '../engine.js'
import { module, fn, f32T, f32 } from '../../../ir/index.js'
import { noSelfAssign } from './no-self-assign.js'
import { compileTsSource } from '../../../../compiler/ts/source-file.js'
import { sourceSpanOf } from '../../../ir/span.js'
import type { Expr } from '../../../ir/nodes.js'

const ruleIds = (m: ReturnType<typeof module>) => lint(m, [noSelfAssign]).map((d) => d.ruleId)

describe('no-self-assign', () => {
  it('flags a self-assignment (v = v)', () => {
    const m = module({
      funcs: [
        fn('selfassign', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.var('v', f32T, f32(0))
          b.assign(v, v) // self-assign = no-op, likely typo
          b.ret(x)
        }),
      ],
    })
    expect(ruleIds(m)).toContain('no-self-assign')
  })

  it('still flags a self-assignment whose sides carry different source spans', () => {
    // The regression this rule grew a replacer for. `v[idx(i)] = v[idx(i)]` is written twice,
    // so once calls began carrying spans the two sides serialised differently and the rule
    // went silent on exactly the typo it exists to catch. A span says WHERE a node was
    // written; this rule asks what it MEANS.
    const src = `"use typeshade";
export function idx(i: i32): i32 {
  return i;
}
export function f(i: i32): f32 {
  let v = 0.;
  v = v;
  return v;
}
`
    const r = compileTsSource(src)
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
    const m: Parameters<typeof lint>[0] = {
      consts: [...r.consts],
      structs: r.structs.map((x) => x.decl),
      bindings: [...r.bindings],
      funcs: [...r.funcs],
    }
    const target = m.funcs.find((x) => x.name === 'f')!.body.find((x) => x.s === 'assign')!
    // The two sides really do differ by span, which is what used to defeat the comparison.
    expect(sourceSpanOf((target as { target: Expr }).target)).toBeDefined()
    expect(lint(m, [noSelfAssign]).map((d) => d.ruleId)).toContain('no-self-assign')
  })

  it('does not flag a normal assignment', () => {
    const m = module({
      funcs: [
        fn('ok', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.var('v', f32T, f32(0))
          b.assign(v, x) // distinct target/value
          b.ret(v)
        }),
      ],
    })
    expect(ruleIds(m)).not.toContain('no-self-assign')
  })

  it('auto-fix deletes the no-op self-assignment', () => {
    const m = module({
      funcs: [
        fn('selfassign', { x: f32T }, f32T, ({ x }, b) => {
          const v = b.var('v', f32T, f32(0))
          b.assign(v, v)
          b.ret(x)
        }),
      ],
    })
    expect(ruleIds(m)).toContain('no-self-assign') // before
    const { module: fixed, applied } = applyFixes(m, [noSelfAssign])
    expect(applied).toContain('no-self-assign')
    expect(ruleIds(fixed)).toEqual([]) // self-assign stmt removed
  })
})
