// Phase 5.1: compileTsSource IR should match fn() for the same logic

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { Switch, Var, fn } from '../../core/ir/builder.js'
import { uniformStruct } from '../../core/sot.js'
import { f32, i32, vec3 } from '../../core/ir/node.js'
import { f32T, i32T, mat4x4fT, vec3fT, vec3uT, vec3f64T, typeKey } from '../../core/ir/types.js'
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
    case 'switch':
      return {
        s: 'switch',
        scrut: normalizeExpr(s.scrut),
        cases: s.cases.map((c) => ({ value: c.value, body: normalizeBody(c.body) })),
        defaultBody: s.defaultBody ? normalizeBody(s.defaultBody) : undefined,
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

  it('a let with no initializer matches EDSL Var(name, type)', () => {
    // #8 A10. `Var('x', f32T)` is the EDSL's declare-then-assign, and it builds the same
    // init-less `Stmt.var` the source language now builds.
    const tsResult = compileTsSource(`
      "use typeshade";
      export function f(a: f32): f32 {
        let x: f32;
        x = a;
        return x;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])

    const edsl = fn('f', { a: f32T }, f32T, ({ a }, bld) => {
      const x = Var('x', f32T)
      bld.assign(x, a)
      return x
    })

    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('a bitwise compound assignment matches EDSL assignOp', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function f(i: i32): i32 {
        let y: i32 = i;
        y <<= 2;
        return y;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])

    const edsl = fn('f', { i: i32T }, i32T, ({ i }, bld) => {
      const y = Var('y', i32T, i)
      // `i32(2)`, not a bare `2`: the EDSL's own literal lift gives a number f32 and does not
      // consult the target of an assignOp, while the source language types the right-hand
      // literal from the target it is assigning into. The written-out cast is what makes the
      // two sides the same IR here.
      bld.assignOp(y, '<<', i32(2))
      return y
    })

    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('a switch whose cases end in break matches EDSL Switch().case().default()', () => {
    // The trailing `break` the source language requires is dropped in lowering, so the two
    // surfaces build the same case bodies — which is the point of accepting it at all.
    const tsResult = compileTsSource(`
      "use typeshade";
      export function f(x: i32): f32 {
        let r: f32 = 0.;
        switch (x) {
          case 0: r = 1.; break;
          case 1: r = 2.; break;
          default: r = 3.;
        }
        return r;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])

    const edsl = fn('f', { x: i32T }, f32T, ({ x }) => {
      const r = Var('r', f32T, f32(0))
      // `r.assign(...)` rather than the outer builder's: a case body runs inside the switch's
      // own builder, and the outer handle would push the statement next to the switch.
      Switch(x)
        .case(0, () => {
          r.assign(f32(1))
        })
        .case(1, () => {
          r.assign(f32(2))
        })
        .default(() => {
          r.assign(f32(3))
        })
      return r
    })

    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('a type-alias struct matches the EDSL uniformStruct decl', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      type Camera = {
        view: mat4;
        pos: vec3;
      }
      declare const cam: uniform<Camera>
      export function f(): vec3 {
        return cam.pos;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = uniformStruct(
      'Camera',
      { group: 0, binding: 0, as: 'cam' },
      { view: mat4x4fT, pos: vec3fT },
    )
    expect(tsResult.structs[0]!.decl).toEqual(edsl.struct)
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
