import type { Expr, ModuleDecl } from '../../../core/ir/nodes.js';
import { eachExpr, eachStmtExpr } from '../../../core/ir/visit.js';

const ORDERED = '__orderedSelect';
type Marked = Expr & { [ORDERED]?: true };

export function markOrderedSelect(node: Expr): Expr {
  (node as Marked)[ORDERED] = true;
  return node;
}

export function isOrderedSelect(e: Expr): boolean {
  return (e as Marked)[ORDERED] === true;
}

export function stripOrdered(m: ModuleDecl): void {
  const strip = (root: Expr | undefined): void => {
    if (root === undefined) return;
    eachExpr(root, (e) => {
      if (isOrderedSelect(e)) delete (e as Marked)[ORDERED];
    });
  };
  for (const f of m.funcs) for (const s of f.body) eachStmtExpr(s, strip);
  for (const c of m.consts) strip(c.valueExpr);
  for (const v of m.vars ?? []) strip(v.init);
}
