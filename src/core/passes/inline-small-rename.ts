import type { Expr, Stmt } from '../ir/index.js';
import { mapStmtExpr } from '../ir/visit.js';
import { mapExpr } from './opt/ir-transform.js';
import { declaredNamesDeep } from './inline-linear.js';

export function renameLocals(
  body: readonly Stmt[],
  prefix: string,
  rewrite: (e: Expr) => Expr,
): Stmt[] {
  const ren = new Map<string, string>();
  const taken = new Set<string>();
  for (const name of declaredNamesDeep(body)) {
    let fresh = `${prefix}l_${name.replace(/^_/, '')}`;
    while (taken.has(fresh)) fresh = `${fresh}_`;
    taken.add(fresh);
    ren.set(name, fresh);
  }
  const rw = (e: Expr): Expr =>
    rewrite(
      mapExpr(e, (x) =>
        (x.op === 'varref' || x.op === 'param') && ren.has(x.name)
          ? { ...x, name: ren.get(x.name)! }
          : x,
      ),
    );
  const go = (s: Stmt): Stmt => {
    if (s.s === 'let') return { ...s, name: ren.get(s.name) ?? s.name, expr: rw(s.expr) };
    if (s.s === 'var')
      return {
        ...s,
        name: ren.get(s.name) ?? s.name,
        ...(s.init !== undefined ? { init: rw(s.init) } : {}),
      };
    return mapStmtExpr(s, rw, go);
  };
  return body.map(go);
}

export function adoptTemp(lifted: readonly Stmt[], s: Stmt): Stmt[] {
  const copy = s.s === 'var' && s.init?.op === 'varref' ? s.init.name : undefined;
  if (s.s !== 'var' || copy === undefined || !copy.startsWith('_sm')) return [...lifted, s];
  if (!lifted.some((d) => d.s === 'var' && d.name === copy)) return [...lifted, s];
  const rw = (e: Expr): Expr =>
    mapExpr(e, (x) => (x.op === 'varref' && x.name === copy ? { ...x, name: s.name } : x));
  const go = (d: Stmt): Stmt => {
    if (d.s === 'var' && d.name === copy)
      return { ...d, name: s.name, ...(d.init !== undefined ? { init: rw(d.init) } : {}) };
    if (d.s === 'let') return { ...d, expr: rw(d.expr) };
    return mapStmtExpr(d, rw, go);
  };
  return lifted.map(go);
}
