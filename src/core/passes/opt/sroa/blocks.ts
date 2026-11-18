import type { Expr, Stmt } from '../../../ir/index.js';
import { eachExpr, eachStmtExpr, mapStmtExpr } from '../../../ir/visit.js';

export function eachBodyExpr(body: readonly Stmt[], visit: (e: Expr) => void): void {
  const walk = (s: Stmt): void => eachStmtExpr(s, (e) => eachExpr(e, visit), walk);
  for (const s of body) walk(s);
}

export function eachBlockStmt(body: readonly Stmt[], visit: (s: Stmt) => void): void {
  for (const s of body) {
    visit(s);
    if (s.s === 'if') {
      for (const a of s.arms) eachBlockStmt(a.body, visit);
      if (s.elseBody) eachBlockStmt(s.elseBody, visit);
    } else if (s.s === 'for') {
      eachBlockStmt(s.body, visit);
    } else if (s.s === 'switch') {
      for (const c of s.cases) eachBlockStmt(c.body, visit);
      if (s.defaultBody) eachBlockStmt(s.defaultBody, visit);
    }
  }
}

export interface Fused {
  readonly stmts: readonly Stmt[];
  readonly consumed: number;
}

export function rewriteBlocks(
  body: readonly Stmt[],
  expand: (s: Stmt, siblings: readonly Stmt[], next: number) => readonly Stmt[] | Fused | undefined,
  exprs?: (e: Expr) => Expr,
): Stmt[] {
  const block = (b: readonly Stmt[]): Stmt[] => rewriteBlocks(b, expand, exprs);
  const own = (s: Stmt): Stmt => (exprs === undefined ? s : mapStmtExpr(s, exprs, (n) => n));
  const out: Stmt[] = [];
  for (let i = 0; i < body.length; i++) {
    const s = body[i]!;
    const replaced = expand(s, body, i + 1);
    if (replaced !== undefined) {
      if ('stmts' in replaced) {
        out.push(...replaced.stmts);
        i += replaced.consumed;
      } else out.push(...replaced);
      continue;
    }
    const head = own(s);
    if (head.s === 'if') {
      out.push({
        ...head,
        arms: head.arms.map((a) => ({ ...a, body: block(a.body) })),
        elseBody: head.elseBody && block(head.elseBody),
      });
    } else if (head.s === 'for') {
      out.push({ ...head, init: own(head.init), update: own(head.update), body: block(head.body) });
    } else if (head.s === 'switch') {
      out.push({
        ...head,
        cases: head.cases.map((c) => ({ ...c, body: block(c.body) })),
        defaultBody: head.defaultBody && block(head.defaultBody),
      });
    } else out.push(head);
  }
  return out;
}
