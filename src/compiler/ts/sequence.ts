// === A call that writes, in source order (Rule 7.9, §26) ===
//
// TypeScript evaluates an expression left to right, and so does WGSL: "The order of evaluation
// for operands of an expression is left-to-right in WGSL. For example, foo() + bar() must
// evaluate foo() before bar()" (Program Order Within an Invocation), and a call's arguments are
// "evaluated. The relative order of evaluation is left-to-right" (Function Calls). GLSL ES 3.00
// promises that for a call's arguments (§6.1.1, "in order, from left to right") and not for an
// operator's operands, which §5.11 leaves to the C++ rule. While every expression was pure that
// gap was invisible. A call that WRITES is not pure: a method that changes its object and
// returns a value (`rng.next()`, §26), a helper that bumps a module variable, an atomic. Two
// more places turned such a call into something other than what the source says:
//
//   - a scalar `c ? a : b` is WGSL's `select(b, a, c)`, which evaluates BOTH arms and the
//     condition last, where TypeScript evaluates the condition and then one arm;
//   - the passes after this one take expressions to be pure: the algebraic pass folds `i - i`
//     and `i * 0` to 0, and GLSL's float `%` spells each operand twice.
//
// So before anything else reads a function, each call that writes and sits INSIDE a larger
// expression is bound to a `let` of its own, in source order, ahead of the statement, and the
// statement reads the temporary: `vec2(rng.next(), rng.next())` is two lets and a `vec2` of
// them. An operand evaluated before such a call that reads what the call writes is bound first,
// so it keeps the value it had: `rng.state + rng.next()` reads the state the call is about to
// change. A call TypeScript runs conditionally keeps its condition: the right operand of `&&`
// or `||`, and an arm of `?:`, become an `if` that assigns a temporary. A call that is the whole
// of its statement (a declaration's initializer, the value of an assignment or a `return`, the
// first condition of an `if`, a `switch` selector, a call statement) stays where it is: nothing
// else in the statement is evaluated around it.
//
// A loop's condition runs on every iteration, so nothing in it can move ahead of the loop. A
// call that writes may stand there as one side of the comparison, where there is nothing to
// order it against, and is refused anywhere deeper.
//
// This runs on the IR the front end built, so every consumer sees the one order: both writers,
// the CPU oracle, the codegen and the debugger. A hoisted call keeps its own span, so stepping
// through `vec2(rng.next(), rng.next())` stops on each call and then on the line.

import type ts from 'typescript'
import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { boolT } from '../../core/ir/types.js'
import { eachExpr } from '../../core/ir/visit.js'
import { isAtomicIntrinsic } from '../../core/intrinsics.js'
import { callWrites, fnWrites, type FnWrites } from '../../core/passes/effects.js'
import { collectLocals } from '../../core/passes/opt/expr-utils.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { diagnosticAtSpan } from './diagnostic.js'
import { TS_CODES } from './codes.js'

type Call = Extract<Expr, { op: 'call' }>

/** One child of an expression, in the order it is evaluated. A `place` is an argument the
 *  callee writes through, or the location an atomic acts on: it is named, not read, so only
 *  the index expressions inside it are evaluated where it stands. */
interface Child {
  readonly expr: Expr
  readonly place?: boolean
}

/** What sequencing one function needs. */
interface Fn {
  readonly writes: FnWrites
  readonly byName: ReadonlyMap<string, FuncDecl>
  /** The function's own locals and by-value parameters: nothing but its body can see them. */
  readonly locals: ReadonlySet<string>
  /** Every name the function or the module already uses, so a temporary takes a fresh one. */
  readonly taken: Set<string>
  next: number
  readonly sourceFile: ts.SourceFile
  readonly diagnostics: TsCompilerDiagnostic[]
  /** `callWrites` per call node, and whether a subtree holds a call that writes. */
  readonly callCache: WeakMap<Call, ReadonlySet<string>>
  readonly writeCache: WeakMap<Expr, boolean>
}

const NONE: ReadonlySet<string> = new Set()

/** Put every call that writes in `m`'s functions in source order, rewriting each body in place.
 *  Called by `compileTsSource` once every function is lowered, since what a helper writes is
 *  read off its body. In place, like the lowering that filled the bodies: a call's `declRef`
 *  and `classFunctionOf` both key on the declaration object. */
export function sequenceEffects(
  m: ModuleDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const writes = fnWrites(m)
  const byName = new Map(m.funcs.map((f) => [f.name, f]))
  const moduleNames = new Set<string>(
    [
      ...m.consts,
      ...m.bindings,
      ...(m.vars ?? []),
      ...(m.overrides ?? []),
      ...m.structs,
      ...m.funcs,
    ].map((d) => d.name),
  )
  for (const f of m.funcs) {
    const locals = new Set<string>(f.params.filter((p) => p.mode !== 'inout').map((p) => p.name))
    collectLocals(f.body, locals)
    const fn: Fn = {
      writes,
      byName,
      locals,
      taken: new Set([...moduleNames, ...locals, ...f.params.map((p) => p.name)]),
      next: 0,
      sourceFile,
      diagnostics,
      callCache: new WeakMap(),
      writeCache: new WeakMap(),
    }
    if (!f.body.some((s) => stmtWrites(s, fn))) continue
    for (const s of f.body) noteNames(s, fn.taken)
    const body = seqBody(f.body, fn)
    if (body !== f.body) (f as { body: readonly Stmt[] }).body = body
  }
}

// ── What writes ──

function writesOf(x: Call, fn: Fn): ReadonlySet<string> {
  let w = fn.callCache.get(x)
  if (w === undefined) {
    w = callWrites(x, fn.writes)
    fn.callCache.set(x, w)
  }
  return w
}

/** Does `e` hold a call that writes? */
function hasWrite(e: Expr, fn: Fn): boolean {
  let hit = fn.writeCache.get(e)
  if (hit === undefined) {
    hit = false
    eachExpr(e, (x) => {
      if (!hit && x.op === 'call' && writesOf(x, fn).size > 0) hit = true
    })
    fn.writeCache.set(e, hit)
  }
  return hit
}

/** Everything the calls in `e` write. */
function writesIn(e: Expr, fn: Fn): ReadonlySet<string> {
  if (!hasWrite(e, fn)) return NONE
  const out = new Set<string>()
  eachExpr(e, (x) => {
    if (x.op === 'call') for (const n of writesOf(x, fn)) out.add(n)
  })
  return out
}

function stmtWrites(s: Stmt, fn: Fn): boolean {
  switch (s.s) {
    case 'let':
      return hasWrite(s.expr, fn)
    case 'var':
      return s.init !== undefined && hasWrite(s.init, fn)
    case 'assign':
    case 'assignOp':
      return hasWrite(s.target, fn) || hasWrite(s.expr, fn)
    case 'call':
      return hasWrite(s.expr, fn)
    case 'return':
      return s.expr !== undefined && hasWrite(s.expr, fn)
    case 'if':
      return (
        s.arms.some((a) => hasWrite(a.cond, fn) || a.body.some((b) => stmtWrites(b, fn))) ||
        (s.elseBody?.some((b) => stmtWrites(b, fn)) ?? false)
      )
    case 'for':
      return (
        stmtWrites(s.init, fn) ||
        hasWrite(s.cond, fn) ||
        stmtWrites(s.update, fn) ||
        s.body.some((b) => stmtWrites(b, fn))
      )
    case 'switch':
      return (
        hasWrite(s.scrut, fn) ||
        s.cases.some((c) => c.body.some((b) => stmtWrites(b, fn))) ||
        (s.defaultBody?.some((b) => stmtWrites(b, fn)) ?? false)
      )
    default:
      return false
  }
}

/** Would evaluating `e` later than now read something `written` changes? A name it reads is
 *  the plain case. A call to a function the module declares is the other: its body may read a
 *  module variable or a storage binding, so it counts as reading every name that is not one of
 *  this function's own locals, which no other function can see. A texture or a sampler is a
 *  handle, not a value that changes, and neither target has a local of one to bind. */
function readsAny(e: Expr, written: ReadonlySet<string>, fn: Fn): boolean {
  if (written.size === 0 || isHandle(e.type)) return false
  const beyondLocals = [...written].some((n) => !fn.locals.has(n))
  let hit = false
  eachExpr(e, (x) => {
    if (hit) return
    if (
      (x.op === 'varref' || x.op === 'param' || x.op === 'constref' || x.op === 'externref') &&
      written.has(x.name)
    ) {
      hit = true
    } else if (beyondLocals && x.op === 'call' && fn.byName.has(x.fn)) {
      hit = true
    }
  })
  return hit
}

function isHandle(t: ShaderType): boolean {
  return (
    t.kind === 'texture' ||
    t.kind === 'storage-texture' ||
    t.kind === 'depth-texture' ||
    t.kind === 'sampler' ||
    t.kind === 'sampler-comparison' ||
    t.kind === 'void'
  )
}

/** A location a function may name: a variable, a parameter, or a field, component or element
 *  of one. */
function isPlace(e: Expr): boolean {
  if (e.op === 'varref' || e.op === 'param') return true
  if (e.op === 'member' || e.op === 'index') return isPlace(e.base)
  return false
}

/** Is argument `i` of `x` a place rather than a value? */
function placeArg(x: Call, i: number, fn: Fn): boolean {
  const arg = x.args[i]
  if (arg === undefined || !isPlace(arg)) return false
  if (x.declRef !== undefined) return fn.byName.get(x.fn)?.params[i]?.mode === 'inout'
  return i === 0 && isAtomicIntrinsic(x.fn)
}

// ── Temporaries ──

function fresh(fn: Fn): string {
  for (;;) {
    const name = `_seq${fn.next++}`
    if (!fn.taken.has(name)) {
      fn.taken.add(name)
      return name
    }
  }
}

/** Bind `e` to a new `let` in `out` and hand back a read of it. A call keeps its span on the
 *  `let`, so a debugger stops on the call; a bound read has nothing to show and runs silently. */
function bind(e: Expr, out: Stmt[], fn: Fn): Expr {
  const name = fresh(fn)
  const span = e.op === 'call' ? e.span : undefined
  out.push(span !== undefined ? { s: 'let', name, expr: e, span } : { s: 'let', name, expr: e })
  return { op: 'varref', type: e.type, name }
}

function noteNames(s: Stmt, taken: Set<string>): void {
  const see = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'varref' || x.op === 'param') taken.add(x.name)
    })
  switch (s.s) {
    case 'let':
      see(s.expr)
      return
    case 'var':
      if (s.init !== undefined) see(s.init)
      return
    case 'assign':
    case 'assignOp':
      see(s.target)
      see(s.expr)
      return
    case 'call':
      see(s.expr)
      return
    case 'return':
      if (s.expr !== undefined) see(s.expr)
      return
    case 'if':
      for (const a of s.arms) {
        see(a.cond)
        for (const b of a.body) noteNames(b, taken)
      }
      for (const b of s.elseBody ?? []) noteNames(b, taken)
      return
    case 'for':
      noteNames(s.init, taken)
      see(s.cond)
      noteNames(s.update, taken)
      for (const b of s.body) noteNames(b, taken)
      return
    case 'switch':
      see(s.scrut)
      for (const c of s.cases) for (const b of c.body) noteNames(b, taken)
      for (const b of s.defaultBody ?? []) noteNames(b, taken)
      return
    default:
      return
  }
}

// ── Expressions ──

/** The children of an expression, sequenced: each call that writes is bound ahead in `out`,
 *  and a child evaluated before a write it would see is bound ahead of that write. `after` is
 *  what the caller writes once these are evaluated, before it uses them. */
function seqList(
  children: readonly Child[],
  out: Stmt[],
  fn: Fn,
  after: ReadonlySet<string> = NONE,
): Expr[] {
  const later: ReadonlySet<string>[] = []
  let acc = after
  for (let i = children.length - 1; i >= 0; i--) {
    later[i] = acc
    const w = writesIn(children[i]!.expr, fn)
    if (w.size > 0) acc = acc.size === 0 ? w : new Set([...acc, ...w])
  }
  return children.map((c, i) => {
    if (c.place) return seqPlace(c.expr, out, fn, later[i]!)
    let r = seqExpr(c.expr, out, false, fn)
    if (readsAny(r, later[i]!, fn)) r = bind(r, out, fn)
    return r
  })
}

/** A place, `ps[i].pos`, with the index expressions in it sequenced. The location itself is
 *  not read here: a load, if the place is read at all, happens where it is used, which is WGSL's
 *  rule for a reference. */
function seqPlace(p: Expr, out: Stmt[], fn: Fn, after: ReadonlySet<string>): Expr {
  const idxs: Expr[] = []
  const collect = (e: Expr): void => {
    if (e.op === 'member') collect(e.base)
    else if (e.op === 'index') {
      collect(e.base)
      idxs.push(e.idx)
    }
  }
  collect(p)
  if (idxs.length === 0) return p
  const next = seqList(
    idxs.map((expr) => ({ expr })),
    out,
    fn,
    after,
  )
  let k = 0
  const rebuild = (e: Expr): Expr => {
    if (e.op === 'member') {
      const base = rebuild(e.base)
      return base === e.base ? e : { ...e, base }
    }
    if (e.op === 'index') {
      const base = rebuild(e.base)
      const idx = next[k++]!
      return base === e.base && idx === e.idx ? e : { ...e, base, idx }
    }
    return e
  }
  return rebuild(p)
}

const same = (a: readonly Expr[], b: readonly Expr[]): boolean => a.every((x, i) => x === b[i])

/** `e` with every call that writes inside it bound ahead in `out`, in source order. `whole`
 *  says `e` is the entire expression of its statement, where a call at the top needs no
 *  temporary: nothing else in the statement is evaluated around it. */
function seqExpr(e: Expr, out: Stmt[], whole: boolean, fn: Fn): Expr {
  if (!hasWrite(e, fn)) return e
  switch (e.op) {
    case 'call': {
      const args = seqList(
        e.args.map((expr, i) => ({ expr, place: placeArg(e, i, fn) })),
        out,
        fn,
      )
      const call: Call = same(args, e.args) ? e : { ...e, args }
      if (whole || writesOf(e, fn).size === 0) return call
      return bind(call, out, fn)
    }
    case 'binop':
    case 'compare': {
      const [a, b] = seqList([{ expr: e.a }, { expr: e.b }], out, fn)
      return a === e.a && b === e.b ? e : { ...e, a: a!, b: b! }
    }
    case 'unop': {
      const [a] = seqList([{ expr: e.a }], out, fn)
      return a === e.a ? e : { ...e, a: a! }
    }
    case 'construct': {
      const args = seqList(
        e.args.map((expr) => ({ expr })),
        out,
        fn,
      )
      return same(args, e.args) ? e : { ...e, args }
    }
    case 'member': {
      if (isPlace(e)) return seqPlace(e, out, fn, NONE)
      const [base] = seqList([{ expr: e.base }], out, fn)
      return base === e.base ? e : { ...e, base: base! }
    }
    case 'index': {
      if (isPlace(e)) return seqPlace(e, out, fn, NONE)
      const [base, idx] = seqList([{ expr: e.base }, { expr: e.idx }], out, fn)
      return base === e.base && idx === e.idx ? e : { ...e, base: base!, idx: idx! }
    }
    case 'logical': {
      const a = seqExpr(e.a, out, false, fn)
      if (!hasWrite(e.b, fn)) return a === e.a ? e : { ...e, a }
      // The right operand runs only when the left one does not decide: `a && b` is
      // `var t = a; if (t) { t = b; }`, and `a || b` tests `!t`.
      const name = fresh(fn)
      out.push({ s: 'var', name, type: e.type, init: a })
      const t: Expr = { op: 'varref', type: e.type, name }
      const body: Stmt[] = []
      assignInto(t, e.b, body, fn)
      const cond: Expr =
        e.lop === '&&'
          ? t
          : {
              op: 'compare',
              type: boolT,
              cop: '==',
              a: t,
              b: { op: 'lit', type: boolT, value: false },
            }
      out.push({ s: 'if', arms: [{ cond, body }] })
      return t
    }
    case 'select': {
      // A condition of bools picks per component and evaluates both arms (§27), in the order
      // they are written.
      if (e.cond.type.kind === 'vec') {
        const [cond, ifTrue, ifFalse] = seqList(
          [{ expr: e.cond }, { expr: e.ifTrue }, { expr: e.ifFalse }],
          out,
          fn,
        )
        return cond === e.cond && ifTrue === e.ifTrue && ifFalse === e.ifFalse
          ? e
          : { ...e, cond: cond!, ifTrue: ifTrue!, ifFalse: ifFalse! }
      }
      const cond = seqExpr(e.cond, out, false, fn)
      if (!hasWrite(e.ifTrue, fn) && !hasWrite(e.ifFalse, fn)) {
        return cond === e.cond ? e : { ...e, cond }
      }
      // An arm that writes runs only when it is chosen, which WGSL's `select` would not do:
      // `var t: T; if (c) { t = a; } else { t = b; }`.
      const name = fresh(fn)
      out.push({ s: 'var', name, type: e.type })
      const t: Expr = { op: 'varref', type: e.type, name }
      const then: Stmt[] = []
      const otherwise: Stmt[] = []
      assignInto(t, e.ifTrue, then, fn)
      assignInto(t, e.ifFalse, otherwise, fn)
      out.push({ s: 'if', arms: [{ cond, body: then }], elseBody: otherwise })
      return t
    }
    default:
      return e
  }
}

/** `t = e` into `out`, with `e` sequenced; the assignment carries the span of a call it stores,
 *  so a debugger stops there when the branch runs. */
function assignInto(t: Expr, e: Expr, out: Stmt[], fn: Fn): void {
  const expr = seqExpr(e, out, true, fn)
  const span = expr.op === 'call' ? expr.span : undefined
  out.push(
    span !== undefined ? { s: 'assign', target: t, expr, span } : { s: 'assign', target: t, expr },
  )
}

// ── Statements ──

function seqBody(body: readonly Stmt[], fn: Fn): readonly Stmt[] {
  if (!body.some((s) => stmtWrites(s, fn))) return body
  const out: Stmt[] = []
  for (const s of body) seqStmt(s, out, fn)
  return out.length === body.length && out.every((s, i) => s === body[i]) ? body : out
}

function seqStmt(s: Stmt, out: Stmt[], fn: Fn): void {
  if (!stmtWrites(s, fn)) {
    out.push(s)
    return
  }
  switch (s.s) {
    case 'let': {
      const expr = seqExpr(s.expr, out, true, fn)
      out.push(expr === s.expr ? s : { ...s, expr })
      return
    }
    case 'var': {
      const init = seqExpr(s.init!, out, true, fn)
      out.push(init === s.init ? s : { ...s, init })
      return
    }
    case 'call': {
      const expr = seqExpr(s.expr, out, true, fn)
      out.push(expr === s.expr ? s : { ...s, expr })
      return
    }
    case 'return': {
      const expr = seqExpr(s.expr!, out, true, fn)
      out.push(expr === s.expr ? s : { ...s, expr })
      return
    }
    case 'assign': {
      // Both targets evaluate the target before the value and store last (GLSL ES 3.00 §5.8,
      // "Expressions on the left of an assignment are evaluated before expressions on the
      // right"), so an index in the target that the value's calls would change is read first.
      const target = isPlace(s.target)
        ? seqPlace(s.target, out, fn, writesIn(s.expr, fn))
        : s.target
      const expr = seqExpr(s.expr, out, true, fn)
      out.push(target === s.target && expr === s.expr ? s : { ...s, target, expr })
      return
    }
    case 'assignOp': {
      const later = writesIn(s.expr, fn)
      const target = isPlace(s.target) ? seqPlace(s.target, out, fn, later) : s.target
      if (readsAny(target, later, fn)) {
        // `this.total += this.next()`: the old value is read before the value is evaluated,
        // and the value's call writes it, so the old value is taken first.
        const old = bind(target, out, fn)
        const expr = seqExpr(s.expr, out, true, fn)
        const value: Expr = { op: 'binop', type: target.type, bop: s.bop, a: old, b: expr }
        out.push(
          s.span !== undefined
            ? { s: 'assign', target, expr: value, span: s.span }
            : { s: 'assign', target, expr: value },
        )
        return
      }
      const expr = seqExpr(s.expr, out, true, fn)
      out.push(target === s.target && expr === s.expr ? s : { ...s, target, expr })
      return
    }
    case 'if': {
      const [first, ...rest] = s.arms
      if (first === undefined) {
        out.push(s)
        return
      }
      const cond = seqExpr(first.cond, out, true, fn)
      const arms: { cond: Expr; body: readonly Stmt[] }[] = [
        { cond, body: seqBody(first.body, fn) },
      ]
      for (const [k, arm] of rest.entries()) {
        if (hasWrite(arm.cond, fn)) {
          // Evaluated only once every condition above it is false, so it opens the `else`.
          const elseBody: Stmt[] = []
          const tail: Stmt =
            s.elseBody !== undefined
              ? { s: 'if', arms: rest.slice(k), elseBody: s.elseBody }
              : { s: 'if', arms: rest.slice(k) }
          seqStmt(tail, elseBody, fn)
          out.push({ ...s, arms, elseBody })
          return
        }
        arms.push({ cond: arm.cond, body: seqBody(arm.body, fn) })
      }
      out.push(
        s.elseBody !== undefined
          ? { ...s, arms, elseBody: seqBody(s.elseBody, fn) }
          : { ...s, arms },
      )
      return
    }
    case 'for': {
      const pre: Stmt[] = []
      seqStmt(s.init, pre, fn)
      const init = pre.pop()!
      out.push(...pre)
      checkLoopCondition(s.cond, fn)
      out.push({ ...s, init, body: seqBody(s.body, fn) })
      return
    }
    case 'switch': {
      const scrut = seqExpr(s.scrut, out, true, fn)
      const cases = s.cases.map((c) => ({ values: c.values, body: seqBody(c.body, fn) }))
      out.push(
        s.defaultBody !== undefined
          ? { ...s, scrut, cases, defaultBody: seqBody(s.defaultBody, fn) }
          : { ...s, scrut, cases },
      )
      return
    }
    default:
      out.push(s)
  }
}

/** A loop's condition runs on every iteration, so a call that writes can be sequenced there
 *  only by being all there is to evaluate on its side of the comparison. `while (rng.next() <
 *  0.9)` is that, and anything deeper is refused. */
function checkLoopCondition(cond: Expr, fn: Fn): void {
  if (!hasWrite(cond, fn)) return
  if (cond.op === 'compare' && hasWrite(cond.a, fn) !== hasWrite(cond.b, fn)) {
    const [call, other] = hasWrite(cond.a, fn) ? [cond.a, cond.b] : [cond.b, cond.a]
    if (
      call.op === 'call' &&
      !call.args.some((a) => hasWrite(a, fn)) &&
      !readsAny(other, writesOf(call, fn), fn)
    ) {
      return
    }
  }
  let first: Call | undefined
  eachExpr(cond, (x) => {
    if (first === undefined && x.op === 'call' && writesOf(x, fn).size > 0) first = x
  })
  const span = first?.span
  const text =
    span !== undefined
      ? fn.sourceFile.text.slice(span.start, span.start + span.length)
      : 'a call that writes'
  fn.diagnostics.push(
    diagnosticAtSpan(
      fn.sourceFile,
      span,
      undefined,
      `A while condition runs "${text}" on every iteration, and a call that writes can stand ` +
        `there only as one side of the comparison. Compare the call alone against the bound, ` +
        `or call it into a let at the end of the body and compare that.`,
      TS_CODES.LOOP_BOUND,
    ),
  )
}
