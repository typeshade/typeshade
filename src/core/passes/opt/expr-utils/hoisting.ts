import type { Expr } from '../../../ir/index.js';
import { eachExpr } from '../../../ir/visit.js';
import { targetRoot } from './roots.js';

function readsAPlace(e: Expr): boolean {
  let at = e;
  for (;;) {
    if (at.op === 'varref' || at.op === 'param' || at.op === 'constref') return true;
    if (at.op === 'member' || at.op === 'index') {
      at = at.base;
      continue;
    }
    return false;
  }
}

export function isWorthHoisting(e: Expr, loadRoots?: ReadonlySet<string>): boolean {
  const copiesAWholeAggregate =
    (e.op === 'index' || e.op === 'member') &&
    (e.type.kind === 'struct' || e.type.kind === 'array') &&
    readsAPlace(e);
  if (copiesAWholeAggregate) return false;
  let worth = false;
  eachExpr(e, (x) => {
    if (
      x.op === 'binop' ||
      x.op === 'unop' ||
      x.op === 'compare' ||
      x.op === 'logical' ||
      x.op === 'call' ||
      x.op === 'construct' ||
      x.op === 'select' ||
      x.op === 'matchExpr'
    ) {
      worth = true;
      return;
    }
    if (loadRoots === undefined || x.op !== 'index') return;
    const root = targetRoot(x.base);
    if (root !== undefined && loadRoots.has(root)) worth = true;
  });
  return worth;
}
