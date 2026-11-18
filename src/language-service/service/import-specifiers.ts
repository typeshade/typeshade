import ts from 'typescript';

const importSpecifiers = new WeakMap<ts.SourceFile, readonly string[]>();

export function importSpecifiersOf(sourceFile: ts.SourceFile): readonly string[] {
  const known = importSpecifiers.get(sourceFile);
  if (known !== undefined) return known;
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && ts.isStringLiteral(specifier)) out.push(specifier.text);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        out.push(argument.literal.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    } else if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression)) {
      out.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  importSpecifiers.set(sourceFile, out);
  return out;
}
