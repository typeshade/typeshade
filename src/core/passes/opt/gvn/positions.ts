import type { Expr, Stmt } from '../../../ir/index.js';
import { eachExpr, keyOf, mapStmtValue } from '../expr-utils.js';

export function exprsRunOncePerBlockRun(s: Stmt): readonly Expr[] {
  switch (s.s) {
    case 'let':
      return [s.expr];
    case 'var':
      return s.init !== undefined ? [s.init] : [];
    case 'assign':
    case 'assignOp':
      return [s.expr];
    case 'return':
      return s.expr !== undefined ? [s.expr] : [];
    case 'if':
      return s.arms.length > 0 ? [s.arms[0]!.cond] : [];
    default:
      return [];
  }
}

export function exprsThatMayReadATemp(s: Stmt): readonly Expr[] {
  const own = exprsRunOncePerBlockRun(s);
  if (s.s !== 'if' || s.arms.length < 2) return own;
  return [...own, ...s.arms.slice(1).map((a) => a.cond)];
}

export function rewriteTempReads(s: Stmt, f: (e: Expr) => Expr): Stmt {
  const t = mapStmtValue(s, f);
  if (t.s !== 'if' || t.arms.length < 2) return t;
  return { ...t, arms: t.arms.map((a, i) => (i === 0 ? a : { ...a, cond: f(a.cond) })) };
}

export function mentionsKey(e: Expr, k: string): boolean {
  let found = false;
  eachExpr(e, (x) => {
    if (!found && keyOf(x) === k) found = true;
  });
  return found;
}

export function isNestingStmt(s: Stmt): boolean {
  return s.s === 'if' || s.s === 'for' || s.s === 'switch';
}
