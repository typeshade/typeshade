import type { Stmt } from '../../../ir/index.js';
import { eachStmtExpr } from '../../../ir/visit.js';
import { collectLocals, collectMutatedRoots, eachExpr } from '../expr-utils.js';

function hasBreakOrContinueOfThisLoop(body: readonly Stmt[]): boolean {
  for (const s of body) {
    if (s.s === 'break' || s.s === 'continue') return true;
    if (s.s === 'if') {
      if (s.arms.some((a) => hasBreakOrContinueOfThisLoop(a.body))) return true;
      if (s.elseBody && hasBreakOrContinueOfThisLoop(s.elseBody)) return true;
    } else if (s.s === 'switch') {
      if (s.cases.some((c) => hasBreakOrContinueOfThisLoop(c.body))) return true;
      if (s.defaultBody && hasBreakOrContinueOfThisLoop(s.defaultBody)) return true;
    }
  }
  return false;
}

export function copiesCanReplaceTheLoop(body: readonly Stmt[], counter: string): boolean {
  const redefined = new Set<string>();
  collectLocals(body, redefined);
  collectMutatedRoots(body, redefined);
  if (redefined.has(counter)) return false;
  const alwaysLeavesInTheFirstIteration = body.some((s) => s.s === 'return' || s.s === 'discard');
  if (alwaysLeavesInTheFirstIteration) return false;
  return !hasBreakOrContinueOfThisLoop(body);
}

export function exprNodeCount(body: readonly Stmt[]): number {
  let n = 0;
  for (const s of body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, () => {
        n++;
      }),
    );
  return n;
}
