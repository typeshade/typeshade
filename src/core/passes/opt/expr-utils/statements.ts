import type { Expr, Stmt } from '../../../ir/index.js';
import { eachStmtExpr, mapStmtExpr } from '../../../ir/visit.js';

export function mapStmtValue(s: Stmt, f: (e: Expr) => Expr): Stmt {
  switch (s.s) {
    case 'assign':
    case 'assignOp':
      return { ...s, expr: f(s.expr) };
    case 'if': {
      const [first, ...elseIfs] = s.arms;
      return first === undefined
        ? s
        : { ...s, arms: [{ ...first, cond: f(first.cond) }, ...elseIfs] };
    }
    case 'let':
    case 'var':
    case 'return':
      return mapStmtExpr(s, f);
    default:
      return s;
  }
}

export function bodyHasRaw(body: readonly Stmt[]): boolean {
  for (const s of body) {
    if (s.s === 'raw') return true;
    if (s.s === 'if') {
      if (s.arms.some((a) => bodyHasRaw(a.body))) return true;
      if (s.elseBody && bodyHasRaw(s.elseBody)) return true;
    } else if (s.s === 'for') {
      if (bodyHasRaw(s.body)) return true;
    } else if (s.s === 'switch') {
      if (s.cases.some((c) => bodyHasRaw(c.body))) return true;
      if (s.defaultBody && bodyHasRaw(s.defaultBody)) return true;
    }
  }
  return false;
}

export function collectLets<T extends Expr>(
  body: readonly Stmt[],
  accepts: (name: string, e: Expr) => e is T,
): Map<string, T> {
  const out = new Map<string, T>();
  const walk = (s: Stmt): void => {
    if (s.s === 'let' && accepts(s.name, s.expr)) out.set(s.name, s.expr);
    eachStmtExpr(s, () => {}, walk);
  };
  for (const s of body) walk(s);
  return out;
}

export function collectLocals(body: readonly Stmt[], out: Set<string>): void {
  for (const s of body) {
    if (s.s === 'let' || s.s === 'var') out.add(s.name);
    else if (s.s === 'if') {
      for (const a of s.arms) collectLocals(a.body, out);
      if (s.elseBody) collectLocals(s.elseBody, out);
    } else if (s.s === 'for') {
      collectLocals([s.init], out);
      collectLocals(s.body, out);
    } else if (s.s === 'switch') {
      for (const c of s.cases) collectLocals(c.body, out);
      if (s.defaultBody) collectLocals(s.defaultBody, out);
    }
  }
}
