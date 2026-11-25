import ts from 'typescript';

export function isUse(id: ts.Identifier): boolean {
  const p = id.parent;
  if (p === undefined) return false;
  if (ts.isPropertyAccessExpression(p)) return p.name !== id;
  if (ts.isQualifiedName(p)) return p.right !== id;
  if (ts.isShorthandPropertyAssignment(p)) return true;
  if (ts.isBindingElement(p)) return p.name !== id && p.propertyName !== id;
  if (
    ts.isPropertyAssignment(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) ||
    ts.isEnumMember(p) ||
    ts.isParameter(p) ||
    ts.isVariableDeclaration(p) ||
    ts.isFunctionDeclaration(p) ||
    ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) ||
    ts.isClassExpression(p) ||
    ts.isInterfaceDeclaration(p) ||
    ts.isTypeAliasDeclaration(p) ||
    ts.isEnumDeclaration(p) ||
    ts.isModuleDeclaration(p) ||
    ts.isTypeParameterDeclaration(p) ||
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isNamespaceImport(p) ||
    ts.isNamespaceExport(p) ||
    ts.isImportClause(p) ||
    ts.isImportEqualsDeclaration(p) ||
    ts.isLabeledStatement(p) ||
    ts.isBreakOrContinueStatement(p)
  ) {
    return (p as { name?: ts.Node }).name !== id;
  }
  return true;
}

export function identifiersIn(node: ts.Node, out: ts.Identifier[] = []): ts.Identifier[] {
  if (ts.isIdentifier(node)) out.push(node);
  ts.forEachChild(node, (child) => void identifiersIn(child, out));
  return out;
}
