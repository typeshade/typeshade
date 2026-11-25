import type { CmpOp, Expr } from '../../../core/ir/nodes.js';
import { eachExpr } from '../../../core/ir/visit.js';
import type { LoweringScope } from '../context.js';
import { foldConstNumber } from './fold-const.js';

function flipCmp(cop: CmpOp): CmpOp {
  if (cop === '<') return '>';
  if (cop === '>') return '<';
  if (cop === '<=') return '>=';
  if (cop === '>=') return '<=';
  return cop;
}

export const isInduct = (e: Expr, name: string): boolean =>
  (e.op === 'varref' || e.op === 'param') && e.name === name;

interface ExitCompare {
  readonly cop: CmpOp;
  readonly bound: Expr;
  readonly value: number | undefined;
}

export function readCond(cond: Expr, name: string, scope: LoweringScope): ExitCompare | undefined {
  if (cond.op !== 'compare') return undefined;
  if (isInduct(cond.a, name) && !mentions(cond.b, name)) {
    return { cop: cond.cop, bound: cond.b, value: foldConstNumber(cond.b, scope) };
  }
  if (isInduct(cond.b, name) && !mentions(cond.a, name)) {
    return { cop: flipCmp(cond.cop), bound: cond.a, value: foldConstNumber(cond.a, scope) };
  }
  return undefined;
}

function mentions(e: Expr, name: string): boolean {
  let hit = false;
  eachExpr(e, (x) => {
    if ((x.op === 'varref' || x.op === 'param') && x.name === name) hit = true;
  });
  return hit;
}
