import ts from 'typescript';

export interface LayerPolicy {
  mayImport: Readonly<Record<string, readonly string[]>>;
  known: readonly string[];
}

export const LAYER_POLICY_PATH = 'src/layer-policy.test.ts';

function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return unwrap(node.expression);
  return node;
}

function initialiserOf(source: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const matches = ts.isIdentifier(declaration.name) && declaration.name.text === name;
      if (matches && declaration.initializer !== undefined) return unwrap(declaration.initializer);
    }
  }
  return undefined;
}

function stringList(node: ts.Expression | undefined): string[] | undefined {
  if (node === undefined) return undefined;
  const array = unwrap(node);
  if (!ts.isArrayLiteralExpression(array)) return undefined;
  const items: string[] = [];
  for (const element of array.elements) {
    if (!ts.isStringLiteralLike(element)) return undefined;
    items.push(element.text);
  }
  return items;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function recordOfLists(node: ts.Expression | undefined): Record<string, string[]> | undefined {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) return undefined;
  const record: Record<string, string[]> = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const key = propertyName(property.name);
    const list = stringList(property.initializer);
    if (key === undefined || list === undefined) return undefined;
    record[key] = list;
  }
  return record;
}

export function parseLayerPolicy(source: ts.SourceFile): LayerPolicy | undefined {
  const mayImport = recordOfLists(initialiserOf(source, 'MAY_IMPORT'));
  const known = stringList(initialiserOf(source, 'KNOWN'));
  if (mayImport === undefined || known === undefined) return undefined;
  return { mayImport, known };
}
