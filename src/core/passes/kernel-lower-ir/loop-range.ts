import type { Expr } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import type { ForStmt, KernelLoopPlan } from './types.js';

export function rangeOf(
  loop: ForStmt,
): { start: Expr; bound: Expr; cop: KernelLoopPlan['cop']; type: ShaderType } | undefined {
  const c = loop.counted;
  if (c === undefined || loop.init.s !== 'var' || loop.init.init === undefined) return undefined;
  const cond = loop.cond;
  if (cond.op !== 'compare') return undefined;
  const flip = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as const;
  const isCounter = (e: Expr): boolean =>
    (e.op === 'varref' || e.op === 'param') && e.name === c.name;
  let cop: KernelLoopPlan['cop'];
  let bound: Expr;
  if (isCounter(cond.a) && cond.cop in flip) {
    cop = cond.cop as KernelLoopPlan['cop'];
    bound = cond.b;
  } else if (isCounter(cond.b) && cond.cop in flip) {
    cop = flip[cond.cop as keyof typeof flip];
    bound = cond.a;
  } else return undefined;
  if ((cop === '<' || cop === '<=') !== c.step > 0) return undefined;
  return { start: loop.init.init, bound, cop, type: loop.init.type };
}
