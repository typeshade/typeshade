import ts from 'typescript';
import { untypedListOf } from '../../compiler/ts/lower/expression-array/untyped-list.js';

const LOGICAL_BITWISE_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
]);

function collect<T extends ts.Node>(
  sourceFile: ts.SourceFile,
  pick: (node: ts.Node) => T | undefined,
): T[] {
  const out: T[] = [];
  const visit = (node: ts.Node): void => {
    const picked = pick(node);
    if (picked !== undefined) out.push(picked);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

export function logicalBitwiseOperations(sourceFile: ts.SourceFile): ts.BinaryExpression[] {
  return collect(sourceFile, (node) =>
    ts.isBinaryExpression(node) && LOGICAL_BITWISE_OPERATORS.has(node.operatorToken.kind)
      ? node
      : undefined,
  );
}

export function reduceCandidates(sourceFile: ts.SourceFile): ts.CallExpression[] {
  return collect(sourceFile, (node) =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'reduce' &&
    node.typeArguments === undefined &&
    node.arguments.length === 2
      ? node
      : undefined,
  );
}

export function fieldCandidates(
  sourceFile: ts.SourceFile,
): (ts.Identifier | ts.PrivateIdentifier)[] {
  return collect(sourceFile, (node) =>
    ts.isPropertyDeclaration(node) &&
    (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) &&
    node.type === undefined &&
    node.initializer !== undefined
      ? node.name
      : undefined,
  );
}

export function listCandidates(sourceFile: ts.SourceFile): ts.Identifier[] {
  return collect(sourceFile, (node) =>
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.type === undefined &&
    node.initializer !== undefined &&
    untypedListOf(node.initializer, true) !== undefined
      ? node.name
      : undefined,
  );
}
