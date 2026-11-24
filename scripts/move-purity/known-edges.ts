import ts from 'typescript';

export const LAYER_POLICY_PATH = 'src/layer-policy.test.ts';

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function knownStatement(
  source: ts.SourceFile,
): { statement: ts.VariableStatement; array: ts.ArrayLiteralExpression } | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'KNOWN') continue;
      const initializer = declaration.initializer && unwrap(declaration.initializer);
      if (initializer && ts.isArrayLiteralExpression(initializer)) {
        return { statement, array: initializer };
      }
    }
  }
  return undefined;
}

export function knownEdges(source: ts.SourceFile | undefined): Set<string> {
  const edges = new Set<string>();
  const known = source && knownStatement(source);
  for (const element of known?.array.elements ?? []) {
    if (ts.isStringLiteralLike(element)) edges.add(element.text);
  }
  return edges;
}

export function textWithoutKnownEdges(
  source: ts.SourceFile,
  statement: ts.Statement,
  from: number,
  to: number,
): string | undefined {
  const known = knownStatement(source);
  if (!known || known.statement !== statement) return undefined;
  const { array } = known;
  let inner = source.text.slice(array.getStart(source), array.end);
  const offset = array.getStart(source);
  const removals = array.elements
    .filter(ts.isStringLiteralLike)
    .map((element) => [element.getStart(source) - offset, element.end - offset] as const)
    .reverse();
  for (const [start, end] of removals) inner = inner.slice(0, start) + inner.slice(end);
  const empty = inner.replace(/[\s,]/g, '');
  return source.text.slice(from, array.getStart(source)) + empty + source.text.slice(array.end, to);
}
