// Phase 5.1: compileTsSource IR should match fn() for the same logic

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { fn } from '../../core/ir/builder.js'
import { f32, vec3 } from '../../core/ir/node.js'
import { f32T, vec3fT, vec3uT, vec3f64T, typeKey } from '../../core/ir/types.js'
import type { FuncDecl, Stmt, Expr } from '../../core/ir/nodes.js'

function assertSameCore(a: FuncDecl, b: FuncDecl): void {
  expect(a.name).toBe(b.name)
  expect(a.params.map((p) => ({ name: p.name, type: typeKey(p.type) }))).toEqual(
    b.params.map((p) => ({ name: p.name, type: typeKey(p.type) })),
  )
  expect(typeKey(a.ret)).toBe(typeKey(b.ret))
  expect(normalizeBody(a.body)).toEqual(normalizeBody(b.body))
}

function normalizeBody(stmts: readonly Stmt[]): unknown {
  return stmts.map(normalizeStmt)
}

function normalizeStmt(s: Stmt): unknown {
  switch (s.s) {
    case 'let':
      return { s: 'let', name: s.name, expr: normalizeExpr(s.expr) }
    case 'var':
      return {
        s: 'var',
        name: s.name,
        type: typeKey(s.type),
        init: s.init ? normalizeExpr(s.init) : undefined,
      }
    case 'return':
      return { s: 'return', expr: s.expr ? normalizeExpr(s.expr) : undefined }
    case 'assign':
      return { s: 'assign', target: normalizeExpr(s.target), expr: normalizeExpr(s.expr) }
    case 'assignOp':
      return {
        s: 'assignOp',
        target: normalizeExpr(s.target),
        bop: s.bop,
        expr: normalizeExpr(s.expr),
      }
    case 'if':
      return {
        s: 'if',
        arms: s.arms.map((arm) => ({
          cond: normalizeExpr(arm.cond),
          body: normalizeBody(arm.body),
        })),
        elseBody: s.elseBody ? normalizeBody(s.elseBody) : undefined,
      }
    default:
      return { s: s.s }
  }
}

function normalizeExpr(e: Expr): unknown {
  switch (e.op) {
    case 'lit':
      return { op: 'lit', type: typeKey(e.type), value: e.value }
    case 'param':
      return { op: 'param', type: typeKey(e.type), name: e.name }
    case 'varref':
      return { op: 'varref', type: typeKey(e.type), name: e.name }
    case 'construct':
      return { op: 'construct', type: typeKey(e.type), args: e.args.map(normalizeExpr) }
    case 'binop':
      return {
        op: 'binop',
        type: typeKey(e.type),
        bop: e.bop,
        a: normalizeExpr(e.a),
        b: normalizeExpr(e.b),
      }
    case 'unop':
      return { op: 'unop', type: typeKey(e.type), a: normalizeExpr(e.a) }
    case 'compare':
      return {
        op: 'compare',
        type: typeKey(e.type),
        cop: e.cop,
        a: normalizeExpr(e.a),
        b: normalizeExpr(e.b),
      }
    case 'logical':
      return {
        op: 'logical',
        type: typeKey(e.type),
        lop: e.lop,
        a: normalizeExpr(e.a),
        b: normalizeExpr(e.b),
      }
    default:
      return { op: e.op }
  }
}

describe('IR equality: use typeshade vs fn()', () => {
  it('transform matches EDSL fn()', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function transform(a: f32, b: f32): f32 {
        const x = a + b;
        return x * 2;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    expect(tsResult.funcs).toHaveLength(1)

    const edsl = fn('transform', { a: f32T, b: f32T }, f32T, ({ a, b }, bld) => {
      const x = bld.let('x', a.add(b))
      return x.mul(f32(2))
    })

    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('add matches EDSL fn()', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function add(a: f32, b: f32): f32 {
        return a + b;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('add', { a: f32T, b: f32T }, f32T, ({ a, b }) => a.add(b))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('vector times scalar matches EDSL v.mul(s)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function scale(v: vec3, s: f32): vec3 {
        return v * s;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('scale', { v: vec3fT, s: f32T }, vec3fT, ({ v, s }) => v.mul(s))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('scalar minus vector matches the EDSL scalar-left s.sub(v)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function flip(v: vec3, s: f32): vec3 {
        return s - v;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('flip', { v: vec3fT, s: f32T }, vec3fT, ({ v, s }) => s.sub(v))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('vec64 times a literal matches EDSL v.mul(0.1) with an f64 literal', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function scale(v: vec3f64): vec3f64 {
        return v * 0.1;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('scale', { v: vec3f64T }, vec3f64T, ({ v }) => v.mul(0.1))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('vec3f(v) matches the EDSL vec3(v) element-converting constructor', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function widen(v: vec3u): vec3 {
        return vec3f(v);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('widen', { v: vec3uT }, vec3fT, ({ v }) => vec3(v))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('identity return matches EDSL fn()', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function id(x: f32): f32 {
        return x;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('id', { x: f32T }, f32T, ({ x }) => x)
    assertSameCore(tsResult.funcs[0]!, edsl)
  })
})
