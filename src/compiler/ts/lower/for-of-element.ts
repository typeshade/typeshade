import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { LoweringScope } from '../context.js';
import { inferredOfExpr } from '../use-inference.js';

export function defineLoopElement(
  scope: LoweringScope,
  name: string,
  type: ShaderType,
  mutable: boolean,
  array: Expr,
): ReturnType<LoweringScope['define']> {
  const list = inferredOfExpr(array);
  return scope.define({
    kind: 'local',
    name,
    type,
    mutable,
    ...(list?.list !== undefined ? { inferred: list } : {}),
  });
}
