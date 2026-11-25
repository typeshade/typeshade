import ts from 'typescript';

export interface ImportEdge {
  from: ts.SourceFile;
  target: ts.SourceFile;
  specifier: string;
  line: number;
  typeOnly: boolean;
  dynamic: boolean;
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

const lineIn = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

function staticEdges(checker: ts.TypeChecker, source: ts.SourceFile): ImportEdge[] {
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
      line: lineIn(source, statement),
      typeOnly: isImport ? importIsTypeOnly(statement) : exportIsTypeOnly(statement),
      dynamic: false,
    });
  }
  return edges;
}

function dynamicSpecifier(
  node: ts.Node,
): { literal: ts.StringLiteral; typeOnly: boolean } | undefined {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [argument] = node.arguments;
    return argument !== undefined && ts.isStringLiteral(argument)
      ? { literal: argument, typeOnly: false }
      : undefined;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    const literal = node.argument.literal;
    return ts.isStringLiteral(literal) ? { literal, typeOnly: true } : undefined;
  }
  return undefined;
}

function dynamicEdges(checker: ts.TypeChecker, source: ts.SourceFile): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const visit = (node: ts.Node): void => {
    const found = dynamicSpecifier(node);
    const target = found === undefined ? undefined : targetOf(checker, found.literal);
    if (found !== undefined && target !== undefined) {
      edges.push({
        from: source,
        target,
        specifier: found.literal.text,
        line: lineIn(source, node),
        typeOnly: found.typeOnly,
        dynamic: true,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

const cache = new WeakMap<ts.SourceFile, ImportEdge[]>();

export function importEdges(checker: ts.TypeChecker, source: ts.SourceFile): ImportEdge[] {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  const edges = [...staticEdges(checker, source), ...dynamicEdges(checker, source)];
  cache.set(source, edges);
  return edges;
}

export function edgesByTarget(edges: readonly ImportEdge[]): ImportEdge[] {
  const merged = new Map<ts.SourceFile, ImportEdge>();
  for (const edge of edges) {
    const known = merged.get(edge.target);
    merged.set(
      edge.target,
      known === undefined
        ? edge
        : {
            ...known,
            line: Math.min(known.line, edge.line),
            typeOnly: known.typeOnly && edge.typeOnly,
          },
    );
  }
  return [...merged.values()];
}
