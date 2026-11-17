import type { Expr, Stmt } from '../../../ir/index.js';
import type { ShaderType } from '../../../ir/types.js';
import { eachExpr } from '../../../ir/visit.js';

export const GUARD_PREFIX = '_guard';
export const MAX_GUARD_TERMS = 24;
export const boolT: ShaderType = { kind: 'scalar', scalar: 'bool' };

const not = (e: Expr): Expr =>
  e.op === 'compare' && e.cop === '==' && e.b.op === 'lit' && e.b.value === false
    ? e.a
    : { op: 'compare', type: boolT, cop: '==', a: e, b: { op: 'lit', type: boolT, value: false } };
const and = (a: Expr, b: Expr): Expr => ({ op: 'logical', type: boolT, lop: '&&', a, b });
const or = (a: Expr, b: Expr): Expr => ({ op: 'logical', type: boolT, lop: '||', a, b });

export const termCount = (e: Expr): number => {
  let n = 0;
  eachExpr(e, (x) => {
    if (x.op === 'compare' || x.op === 'varref') n++;
  });
  return n;
};

export function isGuardName(e: Expr): boolean {
  return e.op === 'varref' && e.name.startsWith(GUARD_PREFIX);
}

type IfStmt = Extract<Stmt, { s: 'if' }>;

function conditionToTakeBranch(chain: IfStmt, branch: number): Expr {
  const conds = chain.arms.map((a) => a.cond);
  let acc: Expr | undefined;
  for (let i = 0; i < Math.min(branch, conds.length); i++) {
    const notEarlier = not(conds[i]!);
    acc = acc === undefined ? notEarlier : and(acc, notEarlier);
  }
  if (branch < conds.length) acc = acc === undefined ? conds[branch]! : and(acc, conds[branch]!);
  return acc ?? { op: 'lit', type: boolT, value: true };
}

export function guardSkipping(chain: IfStmt, skipped: readonly number[]): Expr {
  let takesASkippedBranch: Expr | undefined;
  for (const k of skipped) {
    const p = conditionToTakeBranch(chain, k);
    takesASkippedBranch = takesASkippedBranch === undefined ? p : or(takesASkippedBranch, p);
  }
  return not(takesASkippedBranch!);
}
