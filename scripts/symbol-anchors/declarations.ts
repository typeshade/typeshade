import ts from 'typescript';

export type Declarations = ReadonlyMap<string, readonly ts.Node[]>;

function add(map: Map<string, ts.Node[]>, name: string, node: ts.Node): void {
  const known = map.get(name);
  if (known) known.push(node);
  else map.set(name, [node]);
}

function nameText(name: ts.Node | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

export function topLevel(source: ts.SourceFile): Declarations {
  const map = new Map<string, ts.Node[]>();
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(map, declaration.name.text, statement);
      }
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      const name = nameText(statement.name);
      if (name !== undefined) add(map, name, statement);
    }
  }
  return map;
}

function objectLiteralOf(node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  let current = node;
  while (
    current !== undefined &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current !== undefined && ts.isObjectLiteralExpression(current) ? current : undefined;
}

function membersOfDeclaration(declaration: ts.Node): readonly ts.Node[] {
  if (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
    return declaration.members;
  }
  if (ts.isEnumDeclaration(declaration)) return declaration.members;
  if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) {
    return declaration.type.members;
  }
  if (ts.isVariableStatement(declaration)) {
    const isConst = (declaration.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const literal = isConst
      ? objectLiteralOf(declaration.declarationList.declarations[0]?.initializer)
      : undefined;
    return literal === undefined ? [] : literal.properties;
  }
  return [];
}

export function membersOf(declarations: readonly ts.Node[]): Declarations {
  const map = new Map<string, ts.Node[]>();
  for (const declaration of declarations) {
    for (const member of membersOfDeclaration(declaration)) {
      const name = ts.isConstructorDeclaration(member)
        ? 'constructor'
        : nameText((member as ts.NamedDeclaration).name);
      if (name !== undefined) add(map, name, member);
    }
  }
  return map;
}

const isOverloadable = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isMethodSignature(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

export const isMergeable = (nodes: readonly ts.Node[]): boolean =>
  nodes.length > 1 && nodes.every(isOverloadable);

export function testCalls(source: ts.SourceFile): { title: string; node: ts.Node }[] {
  const found: { title: string; node: ts.Node }[] = [];
  const rootName = (expression: ts.Expression): string | undefined => {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return rootName(expression.expression);
    return undefined;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const root = rootName(node.expression);
      const first = node.arguments[0];
      if (
        (root === 'describe' || root === 'it' || root === 'test') &&
        first !== undefined &&
        ts.isStringLiteralLike(first)
      ) {
        found.push({ title: first.text, node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
