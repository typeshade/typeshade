import ts from 'typescript';

export type ReadonlyArrayOperator = ts.TypeOperatorNode & { readonly type: ts.ArrayTypeNode };

export function isReadonlyArrayOperator(node: ts.TypeNode): node is ReadonlyArrayOperator {
  return (
    ts.isTypeOperatorNode(node) &&
    node.operator === ts.SyntaxKind.ReadonlyKeyword &&
    ts.isArrayTypeNode(node.type)
  );
}

export function isReadonlyArrayReference(node: ts.TypeNode): node is ts.TypeReferenceNode {
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === 'ReadonlyArray' &&
    node.typeArguments?.length === 1
  );
}
