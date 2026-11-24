import type ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { LoweringScope } from '../context.js';
import { refuseListSpread } from '../lower/expression-array.js';
import { lowerUntypedList } from '../lower/expression-array/untyped-list.js';

export function lowerModuleLetList(
  decl: ts.VariableDeclaration,
  list: ts.ArrayLiteralExpression,
  name: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (refuseListSpread(list, sourceFile, scope, diagnostics)) return undefined;
  const declared = { said: `Module let "${name}"`, head: `let ${name}`, at: decl };
  return lowerUntypedList(list, declared, { sourceFile, scope, diagnostics });
}
