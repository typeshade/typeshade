import { describe, expect, it } from 'vitest'
import { evalEntry } from './eval-entry.js'
import { vec4fT, u32T, f32T, boolT, structT } from '../../core/ir/types.js'
import type { Expr, ModuleDecl } from '../../core/ir/nodes.js'

const f = (n: number): Expr => ({ op: 'lit', type: f32T, value: n })
const u = (n: number): Expr => ({ op: 'lit', type: u32T, value: n })
const v4 = (x: Expr, y: Expr): Expr => ({
  op: 'construct',
  type: vec4fT,
  args: [x, y, f(0), f(1)],
})

function eq(i: Expr, n: number): Expr {
  return { op: 'compare', type: boolT, cop: '==', a: i, b: u(n) }
}

function sel(iff: Expr, ift: Expr, cond: Expr): Expr {
  return { op: 'select', type: f32T, cond, ifTrue: ift, ifFalse: iff }
}

function triangle(): ModuleDecl {
  const i: Expr = { op: 'param', type: u32T, name: 'i' }
  const x = sel(sel(f(-0.8), f(0.8), eq(i, 1)), f(0), eq(i, 2))
  const y = sel(f(-0.8), f(0.8), eq(i, 2))
  return {
    consts: [],
    structs: [
      { name: 'Clip', fields: [{ name: 'pos', type: vec4fT, attr: '@builtin(position)', builtin: 'position' }] },
    ],
    bindings: [],
    funcs: [
      {
        name: 'vs',
        params: [{ name: 'i', type: u32T, builtin: 'vertex_index' }],
        ret: structT('Clip'),
        body: [{ s: 'return', expr: { op: 'construct', type: structT('Clip'), args: [v4(x, y)] } }],
        stage: 'vertex',
        attrs: ['@vertex'],
      },
    ],
  }
}

describe('triangle three clip points', () => {
  it('eval vs(0|1|2) are three distinct clip positions', () => {
    const p0 = (evalEntry(triangle(), 'vs', [0]) as { pos: number[] }).pos
    const p1 = (evalEntry(triangle(), 'vs', [1]) as { pos: number[] }).pos
    const p2 = (evalEntry(triangle(), 'vs', [2]) as { pos: number[] }).pos
    expect(p0).toEqual([-0.8, -0.8, 0, 1])
    expect(p1).toEqual([0.8, -0.8, 0, 1])
    expect(p2).toEqual([0, 0.8, 0, 1])
  })
})
