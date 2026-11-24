import type { Expr, ModuleDecl, Stmt } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { eachExpr, eachStmtExpr, mapChildren } from '../../ir/visit.js';

export function mapStmt(st: Stmt, f: (e: Expr) => Expr): Stmt {
  const S = (x: Stmt): Stmt => mapStmt(x, f);
  switch (st.s) {
    case 'let':
      return { ...st, expr: f(st.expr) };
    case 'var':
      return st.init !== undefined ? { ...st, init: f(st.init) } : st;
    case 'assign':
    case 'assignOp':
      return { ...st, target: f(st.target), expr: f(st.expr) };
    case 'call':
      return { ...st, expr: f(st.expr) };
    case 'return':
      return st.expr !== undefined ? { ...st, expr: f(st.expr) } : st;
    case 'if':
      return {
        ...st,
        arms: st.arms.map((a) => ({ cond: f(a.cond), body: a.body.map(S) })),
        ...(st.elseBody !== undefined ? { elseBody: st.elseBody.map(S) } : {}),
      };
    case 'for':
      return {
        ...st,
        init: S(st.init),
        cond: f(st.cond),
        update: S(st.update),
        body: st.body.map(S),
      };
    case 'switch':
      return {
        ...st,
        scrut: f(st.scrut),
        cases: st.cases.map((c) => ({ ...c, body: c.body.map(S) })),
        ...(st.defaultBody !== undefined ? { defaultBody: st.defaultBody.map(S) } : {}),
      };
    default:
      return st;
  }
}

export const typeKey = (t: ShaderType): string => (t.kind === 'scalar' ? t.scalar : t.kind);

export function mapBlock(sts: readonly Stmt[], f: (st: Stmt) => Stmt[] | undefined): Stmt[] {
  const block = (b: readonly Stmt[]): Stmt[] => mapBlock(b, f);
  return sts.flatMap((st): Stmt[] => {
    const own = f(st);
    if (own !== undefined) return own;
    switch (st.s) {
      case 'if':
        return [
          {
            ...st,
            arms: st.arms.map((a) => ({ ...a, body: block(a.body) })),
            ...(st.elseBody !== undefined ? { elseBody: block(st.elseBody) } : {}),
          },
        ];
      case 'for':
        return [{ ...st, body: block(st.body) }];
      case 'switch':
        return [
          {
            ...st,
            cases: st.cases.map((c) => ({ ...c, body: block(c.body) })),
            ...(st.defaultBody !== undefined ? { defaultBody: block(st.defaultBody) } : {}),
          },
        ];
      default:
        return [st];
    }
  });
}

export function placeRoot(e: Expr): Expr {
  return e.op === 'index' || e.op === 'member' ? placeRoot(e.base) : e;
}

export function forEachChild(e: Expr, f: (c: Expr) => void): void {
  mapChildren(e, (c) => {
    f(c);
    return c;
  });
}

export const isRuntimeArray = (t: ShaderType): boolean =>
  t.kind === 'array' && t.size === undefined;

export function writesThroughCall(loop: Stmt, array: string, m: ModuleDecl): boolean {
  const byName = new Map(m.funcs.map((g) => [g.name, g]));
  let found = false;
  eachStmtExpr(loop, (e) =>
    eachExpr(e, (x) => {
      if (found || x.op !== 'call') return;
      const callee = byName.get(x.fn);
      if (callee === undefined) return;
      callee.params.forEach((p, i) => {
        if (p.mode !== 'inout' || x.args[i] === undefined) return;
        let root: Expr = x.args[i]!;
        while (root.op === 'index' || root.op === 'member') root = root.base;
        if ((root.op === 'varref' || root.op === 'param') && root.name === array) found = true;
      });
    }),
  );
  return found;
}
