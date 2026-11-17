import type { Expr, Stmt } from '../../../ir/index.js';
import type { FnReads } from '../../effects.js';
import { isCompound, isWorthHoisting, keyOf, refsLocal } from '../expr-utils.js';
import { exprsRunOncePerBlockRun } from './positions.js';

export interface Occur {
  readonly stmts: Set<number>;
  readonly exemplar: Expr;
}

export type Tally = readonly [unguarded: Map<string, Occur>, guardedKeys: Set<string>];

export interface TallyScope {
  readonly localSet: ReadonlySet<string>;
  readonly loadRoots: ReadonlySet<string>;
  readonly reads: FnReads;
}

function tallyExpr(e: Expr, stmt: number, guarded: boolean, scope: TallyScope, into: Tally): void {
  const { localSet, loadRoots, reads } = scope;
  const [unguarded, guardedKeys] = into;
  if (isCompound(e) && isWorthHoisting(e, loadRoots) && refsLocal(e, localSet, reads)) {
    const k = keyOf(e);
    if (guarded) {
      guardedKeys.add(k);
    } else {
      const o = unguarded.get(k);
      if (o) o.stmts.add(stmt);
      else unguarded.set(k, { stmts: new Set([stmt]), exemplar: e });
    }
  }
  const same = (x: Expr): void => tallyExpr(x, stmt, guarded, scope, into);
  const underGuard = (x: Expr): void => tallyExpr(x, stmt, true, scope, into);
  switch (e.op) {
    case 'logical':
      same(e.a);
      underGuard(e.b);
      break;
    case 'select':
      same(e.cond);
      underGuard(e.ifTrue);
      underGuard(e.ifFalse);
      break;
    case 'matchExpr':
      same(e.scrutinee);
      for (const [, v] of e.cases) underGuard(v);
      underGuard(e.default);
      break;
    case 'binop':
    case 'compare':
      same(e.a);
      same(e.b);
      break;
    case 'unop':
      same(e.a);
      break;
    case 'call':
    case 'construct':
      for (const a of e.args) same(a);
      break;
    case 'member':
      same(e.base);
      break;
    case 'index':
      same(e.base);
      same(e.idx);
      break;
    default:
      break;
  }
}

export function tallyBlock(body: readonly Stmt[], scope: TallyScope): Tally {
  const tally: Tally = [new Map(), new Set()];
  body.forEach((s, stmt) => {
    for (const e of exprsRunOncePerBlockRun(s)) tallyExpr(e, stmt, false, scope, tally);
  });
  return tally;
}

export const firstStmtOf = (o: Occur): number => Math.min(...o.stmts);
