import ts from 'typescript';

export interface ImportEdge {
  from: ts.SourceFile;
  target: ts.SourceFile;
  specifier: string;
  line: number;
  typeOnly: boolean;
}

function importIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name !== undefined) return false;
  const bindings = clause.namedBindings;
  if (bindings === undefined || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function exportIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

function targetOf(checker: ts.TypeChecker, specifier: ts.Expression): ts.SourceFile | undefined {
  const symbol = checker.getSymbolAtLocation(specifier);
  return symbol?.declarations?.find(ts.isSourceFile);
}

export function importEdges(checker: ts.TypeChecker, source: ts.SourceFile): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const statement of source.statements) {
    const isImport = ts.isImportDeclaration(statement);
    if (!isImport && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    const target = targetOf(checker, specifier);
    if (target === undefined) continue;
    edges.push({
      from: source,
      target,
      specifier: specifier.text,
      line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
      typeOnly: isImport ? importIsTypeOnly(statement) : exportIsTypeOnly(statement),
    });
  }
  return edges;
}
