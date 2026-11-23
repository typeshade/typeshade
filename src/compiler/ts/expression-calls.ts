import type { Expr } from '../../core/ir/nodes.js';

export function containsCall(e: Expr): boolean {
  switch (e.op) {
    case 'call':
      return true;
    case 'binop':
    case 'compare':
    case 'logical':
      return containsCall(e.a) || containsCall(e.b);
    case 'unop':
      return containsCall(e.a);
    case 'construct':
      return e.args.some(containsCall);
    case 'select':
      return containsCall(e.cond) || containsCall(e.ifTrue) || containsCall(e.ifFalse);
    case 'member':
      return containsCall(e.base);
    case 'index':
      return containsCall(e.base) || containsCall(e.idx);
    default:
      return false;
  }
}
