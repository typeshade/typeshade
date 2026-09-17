// ═══ Which VALUES on screen are stand-ins, not results (docs/debugging.md §2.4) ═══
//
// §2.4 decided that milestone 2 "returns the existing stub value and marks it in the variables
// view as a stand-in rather than a computed value, so no one mistakes `0` for a result". What
// shipped first was `DebugSession.stubbedIntrinsics`, which is a run-wide list of intrinsic
// NAMES: it says `dpdx` stood in somewhere, and a variables view cannot mark anything with
// that: it does not say which of the six locals on screen is the `0` in question, and it keeps
// saying `dpdx` long after that value has been overwritten by a real one.
//
// `DebugStackFrame.stubbedLocals` is the per-value answer. It is a taint: a stub's result is
// marked, and so is anything computed from a marked value, through arithmetic, through a
// helper call, and into that helper's own parameters. Assigning a whole name something clean
// clears it.
//
// The modules here are built by hand rather than compiled, because `dpdx` is not reachable
// from `"use typeshade"` at all yet: the type map has no `texture` or `sampler` spelling and
// the derivatives are not in the callable surface (§2.4 says exactly this). `step.test.ts`
// builds its own stub module the same way and for the same reason.

import { describe, expect, it } from 'vitest'
import {
  f32T,
  i32T,
  vec2fT,
  type Expr,
  type FuncDecl,
  type ModuleDecl,
  type ShaderType,
  type Stmt,
} from '../ir/index.js'
import { startDebugSession, type DebugSession } from './session.js'
import { stampSpans } from '../testing/stamp-spans.js'

const param = (name: string, type: ShaderType = f32T): Expr => ({ op: 'param', type, name })
const ref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'varref', type, name })
const lit = (value: number, type: ShaderType = f32T): Expr => ({ op: 'lit', type, value })
const call = (fn: string, args: Expr[], type: ShaderType = f32T): Expr => ({
  op: 'call',
  type,
  fn,
  args,
})
const mul = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '*', a, b })
const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '+', a, b })

// Stamped, because a session stops only where there is a span and `dpdx` cannot be written in
// `"use typeshade"` at all, so these modules have to be hand-built. See `stamp-spans.ts`.
function module(funcs: FuncDecl[]): ModuleDecl {
  return stampSpans({ consts: [], structs: [], bindings: [], funcs })
}

function entry(body: Stmt[], params: FuncDecl['params'] = [{ name: 'x', type: f32T }]): ModuleDecl {
  return module([{ name: 'fs', params, ret: f32T, body }])
}

/** Run to the end and report the entry frame's marks at the LAST pause before it finished. */
function marksAtEnd(m: ModuleDecl): Set<string> {
  const s = startDebugSession(m, 'fs', [2], { gpuStubs: true })
  let last = new Set<string>()
  while (s.pause) {
    last = new Set(s.pause.frames[0]!.stubbedLocals)
    s.stepIn()
  }
  return last
}

/** The marks at the pause `n` steps in, innermost frame. */
function marksAfter(s: DebugSession, n: number): Set<string> {
  for (let i = 0; i < n; i++) s.stepIn()
  return new Set(s.pause!.frames[0]!.stubbedLocals)
}

describe('stubbedLocals marks the values a stub produced', () => {
  it('marks the name a stub was assigned to, and nothing else', () => {
    const m = entry([
      { s: 'let', name: 'clean', expr: add(lit(1), lit(2)) },
      { s: 'let', name: 'd', expr: call('dpdx', [param('x')]) },
      { s: 'return', expr: ref('d') },
    ])
    const s = startDebugSession(m, 'fs', [2], { gpuStubs: true })
    expect(marksAfter(s, 1)).toEqual(new Set()) // after `clean`
    expect(marksAfter(s, 1)).toEqual(new Set(['d'])) // after `d`
    // The stub really did stand in, and the value really is the placeholder zero.
    expect(s.pause!.frames[0]!.locals.get('d')).toBe(0)
    expect(s.stubbedIntrinsics).toEqual(['dpdx'])
  })

  it('carries the mark through arithmetic on a marked value', () => {
    const m = entry([
      { s: 'let', name: 'd', expr: call('dpdx', [param('x')]) },
      { s: 'let', name: 'scaled', expr: mul(ref('d'), lit(100)) },
      { s: 'let', name: 'apart', expr: mul(param('x'), lit(100)) },
      { s: 'return', expr: ref('scaled') },
    ])
    // `scaled` is 0 because `d` was, and that is the number someone would otherwise read as
    // an answer. `apart` never touched the stub and must stay unmarked, or the mark would
    // spread to the whole frame and mean nothing.
    expect(marksAtEnd(m)).toEqual(new Set(['d', 'scaled']))
  })

  it('clears the mark when the whole name is assigned something real', () => {
    const m = entry([
      { s: 'var', name: 'v', type: f32T, init: call('dpdx', [param('x')]) },
      { s: 'assign', target: ref('v'), expr: mul(param('x'), lit(3)) },
      { s: 'return', expr: ref('v') },
    ])
    // The mark describes the value being SHOWN, not the history of the run…
    expect(marksAtEnd(m)).toEqual(new Set())
    // …while `stubbedIntrinsics` is the history, and still reports the stub. Two questions.
    const s = startDebugSession(m, 'fs', [2], { gpuStubs: true })
    s.continue()
    expect(s.stubbedIntrinsics).toEqual(['dpdx'])
    expect(s.result).toBe(6)
  })

  it('keeps the mark through a compound assignment, whose old value is an input', () => {
    const m = entry([
      { s: 'var', name: 'acc', type: f32T, init: call('dpdx', [param('x')]) },
      { s: 'assignOp', target: ref('acc'), bop: '+', expr: lit(1) },
      { s: 'return', expr: ref('acc') },
    ])
    // `acc += 1.` is not a fresh value: it is the stand-in plus one, so `1` is as much a
    // fiction as `0` was.
    expect(marksAtEnd(m)).toEqual(new Set(['acc']))
  })

  it('marks the array a real value was written into at a fabricated index', () => {
    // The `1.` is a real number, but `i32(d)` decided WHICH element it landed in, and that was
    // a stand-in. The array's contents are fiction from here, so `arr` is marked even though
    // the right-hand side never touched the stub.
    const arrT = { kind: 'array', elem: f32T, n: 4 } as const
    const m = entry([
      { s: 'let', name: 'd', expr: call('dpdx', [param('x')]) },
      {
        s: 'var',
        name: 'arr',
        type: arrT,
        init: { op: 'construct', type: arrT, args: [lit(0), lit(0), lit(0), lit(0)] },
      },
      {
        s: 'assign',
        target: {
          op: 'index',
          type: f32T,
          base: ref('arr', arrT),
          idx: call('i32', [ref('d')], i32T),
        },
        expr: lit(1),
      },
      { s: 'return', expr: ref('d') },
    ])
    expect(marksAtEnd(m)).toEqual(new Set(['d', 'arr']))
  })

  it('does not mark a clean value merely because the target is a member of a clean variable', () => {
    const m = entry([
      { s: 'let', name: 'd', expr: call('dpdx', [param('x')]) },
      {
        s: 'var',
        name: 'p',
        type: vec2fT,
        init: { op: 'construct', type: vec2fT, args: [lit(1), lit(2)] },
      },
      {
        s: 'assign',
        target: { op: 'member', type: f32T, base: ref('p', vec2fT), field: 'x' },
        expr: lit(9),
      },
      { s: 'return', expr: ref('d') },
    ])
    expect(marksAtEnd(m)).toEqual(new Set(['d']))
  })

  it('marks the whole variable when one component of it is written from a stub, and keeps it', () => {
    const p = ref('p', vec2fT)
    const m = entry([
      {
        s: 'var',
        name: 'p',
        type: vec2fT,
        init: { op: 'construct', type: vec2fT, args: [lit(1), lit(2)] },
      },
      {
        s: 'assign',
        target: { op: 'member', type: f32T, base: p, field: 'x' },
        expr: call('dpdx', [param('x')]),
      },
      { s: 'assign', target: { op: 'member', type: f32T, base: p, field: 'y' }, expr: lit(7) },
      { s: 'return', expr: lit(0) },
    ])
    // Writing `y` cleanly does not make `p` clean: `x` is still the stand-in. The mark errs
    // toward saying "stand-in" about a value that has become real, never the reverse.
    expect(marksAtEnd(m)).toEqual(new Set(['p']))
  })

  it('is empty when nothing stubbed', () => {
    const m = entry([
      { s: 'let', name: 'a', expr: mul(param('x'), lit(2)) },
      { s: 'return', expr: ref('a') },
    ])
    const s = startDebugSession(m, 'fs', [2], { gpuStubs: true })
    while (s.pause) {
      expect(s.pause.frames[0]!.stubbedLocals.size).toBe(0)
      s.stepIn()
    }
    expect(s.stubbedIntrinsics).toEqual([])
    expect(s.result).toBe(4)
  })
})

describe('stubbedLocals across a call', () => {
  const HELPER: FuncDecl = {
    name: 'scale',
    params: [
      { name: 'v', type: f32T },
      { name: 'k', type: f32T },
    ],
    ret: f32T,
    body: [
      { s: 'let', name: 'out', expr: mul(param('v'), param('k')) },
      { s: 'return', expr: ref('out') },
    ],
  }

  const CALLER: Stmt[] = [
    { s: 'let', name: 'd', expr: call('dpdx', [param('x')]) },
    { s: 'let', name: 'r', expr: call('scale', [ref('d'), lit(10)]) },
    { s: 'return', expr: ref('r') },
  ]

  const m = module([
    { name: 'fs', params: [{ name: 'x', type: f32T }], ret: f32T, body: CALLER },
    HELPER,
  ])

  it('marks the callee’s parameter that was passed a marked argument, and not the other', () => {
    const s = startDebugSession(m, 'fs', [2], { gpuStubs: true })
    s.stepIn() // past `const d`
    s.stepIn() // into scale()
    const inner = s.pause!.frames[0]!
    expect(inner.fnName).toBe('scale')
    // `v` was handed the stand-in; `k` is the literal 10 and is a real number.
    expect(new Set(inner.stubbedLocals)).toEqual(new Set(['v']))
  })

  it('marks what the callee computes from it, in the callee’s own frame', () => {
    const s = startDebugSession(m, 'fs', [2], { gpuStubs: true })
    s.stepIn()
    s.stepIn()
    s.stepIn() // past `const out = v * k`
    expect(new Set(s.pause!.frames[0]!.stubbedLocals)).toEqual(new Set(['v', 'out']))
  })

  it('marks the caller’s variable holding the returned value', () => {
    const s = startDebugSession(m, 'fs', [2], { gpuStubs: true })
    let outer = new Set<string>()
    while (s.pause) {
      const f = s.pause.frames[0]!
      if (f.fnName === 'fs') outer = new Set(f.stubbedLocals)
      s.stepIn()
    }
    expect(outer).toEqual(new Set(['d', 'r']))
    expect(s.result).toBe(0)
  })

  it('reports each frame’s own marks, not the innermost frame’s', () => {
    const s = startDebugSession(m, 'fs', [2], { gpuStubs: true })
    s.stepIn()
    s.stepIn()
    const [inner, caller] = s.pause!.frames
    expect(inner!.fnName).toBe('scale')
    expect(caller!.fnName).toBe('fs')
    expect(new Set(inner!.stubbedLocals)).toEqual(new Set(['v']))
    expect(new Set(caller!.stubbedLocals)).toEqual(new Set(['d']))
  })
})
