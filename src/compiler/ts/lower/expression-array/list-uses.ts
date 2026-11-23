// Implements: Rule 5.1 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { Expr } from '../../../../core/ir/nodes.js';
import { f32T } from '../../../../core/ir/types.js';
import { TS_CODES } from '../../codes.js';
import { decidedType, inferenceConflict, keyOf, useInferenceActive } from '../../use-inference.js';
import { lowerArrayLiteral, pushDiag } from '../expression-array.js';
import { recordListValue } from './list-values.js';
import type { ListDeclaration, ListLowering } from './untyped-list.js';

export function lowerListByUses(
  list: ts.ArrayLiteralExpression,
  declared: ListDeclaration,
  { sourceFile, scope, diagnostics }: ListLowering,
): Expr | undefined {
  const decl = declared.at as ts.VariableDeclaration;
  const conflict = inferenceConflict(sourceFile, decl);
  if (conflict !== undefined) {
    pushDiag(diagnostics, sourceFile, decl.name, conflict, TS_CODES.TYPE_MISMATCH);
    return undefined;
  }
  const decided = decidedType(sourceFile, decl);
  const count = list.elements.length;
  const type = { kind: 'array' as const, elem: decided ?? f32T, size: count };
  const init = lowerArrayLiteral(list, type, sourceFile, scope, diagnostics);
  if (init !== undefined && useInferenceActive(sourceFile)) {
    recordListValue(init, {
      decl,
      key: keyOf(decl),
      name: (decl.name as ts.Identifier).text,
      written: list.getText(sourceFile).replace(/\s+/g, ' '),
      list: count,
      ...(decided !== undefined ? { type: decided } : {}),
    });
  }
  return init;
}
