import { cmpHolds } from './counted-for.js';
import { logicalTypeKey as typeKey } from '../optional.js';
import type { Expr } from '../../../core/ir/nodes.js';
import { eachExpr } from '../../../core/ir/visit.js';
import type { LoweringScope } from '../context.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { intElemOf } from '../../../core/passes/opt/expr-utils.js';
import { foldConstNumber, foldConstBool } from './fold-const.js';

function foldConstCond(expr: Expr, scope: LoweringScope): boolean | undefined {
  const known = foldConstBool(expr, scope);
  if (known !== undefined) return known;
  if (expr.op === 'constref' || expr.op === 'varref' || expr.op === 'param') {
    const b = scope.resolveIr(expr.name);
    if (!b || typeKey(b.type) !== 'bool' || (expr.op !== 'constref' && b.mutable)) {
      return undefined;
    }
    const v = b.constValue;
    return typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : undefined;
  }
  if (expr.op === 'logical') {
    const a = foldConstCond(expr.a, scope);
    const b = foldConstCond(expr.b, scope);
    const decides = expr.lop === '||';
    if (a === decides || b === decides) return decides;
    return a === undefined || b === undefined ? undefined : !decides;
  }
  if (expr.op === 'compare' && typeKey(expr.type) === 'bool') {
    const a = exactOperand(expr.a, scope);
    const b = exactOperand(expr.b, scope);
    return a === undefined || b === undefined ? undefined : cmpHolds(expr.cop, a, b);
  }
  return undefined;
}

function exactOperand(e: Expr, scope: LoweringScope): number | undefined {
  const b = foldConstCond(e, scope);
  if (b !== undefined) return Number(b);
  let integral = true;
  eachExpr(e, (x) => {
    if (intElemOf(x.type) === undefined && typeKey(x.type) !== 'bool') integral = false;
  });
  if (integral) return foldConstNumber(e, scope);
  const leaf = e.op === 'unop' ? e.a : e;
  if (leaf.op !== 'lit' && leaf.op !== 'constref') return undefined;
  const v = foldConstNumber(e, scope);
  return v !== undefined && Math.fround(v) === v ? v : undefined;
}

export function openLoopError(
  cond: Expr,
  scope: LoweringScope,
  hasExit: boolean,
  loop: string,
): { message: string; code: TsCode } | undefined {
  if (foldConstCond(cond, scope) !== true || hasExit) return undefined;
  return {
    message:
      `${loop} has no break or return in its body, so it never ends. Leave it ` +
      'with a break, or write the exit into the condition.',
    code: TS_CODES.LOOP_INFINITE,
  };
}
