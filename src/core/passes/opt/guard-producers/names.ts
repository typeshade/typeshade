import type { Expr, Stmt } from '../../../ir/index.js';
import { eachExpr, eachStmtExpr } from '../../../ir/visit.js';

export function addNamesOf(e: Expr, out: Set<string>): void {
  eachExpr(e, (x) => {
    if (x.op === 'varref') out.add(x.name);
  });
}

export function namesIn(s: Stmt): Set<string> {
  const out = new Set<string>();
  const walk = (st: Stmt): void => {
    if (st.s === 'let' || st.s === 'var') out.add(st.name);
    eachStmtExpr(st, (e) => addNamesOf(e, out), walk);
  };
  walk(s);
  return out;
}

export function rootOf(target: Expr): string | undefined {
  let at = target;
  while (at.op === 'member' || at.op === 'index') at = at.base;
  return at.op === 'varref' ? at.name : undefined;
}

export function namesWrittenOutside(s: Stmt): Set<string> {
  const out = new Set<string>();
  const ownLocals = new Set<string>();
  const walk = (x: Stmt): void => {
    if (x.s === 'let' || x.s === 'var') {
      if (x === s) out.add(x.name);
      else ownLocals.add(x.name);
    } else if (x.s === 'assign' || x.s === 'assignOp') {
      const root = rootOf(x.target);
      if (root !== undefined && !ownLocals.has(root)) out.add(root);
    }
    eachStmtExpr(x, () => {}, walk);
  };
  walk(s);
  return out;
}

export function namesDeclaredOrWritten(
  body: readonly Stmt[],
  from: number,
  to: number,
): Set<string> {
  const out = new Set<string>();
  const walk = (st: Stmt): void => {
    if (st.s === 'let' || st.s === 'var') out.add(st.name);
    if (st.s === 'assign' || st.s === 'assignOp') {
      const root = rootOf(st.target);
      if (root !== undefined) out.add(root);
    }
    eachStmtExpr(st, () => {}, walk);
  };
  for (let i = from; i < to; i++) walk(body[i]!);
  return out;
}
