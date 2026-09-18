// The effect table (passes/effects.ts) and the optimizer's use of it (#47). The one arm that
// matters most is the fixpoint's: it optimizes each function in a module holding that function
// alone, so without the table riding along, `store(gid.x);` in `main_k` was a call to a
// function the pass could not see, taken for pure, and dropped. Measured before the fix: the
// emitted `main_k` body was empty.

import { describe, expect, it } from 'vitest'
import { compile } from '../../compiler/ts/compile.js'
import { bodyHasEffectfulCall, exprHasEffect, fnWrites, inheritEffects } from './effects.js'
import { fixpoint, optimizeAt } from './opt/optimize.js'
import { dce } from './opt/dce.js'
import type { ModuleDecl } from '../ir/nodes.js'

const SRC = `"use typeshade"
declare let dst: storage<array<f32>>
function pure(x: f32): f32 {
  return x * 2.
}
function store(i: u32): void {
  dst[i] = 1.
}
function viaStore(i: u32): f32 {
  store(i)
  return 3.
}
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  viaStore(gid.x)
  pure(1.)
}
`

const bodyOf = (m: ModuleDecl, name: string) => m.funcs.find((f) => f.name === name)!.body

describe('the effect table', () => {
  it('names the binding each function writes, through the functions it calls', () => {
    const m = compile(SRC).module
    const w = fnWrites(m)
    expect([...w.get('pure')!]).toEqual([])
    expect([...w.get('store')!]).toEqual(['dst'])
    expect([...w.get('viaStore')!]).toEqual(['dst'])
    expect([...w.get('main_k')!]).toEqual(['dst'])
  })

  it('tells an effectful call from a pure one', () => {
    const m = compile(SRC).module
    const w = fnWrites(m)
    const [viaStore, pure] = bodyOf(m, 'main_k')
    expect(viaStore!.s).toBe('call')
    expect(pure!.s).toBe('call')
    if (viaStore!.s !== 'call' || pure!.s !== 'call')
      throw new Error('expected two call statements')
    expect(exprHasEffect(viaStore!.expr, w)).toBe(true)
    expect(exprHasEffect(pure!.expr, w)).toBe(false)
    expect(bodyHasEffectfulCall(bodyOf(m, 'main_k'), w)).toBe(true)
    expect(bodyHasEffectfulCall(bodyOf(m, 'pure'), w)).toBe(false)
  })

  it('is handed to a view of the module and not recomputed from it', () => {
    const m = compile(SRC).module
    const table = fnWrites(m)
    const view: ModuleDecl = { ...m, funcs: [m.funcs.find((f) => f.name === 'main_k')!] }
    inheritEffects(m, view)
    expect(fnWrites(view)).toBe(table)
    // A view nobody handed the table to computes its own, and from one function it can only
    // see the call, not the callee: this is the mistake the hand-over exists to prevent.
    const orphan: ModuleDecl = { ...m, funcs: [m.funcs.find((f) => f.name === 'main_k')!] }
    expect([...fnWrites(orphan).get('main_k')!]).toEqual([])
  })
})

describe('the optimizer with the effect table', () => {
  it('dce keeps the effectful call statement and drops the pure one', () => {
    const m = compile(SRC).module
    const out = bodyOf(dce(m), 'main_k')
    expect(out).toHaveLength(1)
    expect(out[0]!.s === 'call' && out[0]!.expr.op === 'call' && out[0]!.expr.fn).toBe('viaStore')
  })

  it('the per-function fixpoint still sees what a helper writes', () => {
    const m = compile(SRC).module
    for (const out of [fixpoint(m), optimizeAt(m, 'O2'), optimizeAt(m, 'O1')]) {
      const body = bodyOf(out, 'main_k')
      expect(body).toHaveLength(1)
      expect(body[0]!.s === 'call' && body[0]!.expr.op === 'call' && body[0]!.expr.fn).toBe(
        'viaStore',
      )
    }
  })
})
