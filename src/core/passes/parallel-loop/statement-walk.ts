import type { Expr, FuncDecl, Stmt } from '../../ir/nodes.js';
import { transparent, isName } from './expression-equality.js';
import type { ForStmt } from './types.js';

export function rootName(e: Expr): string | undefined {
  let b: Expr = e;
  while (b.op === 'index' || b.op === 'member') b = b.base;
  return isName(b) ? b.name : undefined;
}

export function mutableNames(f: FuncDecl): Set<string> {
  const counters = new Set<string>();
  const vars = new Set<string>();
  walk(f.body, (st) => {
    if (st.s === 'for' && st.counted !== undefined) counters.add(st.counted.name);
    if (st.s === 'var') vars.add(st.name);
  });
  for (const n of counters) vars.delete(n);
  return vars;
}

export function boundOf(loop: ForStmt): Expr | undefined {
  const c = loop.cond;
  if (c.op !== 'compare' || c.cop !== '<' || loop.counted === undefined) return undefined;
  const a = transparent(c.a);
  return isName(a) && a.name === loop.counted.name ? c.b : undefined;
}

export function walk(body: readonly Stmt[], visit: (st: Stmt) => void): void {
  for (const st of body) {
    visit(st);
    switch (st.s) {
      case 'if':
        for (const a of st.arms) walk(a.body, visit);
        if (st.elseBody !== undefined) walk(st.elseBody, visit);
        break;
      case 'for':
        visit(st.init);
        visit(st.update);
        walk(st.body, visit);
        break;
      case 'switch':
        for (const c of st.cases) walk(c.body, visit);
        if (st.defaultBody !== undefined) walk(st.defaultBody, visit);
        break;
      default:
        break;
    }
  }
}

export function exprsOf(st: Stmt, visit: (e: Expr) => void): void {
  switch (st.s) {
    case 'let':
      visit(st.expr);
      break;
    case 'var':
      if (st.init !== undefined) visit(st.init);
      break;
    case 'assign':
    case 'assignOp':
      visit(st.target);
      visit(st.expr);
      break;
    case 'call':
      visit(st.expr);
      break;
    case 'return':
      if (st.expr !== undefined) visit(st.expr);
      break;
    case 'if':
      for (const a of st.arms) visit(a.cond);
      break;
    case 'for':
      visit(st.cond);
      break;
    case 'switch':
      visit(st.scrut);
      break;
    default:
      break;
  }
}
