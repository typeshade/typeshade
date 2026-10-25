// ═══ Shader DSL — dead-code elimination pass (Optimization context) ═══
//
// Drops a function-local `let`/`var` whose name is never read, and a `call` statement
// whose call has no effect. Conservative + safe: exprs are pure EXCEPT for a call to a
// function that writes a binding or its caller's value, or to an effectful intrinsic
// (passes/effects.ts), so an unread binding whose initializer has no effect has no observable
// effect, and a `call` statement is kept exactly when its call has one (issue #47). An unread
// binding whose initializer DOES have an effect keeps it: `const r = rng.next()` with `r`
// never read still advances `rng`, so the binding becomes the call statement it amounts to.
// It used to be dropped whole, write and all: `const unused = next()` on a helper that bumps a
// module variable vanished from both emits while the CPU oracle, which runs no optimizer,
// still ran it, and a method that changes its object and returns a value (§26) made that the
// common case. An unread `let w = workgroupUniformLoad(flag)` still synchronises, and keeps
// its declaration rather than becoming a call statement (see dropDead).
//   • Pure direct/compound stores to an unread scalar local are dead too. Its own
//     store's self-read is not an external use. Aggregate places, for headers and
//     every other read remain uses; the existing fixed point removes dependencies.
//   • a fn containing a raw Stmt is skipped entirely — raw WGSL may reference a
//     name DCE cannot see (the polygon composer's `var _mcSS`). Same leniency as
//     the validator's scope rule.
//   • module bindings / varyings are NOT touched — they are IO/layout contracts
//     (deferred to the resource model, P4).

import type { Expr, Stmt, ModuleDecl, FuncDecl } from '../../ir/index.js';
import {
  EFFECTFUL_INTRINSICS,
  exprHasEffect,
  exprWrites,
  fnWrites,
  type FnWrites,
} from '../effects.js';
import { isKnownIntrinsic } from '../../intrinsics.js';
import { eachExpr, eachStmtExpr } from '../../ir/visit.js';

// A write-free helper may still contain raw text, an unknown call or an atomic load.
// Key this proof by the inherited effect table, so a one-function optimization view
// keeps the ORIGINAL whole-module proof. Cycles and missing bodies remain unknown.
const discardableFunctions = new WeakMap<FnWrites, ReadonlySet<string>>();

function bodyDiscards(body: readonly Stmt[]): boolean {
  let found = false;
  const scan = (s: Stmt): void => {
    if (s.s === 'discard') found = true;
    eachStmtExpr(s, () => {}, scan);
  };
  for (const s of body) scan(s);
  return found;
}

function canDiscard(e: Expr, writes: FnWrites, pure: ReadonlySet<string>): boolean {
  if (exprHasEffect(e, writes)) return false;
  let safe = true;
  eachExpr(e, (x) => {
    if (x.op !== 'call') return;
    if (
      EFFECTFUL_INTRINSICS.has(x.fn) ||
      (!pure.has(x.fn) && (writes.has(x.fn) || x.declRef !== undefined || !isKnownIntrinsic(x.fn)))
    )
      safe = false;
  });
  return safe;
}

/** Seed DCE's private proof before optimization creates one-function views. @internal */
export function prepareDce(m: ModuleDecl): void {
  const writes = fnWrites(m);
  if (discardableFunctions.has(writes)) return;
  const pure = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of m.funcs) {
      if (
        pure.has(f.name) ||
        (writes.get(f.name)?.size ?? 0) > 0 ||
        f.params.some((p) => p.mode === 'inout') ||
        bodyHasRaw(f.body) ||
        bodyDiscards(f.body)
      )
        continue;
      let safe = true;
      for (const s of f.body)
        eachStmtExpr(s, (e) => {
          if (!canDiscard(e, writes, pure)) safe = false;
        });
      if (!safe) continue;
      pure.add(f.name);
      changed = true;
    }
  }
  discardableFunctions.set(writes, pure);
}

function collectExprNames(e: Expr, out: Set<string>, selfStore?: string): void {
  switch (e.op) {
    case 'varref':
    case 'param':
      if (e.name !== selfStore) out.add(e.name);
      break;
    case 'binop':
    case 'compare':
    case 'logical':
      collectExprNames(e.a, out, selfStore);
      collectExprNames(e.b, out, selfStore);
      break;
    case 'unop':
      collectExprNames(e.a, out, selfStore);
      break;
    case 'call':
    case 'construct':
      for (const a of e.args) collectExprNames(a, out, selfStore);
      break;
    case 'member':
      collectExprNames(e.base, out, selfStore);
      break;
    case 'index':
      collectExprNames(e.base, out, selfStore);
      collectExprNames(e.idx, out, selfStore);
      break;
    case 'select':
      collectExprNames(e.cond, out, selfStore);
      collectExprNames(e.ifTrue, out, selfStore);
      collectExprNames(e.ifFalse, out, selfStore);
      break;
    case 'matchExpr':
      collectExprNames(e.scrutinee, out, selfStore);
      for (const [, v] of e.cases) collectExprNames(v, out, selfStore);
      collectExprNames(e.default, out, selfStore);
      break;
    default:
      break; // lit / constref
  }
}

function collectStmtNames(s: Stmt, out: Set<string>, scalarStores: ReadonlySet<string>): void {
  switch (s.s) {
    case 'let':
      collectExprNames(s.expr, out);
      break;
    case 'var':
      if (s.init !== undefined) collectExprNames(s.init, out);
      break;
    case 'assign':
    case 'assignOp':
      if (s.target.op === 'varref' && scalarStores.has(s.target.name)) {
        // Ignore only this proven-discardable store's own read. Never erase an
        // existing root, or another RHS name: cross-variable cycles stay live.
        collectExprNames(s.expr, out, s.target.name);
      } else {
        collectExprNames(s.target, out);
        collectExprNames(s.expr, out);
      }
      break;
    case 'return':
      if (s.expr !== undefined) collectExprNames(s.expr, out);
      break;
    case 'call':
      collectExprNames(s.expr, out);
      break;
    case 'if':
      for (const arm of s.arms) {
        collectExprNames(arm.cond, out);
        for (const b of arm.body) collectStmtNames(b, out, scalarStores);
      }
      if (s.elseBody) for (const b of s.elseBody) collectStmtNames(b, out, scalarStores);
      break;
    case 'for':
      collectStmtNames(s.init, out, new Set());
      collectExprNames(s.cond, out);
      collectStmtNames(s.update, out, new Set());
      for (const b of s.body) collectStmtNames(b, out, scalarStores);
      break;
    case 'switch':
      collectExprNames(s.scrut, out);
      for (const c of s.cases) for (const b of c.body) collectStmtNames(b, out, scalarStores);
      if (s.defaultBody) for (const b of s.defaultBody) collectStmtNames(b, out, scalarStores);
      break;
    default:
      break;
  }
}

export function bodyHasRaw(body: readonly Stmt[]): boolean {
  for (const s of body) {
    if (s.s === 'raw') return true;
    if (s.s === 'if') {
      if (s.arms.some((a) => bodyHasRaw(a.body))) return true;
      if (s.elseBody && bodyHasRaw(s.elseBody)) return true;
    } else if (s.s === 'for') {
      if (bodyHasRaw([s.init, s.update, ...s.body])) return true;
    } else if (s.s === 'switch') {
      if (s.cases.some((c) => bodyHasRaw(c.body))) return true;
      if (s.defaultBody && bodyHasRaw(s.defaultBody)) return true;
    }
  }
  return false;
}

function dropDead(
  body: readonly Stmt[],
  used: ReadonlySet<string>,
  writes: FnWrites,
  pure: ReadonlySet<string>,
  scalarStores: ReadonlySet<string>,
): Stmt[] {
  const out: Stmt[] = [];
  for (const s of body) {
    if ((s.s === 'let' || s.s === 'var') && !used.has(s.name)) {
      // A dead local, unless its initializer does something besides produce the value. A
      // write stays as the call statement a bare call amounts to, or as the declaration when
      // the call sits deeper. An effect that writes nothing — `workgroupUniformLoad`
      // synchronises — keeps the declaration: WGSL's @must_use builtins cannot stand alone as
      // a call statement, and an unread `let old = atomicAdd(cnt, 1u)` still counts either way.
      const init = s.s === 'let' ? s.expr : s.init;
      if (init === undefined || canDiscard(init, writes, pure)) continue;
      if (init.op === 'call' && exprWrites(init, writes)) {
        out.push({ s: 'call', expr: init, ...(s.span !== undefined ? { span: s.span } : {}) });
        continue;
      }
    }
    // A call kept for its effect stays; one with none (`max(a, b);`, or a call a pass folded
    // to a value) computes and drops, which is nothing.
    if (s.s === 'call' && canDiscard(s.expr, writes, pure)) continue;
    if (
      (s.s === 'assign' || s.s === 'assignOp') &&
      s.target.op === 'varref' &&
      scalarStores.has(s.target.name) &&
      !used.has(s.target.name)
    )
      continue;
    if (s.s === 'if') {
      out.push({
        ...s,
        arms: s.arms.map((a) => ({
          cond: a.cond,
          body: dropDead(a.body, used, writes, pure, scalarStores),
        })),
        elseBody: s.elseBody ? dropDead(s.elseBody, used, writes, pure, scalarStores) : undefined,
      });
    } else if (s.s === 'for') {
      out.push({ ...s, body: dropDead(s.body, used, writes, pure, scalarStores) });
    } else if (s.s === 'switch') {
      out.push({
        ...s,
        cases: s.cases.map((c) => ({
          values: c.values,
          body: dropDead(c.body, used, writes, pure, scalarStores),
        })),
        defaultBody: s.defaultBody
          ? dropDead(s.defaultBody, used, writes, pure, scalarStores)
          : undefined,
      });
    } else {
      out.push(s);
    }
  }
  return out;
}

function dceFn(f: FuncDecl, writes: FnWrites, pure: ReadonlySet<string>): FuncDecl {
  if (bodyHasRaw(f.body)) return f;
  const scalarStores = new Set<string>();
  const blocked = new Set(f.params.map((p) => p.name));
  const scan = (s: Stmt): void => {
    if (s.s === 'var' && s.type.kind === 'scalar') {
      scalarStores.add(s.name);
      if (s.init !== undefined && !canDiscard(s.init, writes, pure)) blocked.add(s.name);
    } else if ((s.s === 'assign' || s.s === 'assignOp') && s.target.op === 'varref') {
      if (!canDiscard(s.expr, writes, pure)) blocked.add(s.target.name);
    }
    // Header stores are still uses, and header declarations are not candidates.
    if (s.s === 'for') {
      for (const b of s.body) scan(b);
    } else eachStmtExpr(s, () => {}, scan);
  };
  for (const s of f.body) scan(s);
  for (const name of blocked) scalarStores.delete(name);
  const used = new Set<string>();
  for (const s of f.body) collectStmtNames(s, used, scalarStores);
  return { ...f, body: dropDead(f.body, used, writes, pure, scalarStores) };
}

/** Remove dead function-local bindings, and effect-free `call` statements, throughout a
 *  module. Pure (module -> module). */
export function dce(m: ModuleDecl): ModuleDecl {
  prepareDce(m);
  const writes = fnWrites(m);
  const pure = discardableFunctions.get(writes)!;
  return { ...m, funcs: m.funcs.map((f) => dceFn(f, writes, pure)) };
}
