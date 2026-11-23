import type ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import { markAbstractRead } from '../abstract-const.js';
import type { Binding } from '../context.js';
import { markInferredRead } from '../use-inference.js';

export function readModuleConst(binding: Binding, node: ts.Expression): Expr {
  return markInferredRead(
    markAbstractRead(
      { op: 'constref', type: binding.type, name: binding.name },
      node,
      binding.abstract,
    ),
    node,
    binding.inferred,
  );
}
