import ts from 'typescript';
import { isBuiltinTypeLiteral } from '../../compiler/ts/attribute-types.js';

export function isBuiltinIdLiteral(literal: ts.Node): boolean {
  if (isBuiltinTypeLiteral(literal)) return true;
  const call = literal.parent;
  return (
    ts.isStringLiteralLike(literal) &&
    call !== undefined &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'builtin' &&
    call.arguments[0] === literal
  );
}

export function isAttributeSlot(slot: ts.Node): boolean {
  if (ts.isDecorator(slot)) return true;
  if (!ts.isIdentifier(slot)) return false;
  const parent = slot.parent;
  if (ts.isDecorator(parent) && parent.expression === slot) return true;
  return ts.isCallExpression(parent) && parent.expression === slot && ts.isDecorator(parent.parent);
}

export function isExpressionSlot(slot: ts.Node): boolean {
  if (ts.isLiteralExpression(slot) || ts.isTemplateLiteralToken(slot)) return false;
  if (ts.isClassLike(slot) || ts.isInterfaceDeclaration(slot) || ts.isTypeLiteralNode(slot))
    return false;
  for (let n: ts.Node | undefined = slot; n !== undefined && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isTypeNode(n) || ts.isDecorator(n)) return false;
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return false;
    if (ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return false;
  }
  if (ts.isIdentifier(slot) && slot.parent !== undefined) {
    const parent = slot.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === slot) return false;
    if (ts.getNameOfDeclaration(parent as ts.Declaration) === slot) return false;
  }
  return true;
}
