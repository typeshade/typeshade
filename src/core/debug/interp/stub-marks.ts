import type { Expr } from '../../ir/index.js';
import type { StepFrame } from './types.js';

export function rootName(target: Expr): string | undefined {
  let e = target;
  for (;;) {
    if (e.op === 'varref' || e.op === 'param') return e.name;
    if (e.op === 'member' || e.op === 'index') {
      e = e.base;
      continue;
    }
    return undefined;
  }
}

export function whole(target: Expr): boolean {
  return target.op === 'varref' || target.op === 'param';
}

export function markStub(
  frame: StepFrame | undefined,
  name: string | undefined,
  derived: boolean,
  canClear: boolean,
): void {
  if (!frame || name === undefined) return;
  if (derived) frame.stubbed.add(name);
  else if (canClear) frame.stubbed.delete(name);
}
