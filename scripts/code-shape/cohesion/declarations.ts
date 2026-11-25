import ts from 'typescript';

export interface Declaration {
  name: string;
  line: number;
  lines: number;
  nodes: ts.Node[];
  symbol: ts.Symbol | undefined;
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function namedNodes(statement: ts.Statement): { name: ts.Identifier; node: ts.Node }[] {
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name === undefined ? [] : [{ name: statement.name, node: statement }];
  }
  if (!ts.isVariableStatement(statement)) return [];
  const declarators = statement.declarationList.declarations;
  const single = declarators.length === 1;
  return declarators.flatMap((declarator) =>
    bindingNames(declarator.name).map((name) => ({
      name,
      node: single ? statement : declarator,
    })),
  );
}

function linesOf(source: ts.SourceFile, node: ts.Node): { line: number; lines: number } {
  const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const last = source.getLineAndCharacterOfPosition(node.getEnd()).line;
  return { line: first + 1, lines: last - first + 1 };
}

export function declarationsOf(checker: ts.TypeChecker, source: ts.SourceFile): Declaration[] {
  const byName = new Map<string, Declaration>();
  for (const statement of source.statements) {
    for (const { name, node } of namedNodes(statement)) {
      const span = linesOf(source, node);
      const known = byName.get(name.text);
      if (known === undefined) {
        byName.set(name.text, {
          name: name.text,
          line: span.line,
          lines: span.lines,
          nodes: [node],
          symbol: checker.getSymbolAtLocation(name),
        });
      } else {
        known.lines += span.lines;
        known.nodes.push(node);
      }
    }
  }
  return [...byName.values()];
}

export function fileLineCount(source: ts.SourceFile): number {
  const text = source.text;
  const breaks = text.split('\n').length;
  return text.endsWith('\n') ? breaks - 1 : breaks;
}
