import ts from 'typescript';
import { isBuiltinTypeLiteral } from '../../compiler/ts/attribute-types.js';

export function isBuiltinStringLiteral(node: ts.Node): node is ts.StringLiteralLike {
  if (!ts.isStringLiteralLike(node)) return false;
  if (isBuiltinTypeLiteral(node)) return true;
  const call = node.parent;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'builtin' &&
    call.arguments[0] === node
  );
}

export function isAttributeName(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node)) return false;
  const parent = node.parent;
  if (ts.isDecorator(parent) && parent.expression === node) return true;
  return ts.isCallExpression(parent) && parent.expression === node && ts.isDecorator(parent.parent);
}

export function isTypeName(node: ts.Node): node is ts.Identifier {
  return (
    ts.isIdentifier(node) && ts.isTypeReferenceNode(node.parent) && node.parent.typeName === node
  );
}
