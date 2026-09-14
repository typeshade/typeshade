// ═══ Every lowered statement knows the source it came from (docs/debugging.md §3) ═══
//
// The claim this file holds: every IR statement the `"use typeshade"` compiler produces
// carries a `SourceSpan`, the span covers the text the author actually wrote, and the spans
// survive the passes that rebuild nodes — which is what a debugger needs before it can stop
// on a line. It also pins the three honest `undefined`s (an EDSL-authored node, a
// pass-synthesised node, an expression that is not a call), because a span that is sometimes
// invented would be worse than one that is sometimes absent.

import { describe, expect, it } from 'vitest'
import { compileTsSource } from './source-file.js'
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../../core/ir/nodes.js'
import { sourceSpanOf, type SourceSpan } from '../../core/ir/span.js'
import { autoVars } from '../../core/passes/opt/index.js'
import { fixpoint, irEqual, optimizeAt } from '../../core/passes/opt/optimize.js'
import { mapChildren, mapStmtExpr } from '../../core/ir/visit.js'
import { mapStmt } from '../../core/passes/opt/ir-transform.js'
import { stripSpans } from '../../core/testing/strip-spans.js'
import { fn, Var, f32, f32T } from '../../core/ir/index.js'

/** One source exercising every statement kind the source language can produce. */
const SRC = `"use typeshade"

export function helper(x: f32): f32 {
  return x * 2.
}

export function shapes(n: i32): f32 {
  const base = 1.
  let acc = 0.
  acc = base
  acc += helper(base)
  if (n > 0) {
    acc = acc + 1.
  } else {
    acc = acc - 1.
  }
  for (let i: i32 = 0; i < 4; i++) {
    if (i === 2) {
      continue
    }
    if (i === 3) {
      break
    }
    acc += 1.
  }
  let w: i32 = 0
  while (w < 4) {
    w = w + 1
  }
  switch (n) {
    case 0:
      acc = 0.
    default:
      acc = acc * 1.
  }
  return acc
}
`

function compiled(source = SRC): { module: ModuleDecl; text: string } {
  const r = compileTsSource(source)
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([])
  return {
    module: {
      consts: [...r.consts],
      structs: r.structs.map((s) => s.decl),
      bindings: [...r.bindings],
      funcs: [...r.funcs],
    },
    text: source,
  }
}

/** Every statement in a body, innermost bodies included, in source order. */
function allStatements(body: readonly Stmt[]): Stmt[] {
  const out: Stmt[] = []
  const walk = (list: readonly Stmt[]): void => {
    for (const s of list) {
      out.push(s)
      if (s.s === 'if') {
        for (const arm of s.arms) walk(arm.body)
        if (s.elseBody) walk(s.elseBody)
      } else if (s.s === 'for') {
        walk([s.init])
        walk([s.update])
        walk(s.body)
      } else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body)
        if (s.defaultBody) walk(s.defaultBody)
      }
    }
  }
  walk(body)
  return out
}

/** Every expression in a body, at every depth. */
function allExpressions(body: readonly Stmt[]): Expr[] {
  const out: Expr[] = []
  const expr = (e: Expr): void => {
    out.push(e)
    switch (e.op) {
      case 'binop':
      case 'compare':
      case 'logical':
        expr(e.a)
        expr(e.b)
        break
      case 'unop':
        expr(e.a)
        break
      case 'call':
      case 'construct':
        for (const a of e.args) expr(a)
        break
      case 'member':
        expr(e.base)
        break
      case 'index':
        expr(e.base)
        expr(e.idx)
        break
      case 'select':
        expr(e.cond)
        expr(e.ifTrue)
        expr(e.ifFalse)
        break
      default:
        break
    }
  }
  for (const s of allStatements(body)) {
    switch (s.s) {
      case 'let':
        expr(s.expr)
        break
      case 'var':
        if (s.init) expr(s.init)
        break
      case 'assign':
      case 'assignOp':
        expr(s.target)
        expr(s.expr)
        break
      case 'return':
        if (s.expr) expr(s.expr)
        break
      case 'if':
        for (const arm of s.arms) expr(arm.cond)
        break
      case 'for':
        expr(s.cond)
        break
      case 'switch':
        expr(s.scrut)
        break
      default:
        break
    }
  }
  return out
}

const textAt = (source: string, span: SourceSpan): string =>
  source.slice(span.start, span.start + span.length)

/** The zero-based line/character fields agree with the offsets they were derived from. */
function expectConsistent(source: string, span: SourceSpan): void {
  const lines = source.split('\n')
  const offsetOf = (line: number, character: number): number =>
    lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + character
  expect(offsetOf(span.line, span.character)).toBe(span.start)
  expect(offsetOf(span.endLine, span.endCharacter)).toBe(span.start + span.length)
}

/** A statement the compiler built rather than lowered: the `while` counter, an `autoVars`
 *  materialisation. Both are named with a leading underscore, which the source language
 *  cannot spell. */
const isSynthesised = (s: Stmt): boolean =>
  (s.s === 'var' && s.name.startsWith('_')) ||
  (s.s === 'assign' && s.target.op === 'varref' && s.target.name.startsWith('_')) ||
  (s.s === 'assignOp' && s.target.op === 'varref' && s.target.name.startsWith('_'))

const byName = (m: ModuleDecl, name: string): FuncDecl => {
  const f = m.funcs.find((x) => x.name === name)
  expect(f, `function ${name}`).toBeDefined()
  return f!
}

describe('source spans — every statement kind carries one', () => {
  it('covers the statement kinds the source language can produce', () => {
    const { module } = compiled()
    const kinds = new Set(allStatements(byName(module, 'shapes').body).map((s) => s.s))
    // `discard`, `placeholder` and `raw` have no `"use typeshade"` spelling, so they cannot
    // appear here; `while` lowers to `for`. This set is the ratchet: a new producible kind
    // fails it until it is added to SRC and proved to carry a span below.
    expect([...kinds].sort()).toEqual([
      'assign',
      'assignOp',
      'break',
      'continue',
      'for',
      'if',
      'let',
      'return',
      'switch',
      'var',
    ])
  })

  it('every statement of every function has a span, bar the two the compiler synthesises', () => {
    const { module, text } = compiled()
    const missing: string[] = []
    for (const f of module.funcs) {
      for (const s of allStatements(f.body)) {
        const span = sourceSpanOf(s)
        if (span === undefined) {
          missing.push(`${f.name}: ${s.s} ${'name' in s ? s.name : ''}`.trim())
          continue
        }
        expect(span.file).toBe('typeshade-input.ts')
        expect(span.length).toBeGreaterThan(0)
        expect(textAt(text, span).length).toBe(span.length)
        expectConsistent(text, span)
      }
    }
    // Named exactly, not counted: the `while` lowering builds a counter the author never
    // wrote, and those two statements are the only ones in this module with no authored
    // origin. A third entry here means a capture site was missed.
    expect(missing).toEqual(['shapes: var _w', 'shapes: assign'])
  })

  it('each statement kind spans the text the author wrote', () => {
    const { module, text } = compiled()
    const body = byName(module, 'shapes').body
    const at = (s: Stmt): string => textAt(text, sourceSpanOf(s)!)
    // Top-level, in source order.
    expect(at(body[0]!)).toBe('const base = 1.')
    expect(at(body[1]!)).toBe('let acc = 0.')
    expect(at(body[2]!)).toBe('acc = base')
    expect(at(body[3]!)).toBe('acc += helper(base)')
    expect(at(body[4]!)).toMatch(/^if \(n > 0\) \{/)
    expect(at(body[5]!)).toMatch(/^for \(let i: i32 = 0; i < 4; i\+\+\) \{/)
    expect(at(body[6]!)).toBe('let w: i32 = 0')
    expect(at(body[7]!)).toMatch(/^while \(w < 4\) \{/)
    expect(at(body[8]!)).toMatch(/^switch \(n\) \{/)
    expect(at(body[9]!)).toBe('return acc')
  })

  it('one declarator spans the whole statement, several span one each', () => {
    // With one declarator the statement IS the declaration, so the span carries the
    // `const`/`let` keyword and a breakpoint on that line points at its start. With several,
    // one TypeScript statement lowers to one IR statement per declarator, and each must span
    // its own or stepping highlights the same line twice.
    const { module, text } = compiled(`"use typeshade"
export function f(): f32 {
  const a = 1.
  const b = 2., c = 3.
  return a + b + c
}
`)
    const body = byName(module, 'f').body
    expect(textAt(text, sourceSpanOf(body[0]!)!)).toBe('const a = 1.')
    expect(textAt(text, sourceSpanOf(body[1]!)!)).toBe('b = 2.')
    expect(textAt(text, sourceSpanOf(body[2]!)!)).toBe('c = 3.')
  })

  it('a `for` header spans its own init and update, not the whole loop', () => {
    const { module, text } = compiled()
    const loop = byName(module, 'shapes').body[5]!
    expect(loop.s).toBe('for')
    if (loop.s !== 'for') return
    expect(textAt(text, sourceSpanOf(loop.init)!)).toBe('let i: i32 = 0')
    expect(textAt(text, sourceSpanOf(loop.update)!)).toBe('i++')
  })

  it('nested statements span their own line, inside their enclosing statement', () => {
    const { module, text } = compiled()
    const body = byName(module, 'shapes').body
    const ifStmt = body[4]!
    expect(ifStmt.s).toBe('if')
    if (ifStmt.s !== 'if') return
    const outer = sourceSpanOf(ifStmt)!
    const thenStmt = ifStmt.arms[0]!.body[0]!
    const inner = sourceSpanOf(thenStmt)!
    expect(textAt(text, inner)).toBe('acc = acc + 1.')
    // Inside, strictly: a debugger highlighting the inner statement never leaves the outer.
    expect(inner.start).toBeGreaterThan(outer.start)
    expect(inner.start + inner.length).toBeLessThan(outer.start + outer.length)
    expect(textAt(text, sourceSpanOf(ifStmt.elseBody![0]!)!)).toBe('acc = acc - 1.')
  })

  it('`break` and `continue` inside a loop carry their own spans', () => {
    const { module, text } = compiled()
    const spans = allStatements(byName(module, 'shapes').body)
      .filter((s) => s.s === 'break' || s.s === 'continue')
      .map((s) => textAt(text, sourceSpanOf(s)!))
    expect(spans).toEqual(['continue', 'break'])
  })

  it('a helper and an entry both carry a declaration span and a name span', () => {
    const { module, text } = compiled()
    for (const name of ['helper', 'shapes']) {
      const f = byName(module, name)
      expect(textAt(text, f.span!)).toMatch(new RegExp(`^export function ${name}\\(`))
      expect(textAt(text, f.nameSpan!)).toBe(name)
      expectConsistent(text, f.span!)
    }
  })

  it("an entry's span starts at its stage decorator", () => {
    const { module, text } = compiled(`"use typeshade"
@fragment
export function fs(): vec4 {
  return vec4(1., 0., 0., 1.)
}
`)
    expect(textAt(text, byName(module, 'fs').span!)).toMatch(/^@fragment\nexport function fs/)
  })
})

describe('source spans — expressions', () => {
  it('a call to a helper carries the span of the call site', () => {
    const { module, text } = compiled()
    const calls = allExpressions(byName(module, 'shapes').body).filter(
      (e) => e.op === 'call' && e.fn === 'helper',
    )
    expect(calls).toHaveLength(1)
    expect(textAt(text, sourceSpanOf(calls[0]!)!)).toBe('helper(base)')
  })

  it('two calls in one statement get different spans', () => {
    const { module, text } = compiled(`"use typeshade"
export function g(x: f32): f32 {
  return x + 1.
}
export function f(a: f32, b: f32): f32 {
  return g(a) + g(b)
}
`)
    const calls = allExpressions(byName(module, 'f').body).filter((e) => e.op === 'call')
    expect(calls.map((c) => textAt(text, sourceSpanOf(c)!))).toEqual(['g(a)', 'g(b)'])
  })

  it('an expansion spans its outermost node only, since the inner ones were written nowhere', () => {
    // `random(seed)` is not a call in the IR: the front end expands it into a
    // `fract(sin(dot(...)))` tree. The node lowered FROM the `ts.CallExpression` takes its
    // span, which is the text the author wrote; the nodes the expansion invents take none,
    // because there is nowhere to point at. Same for the array higher-order functions and the
    // `Math.*` expansions. NOT the same for a numeric cast, which the review found this
    // comment had wrong — see the test below.
    const { module, text } = compiled(`"use typeshade"
export function f(x: f32): f32 {
  return random(x)
}
`)
    const calls = allExpressions(byName(module, 'f').body).filter((e) => e.op === 'call')
    expect(calls.length).toBeGreaterThan(1)
    expect(textAt(text, sourceSpanOf(calls[0]!)!)).toBe('random(x)')
    expect(calls.slice(1).every((c) => sourceSpanOf(c) === undefined)).toBe(true)
  })

  it('a numeric cast carries one, but a folded literal coercion has nowhere to carry it', () => {
    // The review caught this stated backwards. A cast of a VALUE is an ordinary call node
    // lowered from a `ts.CallExpression` the author wrote, so it takes that text's span like
    // any other call. Only a cast of a LITERAL loses one, and not by being spanless: it folds
    // to a `lit`, and `lit` has no span field at all — which is the honest outcome, since
    // `f32(3)` and `3.` are the same IR and the second was never written.
    const { module, text } = compiled(`"use typeshade"
export function f(n: i32, x: f32): f32 {
  const a = f32(n)
  const b = f32(3)
  const c = u32(x)
  return a + b + f32(c)
}
`)
    const body = byName(module, 'f').body
    const casts = allExpressions(body).filter((e) => e.op === 'call')
    expect(casts.map((c) => textAt(text, sourceSpanOf(c)!)).sort()).toEqual([
      'f32(c)',
      'f32(n)',
      'u32(x)',
    ])
    const folded = body[1]
    expect(folded!.s).toBe('let')
    if (folded!.s === 'let') {
      expect(folded.expr.op).toBe('lit')
      expect(sourceSpanOf(folded.expr)).toBeUndefined()
    }
  })

  it('an intrinsic call carries one too', () => {
    const { module, text } = compiled(`"use typeshade"
export function f(x: f32): f32 {
  return sin(x)
}
`)
    const calls = allExpressions(byName(module, 'f').body).filter((e) => e.op === 'call')
    expect(calls.map((c) => textAt(text, sourceSpanOf(c)!))).toEqual(['sin(x)'])
  })

  it('an assignment target carries the span of the lvalue it writes', () => {
    const { module, text } = compiled()
    const targets = allStatements(byName(module, 'shapes').body)
      .filter((s) => s.s === 'assign' || s.s === 'assignOp')
      .map((s) => (s.s === 'assign' || s.s === 'assignOp' ? s.target : undefined)!)
      .map((t) => {
        const span = sourceSpanOf(t)
        return span ? textAt(text, span) : '<synthesised>'
      })
    // Every write in SRC, in walk order — including the `i++` the `for` header makes, whose
    // target is the operand rather than the whole update expression, and the one write nobody
    // authored: the counter the `while` lowering assigns to.
    expect(targets).toEqual([
      'acc', // acc = base
      'acc', // acc += helper(base)
      'acc', // inside `if (n > 0)`
      'acc', // inside its else
      'i', // the `for` header's own update
      'acc', // the loop body
      '<synthesised>', // the `while` counter's update
      'w', // the `while` body
      'acc', // the switch case
      'acc', // its default
    ])
  })

  it('an indexed assignment target spans the whole element access', () => {
    const { module, text } = compiled(`"use typeshade"
declare let out: storage<array<f32>>
@compute([1, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = 1.
}
`)
    const write = byName(module, 'k').body[0]!
    expect(write.s).toBe('assign')
    if (write.s !== 'assign') return
    expect(textAt(text, sourceSpanOf(write.target)!)).toBe('out[gid.x]')
  })

  it('a read of the same name carries none — only the write position does', () => {
    const { module } = compiled(`"use typeshade"
export function f(a: f32): f32 {
  let acc = a
  acc = acc + a
  return acc
}
`)
    const assign = byName(module, 'f').body[1]!
    expect(assign.s).toBe('assign')
    if (assign.s !== 'assign') return
    expect(sourceSpanOf(assign.target)).toBeDefined()
    // The `acc` READ inside `acc + a` is a different node in the same statement, and it has no
    // span: this increment spans the write position, not every name.
    expect(assign.expr.op).toBe('binop')
    if (assign.expr.op !== 'binop') return
    expect(sourceSpanOf(assign.expr.a)).toBeUndefined()
    expect(sourceSpanOf(assign.expr.b)).toBeUndefined()
  })

  it('no other expression has one — this increment stops at calls and lvalues', () => {
    const { module } = compiled()
    const targets = new Set(
      allStatements(byName(module, 'shapes').body)
        .filter((s) => s.s === 'assign' || s.s === 'assignOp')
        .map((s) => (s.s === 'assign' || s.s === 'assignOp' ? s.target : undefined)!),
    )
    const others = allExpressions(byName(module, 'shapes').body).filter(
      (e) => e.op !== 'call' && !targets.has(e),
    )
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((e) => sourceSpanOf(e) === undefined)).toBe(true)
  })
})

describe('source spans — what has none, and why', () => {
  it("a `while` loop's synthesised counter carries no span", () => {
    const { module } = compiled()
    const loop = byName(module, 'shapes').body[7]!
    expect(loop.s).toBe('for')
    if (loop.s !== 'for') return
    // `while (w < 4)` lowers to a `for` over a counter `_w` the author never wrote. The loop
    // itself spans the `while`; its header statements are synthetic and say so.
    expect(sourceSpanOf(loop)).toBeDefined()
    expect(sourceSpanOf(loop.init)).toBeUndefined()
    expect(sourceSpanOf(loop.update)).toBeUndefined()
  })

  it('an EDSL-authored function and body carry none', () => {
    const handle = fn('edsl', { x: f32T }, f32T, ({ x }, b) => {
      const acc = Var('acc', f32(0))
      b.assign(acc, x)
      return acc
    })
    expect(sourceSpanOf(handle.decl)).toBeUndefined()
    for (const s of allStatements(handle.decl.body)) expect(sourceSpanOf(s)).toBeUndefined()
  })
})

describe('source spans — survival through the passes that rebuild nodes', () => {
  it('autoVars preserves every span it did not invent', () => {
    const { module, text } = compiled()
    const before = allStatements(byName(module, 'shapes').body)
      .map((s) => sourceSpanOf(s))
      .filter((s): s is SourceSpan => s !== undefined)
      .map((s) => textAt(text, s))
    const after = allStatements(byName(autoVars(module), 'shapes').body)
      .map((s) => sourceSpanOf(s))
      .filter((s): s is SourceSpan => s !== undefined)
      .map((s) => textAt(text, s))
    expect(after).toEqual(before)
  })

  it('autoVars is the pass the CPU oracle runs, so a stepped run would see these spans', () => {
    // `compileModule` runs `validate` then `autoVars` before evaluating, so the module a CPU
    // run walks is this one. Every statement it can pause on still names its source.
    const { module } = compiled()
    const lowered = autoVars(module)
    const authored = allStatements(byName(lowered, 'shapes').body).filter(
      // Everything the compiler synthesised rather than lowered: the `while` counter `_w` and
      // anything `autoVars` materialised. Both are spelled with a leading underscore, which is
      // a name the source language cannot produce.
      (s) => !isSynthesised(s),
    )
    expect(authored.length).toBeGreaterThan(10)
    for (const s of authored) expect(sourceSpanOf(s), `span for ${s.s}`).toBeDefined()
  })

  it('the shared walkers preserve a span through an identity rewrite', () => {
    // Actually run them. The claim is about `mapStmtExpr`, `mapChildren` and `mapStmt`, so a
    // test that rebuilds a node by hand asserts nothing about the code it names.
    const { module, text } = compiled()
    const body = byName(module, 'shapes').body
    for (const s of body) {
      const before = sourceSpanOf(s)
      if (!before) continue
      for (const rebuilt of [
        mapStmtExpr(s, (e) => e),
        mapStmt(s, (e) => e),
        mapStmtExpr(s, (e) => mapChildren(e, (c) => c)),
      ]) {
        expect(sourceSpanOf(rebuilt), `${s.s} through a walker`).toEqual(before)
      }
    }
    // …and a call Expr through the expression walker.
    const call = allExpressions(body).find((e) => e.op === 'call' && e.fn === 'helper')!
    expect(sourceSpanOf(mapChildren(call, (c) => c))).toEqual(sourceSpanOf(call))
    expect(textAt(text, sourceSpanOf(call)!)).toBe('helper(base)')
  })

  it('the optimizer keeps the authored spans it does not invent, at O1 and at a fixpoint', () => {
    // The ratchet the review asked for. A pass that rebuilds a node from named fields instead
    // of spreading it drops the span silently, and `dead-branch` did exactly that to every
    // `if`. Naming the surviving set means the next such pass fails here rather than in an
    // editor.
    const { module, text } = compiled()
    const surviving = (m: ModuleDecl): string[] =>
      allStatements(byName(m, 'shapes').body)
        .map((s) => sourceSpanOf(s))
        .filter((sp): sp is SourceSpan => sp !== undefined)
        .map((sp) => textAt(text, sp).split('\n')[0]!)
    const authored = new Set(surviving(module))
    expect(authored.size).toBeGreaterThan(8)
    const ifSpans = (m: ModuleDecl): number =>
      allStatements(byName(m, 'shapes').body).filter(
        (st) => st.s === 'if' && sourceSpanOf(st) !== undefined,
      ).length
    const ifCount = ifSpans(module)
    expect(ifCount).toBeGreaterThan(0)
    for (const m of [optimizeAt(module, 'O1'), optimizeAt(module, 'O2'), fixpoint(module)]) {
      // No span is INVENTED: an optimized statement either keeps the text it was written as,
      // or carries none. A pass that rebuilt a node with some other node's span fails here.
      for (const t of surviving(m)) expect(authored.has(t), t).toBe(true)
      // …and every `if` still has one. This is the arm that `dead-branch`'s rebuild broke:
      // it dropped the span of every `if` at exactly the tiers a debugger attaches to.
      expect(ifSpans(m)).toBe(ifCount)
    }
  })

  it('irEqual ignores a span, so the fixpoint does not iterate over provenance', () => {
    // A span is provenance. Were `irEqual` to see it, a pass that rebuilt an equal tree would
    // read as a change and the fixpoint would run again for nothing; measured at twice the
    // iterations on a registered example when spans first landed.
    const { module } = compiled()
    const f = byName(module, 'shapes')
    const stripped = { ...f, body: stripSpans(f.body) }
    expect(irEqual(f, stripped)).toBe(true)
    // …and it still sees a real difference.
    expect(irEqual(f, { ...f, name: 'other' })).toBe(false)
  })
})
