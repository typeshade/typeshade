import type { Expr, Stmt } from '../../../ir/index.js';
import { collectLocals } from '../expr-utils.js';
import { mapExpr, mapStmt } from '../ir-transform.js';
import { copiesCanReplaceTheLoop, exprNodeCount } from './body.js';
import { analyzeLoop, MAX_TRIP, NO_CONSTS, type ForStmt, type IntConsts } from './trip-count.js';

export const MAX_UNROLLED_NODES = 64;

function renameLocals(s: Stmt, newNames: ReadonlyMap<string, string>): Stmt {
  const inExpr = (e: Expr): Expr =>
    mapExpr(e, (x) =>
      (x.op === 'varref' || x.op === 'param') && newNames.has(x.name)
        ? { ...x, name: newNames.get(x.name)! }
        : x,
    );
  const renamed = (name: string): string => newNames.get(name) ?? name;
  const inBody = (body: readonly Stmt[]): Stmt[] => body.map((b) => renameLocals(b, newNames));
  switch (s.s) {
    case 'let':
      return { s: 'let', name: renamed(s.name), expr: inExpr(s.expr) };
    case 'var':
      return s.init !== undefined
        ? { s: 'var', name: renamed(s.name), type: s.type, init: inExpr(s.init) }
        : { s: 'var', name: renamed(s.name), type: s.type };
    case 'assign':
    case 'assignOp':
      return { ...s, target: inExpr(s.target), expr: inExpr(s.expr) };
    case 'call':
      return { ...s, expr: inExpr(s.expr) };
    case 'return':
      return s.expr !== undefined ? { ...s, expr: inExpr(s.expr) } : s;
    case 'if':
      return {
        ...s,
        arms: s.arms.map((a) => ({ cond: inExpr(a.cond), body: inBody(a.body) })),
        elseBody: s.elseBody && inBody(s.elseBody),
      };
    case 'for':
      return {
        ...s,
        init: renameLocals(s.init, newNames),
        cond: inExpr(s.cond),
        update: renameLocals(s.update, newNames),
        body: inBody(s.body),
      };
    case 'switch':
      return {
        ...s,
        scrut: inExpr(s.scrut),
        cases: s.cases.map((c) => ({ values: c.values, body: inBody(c.body) })),
        defaultBody: s.defaultBody && inBody(s.defaultBody),
      };
    default:
      return s;
  }
}

function withCounterReplaced(s: Stmt, counter: string, value: Expr): Stmt {
  return mapStmt(s, (e) => (e.op === 'varref' && e.name === counter ? value : e));
}

export function tryUnroll(
  s: ForStmt,
  nextSuffix: { n: number },
  maxNodes = MAX_UNROLLED_NODES,
  maxTrip = MAX_TRIP,
  consts: IntConsts = NO_CONSTS,
): Stmt[] | undefined {
  const loop = analyzeLoop(s, maxTrip, consts);
  if (loop === undefined) return undefined;
  if (!copiesCanReplaceTheLoop(s.body, loop.name)) return undefined;
  const oneCopyGrowsNothing = loop.seq.length <= 1;
  if (!oneCopyGrowsNothing && loop.seq.length * exprNodeCount(s.body) > maxNodes) return undefined;

  const locals = new Set<string>();
  collectLocals(s.body, locals);
  const out: Stmt[] = [];
  for (const v of loop.seq) {
    const suffix = nextSuffix.n++;
    const newNames = new Map<string, string>();
    // Why: GLSL ES reserves a name that holds `__`, and `_u0_` + `_cse0` would hold one.
    for (const local of locals) newNames.set(local, `_u${suffix}_${local.replace(/^_/, '')}`);
    const value: Expr = { op: 'lit', type: loop.type, value: v };
    for (const st of s.body) {
      const renamed = newNames.size > 0 ? renameLocals(st, newNames) : st;
      out.push(withCounterReplaced(renamed, loop.name, value));
    }
  }
  return out;
}

export function seedSuffix(body: readonly Stmt[]): number {
  const names = new Set<string>();
  collectLocals(body, names);
  let next = 0;
  for (const name of names) {
    const match = /^_u(\d+)_/.exec(name);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return next;
}
