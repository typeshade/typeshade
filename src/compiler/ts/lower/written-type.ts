import ts from 'typescript';
import type { LoweringScope } from '../context.js';
import { hasNoWrittenType } from '../abstract-const.js';
import { isIntegerLiteralTree } from '../lit-coerce.js';
import { untypedListOf } from './expression-array/untyped-list.js';

export function writtenIntegerTree(node: ts.Expression, scope: LoweringScope): boolean {
  if (ts.isParenthesizedExpression(node)) return writtenIntegerTree(node.expression, scope);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return writtenIntegerTree(node.operand, scope);
  }
  if (ts.isIdentifier(node)) return scope.resolve(node.text)?.abstract?.integerWritten === true;
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    return (
      (k === ts.SyntaxKind.PlusToken ||
        k === ts.SyntaxKind.MinusToken ||
        k === ts.SyntaxKind.AsteriskToken ||
        k === ts.SyntaxKind.SlashToken) &&
      writtenIntegerTree(node.left, scope) &&
      writtenIntegerTree(node.right, scope)
    );
  }
  return isIntegerLiteralTree(node);
}

export function writtenTypeOf(
  decl: ts.VariableDeclaration | ts.PropertyDeclaration,
  sourceFile: ts.SourceFile,
): ts.TypeNode | undefined {
  const projectedList =
    decl.type !== undefined &&
    decl.initializer !== undefined &&
    untypedListOf(decl.initializer, true) !== undefined &&
    hasNoWrittenType(decl, sourceFile);
  return projectedList ? undefined : decl.type;
}
