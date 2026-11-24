import ts from 'typescript';

export interface EvaluationContext {
  readonly checker: ts.TypeChecker;
  isTracked(fileName: string): boolean;
}

export interface State {
  readonly ctx: EvaluationContext;
  readonly visiting: Set<ts.Node>;
}

const REASON_LIMIT = 60;

export function describeNode(node: ts.Node): string {
  const text = node.getText().replace(/\s+/g, ' ');
  return `${ts.SyntaxKind[node.kind]} ${text.slice(0, REASON_LIMIT)}`;
}

export const unwrap = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

export function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const owner = calleeName(expression.expression);
    return owner === undefined ? undefined : `${owner}.${expression.name.text}`;
  }
  return undefined;
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(expression)) return expression;
  return ts.isPropertyAccessExpression(expression)
    ? rootIdentifier(expression.expression)
    : undefined;
}

export function resolvedDeclaration(symbol: ts.Symbol, st: State): ts.Declaration | undefined {
  let current = symbol;
  for (let step = 0; step < 32 && current.flags & ts.SymbolFlags.Alias; step += 1) {
    current = st.ctx.checker.getAliasedSymbol(current);
  }
  return current.declarations?.[0];
}

export function isGlobalName(call: ts.CallExpression | ts.NewExpression, st: State): boolean {
  const root = rootIdentifier(call.expression);
  const symbol = root && st.ctx.checker.getSymbolAtLocation(root);
  return (symbol?.declarations ?? []).every((d) => !st.ctx.isTracked(d.getSourceFile().fileName));
}

export const OPERATORS_WITH_EFFECTS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);

export const isAssignment = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
