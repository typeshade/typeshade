import ts from 'typescript';

const CARRIES = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
]);

export function readsNegativeAsWgsl(division: ts.Expression): boolean {
  let n: ts.Node = division;
  for (;;) {
    const p: ts.Node = n.parent;
    if (ts.isParenthesizedExpression(p) || ts.isPrefixUnaryExpression(p)) n = p;
    else if (ts.isBinaryExpression(p) && CARRIES.has(p.operatorToken.kind)) n = p;
    else if (ts.isElementAccessExpression(p)) return p.argumentExpression === n;
    else {
      return ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'u32';
    }
  }
}

export function heldWraps(division: ts.Expression, allowed: readonly string[]): string[] {
  if (readsNegativeAsWgsl(division)) return [];
  return allowed.map((t) => (t === 'f32' ? 'f32(i32' : t));
}
