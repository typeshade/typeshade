// ═══ Shader DSL — dead-code elimination pass (Optimization context) ═══
//
// Drops a function-local `let`/`var` whose name is never read, and a `call` statement
// whose call has no effect. Conservative + safe: exprs are pure EXCEPT for a call to a
// function that writes a binding (passes/effects.ts), so an unread binding has no observable
// effect, and a `call` statement is kept exactly when its call has one (issue #47):
//   • "used" = any varref/param occurrence ANYWHERE in the fn (incl. an assign
//     target — so an assigned-but-unread var is kept, not dropped). One pass; a
//     binding dead only via another dead binding survives (iterate later).
//   • a fn containing a raw Stmt is skipped entirely — raw WGSL may reference a
//     name DCE cannot see (the polygon composer's `var _mcSS`). Same leniency as
//     the validator's scope rule.
//   • module bindings / varyings are NOT touched — they are IO/layout contracts
//     (deferred to the resource model, P4).

import type { Expr, Stmt, ModuleDecl, FuncDecl } from '../../ir/index.js'
import { exprHasEffect, fnWrites, type FnWrites } from '../effects.js'

function collectExprNames(e: Expr, out: Set<string>): void {
  switch (e.op) {
    case 'varref':
    case 'param':
      out.add(e.name)
      break
    case 'binop':
    case 'compare':
    case 'logical':
      collectExprNames(e.a, out)
      collectExprNames(e.b, out)
      break
    case 'unop':
      collectExprNames(e.a, out)
      break
    case 'call':
    case 'construct':
      for (const a of e.args) collectExprNames(a, out)
      break
    case 'member':
      collectExprNames(e.base, out)
      break
    case 'index':
      collectExprNames(e.base, out)
      collectExprNames(e.idx, out)
      break
    case 'select':
      collectExprNames(e.cond, out)
      collectExprNames(e.ifTrue, out)
      collectExprNames(e.ifFalse, out)
      break
    case 'matchExpr':
      collectExprNames(e.scrutinee, out)
      for (const [, v] of e.cases) collectExprNames(v, out)
      collectExprNames(e.default, out)
      break
    default:
      break // lit / constref
  }
}

function collectStmtNames(s: Stmt, out: Set<string>): void {
  switch (s.s) {
    case 'let':
      collectExprNames(s.expr, out)
      break
    case 'var':
      if (s.init !== undefined) collectExprNames(s.init, out)
      break
    case 'assign':
    case 'assignOp':
      collectExprNames(s.target, out)
      collectExprNames(s.expr, out)
      break
    case 'return':
      if (s.expr !== undefined) collectExprNames(s.expr, out)
      break
    case 'call':
      collectExprNames(s.expr, out)
      break
    case 'if':
      for (const arm of s.arms) {
        collectExprNames(arm.cond, out)
        for (const b of arm.body) collectStmtNames(b, out)
      }
      if (s.elseBody) for (const b of s.elseBody) collectStmtNames(b, out)
      break
    case 'for':
      collectStmtNames(s.init, out)
      collectExprNames(s.cond, out)
      collectStmtNames(s.update, out)
      for (const b of s.body) collectStmtNames(b, out)
      break
    case 'switch':
      collectExprNames(s.scrut, out)
      for (const c of s.cases) for (const b of c.body) collectStmtNames(b, out)
      if (s.defaultBody) for (const b of s.defaultBody) collectStmtNames(b, out)
      break
    default:
      break
  }
}

export function bodyHasRaw(body: readonly Stmt[]): boolean {
  for (const s of body) {
    if (s.s === 'raw') return true
    if (s.s === 'if') {
      if (s.arms.some((a) => bodyHasRaw(a.body))) return true
      if (s.elseBody && bodyHasRaw(s.elseBody)) return true
    } else if (s.s === 'for') {
      if (bodyHasRaw(s.body)) return true
    } else if (s.s === 'switch') {
      if (s.cases.some((c) => bodyHasRaw(c.body))) return true
      if (s.defaultBody && bodyHasRaw(s.defaultBody)) return true
    }
  }
  return false
}

function dropDead(body: readonly Stmt[], used: ReadonlySet<string>, writes: FnWrites): Stmt[] {
  const out: Stmt[] = []
  for (const s of body) {
    if ((s.s === 'let' || s.s === 'var') && !used.has(s.name)) continue // dead local
    // A call kept for its effect stays; one with none (`max(a, b);`, or a call a pass folded
    // to a value) computes and drops, which is nothing.
    if (s.s === 'call' && !exprHasEffect(s.expr, writes)) continue
    if (s.s === 'if') {
      out.push({
        ...s,
        arms: s.arms.map((a) => ({ cond: a.cond, body: dropDead(a.body, used, writes) })),
        elseBody: s.elseBody ? dropDead(s.elseBody, used, writes) : undefined,
      })
    } else if (s.s === 'for') {
      out.push({ ...s, body: dropDead(s.body, used, writes) })
    } else if (s.s === 'switch') {
      out.push({
        ...s,
        cases: s.cases.map((c) => ({ value: c.value, body: dropDead(c.body, used, writes) })),
        defaultBody: s.defaultBody ? dropDead(s.defaultBody, used, writes) : undefined,
      })
    } else {
      out.push(s)
    }
  }
  return out
}

function dceFn(f: FuncDecl, writes: FnWrites): FuncDecl {
  if (bodyHasRaw(f.body)) return f
  const used = new Set<string>()
  for (const s of f.body) collectStmtNames(s, used)
  return { ...f, body: dropDead(f.body, used, writes) }
}

/** Remove dead function-local bindings, and effect-free `call` statements, throughout a
 *  module. Pure (module -> module). */
export function dce(m: ModuleDecl): ModuleDecl {
  const writes = fnWrites(m)
  return { ...m, funcs: m.funcs.map((f) => dceFn(f, writes)) }
}
