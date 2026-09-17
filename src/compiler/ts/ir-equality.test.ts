// Phase 5.1: compileTsSource IR should match fn() for the same logic

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import { Switch, Var, constExpr, fn, overrideConst } from '../../core/ir/builder.js'
import { resource, structDecl, uniformStruct } from '../../core/sot.js'
import {
  atan2,
  constRef,
  construct,
  exp2,
  f32,
  fma,
  fwidth,
  member,
  min,
  pow,
  saturate,
  select,
  textureSample,
  toF64,
  u32,
  vec3,
} from '../../core/ir/node.js'
import {
  arrayT,
  boolT,
  f32T,
  f64T,
  i32T,
  mat4x4fT,
  samplerT,
  structT,
  texture2dArrayfT,
  u32T,
  vec2fT,
  vec3fT,
  vec3uT,
  vec3f64T,
  vec4fT,
  typeKey,
} from '../../core/ir/types.js'
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
    case 'call':
      // Without this arm the `min(i, 4)` case compared `{ op: 'call' }` to `{ op: 'call' }`
      // and passed on the merge base, where the literal is still an f32.
      return {
        op: 'call',
        type: typeKey(e.type),
        fn: e.fn,
        args: e.args.map(normalizeExpr),
      }
    case 'constref':
      // Without this arm the "same constref" case compared the tag alone, so a reference to
      // the wrong constant, or to one of the wrong type, would have passed.
      return { op: 'constref', type: typeKey(e.type), name: e.name }
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
    case 'member':
      return {
        op: 'member',
        type: typeKey(e.type),
        field: e.field,
        base: normalizeExpr(e.base),
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
    case 'select':
      return {
        op: 'select',
        type: typeKey(e.type),
        cond: normalizeExpr(e.cond),
        ifTrue: normalizeExpr(e.ifTrue),
        ifFalse: normalizeExpr(e.ifFalse),
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

  it('a component assignment matches the EDSL v.x.assign(a)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function paint(a: f32): vec3 {
        let v = vec3(0., 0., 0.);
        v.x = a;
        return v;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('paint', { a: f32T }, vec3fT, ({ a }, bld) => {
      const v = bld.var('v', vec3fT, vec3(0, 0, 0))
      v.x.assign(a)
      return v
    })
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('a struct-field assignment matches the EDSL o.a.assign(x)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      class P {
        a: f32
      }
      export function put(p: P, x: f32): f32 {
        let o: P = p;
        o.a = x;
        return o.a;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const P = structT('P')
    const edsl = fn('put', { p: P, x: f32T }, f32T, ({ p, x }, bld) => {
      const o = bld.var('o', P, p)
      member(o, 'a', f32T).assign(x)
      return member(o, 'a', f32T)
    })
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
      // `u32(2)`, not a bare `2` and not `i32(2)`: the EDSL's own literal lift gives a number
      // f32 and does not consult the target of an assignOp, while the source language types a
      // SHIFT amount as u32 whatever the target is, which is WGSL's only scalar overload. The
      // written-out cast is what makes the two sides the same IR here.
      bld.assignOp(y, '<<', u32(2))
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

  it('a texture sample matches the EDSL textureSample', () => {
    // #8 A7. The neutral id is chosen from the texture's own dim on both surfaces, so an
    // array sample is `textureSampleArray` either way — that is the seam this pins.
    const tsResult = compileTsSource(`
      "use typeshade";
      declare const atlas: texture_2d_array<f32>
      declare const smp: sampler
      export function sample(uv: vec2): vec4 {
        return textureSample(atlas, smp, uv, 1);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])

    const atlas = resource('atlas', texture2dArrayfT, { group: 0, binding: 0 })
    const smp = resource('smp', samplerT, { group: 0, binding: 1 })
    const edsl = fn('sample', { uv: vec2fT }, vec4fT, ({ uv }) =>
      textureSample(atlas.node, smp.node, uv, 1),
    )

    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('an override read matches the EDSL overrideConst handle', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      const quality: override<f32> = 0.5
      export function q(): f32 {
        return quality;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])

    const quality = overrideConst('quality', f32T, 0.5)
    const edsl = fn('q', {}, f32T, () => quality.node)

    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('select(f, t, c) matches the EDSL select(c, t, f)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function pick(a: f32, b: f32, c: bool): f32 {
        return select(a, b, c);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('pick', { a: f32T, b: f32T, c: boolT }, f32T, ({ a, b, c }) => select(c, b, a))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('saturate(x) matches the EDSL saturate(x)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function clampUnit(x: f32): f32 {
        return saturate(x);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('clampUnit', { x: f32T }, f32T, ({ x }) => saturate(x))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('f64(x) matches the EDSL toF64(x)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function widen(x: f32): f64 {
        return f64(x);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('widen', { x: f32T }, f64T, ({ x }) => toF64(x))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('a ** b matches the EDSL pow(a, b)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function square(x: f32): f32 {
        return x ** x;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('square', { x: f32T }, f32T, ({ x }) => pow(x, x))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('atan(y, x) matches the EDSL atan2(y, x), in that order', () => {
    // Distinct arguments on purpose: atan2(y, x) and atan2(x, y) differ, and a scalar eval of
    // equal arguments could not tell them apart. This is the one place an argument-order
    // mistake in the remap would be invisible.
    const tsResult = compileTsSource(`
      "use typeshade";
      export function angle(y: f32, x: f32): f32 {
        return atan(y, x);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('angle', { y: f32T, x: f32T }, f32T, ({ y, x }) => atan2(y, x))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('exp2(x) matches the EDSL exp2(x)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 {
        return exp2(x);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    assertSameCore(
      tsResult.funcs[0]!,
      fn('f', { x: f32T }, f32T, ({ x }) => exp2(x)),
    )
  })

  it('fwidth(x), a derivative, matches the EDSL fwidth(x)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function f(x: f32): f32 {
        return fwidth(x);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    assertSameCore(
      tsResult.funcs[0]!,
      fn('f', { x: f32T }, f32T, ({ x }) => fwidth(x)),
    )
  })

  it('fma(a, b, c) matches the EDSL fma with the same argument order', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function f(a: f32, b: f32, c: f32): f32 {
        return fma(a, b, c);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('f', { a: f32T, b: f32T, c: f32T }, f32T, ({ a, b, c }) => fma(a, b, c))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('a bare integer literal in a u32 return matches the EDSL u32(0)', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function zero(): u32 {
        return 0;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('zero', {}, u32T, () => u32(0))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('min(i, 4) matches the EDSL min(i, u32(4)) rather than an f32 literal', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      export function cap(i: u32): u32 {
        return min(i, 4);
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = fn('cap', { i: u32T }, u32T, ({ i }) => min(i, u32(4)))
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('a module vector const matches the EDSL constExpr declaration', () => {
    const tsResult = compileTsSource(`
      "use typeshade";
      const UP = vec3(0., 1., 0.)
      export function up(): vec3 {
        return UP;
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const edsl = constExpr('UP', vec3fT, vec3(0, 1, 0))
    expect(tsResult.consts[0]).toEqual(edsl)
    // …and the read is the same constref the EDSL's `.node` is.
    const stmt = tsResult.funcs[0]!.body[0]!
    if (stmt.s !== 'return' || !stmt.expr) throw new Error('expected a return')
    expect(normalizeExpr(stmt.expr)).toEqual(normalizeExpr(constRef('UP', vec3fT).expr))
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

  it('a list initializer matches the EDSL construct over an array type', () => {
    // #8 A16. `[1., 2., 3.]` is the same construct the `array<f32, 3>(...)` call builds, which
    // is the same one the EDSL's `construct(arrayT(f32T, 3), …)` builds.
    const tsResult = compileTsSource(`
      "use typeshade";
      export function head(): f32 {
        const xs: array<f32, 3> = [1., 2., 3.];
        return xs[0];
      }
    `)
    expect(tsResult.diagnostics).toEqual([])
    const A = arrayT(f32T, 3)
    const edsl = fn('head', {}, f32T, (_, bld) => {
      const xs = bld.let('xs', construct(A, [f32(1), f32(2), f32(3)]))
      return xs.at(0)
    })
    assertSameCore(tsResult.funcs[0]!, edsl)
  })

  it('an object literal in a declared return matches the EDSL struct construct', () => {
    // #8 A11. Two structs share a shape here, so name matching cannot answer and only the
    // declared return type can — which is what makes the two surfaces build the same node.
    const tsResult = compileTsSource(`
      "use typeshade";
      class P {
        a: f32
        b: f32
      }
      class Q {
        a: f32
        b: f32
      }
      export function mk(): Q {
        return { a: 1., b: 2. };
      }
    `)
    expect(tsResult.diagnostics).toEqual([])

    // `structDecl`, not `ioStruct`: the source-side struct here carries no attributes, and the
    // return type is INFERRED from the construct, which is how the EDSL spells a
    // struct-returning function (the handle is not a ShaderType token).
    const Q = structDecl('Q', { a: f32T, b: f32T })
    const edsl = fn('mk', {}, () => Q.construct({ a: f32(1), b: f32(2) }))

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
