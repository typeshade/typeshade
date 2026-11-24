import type { ShaderType } from '../../../../core/ir/types.js';
import type { Expr } from '../../../../core/ir/nodes.js';
import type { InferredValue } from '../../use-inference.js';

const listValues = new WeakMap<Expr, InferredValue>();

export function recordListValue(init: Expr, value: InferredValue): void {
  listValues.set(init, value);
}

export function listValueOf(init: Expr | undefined): InferredValue | undefined {
  return init === undefined ? undefined : listValues.get(init);
}

export function listBinding(init: Expr): { readonly inferred?: InferredValue } {
  const inferred = listValueOf(init);
  return inferred === undefined ? {} : { inferred };
}

export function valueExprBinding(c: {
  readonly type: ShaderType;
  readonly valueExpr?: Expr | undefined;
}): {
  readonly valueExpr?: Expr;
  readonly inferred?: InferredValue;
} {
  if (c.type.kind === 'scalar' || c.valueExpr === undefined) return {};
  return { valueExpr: c.valueExpr, ...listBinding(c.valueExpr) };
}
