import type { Expr, Stmt } from '../../../ir/index.js';
import { eachExpr, eachStmtExpr } from '../../../ir/visit.js';
import { GUARD_PREFIX, isGuardName } from './guard-expr.js';
import { namesIn, namesWrittenOutside, rootOf } from './names.js';

type SafeExpr = (e: Expr) => boolean;

function canBeAProducer(s: Stmt, produced: ReadonlySet<string>, safe: SafeExpr): boolean {
  const declaredInside = new Set<string>();
  const ok = (st: Stmt): boolean => {
    switch (st.s) {
      case 'let':
        declaredInside.add(st.name);
        return safe(st.expr);
      case 'var':
        declaredInside.add(st.name);
        return st.init === undefined || safe(st.init);
      case 'assign':
      case 'assignOp': {
        const root = rootOf(st.target);
        return (
          root !== undefined &&
          (produced.has(root) || declaredInside.has(root)) &&
          safe(st.target) &&
          safe(st.expr)
        );
      }
      case 'if':
        return (
          st.arms.every((a) => safe(a.cond) && a.body.every(ok)) && (st.elseBody ?? []).every(ok)
        );
      default:
        return false;
    }
  };
  if (s.s === 'let' || s.s === 'var') return produced.has(s.name) && ok(s);
  return ok(s);
}

function callsOneOf(s: Stmt, fns: ReadonlySet<string>): boolean {
  let found = false;
  const walk = (st: Stmt): void =>
    eachStmtExpr(
      st,
      (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'call' && fns.has(x.fn)) found = true;
        }),
      walk,
    );
  walk(s);
  return found;
}

export function producersBefore(
  body: readonly Stmt[],
  chainAt: number,
  readByConditions: ReadonlySet<string>,
  readAfterChain: ReadonlySet<string>,
  safe: SafeExpr,
  safeFns: ReadonlySet<string>,
): readonly [members: number[], produced: Set<string>] | undefined {
  const shaped = (i: number): boolean => {
    const st = body[i]!;
    if (st.s === 'if' && st.arms.some((a) => isGuardName(a.cond))) return false;
    return canBeAProducer(st, namesWrittenOutside(st), safe);
  };
  const members = new Set<number>();
  for (let i = 0; i < chainAt; i++) if (callsOneOf(body[i]!, safeFns) && shaped(i)) members.add(i);
  if (members.size === 0) return undefined;
  const produced = new Set<string>();
  for (const i of members) for (const n of namesWrittenOutside(body[i]!)) produced.add(n);
  for (let grew = true; grew;) {
    grew = false;
    for (let i = 0; i < chainAt; i++) {
      if (members.has(i)) continue;
      const touchesProduced = [...namesIn(body[i]!)].some((n) => produced.has(n));
      if (!touchesProduced) continue;
      if (!shaped(i)) return undefined;
      members.add(i);
      for (const n of namesWrittenOutside(body[i]!)) produced.add(n);
      grew = true;
    }
  }
  const declaredByMembers = new Set<string>();
  for (const i of members) {
    const st = body[i]!;
    if (st.s === 'let' || st.s === 'var') declaredByMembers.add(st.name);
  }
  const seenOutside = (n: string): boolean =>
    !declaredByMembers.has(n) ||
    n.startsWith(GUARD_PREFIX) ||
    readByConditions.has(n) ||
    readAfterChain.has(n);
  if ([...produced].some(seenOutside)) return undefined;
  return [[...members].sort((a, b) => a - b), produced];
}
