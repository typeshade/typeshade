import type { Stmt } from '../../../core/ir/nodes.js';
import type { LoweringScope } from '../context.js';
import { foldConstNumber } from './fold-const.js';
import { isInduct } from './exit-compare.js';

export type Step =
  | { readonly op: 'add'; readonly by: number }
  | { readonly op: 'mul'; readonly by: number }
  | { readonly op: 'div'; readonly by: number };

export function readStep(update: Stmt, name: string, scope: LoweringScope): Step | undefined {
  if (update.s === 'assignOp') {
    if (!isInduct(update.target, name)) return undefined;
    const c = foldConstNumber(update.expr, scope);
    if (c === undefined) return undefined;
    if (update.bop === '+') return { op: 'add', by: c };
    if (update.bop === '-') return { op: 'add', by: -c };
    if (update.bop === '*') return { op: 'mul', by: c };
    if (update.bop === '/') return { op: 'div', by: c };
    return undefined;
  }
  if (update.s === 'assign' && isInduct(update.target, name) && update.expr.op === 'binop') {
    const e = update.expr;
    if (e.bop === '+') {
      const c = isInduct(e.a, name)
        ? foldConstNumber(e.b, scope)
        : isInduct(e.b, name)
          ? foldConstNumber(e.a, scope)
          : undefined;
      return c === undefined ? undefined : { op: 'add', by: c };
    }
    if (e.bop === '-' && isInduct(e.a, name)) {
      const c = foldConstNumber(e.b, scope);
      return c === undefined ? undefined : { op: 'add', by: -c };
    }
  }
  return undefined;
}

export function stepText(name: string, step: Step): string {
  if (step.op === 'add') return step.by < 0 ? `${name} -= ${-step.by}` : `${name} += ${step.by}`;
  return `${name} ${step.op === 'mul' ? '*' : '/'}= ${step.by}`;
}

export function forUpdateRefusal(shown: string): string {
  return `for-update must be ${shown}++ / ${shown} += <const>, or ${shown} *= / /= <const>.`;
}

export function stalls(step: Step): string | undefined {
  if (step.op === 'add') return step.by === 0 ? 'a step of 0 leaves it where it is.' : undefined;
  if (step.by === 1) return 'multiplying or dividing by 1 leaves it where it is.';
  if (step.by === 0) {
    return step.op === 'mul' ? 'multiplying by 0 pins it at 0.' : 'dividing by 0 cannot move it.';
  }
  return undefined;
}
