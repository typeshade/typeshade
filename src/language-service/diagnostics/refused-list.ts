import ts from 'typescript';
import { TS_CODES } from '../../compiler/ts/codes.js';
import { nodeAtPosition } from '../positions.js';
import type { TypeshadeDiagnostic } from '../types.js';
import { spanOfNode } from './spans.js';

export function repeatsRefusedListUses(
  context: { readonly sourceFile: ts.SourceFile; readonly checker: ts.TypeChecker | undefined },
  diagnostic: TypeshadeDiagnostic,
  compilerErrors: readonly TypeshadeDiagnostic[],
): boolean {
  if (diagnostic.source !== 'typescript' || diagnostic.code !== 2345) return false;
  if (context.checker === undefined) return false;
  const argument = nodeAtPosition(context.sourceFile, diagnostic.span.start);
  if (!ts.isIdentifier(argument)) return false;
  const declaration = context.checker.getSymbolAtLocation(argument)?.valueDeclaration;
  if (
    declaration === undefined ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer === undefined ||
    !ts.isArrayLiteralExpression(declaration.initializer)
  ) {
    return false;
  }
  const name = spanOfNode(declaration.name, declaration.getSourceFile());
  return compilerErrors.some(
    (error) =>
      error.code === TS_CODES.TYPE_MISMATCH &&
      error.span.start === name.start &&
      error.span.length === name.length,
  );
}
